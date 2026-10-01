import contextlib
import math
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._page_batch import SharedFonts
from vivepdf.ops._ranges import PageSide
from vivepdf.ops.fonts import (
    font_name_for,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.protocol import RpcModel

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
WATERMARK_FONT = FONT_DIR / "DejaVuSans.ttf"
WATERMARK_FONT_BOLD = FONT_DIR / "DejaVuSans-Bold.ttf"
CORNER_MARGIN = 24.0


FIT_MARGIN = 0.94


GridPosition = Literal[
    "top-left",
    "top-center",
    "top-right",
    "middle-left",
    "center",
    "middle-right",
    "bottom-left",
    "bottom-center",
    "bottom-right",
]
Position = GridPosition | Literal["tile"]


def grid_cell(position: GridPosition) -> tuple[str, str]:
    if position == "center":
        return "middle", "center"
    row, _, column = position.partition("-")
    return row, column


class WatermarkStyle(RpcModel):
    kind: Literal["text", "image", "pdf"] = "text"
    text: str | None = None
    image_path: str | None = None
    template_path: str | None = None
    template_page: int = Field(default=1, ge=1)
    font_size: float = Field(default=48, ge=4, le=400)
    bold: bool = False
    color: str = "#c00000"
    font_id: str | None = None
    opacity: float = Field(default=0.3, ge=0.02, le=1)
    rotation: float = Field(default=45, ge=-180, le=180)
    position: Position = "center"
    scale: float = Field(default=0.5, gt=0, le=1)
    tile_gap: float = Field(default=100, ge=40, le=400)
    offset_x: float = Field(default=0, ge=-100, le=100)
    offset_y: float = Field(default=0, ge=-100, le=100)
    behind: bool = False


class WatermarkParams(WatermarkStyle):
    path: str
    password: str | None = Field(default=None, repr=False)
    output: str
    overwrite: bool = False
    pages: str | None = None
    side: PageSide = "all"
    flatten: bool = False
    flatten_dpi: int = Field(default=150, ge=72, le=400)
    visibility: Literal["always", "print", "screen"] = "always"


class MarkPreviewResult(RpcModel):
    image: str
    width: int
    height: int
    page: int
    page_count: int
    missing_glyphs: str = ""
    pages_problem: str = ""


class WatermarkPreviewParams(WatermarkStyle):
    path: str
    password: str | None = Field(default=None, repr=False)
    pages: str | None = None
    side: PageSide = "all"
    width: int = Field(default=420, ge=120, le=1600)


def parse_color(value: str) -> tuple[float, float, float]:
    text = value.strip().lstrip("#")
    if len(text) != 6 or any(char not in "0123456789abcdefABCDEF" for char in text):
        raise OpError(ErrorCode.INVALID_PARAMS, f"invalid colour '{value}'")
    return tuple(int(text[index : index + 2], 16) / 255 for index in (0, 2, 4))  # type: ignore[return-value]


def rotated_span(width: float, height: float, rotation: float) -> tuple[float, float]:
    radians = math.radians(rotation)
    cos, sin = abs(math.cos(radians)), abs(math.sin(radians))
    return width * cos + height * sin, width * sin + height * cos


def _anchor_points(
    page_rect: pymupdf.Rect, width: float, height: float, params: WatermarkStyle
) -> list[pymupdf.Point]:
    position = params.position
    shift_x = page_rect.width * params.offset_x / 100
    shift_y = page_rect.height * params.offset_y / 100
    if position == "tile":
        gap = params.tile_gap / 100
        step_x = max(width * 1.6 * gap, 60.0)
        step_y = max(height * 4 * gap, 60.0)
        origin_x = shift_x % step_x
        origin_y = shift_y % step_y
        points: list[pymupdf.Point] = []
        y = step_y / 2 + origin_y - step_y
        row = 1
        while y < page_rect.height + step_y:
            x = ((step_x / 2) if row % 2 == 0 else 0.0) + origin_x - step_x
            while x < page_rect.width + step_x:
                points.append(pymupdf.Point(x, y))
                x += step_x
            y += step_y
            row += 1
        return points
    span_x, span_y = rotated_span(width, height, params.rotation)
    half_w, half_h = span_x / 2, span_y / 2
    grid_row, grid_column = grid_cell(position)
    if grid_column == "left":
        anchor_x = CORNER_MARGIN + half_w
    elif grid_column == "right":
        anchor_x = page_rect.width - CORNER_MARGIN - half_w
    else:
        anchor_x = page_rect.width / 2
    if grid_row == "top":
        anchor_y = CORNER_MARGIN + half_h
    elif grid_row == "bottom":
        anchor_y = page_rect.height - CORNER_MARGIN - half_h
    else:
        anchor_y = page_rect.height / 2
    return [
        pymupdf.Point(
            _kept_inside(anchor_x + shift_x, span_x, page_rect.width),
            _kept_inside(anchor_y + shift_y, span_y, page_rect.height),
        )
    ]


def _kept_inside(centre: float, span: float, length: float) -> float:
    if span >= length:
        return length / 2
    return min(max(centre, span / 2), length - span / 2)


LINE_SPACING = 1.25


def mark_lines(text: str | None) -> list[str]:
    lines = [line.strip() for line in (text or "").replace("\r\n", "\n").split("\n")]
    kept = [line for line in lines if line]
    return kept or [""]


def _block_size(font: pymupdf.Font, lines: list[str], size: float) -> tuple[float, float]:
    width = max((font.text_length(line, fontsize=size) for line in lines), default=0.0)
    return width, size * (1 + LINE_SPACING * (len(lines) - 1))


def _fit_font_size(
    font: pymupdf.Font, lines: list[str], size: float, rect: pymupdf.Rect, rotation: float
) -> float:
    width, height = _block_size(font, lines, size)
    if width <= 0:
        return size
    radians = math.radians(rotation)
    cos, sin = abs(math.cos(radians)), abs(math.sin(radians))
    span_x = width * cos + height * sin
    span_y = width * sin + height * cos
    scale = min(
        1.0,
        rect.width * FIT_MARGIN / span_x if span_x else 1.0,
        rect.height * FIT_MARGIN / span_y if span_y else 1.0,
    )
    return size * scale


def _stamp_text(
    page: pymupdf.Page,
    params: WatermarkStyle,
    font: pymupdf.Font,
    font_file: Path,
    color: tuple,
    layer: int = 0,
    shared: tuple[SharedFonts, int] | None = None,
) -> None:
    font_name = font_name_for(font_file)
    lines = mark_lines(params.text)
    rect = page.rect
    size = _fit_font_size(font, lines, params.font_size, rect, params.rotation)
    width, block = _block_size(font, lines, size)
    for center in _anchor_points(rect, width, block, params):
        morph = (center * page.derotation_matrix, pymupdf.Matrix(params.rotation))
        top = center.y - block / 2
        for index, line in enumerate(lines):
            line_width = font.text_length(line, fontsize=size)
            baseline = pymupdf.Point(
                center.x - line_width / 2, top + size * (LINE_SPACING * index + 0.85)
            )
            fonts = (
                shared[0].using(page, shared[1], font_name, font_file)
                if shared is not None
                else contextlib.nullcontext()
            )
            with fonts:
                page.insert_text(
                    baseline * page.derotation_matrix,
                    line,
                    fontsize=size,
                    fontname=font_name,
                    fontfile=str(font_file),
                    color=color,
                    fill_opacity=params.opacity,
                    stroke_opacity=params.opacity,
                    morph=morph,
                    rotate=page.rotation,
                    overlay=not params.behind,
                    oc=layer,
                )
