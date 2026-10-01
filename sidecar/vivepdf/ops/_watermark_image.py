import functools
from pathlib import Path

import numpy
import pymupdf

from vivepdf.ops._image_files import image_file_pixmap
from vivepdf.ops._placement import insertion_matrix
from vivepdf.ops._watermark_style import FIT_MARGIN, WatermarkStyle, _anchor_points, rotated_span
from vivepdf.rpc.errors import ErrorCode, OpError

TEMPLATE_DPI = 150
MARK_LONG_SIDE = 3000


def _template_pixmap(template_path: str, page_number: int) -> pymupdf.Pixmap:
    source = Path(template_path)
    if not source.is_file():
        raise OpError(ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}")
    try:
        with pymupdf.open(str(source)) as document:
            if document.needs_pass:
                raise OpError(ErrorCode.NEEDS_PASSWORD, f"{source.name} is protected")
            index = min(max(page_number, 1), document.page_count) - 1
            page = document[index]
            long_side = max(page.rect.width, page.rect.height, 1.0)
            dpi = max(1, min(TEMPLATE_DPI, int(MARK_LONG_SIDE * 72 / long_side)))
            return page.get_pixmap(dpi=dpi, alpha=True)
    except OpError:
        raise
    except Exception as error:  # noqa: BLE001
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"cannot read: {source.name}", {"reason": "fileUnreadable"}
        ) from error


def _fade(pixmap: pymupdf.Pixmap, opacity: float) -> pymupdf.Pixmap:
    if pixmap.n - pixmap.alpha not in (1, 3):
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pixmap)
    if not pixmap.alpha:
        pixmap = pymupdf.Pixmap(pixmap, 1)
    samples = numpy.frombuffer(pixmap.samples, dtype=numpy.uint8)
    faded = (samples.astype(numpy.float32) * opacity + 0.5).astype(numpy.uint8)
    return pymupdf.Pixmap(pixmap.colorspace, pixmap.width, pixmap.height, faded.tobytes(), 1)


def _image_pixmap(image_path: str, opacity: float) -> pymupdf.Pixmap:
    source = Path(image_path)
    if not source.is_file():
        raise OpError(ErrorCode.FILE_NOT_FOUND, f"image not found: {source.name}")
    try:
        pixmap = image_file_pixmap(source)
    except Exception as error:  # noqa: BLE001
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"cannot read image: {source.name}",
            {"reason": "imageUnreadable"},
        ) from error
    while max(pixmap.width, pixmap.height) > MARK_LONG_SIDE:
        pixmap.shrink(1)
    return _fade(pixmap, opacity)


def _file_version(path: str) -> tuple[int, int]:
    try:
        info = Path(path).stat()
    except OSError:
        return (0, 0)
    return (info.st_mtime_ns, info.st_size)


@functools.lru_cache(maxsize=4)
def _built_mark(
    kind: str, path: str, template_page: int, opacity: float, _version: tuple[int, int]
) -> pymupdf.Pixmap:
    if kind == "image":
        return _image_pixmap(path, opacity)
    return _fade(_template_pixmap(path, template_page), opacity)


def mark_pixmap(params: WatermarkStyle) -> pymupdf.Pixmap | None:
    if params.kind == "image":
        path = params.image_path or ""
        return _built_mark("image", path, 0, params.opacity, _file_version(path))
    if params.kind == "pdf":
        path = params.template_path or ""
        return _built_mark("pdf", path, params.template_page, params.opacity, _file_version(path))
    return None


def mark_source(pixmap: pymupdf.Pixmap) -> pymupdf.Document:
    source = pymupdf.open()
    page = source.new_page(width=pixmap.width, height=pixmap.height)
    page.insert_image(page.rect, pixmap=pixmap)
    return source


def _stamp_image(
    page: pymupdf.Page, params: WatermarkStyle, source: pymupdf.Document, layer: int = 0
) -> None:
    rect = page.rect
    aspect = source[0].rect.height / max(source[0].rect.width, 1.0)
    width = rect.width * params.scale
    height = width * aspect
    if height > rect.height * params.scale:
        height = rect.height * params.scale
        width = height / aspect
    span_x, span_y = rotated_span(width, height, params.rotation)
    fit = min(
        1.0,
        rect.width * FIT_MARGIN / span_x if span_x else 1.0,
        rect.height * FIT_MARGIN / span_y if span_y else 1.0,
    )
    width, height, span_x, span_y = width * fit, height * fit, span_x * fit, span_y * fit
    for center in _anchor_points(rect, width, height, params):
        box = pymupdf.Rect(
            center.x - span_x / 2,
            center.y - span_y / 2,
            center.x + span_x / 2,
            center.y + span_y / 2,
        )
        target = box * insertion_matrix(page)
        target.normalize()
        page.show_pdf_page(
            target,
            source,
            0,
            rotate=params.rotation + page.rotation,
            overlay=not params.behind,
            oc=layer,
        )
