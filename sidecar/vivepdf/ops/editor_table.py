from dataclasses import dataclass
from typing import Annotated, Literal

import pymupdf
from pydantic import Field, model_validator

from vivepdf.ops._scratch import (
    HEX_COLOR,
    LINE_HEIGHT,
    ScratchFonts,
    baseline_offset,
    load_fonts,
    rgb,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MAX_TABLE_ROWS = 60
MAX_TABLE_COLUMNS = 20
MAX_CELL_CHARS = 2000
MAX_TABLE_HEIGHT = 14_400.0
PADDING = 0.4
STRIPE_STRENGTH = 0.4
DEFAULT_STRIPE = (0.94, 0.94, 0.95)

TableBorder = Literal["all", "horizontal", "outer", "none"]
TableAlign = Literal["left", "center", "right"]
CellText = Annotated[str, Field(max_length=MAX_CELL_CHARS)]


class TableCellStyle(RpcModel):
    fill: str | None = Field(default=None, pattern=HEX_COLOR)
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    align: TableAlign | None = None
    bold: bool | None = None


class TableSpec(RpcModel):
    cells: list[list[CellText]] = Field(min_length=1, max_length=MAX_TABLE_ROWS)
    column_widths: list[Annotated[float, Field(gt=0, le=1000)]] = Field(
        min_length=1, max_length=MAX_TABLE_COLUMNS
    )
    align: list[TableAlign] = Field(min_length=1, max_length=MAX_TABLE_COLUMNS)
    width: float = Field(ge=40, le=2000)
    font_size: float = Field(default=11, ge=4, le=72)
    font_id: str | None = Field(default=None, max_length=4096)
    header: bool = True
    border: TableBorder = "all"
    color: str = Field(default="#111111", pattern=HEX_COLOR)
    border_color: str = Field(default="#111111", pattern=HEX_COLOR)
    header_fill: str | None = Field(default=None, pattern=HEX_COLOR)
    stripes: bool = False
    stripe_fill: str | None = Field(default=None, pattern=HEX_COLOR)
    border_width: float | None = Field(default=None, gt=0, le=20)
    cell_styles: list[list[TableCellStyle]] | None = Field(default=None, max_length=MAX_TABLE_ROWS)

    @model_validator(mode="after")
    def _same_shape(self) -> "TableSpec":
        columns = len(self.column_widths)
        if len(self.align) != columns:
            raise ValueError("align needs one entry per column")
        if any(len(row) != columns for row in self.cells):
            raise ValueError("every row needs one cell per column")
        if self.cell_styles is not None and (
            len(self.cell_styles) != len(self.cells)
            or any(len(row) != columns for row in self.cell_styles)
        ):
            raise ValueError("cell styles need one entry per cell")
        return self

    def style_of(self, row: int, column: int) -> TableCellStyle | None:
        return self.cell_styles[row][column] if self.cell_styles is not None else None

    def is_bold(self, row: int, column: int) -> bool:
        style = self.style_of(row, column)
        if style is not None and style.bold is not None:
            return style.bold
        return self.header and row == 0

    def align_of(self, row: int, column: int) -> TableAlign:
        style = self.style_of(row, column)
        return style.align if style is not None and style.align else self.align[column]


class TablePreviewResult(RpcModel):
    svg: str
    width: float
    height: float
    missing_glyphs: str = ""
    row_heights: list[float] = Field(default_factory=list)
    column_widths: list[float] = Field(default_factory=list)


@dataclass
class _Layout:
    widths: list[float]
    heights: list[float]
    lines: list[list[list[str]]]
    padding: float


def _stripe_colour(spec: TableSpec) -> tuple[float, float, float]:
    if spec.stripe_fill:
        return rgb(spec.stripe_fill)
    if not spec.header_fill:
        return DEFAULT_STRIPE
    red, green, blue = rgb(spec.header_fill)
    return tuple(1 - (1 - channel) * STRIPE_STRENGTH for channel in (red, green, blue))


def _break_word(word: str, font: pymupdf.Font, size: float, width: float) -> list[str]:
    pieces: list[str] = []
    current = ""
    for char in word:
        if current and font.text_length(current + char, fontsize=size) > width:
            pieces.append(current)
            current = char
        else:
            current += char
    if current:
        pieces.append(current)
    return pieces


def wrap_cell(text: str, font: pymupdf.Font, size: float, width: float) -> list[str]:
    lines: list[str] = []
    for paragraph in text.replace("\r\n", "\n").split("\n"):
        words = paragraph.split()
        if not words:
            lines.append("")
            continue
        current = ""
        for word in words:
            candidate = f"{current} {word}" if current else word
            if font.text_length(candidate, fontsize=size) <= width:
                current = candidate
                continue
            if current:
                lines.append(current)
            pieces = _break_word(word, font, size, width)
            lines.extend(pieces[:-1])
            current = pieces[-1] if pieces else ""
        lines.append(current)
    while len(lines) > 1 and lines[-1] == "":
        lines.pop()
    return lines or [""]


def _layout(spec: TableSpec, regular: pymupdf.Font, bold: pymupdf.Font) -> _Layout:
    total = sum(spec.column_widths)
    widths = [spec.width * weight / total for weight in spec.column_widths]
    padding = spec.font_size * PADDING
    line_step = spec.font_size * LINE_HEIGHT
    lines: list[list[list[str]]] = []
    heights: list[float] = []
    for row_index, row in enumerate(spec.cells):
        wrapped = [
            wrap_cell(
                text,
                bold if spec.is_bold(row_index, column) else regular,
                spec.font_size,
                max(1.0, width - 2 * padding),
            )
            for column, (text, width) in enumerate(zip(row, widths, strict=True))
        ]
        lines.append(wrapped)
        heights.append(max(len(cell) for cell in wrapped) * line_step + 2 * padding)
    if sum(heights) > MAX_TABLE_HEIGHT:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the table is too tall to place on a page",
            {"reason": "tableTooTall", "height": round(sum(heights))},
        )
    return _Layout(widths, heights, lines, padding)


