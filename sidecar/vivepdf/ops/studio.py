import contextlib
import io
from pathlib import Path

import numpy as np
import pymupdf
import zxingcpp
from PIL import Image, ImageDraw, ImageOps

from vivepdf.ops._image_files import eight_bit, open_picture
from vivepdf.ops._output import prepare_output, save_document
from vivepdf.ops._studio_models import (
    MAX_OUTPUT_PAGES,
    StudioImageItem,
    StudioItem,
    StudioPage,
    StudioQrItem,
    StudioRenderParams,
    StudioRenderResult,
    StudioSvgItem,
    StudioTextItem,
    StudioVectorItem,
)
from vivepdf.ops._studio_text import TextFaces, draw_text, from_segments, has_placeholders, layout
from vivepdf.ops._studio_vector import place, vector_document
from vivepdf.ops._svg import drawing_pdf
from vivepdf.ops.create_bulk import PLACEHOLDER, fill_placeholders
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.registry import op

IMAGE_DPI = 300
JPEG_QUALITY = 90
QR_LEVELS = {"L": "L", "M": "M", "Q": "Q", "H": "H"}

Cache = dict[tuple[int, int], tuple[pymupdf.Document, float]]


def _missing_image(path: str) -> OpError:
    return OpError(
        ErrorCode.FILE_NOT_FOUND,
        f"image not found: {Path(path).name}",
        {"reason": "missingImage", "path": path},
    )


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


def image_document(item: StudioImageItem) -> pymupdf.Document:
    source = Path(item.path)
    if not source.is_file():
        raise _missing_image(item.path)
    try:
        with open_picture(source) as opened:
            image = eight_bit(ImageOps.exif_transpose(opened)).convert("RGBA")
    except OpError:
        raise
    except Exception as error:  # noqa: BLE001
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"cannot read image: {source.name}",
            {"reason": "imageUnreadable", "path": item.path},
        ) from error
    image = _crop(image, item)
    if item.fit == "cover":
        image = _cover(image, item.width / item.height)
    rect = _placed_rect(image, item)
    image = _masked(_resampled(image, rect), item, rect)
    document = pymupdf.open()
    page = document.new_page(width=item.width, height=item.height)
    page.insert_image(rect, stream=_encoded(image), keep_proportion=False)
    return document


def qr_document(item: StudioQrItem, value: str) -> pymupdf.Document:
    try:
        barcode = zxingcpp.create_barcode(
            value, zxingcpp.BarcodeFormat.QRCode, ec_level=QR_LEVELS[item.error_level]
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
    dark = modules < 128
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
        shape.finish(color=None, fill=_rgb(item.background), fill_opacity=item.opacity)
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
    shape.finish(color=None, fill=_rgb(item.color), fill_opacity=item.opacity)
    shape.commit()
    return document


def _rgb(colour: str) -> tuple[float, float, float]:
    return tuple(int(colour[index : index + 2], 16) / 255 for index in (1, 3, 5))  # type: ignore[return-value]


def _static(item: StudioItem) -> bool:
    if isinstance(item, StudioQrItem):
        return not PLACEHOLDER.search(item.value)
    return not isinstance(item, StudioTextItem)


def _source(
    item: StudioItem, key: tuple[int, int], cache: Cache, values: dict[str, str]
) -> tuple[pymupdf.Document, float]:
    if key in cache:
        return cache[key]
    margin = 0.0
    if isinstance(item, StudioVectorItem):
        document, margin = vector_document(item)
    elif isinstance(item, StudioSvgItem):
        document = drawing_pdf(item.svg.encode("utf-8"), "drawing", item.opacity)
    elif isinstance(item, StudioImageItem):
        document = image_document(item)
    elif isinstance(item, StudioQrItem):
        document = qr_document(item, fill_placeholders(item.value, values))
    else:
        raise TypeError(item.kind)
    if _static(item):
        cache[key] = (document, margin)
    return document, margin


def _faces(font_id: str | None, faces: dict[str | None, TextFaces]) -> TextFaces:
    if font_id not in faces:
        faces[font_id] = TextFaces(font_id)
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
            placed = (
                from_segments(item.segments)
                if item.segments is not None and not has_placeholders(item)
                else layout(item, text_faces, values, language)
            )
            missing.append(draw_text(page, item, text_faces, placed))
            continue
        source, margin = _source(item, (page_index, item_index), cache, values)
        try:
            place(page, source, item, margin)
        finally:
            if not _static(item):
                source.close()
    return "".join(missing)


def _row_values(row: dict[str, str], index: int, date: str) -> dict[str, str]:
    values = {"n": str(index + 1)}
    if date:
        values["date"] = date
    values.update(row)
    return values


def _check_images(params: StudioRenderParams) -> list[str]:
    paths = [
        item.path
        for page in params.pages
        for item in page.items
        if isinstance(item, StudioImageItem)
    ]
    for path in paths:
        if not Path(path).is_file():
            raise _missing_image(path)
    return paths


@op("studio.render", StudioRenderParams)
def render(params: StudioRenderParams, progress: Progress) -> StudioRenderResult:
    rows = params.rows or [{}]
    total = len(rows) * len(params.pages)
    if total > MAX_OUTPUT_PAGES:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"too many pages: {total}",
            {"reason": "tooManyPages", "limit": MAX_OUTPUT_PAGES},
        )
    target = prepare_output(params.output, _check_images(params), params.overwrite)
    cache: Cache = {}
    faces: dict[str | None, TextFaces] = {}
    missing: list[str] = []
    document = pymupdf.open()
    try:
        done = 0
        for row_index, row in enumerate(rows):
            values = _row_values(row, row_index, params.date)
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
        metadata = dict(document.metadata or {})
        metadata.update({"title": params.title.strip(), "creator": "vivePDF"})
        document.set_metadata(metadata)
        with contextlib.suppress(Exception):
            document.subset_fonts(fallback=False)
        saved = save_document(document, target)
    finally:
        document.close()
        for source, _ in cache.values():
            source.close()
    return StudioRenderResult(
        output=saved.output,
        page_count=saved.page_count,
        bytes=saved.bytes,
        missing_glyphs="".join(dict.fromkeys("".join(missing))),
    )
