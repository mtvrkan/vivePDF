import re
from typing import Literal

import numpy
import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._ranges import (
    PageSide,
    filter_side,
    parse_page_ranges,
)
from vivepdf.ops._redaction import jpeg_images, recompress_redacted
from vivepdf.ops.pages import SourceParams
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

PAPER_SIZES: dict[str, tuple[float, float]] = {
    "a3": (842, 1191),
    "a4": (595, 842),
    "a5": (420, 595),
    "letter": (612, 792),
    "legal": (612, 1008),
    "tabloid": (792, 1224),
}


ResizeMode = Literal["fit", "fill", "stretch", "box"]


class ResizeParams(SourceParams):
    preset: str | None = None
    width: float | None = None
    height: float | None = None
    pages: str | None = None
    auto_rotate: bool = True
    mode: ResizeMode = "fit"
    margin: float = Field(default=0, ge=0, le=200)
    match_largest: bool = False


MIN_PAGE_SIDE = 3.0
MAX_PAGE_SIDE = 14400.0


def _target_size(params: ResizeParams) -> tuple[float, float]:
    if params.preset:
        size = PAPER_SIZES.get(params.preset.lower())
        if not size:
            raise OpError(ErrorCode.INVALID_PARAMS, f"unknown paper size '{params.preset}'")
        return size
    if params.width is None or params.height is None:
        raise OpError(ErrorCode.INVALID_PARAMS, "preset or width/height is required")
    if not all(MIN_PAGE_SIDE <= side <= MAX_PAGE_SIDE for side in (params.width, params.height)):
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "page size out of range",
            {"reason": "pageSizeRange", "min": MIN_PAGE_SIDE, "max": MAX_PAGE_SIDE},
        )
    return (params.width, params.height)


def _largest_size(pages: list[pymupdf.Page]) -> tuple[float, float]:
    long_side = max(max(page.rect.width, page.rect.height) for page in pages)
    short_side = max(min(page.rect.width, page.rect.height) for page in pages)
    largest = max(pages, key=lambda page: page.rect.width * page.rect.height)
    if largest.rect.width > largest.rect.height:
        return (long_side, short_side)
    return (short_side, long_side)


NUMBER_TOKEN = re.compile(r"-?(?:\d+\.?\d*|\.\d+)")


POINT_ARRAY_KEYS = ("QuadPoints", "Vertices", "L", "CL")


def _pdf_box(document: pymupdf.Document, xref: int, key: str) -> pymupdf.Rect | None:
    kind, value = document.xref_get_key(xref, key)
    if kind != "array":
        return None
    numbers = [float(token) for token in NUMBER_TOKEN.findall(value)]
    if len(numbers) != 4:
        return None
    box = pymupdf.Rect(numbers)
    box.normalize()
    return box


def visible_box(
    document: pymupdf.Document, page: pymupdf.Page, page_xref: int | None = None
) -> pymupdf.Rect:
    xref = page.xref if page_xref is None else page_xref
    media = _pdf_box(document, xref, "MediaBox") or pymupdf.Rect(
        0, 0, page.mediabox.width, page.mediabox.height
    )
    crop = _pdf_box(document, xref, "CropBox")
    if crop is None:
        return media
    visible = crop & media
    return media if visible.is_empty else visible


def _placement(
    source_box: pymupdf.Rect, target_box: pymupdf.Rect, mode: ResizeMode
) -> pymupdf.Matrix:
    scale_x = target_box.width / source_box.width
    scale_y = target_box.height / source_box.height
    if mode == "fit":
        scale_x = scale_y = min(scale_x, scale_y)
    elif mode == "fill":
        scale_x = scale_y = max(scale_x, scale_y)
    shift_x = target_box.x0 + (target_box.width - source_box.width * scale_x) / 2
    shift_y = target_box.y0 + (target_box.height - source_box.height * scale_y) / 2
    return pymupdf.Matrix(
        scale_x, 0, 0, scale_y, shift_x - source_box.x0 * scale_x, shift_y - source_box.y0 * scale_y
    )


