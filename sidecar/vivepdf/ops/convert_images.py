import contextlib
import io
import re
import shutil
import tempfile
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document, unwrap_document
from vivepdf.ops._image_files import eight_bit, open_picture, picture_too_large, picture_unreadable
from vivepdf.ops._naming import sanitize_file_name
from vivepdf.ops._output import OutputResult, prepare_output, save_document, write_atomically
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
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops.convert import IMAGE_EXTENSIONS
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class ImagesParams(RpcModel):
    path: str
    password: str | None = None
    output_dir: str
    format: Literal["png", "jpg", "webp", "tiff"] = "png"
    dpi: int = Field(default=150, ge=36, le=600)
    quality: int = Field(default=88, ge=10, le=100)
    pages: str | None = None
    base_name: str | None = None
    overwrite: bool = False
    single: bool = False
    transparent: bool = False
    gray: bool = False
    archive: bool = False


class ImagesResult(RpcModel):
    outputs: list[str]
    bytes: int
    reduced_pages: list[int] = Field(default_factory=list)
    page_count: int = 0


MAX_JOINED_PIXELS = 250_000_000
PIL_FORMATS = {"png": "PNG", "jpg": "JPEG", "webp": "WEBP", "tiff": "TIFF"}
JOINED_BACKGROUNDS = {"L": 255, "LA": (255, 0), "RGB": (255, 255, 255), "RGBA": (255, 255, 255, 0)}


def _refuse_existing(targets: list[Path]) -> None:
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


