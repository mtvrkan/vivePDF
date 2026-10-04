import base64
import contextlib
import io
import math
from pathlib import Path

import numpy as np
import pymupdf
import zxingcpp
from PIL import Image, ImageDraw, ImageOps

from vivepdf.ops._image_files import eight_bit, open_picture
from vivepdf.ops._output import prepare_output, save_document, write_atomically
from vivepdf.ops._studio_merge import merge_rows, row_values, save_output, split_targets
from vivepdf.ops._studio_models import (
    MAX_OUTPUT_PAGES,
    StudioImageInfoParams,
    StudioImageInfoResult,
    StudioImageItem,
    StudioItem,
    StudioPage,
    StudioQrItem,
    StudioQrParams,
    StudioQrResult,
    StudioRenderParams,
    StudioRenderResult,
    StudioShadowItem,
    StudioSvgItem,
    StudioSvgParams,
    StudioSvgResult,
    StudioTextItem,
    StudioVectorItem,
)
from vivepdf.ops._studio_project import build_archive, embed_archive, missing_asset
from vivepdf.ops._studio_shadow import shadow_document
from vivepdf.ops._studio_shaped import draw_shaped, needs_shaping, run_texts
from vivepdf.ops._studio_text import TextFaces, draw_text, from_segments, has_placeholders, layout
from vivepdf.ops._studio_vector import group_opacity, place, vector_document
from vivepdf.ops._svg import clean_svg_markup, drawing_pdf
from vivepdf.ops.create_bulk import PLACEHOLDER, fill_placeholders
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.registry import op

IMAGE_DPI = 300
JPEG_QUALITY = 90
MAX_IMAGE_PIXELS = 80_000_000
MAX_SVG_MARKUP = 4_000_000
PNG_SIGNATURE = bytes([0x89, 0x50, 0x4E, 0x47])
QR_LEVELS = {"L": "L", "M": "M", "Q": "Q", "H": "H"}

Cache = dict[tuple[int, int], tuple[pymupdf.Document, float]]


def _crop(image: Image.Image, item: StudioImageItem) -> Image.Image:
    if item.crop is None:
        return image
    width, height = image.size
    left = round(item.crop.x * width)
    top = round(item.crop.y * height)
    right = min(width, max(left + 1, round((item.crop.x + item.crop.width) * width)))
    bottom = min(height, max(top + 1, round((item.crop.y + item.crop.height) * height)))
    return image.crop((left, top, right, bottom))


def _cover(image: Image.Image, aspect: float) -> Image.Image:
    width, height = image.size
    if width / height > aspect:
        kept = max(1, round(height * aspect))
        left = (width - kept) // 2
        return image.crop((left, 0, left + kept, height))
    kept = max(1, round(width / aspect))
    top = (height - kept) // 2
    return image.crop((0, top, width, top + kept))


def _placed_rect(image: Image.Image, item: StudioImageItem) -> pymupdf.Rect:
    if item.fit != "contain":
        return pymupdf.Rect(0, 0, item.width, item.height)
    width, height = image.size
    scale = min(item.width / width, item.height / height)
    placed_width, placed_height = width * scale, height * scale
    left = (item.width - placed_width) / 2
    top = (item.height - placed_height) / 2
    return pymupdf.Rect(left, top, left + placed_width, top + placed_height)


def _resampled(image: Image.Image, rect: pymupdf.Rect) -> Image.Image:
    limit = IMAGE_DPI / 72
    scale = min(max(image.width / rect.width, image.height / rect.height), limit)
    size = (max(1, round(rect.width * scale)), max(1, round(rect.height * scale)))
    return image if image.size == size else image.resize(size, Image.Resampling.LANCZOS)


def _masked(image: Image.Image, item: StudioImageItem, rect: pymupdf.Rect) -> Image.Image:
    if item.mask == "none" and item.opacity >= 1:
        return image
    alpha = image.getchannel("A")
    shape = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(shape)
    box = (0, 0, image.width - 1, image.height - 1)
    if item.mask == "circle":
        draw.ellipse(box, fill=255)
    elif item.mask == "rounded":
        radius = min(item.radius, rect.width / 2, rect.height / 2) * image.width / rect.width
        draw.rounded_rectangle(box, radius=round(radius), fill=255)
    else:
        draw.rectangle(box, fill=255)
    combined = np.asarray(alpha, dtype=np.float32) * np.asarray(shape, dtype=np.float32) / 255
    combined *= item.opacity
    image.putalpha(Image.fromarray(np.clip(combined, 0, 255).astype(np.uint8), mode="L"))
    return image


