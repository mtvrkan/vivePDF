import contextlib
import datetime
import getpass
import math
from pathlib import Path

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._font_unicode import subset_fonts
from vivepdf.ops._output import prepare_output, save_document
from vivepdf.ops._page_batch import SharedFonts
from vivepdf.ops._placement import insertion_matrix
from vivepdf.ops._ranges import PageSide, filter_side, no_pages_selected, parse_page_ranges
from vivepdf.ops._watermark_style import (
    FIT_MARGIN,
    LINE_SPACING,
    GridPosition,
    MarkPreviewResult,
    grid_cell,
    mark_lines,
    parse_color,
)
from vivepdf.ops.fonts import font_name_for, resolve_choice, uncovered_glyphs
from vivepdf.ops.security_watermark import draw_as_watermark, first_selected_index, render_preview
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

StampPosition = GridPosition
FONT_NAME = "vivepdf-stamp"
MM_TO_PT = 72 / 25.4
BOX_PAD_X = 0.55
BOX_PAD_Y = 0.3
BOX_LINE_HEIGHT = 1.25
SHRINK_STEP = 0.9
SHRINK_TRIES = 6


class StampStyle(RpcModel):
    text: str = Field(min_length=1, max_length=240)
    color: str = "#c0392b"
    font_id: str | None = None
    behind: bool = False
    offset_x: float = Field(default=0, ge=-100, le=100)
    offset_y: float = Field(default=0, ge=-100, le=100)
    font_size: float = Field(default=28, ge=6, le=200)
    position: StampPosition = "top-right"
    margin: float = Field(default=12, ge=0, le=100)
    rotation: float = Field(default=-12, ge=-90, le=90)
    opacity: float = Field(default=0.85, ge=0.05, le=1)
    border: bool = True
    name: str = Field(default="", max_length=120)
    date_format: str = Field(default="%d.%m.%Y", max_length=60)


class StampParams(StampStyle):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    pages: str | None = None
    side: PageSide = "all"


class StampPreviewParams(StampStyle):
    path: str
    password: str | None = None
    pages: str | None = None
    side: PageSide = "all"
    width: int = Field(default=420, ge=120, le=1600)


class StampResult(RpcModel):
    output: str
    page_count: int
    bytes: int
    stamped: int


def login_name() -> str:
    try:
        return getpass.getuser()
    except (OSError, KeyError, ImportError):
        return ""


def render_stamp_text(
    template: str, page: int, total: int, name: str, path: str, date_format: str
) -> str:
    now = datetime.datetime.now()
    try:
        date_text = now.strftime(date_format)
    except ValueError:
        date_text = now.strftime("%d.%m.%Y")
    return (
        template.replace("{date}", date_text)
        .replace("{time}", now.strftime("%H:%M"))
        .replace("{name}", name)
        .replace("{user}", login_name())
        .replace("{file}", Path(path).stem)
        .replace("{page}", str(page))
        .replace("{total}", str(total))
    )


def _box_for(
    page_rect: pymupdf.Rect, width: float, height: float, position: StampPosition, margin: float
) -> pymupdf.Rect:
    row, column = grid_cell(position)
    if column == "left":
        x0 = page_rect.x0 + margin
    elif column == "right":
        x0 = page_rect.x1 - margin - width
    else:
        x0 = page_rect.x0 + (page_rect.width - width) / 2
    if row == "top":
        y0 = page_rect.y0 + margin
    elif row == "bottom":
        y0 = page_rect.y1 - margin - height
    else:
        y0 = page_rect.y0 + (page_rect.height - height) / 2
    return pymupdf.Rect(x0, y0, x0 + width, y0 + height)


def _rotated_span(width: float, height: float, rotation: float) -> tuple[float, float]:
    radians = math.radians(rotation)
    cos, sin = abs(math.cos(radians)), abs(math.sin(radians))
    return width * cos + height * sin, width * sin + height * cos


def _fit_font_size(
    font: pymupdf.Font, lines: list[str], size: float, page_rect: pymupdf.Rect, rotation: float
) -> float:
    longest = max((font.text_length(line, fontsize=size) for line in lines), default=0.0)
    width = longest + size * BOX_PAD_X * 2
    height = size * (BOX_LINE_HEIGHT * len(lines) + BOX_PAD_Y * 2)
    span_x, span_y = _rotated_span(width, height, rotation)
    scale = min(
        1.0,
        page_rect.width * FIT_MARGIN / span_x if span_x else 1.0,
        page_rect.height * FIT_MARGIN / span_y if span_y else 1.0,
    )
    return size * scale