def _format_number(value: float) -> str:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def _transformed_points(value: str, matrix: pymupdf.Matrix) -> str:
    numbers = [float(token) for token in NUMBER_TOKEN.findall(value)]
    moved: list[str] = []
    for position in range(0, len(numbers) - 1, 2):
        point = pymupdf.Point(numbers[position], numbers[position + 1]) * matrix
        moved.extend((_format_number(point.x), _format_number(point.y)))
    return "[" + " ".join(moved) + "]"


def _move_annotations(
    document: pymupdf.Document, page: pymupdf.Page, matrix: pymupdf.Matrix
) -> None:
    for xref, *_ in page.annot_xrefs():
        rect = _pdf_box(document, xref, "Rect")
        if rect is not None:
            moved = rect * matrix
            moved.normalize()
            document.xref_set_key(
                xref, "Rect", "[" + " ".join(_format_number(v) for v in moved) + "]"
            )
        for key in POINT_ARRAY_KEYS:
            kind, value = document.xref_get_key(xref, key)
            if kind == "array":
                document.xref_set_key(xref, key, _transformed_points(value, matrix))
        kind, value = document.xref_get_key(xref, "InkList")
        if kind == "array":
            strokes = re.findall(r"\[([^\[\]]*)\]", value[1:-1])
            document.xref_set_key(
                xref,
                "InkList",
                "[" + "".join(_transformed_points(stroke, matrix) for stroke in strokes) + "]",
            )


DESTINATION_ARRAY = re.compile(
    r"\[\s*(\d+)\s+0\s+R\s*/(XYZ|FitR|FitH|FitV|FitBH|FitBV)\b([^\[\]/]*)\]"
)


DESTINATION_AXES = {
    "XYZ": "xy",
    "FitR": "xyxy",
    "FitH": "y",
    "FitBH": "y",
    "FitV": "x",
    "FitBV": "x",
}


def _moved_value(value: str, axis: str, matrix: pymupdf.Matrix) -> str:
    if value == "null":
        return value
    try:
        number = float(value)
    except ValueError:
        return value
    if axis == "x":
        return _format_number(number * matrix.a + matrix.e)
    return _format_number(number * matrix.d + matrix.f)


def _moved_destination(match: re.Match[str], moves: dict[int, pymupdf.Matrix]) -> str:
    matrix = moves.get(int(match.group(1)))
    if matrix is None:
        return match.group(0)
    kind = match.group(2)
    values = match.group(3).split()
    axes = DESTINATION_AXES[kind]
    moved = [
        _moved_value(value, axes[position], matrix) if position < len(axes) else value
        for position, value in enumerate(values)
    ]
    return f"[{match.group(1)} 0 R/{kind} {' '.join(moved)}]".replace(" ]", "]")


def move_destinations(
    document: pymupdf.Document, moves: dict[int, pymupdf.Matrix], progress: Progress
) -> None:
    if not moves:
        return
    for xref in range(1, document.xref_length()):
        if xref % 1000 == 0:
            progress.check_cancelled()
        if document.xref_is_stream(xref):
            continue
        body = document.xref_object(xref, compressed=True)
        if "/XYZ" not in body and "/Fit" not in body:
            continue
        moved = DESTINATION_ARRAY.sub(lambda match: _moved_destination(match, moves), body)
        if moved != body:
            document.update_object(xref, moved)


