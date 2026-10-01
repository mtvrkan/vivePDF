from dataclasses import dataclass
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops.analyze import _into_protected, _printable_copy
from vivepdf.ops.page_geometry import PAPER_SIZES
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

PosterPaper = Literal["a4", "a3", "letter", "legal"]
PosterOrientation = Literal["auto", "portrait", "landscape"]
LABEL_SIZE = 7.0
LABEL_PAD = 2.0
MARK_REACH = 12.0
GUIDE_GREY = (0.55, 0.55, 0.55)
WHITE = (1, 1, 1)


class PosterParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    paper: PosterPaper = "a4"
    orientation: PosterOrientation = "auto"
    columns: int = Field(default=2, ge=1, le=10)
    rows: int = Field(default=2, ge=1, le=10)
    margin: float = Field(default=28.0, ge=0, le=144)
    overlap: float = Field(default=14.0, ge=0, le=144)
    cut_marks: bool = True
    labels: bool = True
    pages: str | None = None


class PosterResult(OutputResult):
    sheets: int
    scale: float


@dataclass(frozen=True)
class PosterPlan:
    sheet_width: float
    sheet_height: float
    printable_width: float
    printable_height: float
    scale: float
    offset_x: float
    offset_y: float


def _sheet_sizes(paper: PosterPaper, orientation: PosterOrientation) -> list[tuple[float, float]]:
    short, long = sorted(PAPER_SIZES[paper])
    if orientation == "portrait":
        return [(short, long)]
    if orientation == "landscape":
        return [(long, short)]
    return [(short, long), (long, short)]


def plan_poster(page: pymupdf.Rect, params: PosterParams) -> PosterPlan:
    plans: list[PosterPlan] = []
    for sheet_width, sheet_height in _sheet_sizes(params.paper, params.orientation):
        printable_width = sheet_width - 2 * params.margin
        printable_height = sheet_height - 2 * params.margin
        total_width = params.columns * printable_width - (params.columns - 1) * params.overlap
        total_height = params.rows * printable_height - (params.rows - 1) * params.overlap
        scale = min(total_width / page.width, total_height / page.height)
        plan = PosterPlan(
            sheet_width=sheet_width,
            sheet_height=sheet_height,
            printable_width=printable_width,
            printable_height=printable_height,
            scale=scale,
            offset_x=(total_width - page.width * scale) / 2,
            offset_y=(total_height - page.height * scale) / 2,
        )
        plans.append(plan)
    return max(plans, key=lambda plan: plan.scale)


def tile_regions(
    plan: PosterPlan, page: pymupdf.Rect, params: PosterParams, column: int, row: int
) -> tuple[pymupdf.Rect, pymupdf.Rect] | None:
    step_x = plan.printable_width - params.overlap
    step_y = plan.printable_height - params.overlap
    tile = pymupdf.Rect(
        column * step_x,
        row * step_y,
        column * step_x + plan.printable_width,
        row * step_y + plan.printable_height,
    )
    placed = pymupdf.Rect(
        plan.offset_x,
        plan.offset_y,
        plan.offset_x + page.width * plan.scale,
        plan.offset_y + page.height * plan.scale,
    )
    shown = tile & placed
    if shown.is_empty or shown.width < 0.5 or shown.height < 0.5:
        return None
    clip = pymupdf.Rect(
        page.x0 + (shown.x0 - plan.offset_x) / plan.scale,
        page.y0 + (shown.y0 - plan.offset_y) / plan.scale,
        page.x0 + (shown.x1 - plan.offset_x) / plan.scale,
        page.y0 + (shown.y1 - plan.offset_y) / plan.scale,
    )
    target = pymupdf.Rect(
        params.margin + shown.x0 - tile.x0,
        params.margin + shown.y0 - tile.y0,
        params.margin + shown.x1 - tile.x0,
        params.margin + shown.y1 - tile.y0,
    )
    return clip, target


def tile_name(column: int, row: int) -> str:
    letters = ""
    value = row
    while True:
        letters = chr(ord("A") + value % 26) + letters
        value = value // 26 - 1
        if value < 0:
            return f"{letters}{column + 1}"


