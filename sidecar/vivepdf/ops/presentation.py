import json
import math
import re
import uuid
from typing import Any, Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._inplace import save_in_place
from vivepdf.ops._output import OutputResult
from vivepdf.ops._placement import insertion_matrix
from vivepdf.ops._svg import MAX_SVG_BYTES, drawing_pdf
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.paths import ModifyPath, ReadPath
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

HEX_COLOR = r"^#[0-9a-fA-F]{6}$"
HIGHLIGHTER_OPACITY = 0.45
ARROW_HEAD_MIN = 7.5
ARROW_HEAD_PER_WIDTH = 4
ARROW_HEAD_ANGLE = math.pi / 7
ELLIPSE_SEGMENTS = 48
TEXT_LINE_HEIGHT = 1.25
TEXT_FONT = "hebo"
MIN_WIDTH = 0.25
MAX_POINTS = 20_000
MAX_STROKES = 2_000
BOARD_BACKGROUNDS = {"black": (0.0, 0.0, 0.0), "white": (1.0, 1.0, 1.0)}
DRAWING_STAMP_NAME = "/Drawing"
PLACED_FORM = re.compile(rb"/([^\s/]+)\s+Do")
SOURCE_KEY = "VivePDFSource"
SOURCE_VERSION = 1
MAX_SOURCE_BYTES = 64 * 1024
DRAWING_NAME_PREFIX = "vivepdf-drawing-"

InsertedKind = Literal["table", "chart"]

Point = tuple[float, float]


class InsertedSource(RpcModel):
    kind: InsertedKind
    data: dict[str, Any]


class PresentationStroke(RpcModel):
    tool: Literal["pen", "highlighter", "line", "arrow", "rect", "ellipse", "text", "drawing"]
    color: str = Field(pattern=HEX_COLOR)
    width: float = Field(ge=0, le=1)
    opacity: float = Field(default=1.0, ge=0.05, le=1.0)
    points: list[tuple[float, float]] = Field(min_length=1, max_length=MAX_POINTS)
    text: str | None = Field(default=None, max_length=5000)
    font_size: float | None = Field(default=None, gt=0, le=1)
    size: tuple[float, float] | None = None
    svg: str | None = Field(default=None, max_length=MAX_SVG_BYTES)
    source: InsertedSource | None = None


class PresentationPage(RpcModel):
    page: int = Field(ge=1)
    strokes: list[PresentationStroke] = Field(min_length=1, max_length=MAX_STROKES)


class PresentationBoard(RpcModel):
    background: Literal["black", "white"]
    width: float = Field(gt=0, le=20_000)
    height: float = Field(gt=0, le=20_000)
    strokes: list[PresentationStroke] = Field(min_length=1, max_length=MAX_STROKES)


class SaveDrawingsParams(RpcModel):
    path: ModifyPath
    password: str | None = None
    author: str | None = Field(default=None, max_length=200)
    pages: list[PresentationPage] = Field(default_factory=list, max_length=5000)
    boards: list[PresentationBoard] = Field(default_factory=list, max_length=2)


class SaveDrawingsResult(OutputResult):
    annotations: int
    pages_added: int


class InsertedSourcesParams(RpcModel):
    path: ReadPath
    password: str | None = None
    page: int = Field(ge=1)


class InsertedItem(RpcModel):
    id: str
    kind: InsertedKind
    data: dict[str, Any]
    rect: tuple[float, float, float, float]


class InsertedSourcesResult(RpcModel):
    items: list[InsertedItem]


