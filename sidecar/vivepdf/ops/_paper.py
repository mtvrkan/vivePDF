import math
from dataclasses import dataclass, field
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._page_text import parse_color
from vivepdf.ops.furniture import mark_new_content
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.protocol import RpcModel

MM = 72 / 25.4
PAPER_INSET_MM = 10.0
MARGIN_OFFSET_MM = 20.0
MAX_PAPER_MARKS = 40_000
RULE_WIDTH = 0.5
GUIDE_WIDTH = 0.4
MARGIN_WIDTH = 0.7
MARGIN_COLOUR = (0.87, 0.4, 0.4)
GUIDE_DASHES = "[2 2] 0"
BACKGROUND_ARTIFACT = b"/Artifact <</Type /Background>> BDC\n"
EPSILON = 1e-6

PaperStyle = Literal["lined", "grid", "dots", "isometric", "handwriting", "staff"]
LineKind = Literal["rule", "guide", "margin"]


class PaperPattern(RpcModel):
    style: PaperStyle
    spacing: float = Field(ge=2, le=30, allow_inf_nan=False)
    color: str = Field(default="#9bb4d0", pattern=r"^#[0-9a-fA-F]{6}$")
    margin: bool = False


@dataclass
class PaperMarks:
    lines: list[tuple[float, float, float, float, LineKind]] = field(default_factory=list)
    dots: list[tuple[float, float]] = field(default_factory=list)
    dot_radius: float = 0.0


def _count(length: float, step: float) -> int:
    return max(0, math.floor(length / step + EPSILON))


def _banded_rows(top: float, bottom: float, step: float, lines: int, gap: float) -> list[float]:
    band = (lines - 1) * step
    rows: list[float] = []
    y = top + step
    while y + band <= bottom + EPSILON:
        rows.extend(y + index * step for index in range(lines))
        y += band + gap
    return rows


def _lined(marks: PaperMarks, box: tuple[float, float, float, float], step: float, margin: bool):
    left, top, right, bottom = box
    for index in range(1, _count(bottom - top, step) + 1):
        y = top + index * step
        marks.lines.append((left, y, right, y, "rule"))
    x = left + MARGIN_OFFSET_MM * MM
    if margin and x < right:
        marks.lines.append((x, top, x, bottom, "margin"))


def _lattice(width: float, height: float, box: tuple[float, float, float, float], step: float):
    left, top, right, bottom = box
    columns, rows = _count(right - left, step), _count(bottom - top, step)
    return columns, rows, (width - columns * step) / 2, (height - rows * step) / 2


def _grid(marks: PaperMarks, width: float, height: float, box, step: float) -> None:
    columns, rows, x0, y0 = _lattice(width, height, box, step)
    if not columns or not rows:
        return
    for column in range(columns + 1):
        x = x0 + column * step
        marks.lines.append((x, y0, x, y0 + rows * step, "rule"))
    for row in range(rows + 1):
        y = y0 + row * step
        marks.lines.append((x0, y, x0 + columns * step, y, "rule"))


def _dots(marks: PaperMarks, width: float, height: float, box, step: float) -> None:
    columns, rows, x0, y0 = _lattice(width, height, box, step)
    marks.dots = [
        (x0 + column * step, y0 + row * step)
        for row in range(rows + 1)
        for column in range(columns + 1)
    ]


def _isometric(marks: PaperMarks, width: float, height: float, box, step: float) -> None:
    left, top, right, bottom = box
    row_height = step * math.sqrt(3) / 2
    columns, rows = _count(right - left, step), _count(bottom - top, row_height)
    x0, y0 = (width - columns * step) / 2, (height - rows * row_height) / 2
    for row in range(rows + 1):
        shift = step / 2 if row % 2 else 0.0
        for column in range(columns if row % 2 else columns + 1):
            marks.dots.append((x0 + column * step + shift, y0 + row * row_height))


def paper_marks(width: float, height: float, pattern: PaperPattern) -> PaperMarks:
    step = pattern.spacing * MM
    inset = PAPER_INSET_MM * MM
    box = (inset, inset, width - inset, height - inset)
    marks = PaperMarks(dot_radius=min(1.2, max(0.5, step * 0.05)))
    if box[2] - box[0] < step or box[3] - box[1] < step:
        return marks
    if pattern.style == "lined":
        _lined(marks, box, step, pattern.margin)
    elif pattern.style == "grid":
        _grid(marks, width, height, box, step)
    elif pattern.style == "dots":
        _dots(marks, width, height, box, step)
    elif pattern.style == "isometric":
        _isometric(marks, width, height, box, step)
    elif pattern.style == "handwriting":
        for index, y in enumerate(_banded_rows(box[1], box[3], step, 4, 2 * step)):
            kind: LineKind = "guide" if index % 4 in (1, 2) else "rule"
            marks.lines.append((box[0], y, box[2], y, kind))
    else:
        for y in _banded_rows(box[1], box[3], step, 5, 6 * step):
            marks.lines.append((box[0], y, box[2], y, "rule"))
    return marks


def _stroke(page: pymupdf.Page, lines, colour, width: float, dashes: str | None = None) -> None:
    if not lines:
        return
    shape = page.new_shape()
    for x0, y0, x1, y1, _kind in lines:
        shape.draw_line((x0, y0), (x1, y1))
    shape.finish(color=colour, width=width, dashes=dashes, closePath=False)
    shape.commit()


def draw_paper(page: pymupdf.Page, pattern: PaperPattern) -> None:
    rect = page.rect
    marks = paper_marks(rect.width, rect.height, pattern)
    if len(marks.lines) + len(marks.dots) > MAX_PAPER_MARKS:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "paper pattern is too dense for the page size",
            {"reason": "paperTooDense"},
        )
    colour = parse_color(pattern.color)
    before = set(page.get_contents())
    by_kind = {
        kind: [line for line in marks.lines if line[4] == kind]
        for kind in ("rule", "guide", "margin")
    }
    _stroke(page, by_kind["rule"], colour, RULE_WIDTH)
    _stroke(page, by_kind["guide"], colour, GUIDE_WIDTH, GUIDE_DASHES)
    _stroke(page, by_kind["margin"], MARGIN_COLOUR, MARGIN_WIDTH)
    if marks.dots:
        shape = page.new_shape()
        for x, y in marks.dots:
            shape.draw_circle((x, y), marks.dot_radius)
        shape.finish(color=None, fill=colour, width=0)
        shape.commit()
    mark_new_content(page, before, BACKGROUND_ARTIFACT)