def _place_page(
    document: pymupdf.Document,
    page: pymupdf.Page,
    page_xref: int,
    size: tuple[float, float],
    margin: float,
    mode: ResizeMode,
) -> pymupdf.Matrix:
    width, height = size
    target_box = pymupdf.Rect(margin, margin, width - margin, height - margin)
    if target_box.is_empty or target_box.width <= 0 or target_box.height <= 0:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the margin leaves no room for the page",
            {"reason": "marginTooLarge"},
        )
    source_box = visible_box(document, page, page_xref)
    if source_box.width <= 0 or source_box.height <= 0:
        raise OpError(ErrorCode.INVALID_PDF, f"page {page.number + 1} has no visible area")
    matrix = _placement(source_box, target_box, mode)
    clip = (source_box * matrix) & target_box
    page.wrap_contents()
    prefix = (
        f"q {_format_number(clip.x0)} {_format_number(clip.y0)} "
        f"{_format_number(clip.width)} {_format_number(clip.height)} re W n "
        + " ".join(_format_number(value) for value in matrix)
        + " cm\n"
    )
    opening = document.get_new_xref()
    document.update_object(opening, "<<>>")
    document.update_stream(opening, prefix.encode())
    closing = document.get_new_xref()
    document.update_object(closing, "<<>>")
    document.update_stream(closing, b"\nQ\n")
    contents = page.get_contents()
    page_contents = " ".join(f"{xref} 0 R" for xref in [opening, *contents, closing])
    document.xref_set_key(page_xref, "Contents", f"[{page_contents}]")
    _move_annotations(document, page, matrix)
    page.set_mediabox(pymupdf.Rect(0, 0, width, height))
    return matrix


def _resize_box(
    document: pymupdf.Document, page: pymupdf.Page, page_xref: int, size: tuple[float, float]
) -> None:
    origin = visible_box(document, page, page_xref).tl
    page.set_mediabox(pymupdf.Rect(origin.x, origin.y, origin.x + size[0], origin.y + size[1]))


def _unrotated_size(size: tuple[float, float], rotation: int) -> tuple[float, float]:
    return (size[1], size[0]) if rotation in (90, 270) else size


@op("pages.resize", ResizeParams)
def resize_pages(params: ResizeParams, progress: Progress) -> OutputResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        selected = list(dict.fromkeys(parse_page_ranges(params.pages, document.page_count)))
        pages = [document[index] for index in selected]
        page_xrefs = [document.page_xref(index) for index in selected]
        width, height = _largest_size(pages) if params.match_largest else _target_size(params)
        moves: dict[int, pymupdf.Matrix] = {}
        for position, (page, page_xref) in enumerate(zip(pages, page_xrefs, strict=True)):
            progress.check_cancelled()
            landscape_source = page.rect.width > page.rect.height
            page_size = (width, height)
            if params.auto_rotate and landscape_source != (width > height):
                page_size = (height, width)
            unrotated = _unrotated_size(page_size, page.rotation)
            if params.mode == "box":
                _resize_box(document, page, page_xref, unrotated)
            else:
                moves[page_xref] = _place_page(
                    document, page, page_xref, unrotated, params.margin, params.mode
                )
            if position % 10 == 0:
                progress.report(position / len(selected), "progress.resizing")
        move_destinations(document, moves, progress)
        progress.report(0.9, "progress.saving")
        return save_document(document, target)


class Insets(RpcModel):
    left: float = Field(default=0, ge=0)
    top: float = Field(default=0, ge=0)
    right: float = Field(default=0, ge=0)
    bottom: float = Field(default=0, ge=0)


DETECT_DPI = 100


DETECT_THRESHOLD = 245


DETECT_CONTRAST = 10


DETECT_SPECKLE = 2


MIN_CROP_SIDE = 10.0


class CropParams(SourceParams):
    pages: str | None = None
    side: PageSide = "all"
    insets: Insets = Field(default_factory=Insets)
    mode: Literal["insets", "auto"] = "insets"
    auto_margin: float = Field(default=6, ge=0, le=200)
    remove_content: bool = False


class CropResult(OutputResult):
    cropped: int


def _unrotated_insets(insets: Insets, rotation: int) -> tuple[float, float, float, float]:
    left, top, right, bottom = insets.left, insets.top, insets.right, insets.bottom
    if rotation == 90:
        return (top, right, bottom, left)
    if rotation == 180:
        return (right, bottom, left, top)
    if rotation == 270:
        return (bottom, left, top, right)
    return (left, top, right, bottom)


def media_box_top_left(page: pymupdf.Page) -> pymupdf.Rect:
    media = page.mediabox
    return pymupdf.Rect(media.x0, 0, media.x1, media.height)