def _draw_fills(page: pymupdf.Page, spec: TableSpec, layout: _Layout, opacity: float) -> None:
    top = 0.0
    for row_index, height in enumerate(layout.heights):
        fill = None
        if spec.header and row_index == 0 and spec.header_fill:
            fill = rgb(spec.header_fill)
        elif spec.stripes and (row_index - (1 if spec.header else 0)) % 2 == 1:
            fill = _stripe_colour(spec)
        if fill is not None:
            page.draw_rect(
                pymupdf.Rect(0, top, spec.width, top + height),
                color=None,
                fill=fill,
                width=0,
                fill_opacity=opacity,
            )
        left = 0.0
        for column, width in enumerate(layout.widths):
            style = spec.style_of(row_index, column)
            if style is not None and style.fill:
                page.draw_rect(
                    pymupdf.Rect(left, top, left + width, top + height),
                    color=None,
                    fill=rgb(style.fill),
                    width=0,
                    fill_opacity=opacity,
                )
            left += width
        top += height


def _draw_borders(page: pymupdf.Page, spec: TableSpec, layout: _Layout, opacity: float) -> None:
    if spec.border == "none":
        return
    colour = rgb(spec.border_color)
    line_width = spec.border_width or max(0.5, spec.font_size / 16)
    height = sum(layout.heights)
    edges_y = [0.0]
    for row_height in layout.heights:
        edges_y.append(edges_y[-1] + row_height)
    edges_x = [0.0]
    for column_width in layout.widths:
        edges_x.append(edges_x[-1] + column_width)

    def line(x0: float, y0: float, x1: float, y1: float) -> None:
        page.draw_line((x0, y0), (x1, y1), color=colour, width=line_width, stroke_opacity=opacity)

    if spec.border == "all":
        horizontal = edges_y
        vertical = edges_x
    elif spec.border == "horizontal":
        horizontal = edges_y
        vertical = []
    else:
        horizontal = [0.0, height] + ([edges_y[1]] if spec.header and len(edges_y) > 2 else [])
        vertical = [0.0, spec.width]
    for y in horizontal:
        line(0, y, spec.width, y)
    for x in vertical:
        line(x, 0, x, height)


def _draw_text(
    page: pymupdf.Page,
    spec: TableSpec,
    layout: _Layout,
    fonts: ScratchFonts,
    opacity: float,
) -> None:
    fonts.install(page)
    size = spec.font_size
    line_step = size * LINE_HEIGHT
    top = 0.0
    for row_index, row in enumerate(layout.lines):
        left = 0.0
        for column_index, cell in enumerate(row):
            heading = spec.is_bold(row_index, column_index)
            font = fonts.of(heading)
            fontname = fonts.name_of(heading)
            offset = baseline_offset(font, size)
            style = spec.style_of(row_index, column_index)
            colour = rgb(style.color if style is not None and style.color else spec.color)
            width = layout.widths[column_index]
            spare = layout.heights[row_index] - 2 * layout.padding - len(cell) * line_step
            middle = max(0.0, spare / 2)
            for line_index, text in enumerate(cell):
                if not text:
                    continue
                advance = font.text_length(text, fontsize=size)
                align = spec.align_of(row_index, column_index)
                if align == "center":
                    x = left + (width - advance) / 2
                elif align == "right":
                    x = left + width - layout.padding - advance
                else:
                    x = left + layout.padding
                y = top + layout.padding + middle + line_index * line_step + offset
                page.insert_text(
                    (x, y),
                    text,
                    fontname=fontname,
                    fontsize=size,
                    color=colour,
                    fill_opacity=opacity,
                )
            left += width
        top += layout.heights[row_index]


def _table_document(spec: TableSpec, opacity: float = 1.0) -> tuple[pymupdf.Document, str, _Layout]:
    fonts = load_fonts(spec.font_id)
    layout = _layout(spec, fonts.regular, fonts.bold)
    document = pymupdf.open()
    page = document.new_page(width=spec.width, height=sum(layout.heights))
    _draw_fills(page, spec, layout, opacity)
    _draw_borders(page, spec, layout, opacity)
    _draw_text(page, spec, layout, fonts, opacity)
    texts = [
        (text, spec.is_bold(row, column))
        for row, cells in enumerate(spec.cells)
        for column, text in enumerate(cells)
    ]
    body = "".join(text for text, bold in texts if not bold)
    heading = "".join(text for text, bold in texts if bold)
    return document, fonts.missing(body, heading), layout


def table_pdf(spec: TableSpec, opacity: float = 1.0) -> tuple[pymupdf.Document, str]:
    document, missing, _ = _table_document(spec, opacity)
    return document, missing


@op("editor.table_preview", TableSpec)
def table_preview(params: TableSpec, _progress: Progress) -> TablePreviewResult:
    document, missing, layout = _table_document(params)
    try:
        page = document[0]
        return TablePreviewResult(
            svg=page.get_svg_image(text_as_path=True),
            width=page.rect.width,
            height=page.rect.height,
            missing_glyphs=missing,
            row_heights=layout.heights,
            column_widths=layout.widths,
        )
    finally:
        document.close()
