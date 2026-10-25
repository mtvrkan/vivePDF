import contextlib
import io
import shutil
import tempfile
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

from vivepdf.ops._output import write_atomically
from vivepdf.ops._page_images import (
    MAX_IMAGE_SIDE,
    TIFF_COMPRESSION,
    RenderSettings,
    RenderSource,
    page_dpi,
    page_pixmap,
    render_workers,
    rendered_in_order,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress

MAX_JOINED_PIXELS = 250_000_000
PIL_FORMATS = {"png": "PNG", "jpg": "JPEG", "webp": "WEBP", "tiff": "TIFF"}
JOINED_BACKGROUNDS = {"L": 255, "LA": (255, 0), "RGB": (255, 255, 255), "RGBA": (255, 255, 255, 0)}


def refuse_existing(targets: list[Path]) -> None:
    for target in targets:
        if target.exists():
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"output already exists: {target.name}",
                {"exists": True, "path": str(target)},
            )


def _report_rendering(progress: Progress, position: int, total: int) -> None:
    if position % 5 == 0:
        progress.report(
            position / total, "progress.rendering", {"current": position + 1, "total": total}
        )


def joined_size(document: pymupdf.Document, indices: list[int], dpi: int) -> tuple[int, int]:
    matrix = pymupdf.Matrix(dpi / 72, dpi / 72)
    boxes = [(document[index].rect * matrix).irect for index in indices]
    return max(box.width for box in boxes) + 2, sum(box.height + 1 for box in boxes)


def _picture_mode(settings: RenderSettings) -> str:
    if settings.gray:
        return "LA" if settings.alpha else "L"
    return "RGBA" if settings.alpha else "RGB"


def _joined_image(
    document: pymupdf.Document, indices: list[int], settings: RenderSettings, progress
):
    from PIL import Image

    width, height = joined_size(document, indices, settings.dpi)
    if max(width, height) > MAX_IMAGE_SIDE[settings.format] or width * height > MAX_JOINED_PIXELS:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the joined image would be too large",
            {"reason": "imageTooLarge", "width": width, "height": height},
        )
    mode = _picture_mode(settings)
    canvas = Image.new(mode, (width, height), JOINED_BACKGROUNDS[mode])
    top = 0
    widest = 0
    for position, index in enumerate(indices):
        progress.check_cancelled()
        pixmap = page_pixmap(document[index], settings.dpi, settings)
        picture = Image.frombytes(mode, (pixmap.width, pixmap.height), pixmap.samples)
        canvas.paste(picture, ((width - pixmap.width) // 2, top))
        top += pixmap.height
        widest = max(widest, pixmap.width)
        _report_rendering(progress, position, len(indices))
    left = (width - widest) // 2
    return canvas.crop((left, 0, left + widest, top))


def save_joined(
    document: pymupdf.Document,
    indices: list[int],
    target: Path,
    settings: RenderSettings,
    progress: Progress,
) -> None:
    joined = _joined_image(document, indices, settings, progress)
    progress.report(0.95, "progress.saving")
    options: dict[str, object] = {"dpi": (settings.dpi, settings.dpi)}
    if settings.format in ("jpg", "webp"):
        options["quality"] = settings.quality
    if settings.format == "jpg":
        joined = joined.convert("L" if settings.gray else "RGB")
    write_atomically(
        target, lambda partial: joined.save(partial, format=PIL_FORMATS[settings.format], **options)
    )


def save_tiff_pages(
    document: pymupdf.Document,
    indices: list[int],
    target: Path,
    settings: RenderSettings,
    progress: Progress,
) -> list[int]:
    from PIL import TiffImagePlugin

    reduced: list[int] = []

    def write(partial: Path) -> None:
        tiff = TiffImagePlugin.AppendingTiffWriter(str(partial), True)
        try:
            for position, index in enumerate(indices):
                progress.check_cancelled()
                page = document[index]
                dpi = page_dpi(page.rect, settings.dpi, settings.format)
                if dpi != settings.dpi:
                    reduced.append(index + 1)
                picture = page_pixmap(page, dpi, settings).pil_image()
                picture.save(tiff, format="TIFF", compression=TIFF_COMPRESSION, dpi=(dpi, dpi))
                tiff.newFrame()
                _report_rendering(progress, position, len(indices))
            tiff.finalize()
        finally:
            tiff.f.close()
            io.BytesIO.close(tiff)

    write_atomically(target, write)
    return reduced


@dataclass(slots=True)
class PageFiles:
    outputs: list[str] = field(default_factory=list)
    reduced: list[int] = field(default_factory=list)
    bytes: int = 0


def _partial_path(target: Path) -> Path:
    return target.parent / f".vivepdf-{uuid.uuid4().hex[:12]}.part"


def write_page_files(
    source: RenderSource,
    jobs: list[tuple[int, Path]],
    settings: RenderSettings,
    progress: Progress,
) -> PageFiles:
    partials = {index: _partial_path(target) for index, target in jobs}
    targets = dict(jobs)
    written = PageFiles()
    results = rendered_in_order(
        source,
        [(index, partials[index]) for index, _target in jobs],
        settings,
        progress.check_cancelled,
        render_workers(len(jobs)),
    )
    try:
        with contextlib.closing(results):
            for position, (index, reduced) in enumerate(results):
                target = targets[index]
                partials.pop(index).replace(target)
                written.outputs.append(str(target))
                written.bytes += target.stat().st_size
                if reduced:
                    written.reduced.append(index + 1)
                _report_rendering(progress, position, len(jobs))
    except BaseException:
        for path in [*partials.values(), *map(Path, written.outputs)]:
            path.unlink(missing_ok=True)
        raise
    return written


def _write_archive(partial: Path, members: list[str]) -> None:
    with zipfile.ZipFile(partial, "w", zipfile.ZIP_STORED) as archive:
        for path in members:
            archive.write(path, Path(path).name)


def archive_pages(
    source: RenderSource,
    jobs: list[tuple[int, str]],
    target: Path,
    settings: RenderSettings,
    progress: Progress,
) -> PageFiles:
    folder = Path(tempfile.mkdtemp(prefix=".vivepdf-", dir=target.parent))
    try:
        written = write_page_files(
            source, [(index, folder / name) for index, name in jobs], settings, progress
        )
        progress.check_cancelled()
        progress.report(0.95, "progress.saving")
        write_atomically(target, lambda partial: _write_archive(partial, written.outputs))
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    return PageFiles([str(target)], written.reduced, target.stat().st_size)