def _inside(
    box: pymupdf.Rect, page_rect: pymupdf.Rect, rotation: float, margin: float
) -> pymupdf.Rect:
    span_x, span_y = _rotated_span(box.width, box.height, rotation)
    room = min(
        margin, max((page_rect.width - span_x) / 2, 0.0), max((page_rect.height - span_y) / 2, 0.0)
    )
    limit_x = max((page_rect.width - span_x) / 2 - room, 0.0)
    limit_y = max((page_rect.height - span_y) / 2 - room, 0.0)
    middle = pymupdf.Point((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
    centre = pymupdf.Point((page_rect.x0 + page_rect.x1) / 2, (page_rect.y0 + page_rect.y1) / 2)
    shift_x = min(max(middle.x, centre.x - limit_x), centre.x + limit_x) - middle.x
    shift_y = min(max(middle.y, centre.y - limit_y), centre.y + limit_y) - middle.y
    return box + (shift_x, shift_y, shift_x, shift_y)


def stamp_page(
    page: pymupdf.Page,
    text: str,
    params: StampStyle,
    font: pymupdf.Font | None = None,
    shared: tuple[SharedFonts, int] | None = None,
) -> bool:
    if not text.strip():
        return False
    font_file = resolve_choice(params.font_id, True)
    if font is None:
        font = pymupdf.Font(fontfile=str(font_file))
    lines = mark_lines(text)
    size = _fit_font_size(font, lines, params.font_size, page.rect, params.rotation)
    text_width = max((font.text_length(line, fontsize=size) for line in lines), default=0.0)
    pad_x = size * BOX_PAD_X
    pad_y = size * BOX_PAD_Y
    line_height = size * BOX_LINE_HEIGHT * len(lines)
    placed = _box_for(
        page.rect,
        text_width + 2 * pad_x,
        line_height + 2 * pad_y,
        params.position,
        params.margin * MM_TO_PT,
    )
    shift = (page.rect.width * params.offset_x / 100, page.rect.height * params.offset_y / 100)
    box = _inside(placed + shift * 2, page.rect, params.rotation, params.margin * MM_TO_PT)
    color = parse_color(params.color)
    pivot = pymupdf.Point((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
    morph = (pivot * page.derotation_matrix, pymupdf.Matrix(params.rotation))
    unrotated_box = box * insertion_matrix(page)
    unrotated_box.normalize()
    text_box = pymupdf.Rect(box.x0, box.y0 + pad_y, box.x1, box.y1) * page.derotation_matrix
    text_box.normalize()
    font_name = font_name_for(font_file)
    written = False

    def draw() -> None:
        nonlocal written
        fonts = (
            shared[0].using(page, shared[1], font_name, font_file)
            if shared is not None
            else contextlib.nullcontext()
        )
        text_size = size
        with fonts:
            for _ in range(SHRINK_TRIES):
                left = page.insert_textbox(
                    text_box,
                    "\n".join(lines),
                    fontsize=text_size,
                    lineheight=LINE_SPACING,
                    fontname=font_name,
                    fontfile=str(font_file),
                    color=color,
                    align=pymupdf.TEXT_ALIGN_CENTER,
                    fill_opacity=params.opacity,
                    rotate=page.rotation,
                    morph=morph,
                    overlay=not params.behind,
                )
                if left >= 0:
                    written = True
                    break
                text_size *= SHRINK_STEP
        if written and params.border:
            shape = page.new_shape()
            shape.draw_rect(unrotated_box)
            shape.finish(
                color=color,
                width=max(1.2, size * 0.07),
                stroke_opacity=params.opacity,
                morph=morph,
            )
            shape.commit(overlay=not params.behind)

    draw_as_watermark(page, draw)
    return written


@op("security.stamp", StampParams)
def stamp(params: StampParams, progress: Progress) -> StampResult:
    if not params.text.strip():
        raise OpError(ErrorCode.INVALID_PARAMS, "stamp text is required")
    target = prepare_output(params.output, [params.path], params.overwrite)
    stamped = 0
    with open_document(params.path, params.password) as document:
        total = document.page_count
        selected = filter_side(parse_page_ranges(params.pages, total), params.side)
        if not selected:
            raise no_pages_selected()
        pages = [document[index] for index in selected]
        page_xrefs = [document.page_xref(index) for index in selected]
        font = pymupdf.Font(fontfile=str(resolve_choice(params.font_id, True)))
        fonts = SharedFonts(document)
        for position, (index, page, page_xref) in enumerate(
            zip(selected, pages, page_xrefs, strict=True)
        ):
            progress.check_cancelled()
            text = render_stamp_text(
                params.text, index + 1, total, params.name, params.path, params.date_format
            )
            stamped += int(stamp_page(page, text, params, font, (fonts, page_xref)))
            if position % 10 == 0:
                progress.report(
                    position / max(1, len(selected)),
                    "progress.stamping",
                    {"current": position + 1, "total": len(selected)},
                )
        with contextlib.suppress(Exception):
            subset_fonts(document, fallback=False)
        progress.report(0.95, "progress.saving")
        saved = save_document(document, target)
        return StampResult(
            output=saved.output,
            page_count=saved.page_count,
            bytes=saved.bytes,
            stamped=stamped,
        )


@op("security.stamp_preview", StampPreviewParams)
def stamp_preview(params: StampPreviewParams, _progress: Progress) -> MarkPreviewResult:
    if not params.text.strip():
        raise OpError(ErrorCode.INVALID_PARAMS, "stamp text is required")
    with open_document(params.path, params.password) as document:
        total = document.page_count
        index, pages_problem = first_selected_index(params.pages, total, params.side)
        page = document[index]
        text = render_stamp_text(
            params.text, index + 1, total, params.name, params.path, params.date_format
        )
        stamp_page(page, text, params)
        result = render_preview(page, params.width, index + 1, total)
        result.missing_glyphs = uncovered_glyphs(resolve_choice(params.font_id, True), text)
        result.pages_problem = pages_problem
        return result