def _save_joined(
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


def _save_tiff_pages(
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
class _PageFiles:
    outputs: list[str] = field(default_factory=list)
    reduced: list[int] = field(default_factory=list)
    bytes: int = 0


def _partial_path(target: Path) -> Path:
    return target.parent / f".vivepdf-{uuid.uuid4().hex[:12]}.part"


def _write_page_files(
    source: RenderSource,
    jobs: list[tuple[int, Path]],
    settings: RenderSettings,
    progress: Progress,
) -> _PageFiles:
    partials = {index: _partial_path(target) for index, target in jobs}
    targets = dict(jobs)
    written = _PageFiles()
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


def _archive_pages(
    source: RenderSource,
    jobs: list[tuple[int, str]],
    target: Path,
    settings: RenderSettings,
    progress: Progress,
) -> _PageFiles:
    folder = Path(tempfile.mkdtemp(prefix=".vivepdf-", dir=target.parent))
    try:
        written = _write_page_files(
            source, [(index, folder / name) for index, name in jobs], settings, progress
        )
        progress.check_cancelled()
        progress.report(0.95, "progress.saving")
        write_atomically(target, lambda partial: _write_archive(partial, written.outputs))
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    return _PageFiles([str(target)], written.reduced, target.stat().st_size)


def _single_image(
    document: pymupdf.Document,
    indices: list[int],
    target: Path,
    settings: RenderSettings,
    progress: Progress,
) -> ImagesResult:
    reduced: list[int] = []
    if settings.format == "tiff":
        reduced = _save_tiff_pages(document, indices, target, settings, progress)
    else:
        _save_joined(document, indices, target, settings, progress)
    return ImagesResult(
        outputs=[str(target)],
        bytes=target.stat().st_size,
        reduced_pages=reduced,
        page_count=len(indices),
    )


@op("convert.to_images", ImagesParams)
def to_images(params: ImagesParams, progress: Progress) -> ImagesResult:
    output_dir = Path(params.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    base_name = sanitize_file_name(params.base_name or Path(params.path).stem)
    extension = params.format
    settings = RenderSettings(
        format=params.format,
        dpi=params.dpi,
        quality=params.quality,
        alpha=params.transparent and params.format != "jpg",
        gray=params.gray,
    )
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        if params.single:
            target = output_dir / f"{base_name}.{extension}"
            if not params.overwrite:
                _refuse_existing([target])
            return _single_image(document, indices, target, settings, progress)
        width = len(str(document.page_count))
        names = [f"{base_name}-{index + 1:0{width}d}.{extension}" for index in indices]
        source = RenderSource(unwrap_document(document), params.path, params.password)
        if params.archive:
            target = output_dir / f"{base_name}.zip"
            if not params.overwrite:
                _refuse_existing([target])
            written = _archive_pages(
                source, list(zip(indices, names, strict=True)), target, settings, progress
            )
        else:
            targets = [output_dir / name for name in names]
            if not params.overwrite:
                _refuse_existing(targets)
            written = _write_page_files(
                source, list(zip(indices, targets, strict=True)), settings, progress
            )
    return ImagesResult(
        outputs=written.outputs,
        bytes=written.bytes,
        reduced_pages=written.reduced,
        page_count=len(indices),
    )


def _natural_key(path: Path) -> list[object]:
    return [
        int(token) if token.isdigit() else token.lower() for token in re.split(r"(\d+)", path.name)
    ]


def collect_images(images: list[str], folders: list[str], recursive: bool, sort: str) -> list[Path]:
    found: list[Path] = [Path(item) for item in images]
    for folder in folders:
        root = Path(folder)
        if not root.is_dir():
            raise OpError(
                ErrorCode.FILE_NOT_FOUND, f"folder not found: {root.name}", {"path": folder}
            )
        iterator = root.rglob("*") if recursive else root.iterdir()
        folder_files = [
            item
            for item in iterator
            if item.is_file() and item.suffix.lower().lstrip(".") in IMAGE_EXTENSIONS
        ]
        folder_files.sort(
            key=(lambda item: item.stat().st_mtime) if sort == "date" else _natural_key
        )
        found.extend(folder_files)
    unique: list[Path] = []
    seen: set[Path] = set()
    for item in found:
        resolved = item.resolve()
        if resolved in seen:
            continue
        if not resolved.is_file():
            raise OpError(
                ErrorCode.FILE_NOT_FOUND, f"image not found: {item.name}", {"path": str(item)}
            )
        seen.add(resolved)
        unique.append(resolved)
    return unique


class ImagesToPdfParams(RpcModel):
    images: list[str] = Field(default_factory=list)
    folders: list[str] = Field(default_factory=list)
    recursive: bool = False
    sort: Literal["name", "date"] = "name"
    page_size: Literal["image", "a4", "letter"] = "a4"
    orientation: Literal["auto", "portrait", "landscape"] = "auto"
    margin: float = Field(default=0, ge=0, le=200)
    fit: Literal["fit", "fill"] = "fit"
    output: str
    overwrite: bool = False


class ImagesToPdfResult(OutputResult):
    skipped: list[str] = Field(default_factory=list)


EXIF_ORIENTATION = 0x0112
EXIF_ROTATIONS = {3: 180, 6: 270, 8: 90}
NATIVE_IMAGE_FORMATS = {"JPEG", "MPO", "PNG", "BMP", "GIF", "TIFF", "PPM", "JPEG2000"}
MULTI_FRAME_FORMATS = {"TIFF"}
LOSSY_FORMATS = {"JPEG", "MPO", "WEBP", "HEIF", "AVIF"}
PIL_KEPT_MODES = {"1", "L", "LA", "P", "RGB", "RGBA"}
REENCODED_JPEG_QUALITY = 92
DECODE_PIXEL_LIMIT = 150_000_000
DEFAULT_IMAGE_DPI = 96.0
PLAUSIBLE_DPI = (36.0, 2400.0)


@dataclass(slots=True)
class ImageFrame:
    width: int
    height: int
    filename: str | None = None
    stream: bytes | None = None
    rotate: int = 0
    dpi: float = DEFAULT_IMAGE_DPI


def _image_dpi(info: dict) -> float:
    value = info.get("dpi")
    try:
        horizontal = float(value[0]) if isinstance(value, tuple) else float(value)
    except (TypeError, ValueError, IndexError):
        return DEFAULT_IMAGE_DPI
    low, high = PLAUSIBLE_DPI
    return horizontal if low <= horizontal <= high else DEFAULT_IMAGE_DPI


def _encoded_frame(picture, source_format: str, dpi: float) -> ImageFrame:
    picture = eight_bit(picture)
    if picture.mode not in PIL_KEPT_MODES:
        picture = picture.convert("RGBA" if "A" in picture.getbands() else "RGB")
    buffer = io.BytesIO()
    if picture.mode in ("RGB", "L") and source_format in LOSSY_FORMATS:
        picture.save(buffer, format="JPEG", quality=REENCODED_JPEG_QUALITY)
    else:
        picture.save(buffer, format="PNG")
    return ImageFrame(picture.width, picture.height, stream=buffer.getvalue(), dpi=dpi)


def _native_frame(image: Path) -> ImageFrame:
    try:
        pixmap = pymupdf.Pixmap(str(image))
    except Exception as error:  # noqa: BLE001
        raise picture_unreadable(image) from error
    dpi = float(pixmap.xres) if pixmap.xres else DEFAULT_IMAGE_DPI
    low, high = PLAUSIBLE_DPI
    return ImageFrame(
        pixmap.width,
        pixmap.height,
        filename=str(image),
        dpi=dpi if low <= dpi <= high else DEFAULT_IMAGE_DPI,
    )


def load_frames(image: Path) -> list[ImageFrame]:
    from PIL import ImageOps

    try:
        with open_picture(image) as picture:
            source_format = picture.format or ""
            dpi = _image_dpi(picture.info)
            orientation = picture.getexif().get(EXIF_ORIENTATION, 1)
            frame_count = (
                getattr(picture, "n_frames", 1) if source_format in MULTI_FRAME_FORMATS else 1
            )
            if (
                source_format in NATIVE_IMAGE_FORMATS
                and frame_count == 1
                and orientation
                in (
                    1,
                    3,
                    6,
                    8,
                )
            ):
                width, height = picture.size
                rotate = EXIF_ROTATIONS.get(orientation, 0)
                if rotate in (90, 270):
                    width, height = height, width
                return [ImageFrame(width, height, filename=str(image), rotate=rotate, dpi=dpi)]
            if picture.width * picture.height > DECODE_PIXEL_LIMIT:
                raise picture_too_large(image, picture.width, picture.height)
            if frame_count > 1:
                frames = []
                for position in range(frame_count):
                    picture.seek(position)
                    frames.append(
                        _encoded_frame(picture.copy(), source_format, _image_dpi(picture.info))
                    )
                return frames
            return [_encoded_frame(ImageOps.exif_transpose(picture), source_format, dpi)]
    except OpError:
        raise
    except Exception:  # noqa: BLE001
        return [_native_frame(image)]


def _page_size_for(frame: ImageFrame, params: ImagesToPdfParams) -> tuple[float, float]:
    if params.page_size == "image":
        width, height = frame.width * 72 / frame.dpi, frame.height * 72 / frame.dpi
        scale = min(1.0, 14400 / max(width, height))
        return (width * scale, height * scale)
    width, height = pymupdf.paper_size(params.page_size)
    landscape = params.orientation == "landscape" or (
        params.orientation == "auto" and frame.width > frame.height
    )
    return (height, width) if landscape else (width, height)


def _insert_frame(page: pymupdf.Page, box: pymupdf.Rect, frame: ImageFrame) -> None:
    page.insert_image(
        box,
        filename=frame.filename,
        stream=frame.stream,
        rotate=frame.rotate,
        keep_proportion=True,
    )


def place_frame(page: pymupdf.Page, frame: ImageFrame, margin: float, fit: str) -> None:
    box = page.rect + (margin, margin, -margin, -margin)
    if box.is_empty:
        box = page.rect
    if fit != "fill":
        _insert_frame(page, box, frame)
        return
    scale = max(box.width / frame.width, box.height / frame.height)
    width, height = frame.width * scale, frame.height * scale
    left, top = (box.width - width) / 2, (box.height - height) / 2
    with pymupdf.open() as holder:
        canvas = holder.new_page(width=box.width, height=box.height)
        _insert_frame(canvas, pymupdf.Rect(left, top, left + width, top + height), frame)
        page.show_pdf_page(box, holder, 0)


@op("convert.images_to_pdf", ImagesToPdfParams)
def images_to_pdf(params: ImagesToPdfParams, progress: Progress) -> ImagesToPdfResult:
    target = prepare_output(params.output, params.images, params.overwrite)
    images = collect_images(params.images, params.folders, params.recursive, params.sort)
    if not images:
        raise OpError(ErrorCode.INVALID_PARAMS, "no images found", {"reason": "noImages"})
    chosen = {Path(item).resolve() for item in params.images}
    skipped: list[str] = []
    document = pymupdf.open()
    try:
        for position, image in enumerate(images):
            progress.check_cancelled()
            try:
                frames = load_frames(image)
            except OpError:
                if image in chosen:
                    raise
                skipped.append(image.name)
                continue
            for frame in frames:
                width, height = _page_size_for(frame, params)
                page = document.new_page(width=width, height=height)
                place_frame(page, frame, params.margin, params.fit)
            if position % 5 == 0:
                progress.report(
                    position / len(images),
                    "progress.rendering",
                    {"current": position + 1, "total": len(images)},
                )
        if document.page_count == 0:
            raise OpError(ErrorCode.INVALID_PARAMS, "no images found", {"reason": "noImages"})
        progress.report(0.95, "progress.saving")
        saved = save_document(document, target)
        return ImagesToPdfResult(**saved.model_dump(), skipped=skipped)
    finally:
        document.close()