def _draw_cut_marks(
    sheet: pymupdf.Page, plan: PosterPlan, params: PosterParams, column: int, row: int
) -> None:
    margin = params.margin
    shape = sheet.new_shape()
    if column < params.columns - 1 and params.overlap > 0:
        x = margin + plan.printable_width - params.overlap
        shape.draw_line(pymupdf.Point(x, margin), pymupdf.Point(x, margin + plan.printable_height))
    if row < params.rows - 1 and params.overlap > 0:
        y = margin + plan.printable_height - params.overlap
        shape.draw_line(pymupdf.Point(margin, y), pymupdf.Point(margin + plan.printable_width, y))
    corners = (
        (margin, margin),
        (margin + plan.printable_width, margin),
        (margin, margin + plan.printable_height),
        (margin + plan.printable_width, margin + plan.printable_height),
    )
    reach = min(MARK_REACH, plan.printable_width / 4, plan.printable_height / 4)
    for x, y in corners:
        horizontal = reach if x == margin else -reach
        vertical = reach if y == margin else -reach
        shape.draw_line(pymupdf.Point(x, y), pymupdf.Point(x + horizontal, y))
        shape.draw_line(pymupdf.Point(x, y), pymupdf.Point(x, y + vertical))
    shape.finish(color=GUIDE_GREY, width=0.4, dashes="[3 2] 0")
    shape.commit()


def _draw_label(
    sheet: pymupdf.Page, plan: PosterPlan, params: PosterParams, column: int, row: int, text: str
) -> None:
    length = pymupdf.get_text_length(text, fontsize=LABEL_SIZE) + 2 * LABEL_PAD
    depth = LABEL_SIZE + LABEL_PAD
    ascent = LABEL_PAD / 2 + LABEL_SIZE * 0.75
    left = params.margin
    right = params.margin + plan.printable_width
    bottom = params.margin + plan.printable_height
    hidden_strip = params.overlap >= depth
    if column < params.columns - 1 and hidden_strip and row == params.rows - 1:
        box_left = right - (params.overlap + depth) / 2
        box = pymupdf.Rect(
            box_left, bottom - LABEL_PAD - length, box_left + depth, bottom - LABEL_PAD
        )
        origin = pymupdf.Point(box.x0 + ascent, box.y1 - LABEL_PAD)
        rotate = 90
    else:
        if row < params.rows - 1 and hidden_strip:
            box_top = bottom - (params.overlap + depth) / 2
        else:
            box_top = bottom - LABEL_PAD - depth
        box = pymupdf.Rect(left + LABEL_PAD, box_top, left + LABEL_PAD + length, box_top + depth)
        origin = pymupdf.Point(box.x0 + LABEL_PAD, box.y0 + ascent)
        rotate = 0
    sheet.draw_rect(box, color=None, fill=WHITE, width=0)
    sheet.insert_text(origin, text, fontsize=LABEL_SIZE, color=GUIDE_GREY, rotate=rotate)


@op("pages.poster", PosterParams)
def poster(params: PosterParams, progress: Progress) -> PosterResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with (
        open_document(params.path, params.password) as original,
        _printable_copy(original, progress) as source,
    ):
        indices = parse_page_ranges(params.pages, source.page_count)
        result = pymupdf.open()
        try:
            written = 0
            largest_scale = 0.0
            for position, index in enumerate(indices):
                progress.check_cancelled()
                progress.report(
                    position / len(indices) * 0.9,
                    "progress.imposing",
                    {"current": position + 1, "total": len(indices)},
                )
                page_rect = source[index].rect
                plan = plan_poster(page_rect, params)
                largest_scale = max(largest_scale, plan.scale)
                for row in range(params.rows):
                    for column in range(params.columns):
                        regions = tile_regions(plan, page_rect, params, column, row)
                        if regions is None:
                            continue
                        clip, placed = regions
                        sheet = result.new_page(width=plan.sheet_width, height=plan.sheet_height)
                        sheet.show_pdf_page(placed, source, index, clip=clip)
                        if params.cut_marks:
                            _draw_cut_marks(sheet, plan, params, column, row)
                        if params.labels:
                            name = tile_name(column, row)
                            _draw_label(sheet, plan, params, column, row, f"{name} · {index + 1}")
                        written += 1
            progress.report(0.9, "progress.saving")
            saved = save_document(_into_protected(original, result), target)
        finally:
            result.close()
    return PosterResult(**saved.model_dump(), sheets=written, scale=round(largest_scale, 4))