def _encoded(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    lowest, _ = image.getchannel("A").getextrema()
    if lowest < 255:
        image.save(buffer, format="PNG", optimize=True)
    else:
        image.convert("RGB").save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buffer.getvalue()


def _picture(path: str) -> Image.Image:
    source = Path(path)
    if not source.is_file():
        raise missing_asset(path)
    try:
        with open_picture(source) as opened:
            return eight_bit(ImageOps.exif_transpose(opened)).convert("RGBA")
    except OpError:
        raise
    except Exception as error:  # noqa: BLE001
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"cannot read image: {source.name}",
            {"reason": "imageUnreadable", "path": path},
        ) from error


def image_document(item: StudioImageItem) -> pymupdf.Document:
    image = _crop(_picture(item.path), item)
    if item.fit == "cover":
        image = _cover(image, item.width / item.height)
    rect = _placed_rect(image, item)
    image = _masked(_resampled(image, rect), item, rect)
    document = pymupdf.open()
    page = document.new_page(width=item.width, height=item.height)
    page.insert_image(rect, stream=_encoded(image), keep_proportion=False)
    return document


def qr_modules(value: str, error_level: str) -> np.ndarray:
    try:
        barcode = zxingcpp.create_barcode(
            value, zxingcpp.BarcodeFormat.QRCode, ec_level=QR_LEVELS[error_level]
        )
    except Exception as error:  # noqa: BLE001
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the QR value cannot be encoded",
            {"reason": "cannotEncode", "format": "qr"},
        ) from error
    raw = zxingcpp.write_barcode_to_image(barcode, scale=1, add_quiet_zones=False)
    modules = np.array(np.array(raw, copy=False), dtype=np.uint8)
    if modules.ndim == 3:
        modules = modules[:, :, 0]
    return modules < 128


def qr_document(item: StudioQrItem, value: str) -> pymupdf.Document:
    dark = qr_modules(value, item.error_level)
    count = dark.shape[0]
    side = min(item.width, item.height)
    unit = side / count
    left = (item.width - side) / 2
    top = (item.height - side) / 2
    document = pymupdf.open()
    page = document.new_page(width=item.width, height=item.height)
    shape = page.new_shape()
    if item.background:
        shape.draw_rect(page.rect)
        shape.finish(color=None, fill=_rgb(item.background))
    for row in range(count):
        column = 0
        while column < count:
            if not dark[row, column]:
                column += 1
                continue
            start = column
            while column < count and dark[row, column]:
                column += 1
            shape.draw_rect(
                pymupdf.Rect(
                    left + start * unit,
                    top + row * unit,
                    left + column * unit,
                    top + (row + 1) * unit,
                )
            )
    shape.finish(color=None, fill=_rgb(item.color))
    shape.commit()
    return group_opacity(document, item.opacity)


def _rgb(colour: str) -> tuple[float, float, float]:
    return tuple(int(colour[index : index + 2], 16) / 255 for index in (1, 3, 5))  # type: ignore[return-value]


def _static(item: StudioItem) -> bool:
    if isinstance(item, StudioQrItem):
        return not PLACEHOLDER.search(item.value)
    if isinstance(item, StudioShadowItem):
        return all(_static(nested) for nested in item.items)
    return not isinstance(item, StudioTextItem)


def _shadow(item: StudioShadowItem, values: dict[str, str]) -> tuple[pymupdf.Document, float]:
    sources: list[tuple[pymupdf.Document, float]] = []
    try:
        for nested in item.items:
            sources.append(_build(nested, values))
        return shadow_document(item, sources)
    finally:
        for source, _ in sources:
            source.close()


def _build(item: StudioItem, values: dict[str, str]) -> tuple[pymupdf.Document, float]:
    if isinstance(item, StudioVectorItem):
        return vector_document(item)
    if isinstance(item, StudioSvgItem):
        return group_opacity(drawing_pdf(item.svg.encode("utf-8"), "drawing"), item.opacity), 0.0
    if isinstance(item, StudioImageItem):
        return image_document(item), 0.0
    if isinstance(item, StudioQrItem):
        return qr_document(item, fill_placeholders(item.value, values)), 0.0
    if isinstance(item, StudioShadowItem):
        return _shadow(item, values)
    raise TypeError(item.kind)