def _rgb(color: str) -> tuple[float, float, float]:
    value = int(color[1:], 16)
    return ((value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)


def _ellipse(start: Point, end: Point) -> list[Point]:
    cx, cy = (start[0] + end[0]) / 2, (start[1] + end[1]) / 2
    rx, ry = abs(end[0] - start[0]) / 2, abs(end[1] - start[1]) / 2
    return [
        (
            cx + rx * math.cos(index / ELLIPSE_SEGMENTS * 2 * math.pi),
            cy + ry * math.sin(index / ELLIPSE_SEGMENTS * 2 * math.pi),
        )
        for index in range(ELLIPSE_SEGMENTS + 1)
    ]


def _arrow_head(start: Point, tip: Point, width: float) -> list[Point]:
    angle = math.atan2(tip[1] - start[1], tip[0] - start[0])
    length = max(ARROW_HEAD_MIN, width * ARROW_HEAD_PER_WIDTH)
    return [
        (
            tip[0] - length * math.cos(angle - ARROW_HEAD_ANGLE),
            tip[1] - length * math.sin(angle - ARROW_HEAD_ANGLE),
        ),
        tip,
        (
            tip[0] - length * math.cos(angle + ARROW_HEAD_ANGLE),
            tip[1] - length * math.sin(angle + ARROW_HEAD_ANGLE),
        ),
    ]


def _outlines(stroke: PresentationStroke, points: list[Point], width: float) -> list[list[Point]]:
    if stroke.tool in ("pen", "highlighter"):
        return [points if len(points) > 1 else [points[0], points[0]]]
    start, end = points[0], points[1] if len(points) > 1 else points[0]
    if stroke.tool == "line":
        return [[start, end]]
    if stroke.tool == "arrow":
        return [[start, end], _arrow_head(start, end, width)]
    if stroke.tool == "rect":
        return [[start, (end[0], start[1]), end, (start[0], end[1]), start]]
    return [_ellipse(start, end)]


def _sign(annot: pymupdf.Annot, author: str | None) -> None:
    if author:
        annot.set_info(title=author)


def _add_ink(
    page: pymupdf.Page,
    stroke: PresentationStroke,
    points: list[Point],
    width: float,
    matrix: pymupdf.Matrix,
    author: str | None,
) -> None:
    lines = [
        [tuple(pymupdf.Point(x, y) * matrix) for x, y in line]
        for line in _outlines(stroke, points, width)
    ]
    annot = page.add_ink_annot(lines)
    annot.set_border(width=max(MIN_WIDTH, width))
    annot.set_colors(stroke=_rgb(stroke.color))
    if stroke.tool == "highlighter":
        annot.set_opacity(HIGHLIGHTER_OPACITY)
        annot.set_blendmode(pymupdf.PDF_BM_Multiply)
    elif stroke.opacity < 1:
        annot.set_opacity(stroke.opacity)
    _sign(annot, author)
    annot.update()


def _add_text(
    page: pymupdf.Page,
    stroke: PresentationStroke,
    points: list[Point],
    scale: tuple[float, float],
    matrix: pymupdf.Matrix,
    author: str | None,
) -> bool:
    if not stroke.text or not stroke.text.strip() or not stroke.font_size or not stroke.size:
        return False
    font_size = stroke.font_size * scale[0]
    lines = stroke.text.split("\n")
    widest = max(
        pymupdf.get_text_length(line, fontname=TEXT_FONT, fontsize=font_size) for line in lines
    )
    width = max(stroke.size[0] * scale[0], widest + font_size * 0.6)
    height = max(
        stroke.size[1] * scale[1], len(lines) * font_size * TEXT_LINE_HEIGHT + font_size * 0.4
    )
    left, top = points[0]
    rect = pymupdf.Rect(left, top, left + width, top + height) * matrix
    annot = page.add_freetext_annot(
        rect.normalize(),
        stroke.text,
        fontsize=font_size,
        fontname=TEXT_FONT,
        text_color=_rgb(stroke.color),
        rotate=page.rotation,
    )
    if stroke.opacity < 1:
        annot.set_opacity(stroke.opacity)
    _sign(annot, author)
    annot.update()
    return True


def _holder(document: pymupdf.Document, xref: int, key: str) -> tuple[int, str | None]:
    kind, value = document.xref_get_key(xref, key)
    if kind == "xref":
        return int(value.split()[0]), None
    return xref, key


def _forget_xobject(page: pymupdf.Page, name: str) -> None:
    document = page.parent
    xref, key = _holder(document, page.xref, "Resources")
    xref, _ = _holder(document, xref, f"{key}/XObject" if key else "XObject")
    entry = re.compile(rf"/{re.escape(name)}\s+\d+\s+\d+\s+R")
    document.update_object(xref, entry.sub("", document.xref_object(xref, compressed=True), 1))


def _placed_form(page: pymupdf.Page, box: pymupdf.Rect, drawing: pymupdf.Document) -> int:
    document = page.parent
    before = page.get_contents()
    page.show_pdf_page(box, drawing, 0, keep_proportion=True, overlay=True, rotate=page.rotation)
    added = b"".join(
        document.xref_stream(xref) for xref in page.get_contents() if xref not in before
    )
    document.xref_set_key(page.xref, "Contents", "[" + "".join(f"{x} 0 R " for x in before) + "]")
    placed = PLACED_FORM.search(added)
    if placed is None:
        raise OpError(ErrorCode.INTERNAL, "the drawing could not be placed")
    name = placed.group(1).decode("ascii")
    kind, value = document.xref_get_key(page.xref, f"Resources/XObject/{name}")
    if kind != "xref":
        raise OpError(ErrorCode.INTERNAL, "the drawing could not be placed")
    _forget_xobject(page, name)
    return int(value.split()[0])


def _source_text(source: InsertedSource | None) -> str | None:
    if source is None:
        return None
    text = json.dumps(
        {"v": SOURCE_VERSION, "kind": source.kind, "data": source.data},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    if len(text.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the inserted item's source is too large",
            {"reason": "sourceTooLarge", "limit": MAX_SOURCE_BYTES},
        )
    return text


def _stored_source(text: str) -> tuple[InsertedKind, dict[str, Any]] | None:
    if len(text.encode("utf-8")) > MAX_SOURCE_BYTES:
        return None
    try:
        stored = json.loads(text)
    except ValueError:
        return None
    if not isinstance(stored, dict) or stored.get("v") != SOURCE_VERSION:
        return None
    kind, data = stored.get("kind"), stored.get("data")
    if kind not in ("table", "chart") or not isinstance(data, dict):
        return None
    return kind, data


def _add_drawing(
    page: pymupdf.Page,
    stroke: PresentationStroke,
    points: list[Point],
    scale: tuple[float, float],
    author: str | None,
) -> bool:
    if not stroke.svg or not stroke.size:
        return False
    left, top = points[0]
    visible = pymupdf.Rect(
        left, top, left + stroke.size[0] * scale[0], top + stroke.size[1] * scale[1]
    )
    visible.normalize()
    if visible.is_empty:
        return False
    source = _source_text(stroke.source)
    box = visible * insertion_matrix(page)
    box.normalize()
    drawing = drawing_pdf(stroke.svg.encode("utf-8"), "drawing", stroke.opacity)
    try:
        form = _placed_form(page, box, drawing)
    finally:
        drawing.close()
    rect = (visible * page.derotation_matrix).normalize()
    annot = page.add_stamp_annot(rect, stamp=0)
    annot.set_rect(rect)
    _sign(annot, author)
    document = page.parent
    bbox = document.xref_get_key(annot.xref, "Rect")[1]
    appearance = document.get_new_xref()
    document.update_object(
        appearance,
        f"<</Type/XObject/Subtype/Form/BBox{bbox}/Resources<</XObject<</Fm0 {form} 0 R>>>>>>",
    )
    document.update_stream(appearance, b"q /Fm0 Do Q")
    document.xref_set_key(annot.xref, "AP", f"<</N {appearance} 0 R>>")
    document.xref_set_key(annot.xref, "Contents", "null")
    document.xref_set_key(annot.xref, "Name", DRAWING_STAMP_NAME)
    document.xref_set_key(
        annot.xref, "NM", pymupdf.get_pdf_str(f"{DRAWING_NAME_PREFIX}{uuid.uuid4().hex}")
    )
    if source is not None:
        document.xref_set_key(annot.xref, SOURCE_KEY, pymupdf.get_pdf_str(source))
    return True


def _draw(
    page: pymupdf.Page,
    strokes: list[PresentationStroke],
    scale: tuple[float, float],
    matrix: pymupdf.Matrix,
    author: str | None,
) -> int:
    added = 0
    for stroke in strokes:
        points = [(x * scale[0], y * scale[1]) for x, y in stroke.points]
        if stroke.tool == "text":
            added += _add_text(page, stroke, points, scale, matrix, author)
            continue
        if stroke.tool == "drawing":
            added += _add_drawing(page, stroke, points, scale, author)
            continue
        _add_ink(page, stroke, points, stroke.width * scale[0], matrix, author)
        added += 1
    return added


def _page_out_of_range(page: int, count: int) -> OpError:
    return OpError(
        ErrorCode.INVALID_PARAMS,
        f"page {page} is outside 1..{count}",
        {"reason": "pageOutOfRange", "page": page, "pageCount": count},
    )


def _inserted_item(page: pymupdf.Page, xref: int) -> InsertedItem | None:
    document = page.parent
    kind, value = document.xref_get_key(xref, SOURCE_KEY)
    if kind != "string":
        return None
    stored = _stored_source(value)
    name_kind, name = document.xref_get_key(xref, "NM")
    if stored is None or name_kind != "string" or not name:
        return None
    visible = (page.load_annot(xref).rect * page.rotation_matrix).normalize()
    width, height = page.rect.width, page.rect.height
    return InsertedItem(
        id=name,
        kind=stored[0],
        data=stored[1],
        rect=(visible.x0 / width, visible.y0 / height, visible.x1 / width, visible.y1 / height),
    )


def _board_page(document: pymupdf.Document, board: PresentationBoard) -> pymupdf.Page:
    reference = document[-1].rect if document.page_count else pymupdf.paper_rect("a4")
    width = reference.width
    page = document.new_page(-1, width=width, height=width * board.height / board.width)
    page.draw_rect(page.rect, color=None, fill=BOARD_BACKGROUNDS[board.background], overlay=False)
    return page


@op("presentation.save_drawings", SaveDrawingsParams)
def save_drawings(params: SaveDrawingsParams, progress: Progress) -> SaveDrawingsResult:
    if not params.pages and not params.boards:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "there are no drawings to save", {"reason": "empty"}
        )
    document = open_document(params.path, params.password)
    try:
        author = params.author.strip() if params.author else None
        added = 0
        total = len(params.pages) + len(params.boards)
        for index, entry in enumerate(params.pages):
            progress.check_cancelled()
            if entry.page > document.page_count:
                raise _page_out_of_range(entry.page, document.page_count)
            page = document[entry.page - 1]
            scale = (page.rect.width, page.rect.height)
            added += _draw(page, entry.strokes, scale, page.derotation_matrix, author)
            progress.report(
                (index + 1) / total * 0.9,
                "progress.applying",
            )
        for board in params.boards:
            progress.check_cancelled()
            page = _board_page(document, board)
            added += _draw(
                page, board.strokes, (page.rect.width, page.rect.height), pymupdf.Identity, author
            )
        saved = save_in_place(document, params.path)
        return SaveDrawingsResult(
            **saved.model_dump(), annotations=added, pages_added=len(params.boards)
        )
    finally:
        if not document.is_closed:
            document.close()


@op("presentation.inserted_sources", InsertedSourcesParams)
def inserted_sources(params: InsertedSourcesParams, progress: Progress) -> InsertedSourcesResult:
    document = open_document(params.path, params.password)
    try:
        if params.page > document.page_count:
            raise _page_out_of_range(params.page, document.page_count)
        page = document[params.page - 1]
        items = [
            item
            for xref, kind, _name in page.annot_xrefs()
            if kind == pymupdf.PDF_ANNOT_STAMP and (item := _inserted_item(page, xref)) is not None
        ]
        return InsertedSourcesResult(items=items)
    finally:
        document.close()