def current_crop_box(page: pymupdf.Page) -> pymupdf.Rect:
    media = media_box_top_left(page)
    box = page.cropbox & media
    return media if box.is_empty else box


def detect_content_box(page: pymupdf.Page, margin: float) -> pymupdf.Rect | None:
    pixmap = page.get_pixmap(dpi=DETECT_DPI, colorspace=pymupdf.csGRAY, annots=True)
    if pixmap.width < 3 or pixmap.height < 3:
        return None
    grid = numpy.frombuffer(pixmap.samples, dtype=numpy.uint8)
    grid = grid.reshape(pixmap.height, pixmap.stride)[:, : pixmap.width]
    paper = float(numpy.percentile(grid, 90))
    dark = grid < min(DETECT_THRESHOLD, paper - DETECT_CONTRAST)
    rows = numpy.flatnonzero(dark.sum(axis=1) > DETECT_SPECKLE)
    columns = numpy.flatnonzero(dark.sum(axis=0) > DETECT_SPECKLE)
    if rows.size == 0 or columns.size == 0:
        return None
    scale = 72.0 / DETECT_DPI
    visible = page.rect
    found = pymupdf.Rect(
        visible.x0 + float(columns[0]) * scale - margin,
        visible.y0 + float(rows[0]) * scale - margin,
        visible.x0 + float(columns[-1] + 1) * scale + margin,
        visible.y0 + float(rows[-1] + 1) * scale + margin,
    )
    found = found & visible
    if found.is_empty:
        return None
    origin = current_crop_box(page).tl
    return (found * page.derotation_matrix) + (origin.x, origin.y, origin.x, origin.y)


def _erase_outside(page: pymupdf.Page, keep: pymupdf.Rect) -> None:
    origin = current_crop_box(page).tl
    shift = (-origin.x, -origin.y, -origin.x, -origin.y)
    box = media_box_top_left(page) + shift
    keep = keep + shift
    strips = [
        pymupdf.Rect(box.x0, box.y0, box.x1, keep.y0),
        pymupdf.Rect(box.x0, keep.y1, box.x1, box.y1),
        pymupdf.Rect(box.x0, keep.y0, keep.x0, keep.y1),
        pymupdf.Rect(keep.x1, keep.y0, box.x1, keep.y1),
    ]
    marked = False
    before, jpeg_sizes = jpeg_images(page)
    for strip in strips:
        strip = strip & box
        if strip.is_empty or strip.width <= 0 or strip.height <= 0:
            continue
        page.add_redact_annot(strip)
        marked = True
    if marked:
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_PIXELS)
        recompress_redacted(page, before, jpeg_sizes)


@op("pages.crop", CropParams)
def crop_pages(params: CropParams, progress: Progress) -> CropResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        indices = filter_side(
            list(dict.fromkeys(parse_page_ranges(params.pages, document.page_count))), params.side
        )
        cropped = 0
        for position, index in enumerate(indices):
            progress.check_cancelled()
            page = document[index]
            box = current_crop_box(page)
            if params.mode == "auto":
                found = detect_content_box(page, params.auto_margin)
                if found is None:
                    continue
                new_box = found & box
            else:
                left, top, right, bottom = _unrotated_insets(params.insets, page.rotation)
                new_box = pymupdf.Rect(box.x0 + left, box.y0 + top, box.x1 - right, box.y1 - bottom)
            if new_box.is_empty or new_box.width < MIN_CROP_SIDE or new_box.height < MIN_CROP_SIDE:
                if params.mode == "auto":
                    continue
                raise OpError(
                    ErrorCode.INVALID_PARAMS,
                    f"crop leaves page {index + 1} empty",
                    {"reason": "cropEmpty", "page": index + 1},
                )
            if params.remove_content:
                _erase_outside(page, new_box)
            page.set_cropbox(new_box)
            cropped += 1
            if position % 10 == 0:
                progress.report(position / max(1, len(indices)), "progress.cropping")
        progress.report(0.9, "progress.saving")
        saved = save_document(document, target)
    return CropResult(**saved.model_dump(), cropped=cropped)