def _source(
    item: StudioItem, key: tuple[int, int], cache: Cache, values: dict[str, str]
) -> tuple[pymupdf.Document, float]:
    if key in cache:
        return cache[key]
    document, margin = _build(item, values)
    if _static(item):
        cache[key] = (document, margin)
    return document, margin


def _faces(font_id: str | None, faces: dict[str | None, TextFaces]) -> TextFaces:
    if font_id not in faces:
        shared = next(iter(faces.values()), None)
        faces[font_id] = TextFaces(font_id, shared.store if shared else None)
    return faces[font_id]


def draw_page(
    document: pymupdf.Document,
    spec: StudioPage,
    page_index: int,
    values: dict[str, str],
    language: str,
    cache: Cache,
    faces: dict[str | None, TextFaces],
) -> str:
    page = document.new_page(width=spec.width, height=spec.height)
    missing: list[str] = []
    for item_index, item in enumerate(spec.items):
        if item.opacity <= 0:
            continue
        if isinstance(item, StudioTextItem):
            text_faces = _faces(item.font_id, faces)
            texts = run_texts(item, values, language)
            if needs_shaping(item, text_faces, texts):
                draw_shaped(page, item, text_faces, values, language)
                continue
            text_layout = (
                from_segments(item)
                if item.segments is not None and not has_placeholders(item)
                else layout(item, text_faces, values, language)
            )
            missing.append(draw_text(page, item, text_faces, text_layout))
            continue
        source, margin = _source(item, (page_index, item_index), cache, values)
        try:
            place(page, source, item, margin)
        finally:
            if not _static(item):
                source.close()
    return "".join(missing)


def _check_images(params: StudioRenderParams) -> list[str]:
    paths = [
        item.path
        for page in params.pages
        for item in page.items
        if isinstance(item, StudioImageItem)
    ]
    for path in paths:
        if not Path(path).is_file():
            raise missing_asset(path)
    return paths


def _image_targets(
    output: str, extension: str, count: int, overwrite: bool, numbers: list[int] | None = None
) -> list[Path]:
    base = Path(output).with_suffix(f".{extension}").resolve()
    labels = numbers if numbers is not None and len(numbers) == count else range(1, count + 1)
    targets = (
        [base]
        if count == 1
        else [base.with_name(f"{base.stem}-{label}{base.suffix}") for label in labels]
    )
    taken = next((target for target in targets if target.exists()), None)
    if taken is not None and not overwrite:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"output already exists: {taken.name}",
            {"exists": True, "path": str(taken)},
        )
    base.parent.mkdir(parents=True, exist_ok=True)
    return targets


def _save_images(
    document: pymupdf.Document,
    targets: list[Path],
    params: StudioRenderParams,
    progress: Progress,
) -> int:
    written = 0
    extension = params.format
    alpha = params.transparent and extension == "png"
    for index, (page, target) in enumerate(zip(document, targets, strict=True)):
        progress.check_cancelled()
        area = page.rect.width * page.rect.height
        scale = min(params.dpi / 72, math.sqrt(MAX_IMAGE_PIXELS / max(area, 1.0)))
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=alpha)
        write_atomically(
            target,
            lambda path, image=pixmap: image.save(
                str(path), output=extension, jpg_quality=params.quality
            ),
        )
        written += target.stat().st_size
        progress.report(0.92 + 0.08 * (index + 1) / len(targets), "progress.saving")
    return written


def _render_split(
    params: StudioRenderParams, rows: list[dict[str, str]], images: list[str], progress: Progress
) -> StudioRenderResult:
    targets = split_targets(params, rows)
    inputs = [*images, *([params.data_path] if params.data_path else [])]
    cache: Cache = {}
    faces: dict[str | None, TextFaces] = {}
    missing: list[str] = []
    size = 0
    pages = 0
    try:
        for row_index, (row, target) in enumerate(zip(rows, targets, strict=True)):
            values = row_values(row, row_index, params.date)
            document = pymupdf.open()
            try:
                for page_index, spec in enumerate(params.pages):
                    progress.check_cancelled()
                    missing.append(
                        draw_page(document, spec, page_index, values, params.language, cache, faces)
                    )
                _describe(document, params)
                pages += document.page_count
                size += save_output(document, target, inputs, params.sign, _save_pdf)
            finally:
                document.close()
            progress.report(
                (row_index + 1) / len(rows),
                "progress.rendering",
                {"current": row_index + 1, "total": len(rows)},
            )
    finally:
        for source, _ in cache.values():
            source.close()
    return StudioRenderResult(
        output=str(targets[0]),
        outputs=[str(target) for target in targets],
        page_count=pages,
        bytes=size,
        missing_glyphs="".join(dict.fromkeys("".join(missing))),
    )


