import re
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document, unwrap_document
from vivepdf.ops._image_frames import (
    ImageFrame,
    compressed_frame,
    frame_box,
    load_frames,
    place_frame,
    shown_size,
)
from vivepdf.ops._naming import sanitize_file_name
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._page_image_files import (
    archive_pages,
    refuse_existing,
    save_joined,
    save_tiff_pages,
    write_page_files,
)
from vivepdf.ops._page_images import (
    RenderSettings,
    RenderSource,
)
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops.convert import IMAGE_EXTENSIONS
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.paths import ReadDir, ReadPath, WriteDir, WritePath
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class ImagesParams(RpcModel):
    path: ReadPath
    password: str | None = None
    output_dir: WriteDir
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


def _single_image(
    document: pymupdf.Document,
    indices: list[int],
    target: Path,
    settings: RenderSettings,
    progress: Progress,
) -> ImagesResult:
    reduced: list[int] = []
    if settings.format == "tiff":
        reduced = save_tiff_pages(document, indices, target, settings, progress)
    else:
        save_joined(document, indices, target, settings, progress)
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
                refuse_existing([target])
            return _single_image(document, indices, target, settings, progress)
        width = len(str(document.page_count))
        names = [f"{base_name}-{index + 1:0{width}d}.{extension}" for index in indices]
        source = RenderSource(unwrap_document(document), params.path, params.password)
        if params.archive:
            target = output_dir / f"{base_name}.zip"
            if not params.overwrite:
                refuse_existing([target])
            written = archive_pages(
                source, list(zip(indices, names, strict=True)), target, settings, progress
            )
        else:
            targets = [output_dir / name for name in names]
            if not params.overwrite:
                refuse_existing(targets)
            written = write_page_files(
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
    images: list[ReadPath] = Field(default_factory=list)
    folders: list[ReadDir] = Field(default_factory=list)
    recursive: bool = False
    sort: Literal["name", "date"] = "name"
    page_size: Literal["image", "a4", "letter"] = "a4"
    orientation: Literal["auto", "portrait", "landscape"] = "auto"
    margin: float = Field(default=0, ge=0, le=200)
    fit: Literal["fit", "fill"] = "fit"
    compress_photos: bool = False
    output: WritePath
    overwrite: bool = False


class ImagesToPdfResult(OutputResult):
    skipped: list[str] = Field(default_factory=list)


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
            source = image if len(frames) == 1 else None
            for frame in frames:
                width, height = _page_size_for(frame, params)
                page = document.new_page(width=width, height=height)
                if params.compress_photos:
                    needed = shown_size(frame_box(page, params.margin), frame, params.fit)
                    frame = compressed_frame(frame, source, needed)
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