def _describe(document: pymupdf.Document, params: StudioRenderParams) -> None:
    metadata = dict(document.metadata or {})
    metadata.update({"title": params.title.strip(), "creator": "vivePDF"})
    document.set_metadata(metadata)


def _save_pdf(document: pymupdf.Document, target: Path) -> None:
    with contextlib.suppress(Exception):
        document.subset_fonts(fallback=False)
    save_document(document, target)


@op("studio.render", StudioRenderParams)
def render(params: StudioRenderParams, progress: Progress) -> StudioRenderResult:
    if params.page_numbers is not None and len(params.page_numbers) != len(params.pages):
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "page numbers must match the pages",
            {"reason": "badPageNumbers"},
        )
    rows = merge_rows(params)
    images = _check_images(params)
    if params.split:
        return _render_split(params, rows, images, progress)
    total = len(rows) * len(params.pages)
    if total > MAX_OUTPUT_PAGES:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"too many pages: {total}",
            {"reason": "tooManyOutputPages", "limit": MAX_OUTPUT_PAGES},
        )
    if not params.output:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "an output file is required", {"reason": "noOutput"}
        )
    inputs = [*images, *([params.data_path] if params.data_path else [])]
    if params.format == "pdf":
        targets = [prepare_output(params.output, inputs, params.overwrite)]
    else:
        targets = _image_targets(
            params.output, params.format, total, params.overwrite, params.page_numbers
        )
    cache: Cache = {}
    faces: dict[str | None, TextFaces] = {}
    missing: list[str] = []
    document = pymupdf.open()
    try:
        done = 0
        for row_index, row in enumerate(rows):
            values = row_values(row, row_index, params.date)
            for page_index, spec in enumerate(params.pages):
                progress.check_cancelled()
                missing.append(
                    draw_page(document, spec, page_index, values, params.language, cache, faces)
                )
                done += 1
                progress.report(
                    0.9 * done / total, "progress.rendering", {"current": done, "total": total}
                )
        progress.report(0.92, "progress.saving")
        if params.format == "pdf":
            _describe(document, params)
            if (embed := params.embed) is not None:
                embed_archive(document, build_archive(embed.design, embed.assets, b""))
            size = save_output(document, targets[0], inputs, params.sign, _save_pdf)
        else:
            size = _save_images(document, targets, params, progress)
        page_count = document.page_count
    finally:
        document.close()
        for source, _ in cache.values():
            source.close()
    return StudioRenderResult(
        output=str(targets[0]),
        outputs=[str(target) for target in targets],
        page_count=page_count,
        bytes=size,
        missing_glyphs="".join(dict.fromkeys("".join(missing))),
    )


@op("studio.image_info", StudioImageInfoParams)
def image_info(params: StudioImageInfoParams, _progress: Progress) -> StudioImageInfoResult:
    image = _picture(params.path)
    width, height = image.size
    image.thumbnail((params.max_side, params.max_side), Image.Resampling.LANCZOS)
    encoded = _encoded(image)
    mime = "image/png" if encoded.startswith(PNG_SIGNATURE) else "image/jpeg"
    return StudioImageInfoResult(
        width=width, height=height, mime=mime, base64=base64.b64encode(encoded).decode("ascii")
    )


@op("studio.qr", StudioQrParams)
def qr(params: StudioQrParams, _progress: Progress) -> StudioQrResult:
    dark = qr_modules(params.value, params.error_level)
    return StudioQrResult(
        size=int(dark.shape[0]),
        modules="".join("1" if cell else "0" for cell in dark.reshape(-1).tolist()),
    )


@op("studio.import_svg", StudioSvgParams)
def import_svg(params: StudioSvgParams, _progress: Progress) -> StudioSvgResult:
    source = Path(params.path)
    if not source.is_file():
        raise missing_asset(params.path)
    markup, width, height = clean_svg_markup(source, MAX_SVG_MARKUP)
    return StudioSvgResult(svg=markup, width=width, height=height)
