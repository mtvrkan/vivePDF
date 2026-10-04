import math
from dataclasses import dataclass, field
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
from vivepdf.ops.editor_table import wrap_cell
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MAX_CATEGORIES = 100
MAX_SERIES = 8
MAX_LABEL_CHARS = 200
MAX_TITLE_CHARS = 300
DEFAULT_PALETTE = (
    "#2563eb",
    "#f97316",
    "#16a34a",
    "#dc2626",
    "#9333ea",
    "#0891b2",
    "#ca8a04",
    "#db2777",
)
GRID_COLOUR = (0.86, 0.87, 0.89)
AXIS_COLOUR = (0.42, 0.45, 0.5)
WHITE = (1.0, 1.0, 1.0)
AREA_OPACITY = 0.35
GROUP_SHARE = 0.72
DOUGHNUT_HOLE = 0.55
ARC_STEP_DEGREES = 2.0
TICK_TARGET = 5
SIDE_LEGEND_SHARE = 0.35

ChartType = Literal[
    "column", "bar", "line", "area", "pie", "doughnut", "scatter", "histogram", "box", "dotplot"
]
LegendPosition = Literal["bottom", "top", "right", "left"]
SAMPLE_TYPES = ("histogram", "box", "dotplot")
MAX_BINS = 50
Label = Annotated[str, Field(max_length=MAX_LABEL_CHARS)]


class ChartSeries(RpcModel):
    name: Label = ""
    color: str = Field(pattern=HEX_COLOR)
    values: list[float | None] = Field(max_length=MAX_CATEGORIES)


class ChartSpec(RpcModel):
    type: ChartType = "column"
    categories: list[Label] = Field(min_length=1, max_length=MAX_CATEGORIES)
    series: list[ChartSeries] = Field(min_length=1, max_length=MAX_SERIES)
    title: str = Field(default="", max_length=MAX_TITLE_CHARS)
    category_title: Label = ""
    value_title: Label = ""
    legend: bool = True
    legend_position: LegendPosition = "bottom"
    grid: bool = True
    value_labels: bool = False
    stacked: bool = False
    width: float = Field(default=360, ge=120, le=1200)
    height: float = Field(default=240, ge=80, le=1200)
    font_size: float = Field(default=10, ge=4, le=36)
    font_id: str | None = Field(default=None, max_length=4096)
    color: str = Field(default="#1f2937", pattern=HEX_COLOR)
    palette: list[Annotated[str, Field(pattern=HEX_COLOR)]] = Field(
        default_factory=lambda: list(DEFAULT_PALETTE), min_length=1, max_length=12
    )
    decimal: Literal[".", ","] = "."
    bins: int | None = Field(default=None, ge=1, le=MAX_BINS)

    @model_validator(mode="after")
    def _same_length(self) -> "ChartSpec":
        count = len(self.categories)
        for series in self.series:
            if len(series.values) != count:
                raise ValueError("every series needs one value per category")
            if any(value is not None and not math.isfinite(value) for value in series.values):
                raise ValueError("values must be finite numbers")
        return self


class ChartPreviewResult(RpcModel):
    svg: str
    width: float
    height: float
    missing_glyphs: str = ""


@dataclass
class _Ticks:
    low: float
    high: float
    step: float
    decimals: int

    def values(self) -> list[float]:
        count = round((self.high - self.low) / self.step)
        return [self.low + index * self.step for index in range(count + 1)]


@dataclass
class _Box:
    left: float
    top: float
    right: float
    bottom: float

    @property
    def width(self) -> float:
        return self.right - self.left

    @property
    def height(self) -> float:
        return self.bottom - self.top


@dataclass
class _Canvas:
    page: pymupdf.Page
    fonts: ScratchFonts
    spec: ChartSpec
    opacity: float
    regular_text: list[str] = field(default_factory=list)
    bold_text: list[str] = field(default_factory=list)

    @property
    def size(self) -> float:
        return self.spec.font_size

    @property
    def line(self) -> float:
        return self.spec.font_size * LINE_HEIGHT

    def width_of(self, text: str, size: float | None = None, bold: bool = False) -> float:
        return self.fonts.of(bold).text_length(text, fontsize=size or self.size)

    def text(
        self,
        x: float,
        top: float,
        text: str,
        *,
        size: float | None = None,
        bold: bool = False,
        align: str = "left",
        colour: tuple[float, float, float] | None = None,
    ) -> None:
        if not text:
            return
        size = size or self.size
        font = self.fonts.of(bold)
        width = font.text_length(text, fontsize=size)
        if align == "center":
            x -= width / 2
        elif align == "right":
            x -= width
        (self.bold_text if bold else self.regular_text).append(text)
        self.page.insert_text(
            (x, top + baseline_offset(font, size)),
            text,
            fontname=self.fonts.name_of(bold),
            fontsize=size,
            color=colour or rgb(self.spec.color),
            fill_opacity=self.opacity,
        )

    def upright_text(self, left: float, middle: float, text: str) -> None:
        if not text:
            return
        font = self.fonts.regular
        width = font.text_length(text, fontsize=self.size)
        self.regular_text.append(text)
        self.page.insert_text(
            (left + baseline_offset(font, self.size), middle + width / 2),
            text,
            fontname=self.fonts.name_of(False),
            fontsize=self.size,
            color=rgb(self.spec.color),
            fill_opacity=self.opacity,
            rotate=90,
        )

    def fill_rect(
        self, rect: pymupdf.Rect, colour: tuple[float, float, float], opacity: float = 1.0
    ) -> None:
        rect.normalize()
        if rect.width <= 0 or rect.height <= 0:
            return
        self.page.draw_rect(
            rect, color=None, fill=colour, width=0, fill_opacity=opacity * self.opacity
        )

    def line_between(
        self,
        start: tuple[float, float],
        end: tuple[float, float],
        colour: tuple[float, float, float],
        width: float,
    ) -> None:
        self.page.draw_line(start, end, color=colour, width=width, stroke_opacity=self.opacity)

    def polygon(
        self,
        points: list[tuple[float, float]],
        fill: tuple[float, float, float] | None,
        stroke: tuple[float, float, float] | None = None,
        width: float = 0,
        fill_opacity: float = 1.0,
        closed: bool = True,
    ) -> None:
        if len(points) < 2:
            return
        self.page.draw_polyline(
            points,
            color=stroke,
            fill=fill,
            width=width,
            closePath=closed,
            fill_opacity=fill_opacity * self.opacity,
            stroke_opacity=self.opacity,
            lineJoin=1,
            lineCap=1,
        )

    def dot(self, centre: tuple[float, float], radius: float, colour) -> None:
        self.page.draw_circle(
            centre,
            radius,
            color=WHITE,
            fill=colour,
            width=radius * 0.35,
            fill_opacity=self.opacity,
            stroke_opacity=self.opacity,
        )

    def fitted(self, text: str, width: float, lines: int = 1, bold: bool = False) -> list[str]:
        wrapped = wrap_cell(text, self.fonts.of(bold), self.size, max(1.0, width))
        if len(wrapped) <= lines:
            return wrapped
        kept = wrapped[:lines]
        last = kept[-1]
        while last and self.width_of(last + "…", bold=bold) > width:
            last = last[:-1]
        kept[-1] = last.rstrip() + "…"
        return kept


def _refuse(reason: str, message: str, **data) -> OpError:
    return OpError(ErrorCode.INVALID_PARAMS, message, {"reason": reason, **data})


def nice_ticks(low: float, high: float, target: int = TICK_TARGET) -> _Ticks:
    if high - low < 1e-12:
        spread = abs(high) * 0.1 or 1.0
        low, high = low - spread, high + spread
    raw = (high - low) / target
    magnitude = 10 ** math.floor(math.log10(raw))
    multiple = next(value for value in (1, 2, 2.5, 5, 10) if value * magnitude >= raw * 0.999)
    step = multiple * magnitude
    start = math.floor(low / step + 1e-9) * step
    end = math.ceil(high / step - 1e-9) * step
    decimals = max(0, -math.floor(math.log10(magnitude) + 1e-9) + (1 if multiple == 2.5 else 0))
    return _Ticks(start, end, step, decimals)


def format_number(value: float, decimals: int, decimal: str) -> str:
    text = f"{value:.{decimals}f}"
    if float(text) == 0:
        text = text.lstrip("-")
    return text.replace(".", decimal)


def plain_number(value: float, decimal: str) -> str:
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    if text in ("-0", ""):
        text = "0"
    return text.replace(".", decimal)


def percent_text(share: float, decimal: str) -> str:
    text = f"{share * 100:.1f}".removesuffix(".0")
    return text.replace(".", decimal)


def parse_number(text: str) -> float | None:
    cleaned = "".join(text.split()).replace("−", "-")
    comma, dot = cleaned.rfind(","), cleaned.rfind(".")
    if comma >= 0 and dot >= 0:
        separator = "," if comma > dot else "."
        grouping = "." if separator == "," else ","
        cleaned = cleaned.replace(grouping, "").replace(separator, ".")
    elif comma >= 0:
        cleaned = cleaned.replace(",", ".") if cleaned.count(",") == 1 else cleaned.replace(",", "")
    elif cleaned.count(".") > 1:
        cleaned = cleaned.replace(".", "")
    try:
        value = float(cleaned)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _series_values(spec: ChartSpec) -> list[list[float | None]]:
    return [series.values for series in spec.series]


def _stacks(spec: ChartSpec) -> tuple[list[float], list[float]]:
    count = len(spec.categories)
    positive = [0.0] * count
    negative = [0.0] * count
    for values in _series_values(spec):
        for index, value in enumerate(values):
            if value is None:
                continue
            if value >= 0:
                positive[index] += value
            else:
                negative[index] += value
    return positive, negative


def _value_range(spec: ChartSpec, stacked: bool) -> tuple[float, float]:
    if stacked:
        positive, negative = _stacks(spec)
        return min(0.0, *negative), max(0.0, *positive)
    present = [value for values in _series_values(spec) for value in values if value is not None]
    low, high = min(present), max(present)
    if spec.type == "line" and low > 0 and low > high * 0.5:
        return low, high
    if spec.type == "line" and high < 0 and high < low * 0.5:
        return low, high
    return min(0.0, low), max(0.0, high)


def _legend_entries(spec: ChartSpec) -> list[tuple[str, tuple[float, float, float]]]:
    if not spec.legend:
        return []
    if spec.type in ("pie", "doughnut"):
        values = spec.series[0].values
        return [
            (name, rgb(spec.palette[index % len(spec.palette)]))
            for index, name in enumerate(spec.categories)
            if values[index] is not None and values[index] > 0 and name.strip()
        ]
    return [(series.name, rgb(series.color)) for series in spec.series if series.name.strip()]


def _draw_title(canvas: _Canvas, box: _Box) -> None:
    title = canvas.spec.title.strip()
    if not title:
        return
    size = canvas.size * 1.25
    lines = wrap_cell(title, canvas.fonts.bold, size, box.width)[:2]
    for line in lines:
        canvas.text(box.left + box.width / 2, box.top, line, size=size, bold=True, align="center")
        box.top += size * LINE_HEIGHT
    box.top += canvas.size * 0.4


def _draw_side_legend(
    canvas: _Canvas, box: _Box, entries: list[tuple[str, tuple[float, float, float]]]
) -> None:
    swatch = canvas.size * 0.75
    gap = canvas.size * 0.4
    limit = box.width * SIDE_LEGEND_SHARE
    labels = [canvas.fitted(name, max(1.0, limit - swatch - gap))[0] for name, _ in entries]
    width = min(limit, swatch + gap + max(canvas.width_of(label) for label in labels))
    shown = list(zip(labels, (colour for _, colour in entries), strict=True))
    shown = shown[: max(1, int(box.height // canvas.line))]
    top = box.top + (box.height - len(shown) * canvas.line) / 2
    left = box.right - width if canvas.spec.legend_position == "right" else box.left
    for label, colour in shown:
        square_top = top + (canvas.line - swatch) / 2
        canvas.fill_rect(pymupdf.Rect(left, square_top, left + swatch, square_top + swatch), colour)
        canvas.text(left + swatch + gap, top, label)
        top += canvas.line
    if canvas.spec.legend_position == "right":
        box.right = left - canvas.size * 0.8
    else:
        box.left = left + width + canvas.size * 0.8


def _draw_legend(canvas: _Canvas, box: _Box) -> None:
    entries = _legend_entries(canvas.spec)
    if not entries:
        return
    if canvas.spec.legend_position in ("left", "right"):
        _draw_side_legend(canvas, box, entries)
        return
    swatch = canvas.size * 0.75
    gap = canvas.size * 0.4
    spacing = canvas.size * 1.2
    items: list[tuple[str, tuple[float, float, float], float]] = []
    for name, colour in entries:
        label = canvas.fitted(name, box.width - swatch - gap)[0]
        items.append((label, colour, swatch + gap + canvas.width_of(label)))
    rows: list[list[tuple[str, tuple[float, float, float], float]]] = [[]]
    used = 0.0
    for item in items:
        needed = item[2] + (spacing if rows[-1] else 0)
        if rows[-1] and used + needed > box.width:
            rows.append([])
            used = 0.0
            needed = item[2]
        rows[-1].append(item)
        used += needed
    if canvas.spec.legend_position == "top":
        top = box.top
        box.top = top + len(rows) * canvas.line + canvas.size * 0.5
    else:
        top = box.bottom - len(rows) * canvas.line
        box.bottom = top - canvas.size * 0.5
    for row in rows:
        total = sum(item[2] for item in row) + spacing * (len(row) - 1)
        x = box.left + (box.width - total) / 2
        for label, colour, width in row:
            square_top = top + (canvas.line - swatch) / 2
            canvas.fill_rect(pymupdf.Rect(x, square_top, x + swatch, square_top + swatch), colour)
            canvas.text(x + swatch + gap, top, label)
            x += width + spacing
        top += canvas.line


def _label_stride(slot: float, canvas: _Canvas, labels: list[str]) -> int:
    widest = max((canvas.width_of(label) for label in labels), default=0.0)
    wanted = min(widest, canvas.size * 3.0)
    stride = 1
    while slot * stride < wanted and stride < len(labels):
        stride += 1
    return stride


def _draw_value_grid(
    canvas: _Canvas,
    plot: _Box,
    ticks: _Ticks,
    position,
    vertical: bool,
) -> None:
    spec = canvas.spec
    for value in ticks.values():
        at = position(value)
        text = format_number(value, ticks.decimals, spec.decimal)
        if vertical:
            if spec.grid:
                canvas.line_between((plot.left, at), (plot.right, at), GRID_COLOUR, 0.5)
            canvas.text(
                plot.left - canvas.size * 0.4,
                at - canvas.line / 2,
                text,
                align="right",
                colour=AXIS_COLOUR,
            )
        else:
            if spec.grid:
                canvas.line_between((at, plot.top), (at, plot.bottom), GRID_COLOUR, 0.5)
            canvas.text(
                at, plot.bottom + canvas.size * 0.3, text, align="center", colour=AXIS_COLOUR
            )


def _tick_label_width(canvas: _Canvas, ticks: _Ticks) -> float:
    return max(
        canvas.width_of(format_number(value, ticks.decimals, canvas.spec.decimal))
        for value in ticks.values()
    )


def _draw_axis_titles(canvas: _Canvas, box: _Box, upright: str, across: str) -> None:
    gap = canvas.size * 0.4
    if upright.strip():
        canvas.upright_text(box.left, box.top + box.height / 2, upright.strip())
        box.left += canvas.line + gap
    if across.strip():
        canvas.text(
            box.left + box.width / 2, box.bottom - canvas.line, across.strip(), align="center"
        )
        box.bottom -= canvas.line + gap


def _draw_category_chart(canvas: _Canvas, box: _Box) -> None:
    spec = canvas.spec
    horizontal = spec.type == "bar"
    stacked = spec.stacked and spec.type in ("column", "bar", "area")
    low, high = _value_range(spec, stacked)
    ticks = nice_ticks(low, high)
    count = len(spec.categories)
    size = canvas.size
    gap = size * 0.4
    if horizontal:
        _draw_axis_titles(canvas, box, spec.category_title, spec.value_title)
    else:
        _draw_axis_titles(canvas, box, spec.value_title, spec.category_title)
    if horizontal:
        label_width = min(
            max(canvas.width_of(label) for label in spec.categories) + 1, box.width * 0.3
        )
        tick_half = _tick_label_width(canvas, ticks) / 2
        plot = _Box(
            box.left + label_width + gap,
            box.top + size * 0.2,
            box.right - tick_half,
            box.bottom - canvas.line - size * 0.3,
        )
    else:
        plot_left = box.left + _tick_label_width(canvas, ticks) + gap
        slot = (box.right - plot_left) / count
        stride = _label_stride(slot, canvas, spec.categories)
        label_lines = max(
            len(canvas.fitted(label, slot * stride * 0.95, 2)) for label in spec.categories
        )
        plot = _Box(
            plot_left,
            box.top + canvas.line / 2,
            box.right,
            box.bottom - label_lines * canvas.line - size * 0.3,
        )
    if plot.width < size or plot.height < size:
        raise _refuse("chartTooSmall", "the chart is too small for its labels", width=spec.width)
    span = ticks.high - ticks.low

    def value_at(value: float) -> float:
        share = (value - ticks.low) / span
        return plot.left + share * plot.width if horizontal else plot.bottom - share * plot.height

    _draw_value_grid(canvas, plot, ticks, value_at, vertical=not horizontal)
    slot = (plot.height if horizontal else plot.width) / count

    def slot_start(index: int) -> float:
        return plot.top + index * slot if horizontal else plot.left + index * slot

    stride = 1 if horizontal else _label_stride(slot, canvas, spec.categories)
    for index, label in enumerate(spec.categories):
        if index % stride:
            continue
        if horizontal:
            lines = canvas.fitted(label, plot.left - box.left - gap, 2)
            top = slot_start(index) + (slot - len(lines) * canvas.line) / 2
            for number, line in enumerate(lines):
                canvas.text(plot.left - gap, top + number * canvas.line, line, align="right")
        else:
            lines = canvas.fitted(label, slot * stride * 0.95, 2)
            middle = slot_start(index) + slot / 2
            for number, line in enumerate(lines):
                canvas.text(
                    middle, plot.bottom + size * 0.3 + number * canvas.line, line, align="center"
                )
    zero = value_at(min(max(0.0, ticks.low), ticks.high))
    if spec.type in ("line", "area"):
        _draw_lines(canvas, slot, slot_start, value_at, stacked)
    else:
        floor = plot.left if horizontal else plot.bottom
        _draw_bars(canvas, slot, slot_start, value_at, stacked, horizontal, floor)
    if horizontal:
        canvas.line_between((zero, plot.top), (zero, plot.bottom), AXIS_COLOUR, 0.75)
    else:
        canvas.line_between((plot.left, zero), (plot.right, zero), AXIS_COLOUR, 0.75)


def _bar_rect(horizontal: bool, along: float, across: float, start: float, end: float):
    if horizontal:
        return pymupdf.Rect(start, along, end, along + across)
    return pymupdf.Rect(along, end, along + across, start)


def _draw_bars(
    canvas, slot, slot_start, value_at, stacked: bool, horizontal: bool, floor: float
) -> None:
    spec = canvas.spec
    group = slot * GROUP_SHARE
    series_count = len(spec.series)
    across = group if stacked else group / series_count
    small = canvas.size * 0.85
    positive = [0.0] * len(spec.categories)
    negative = [0.0] * len(spec.categories)
    for series_index, series in enumerate(spec.series):
        colour = rgb(series.color)
        for index, value in enumerate(series.values):
            if value is None:
                continue
            along = slot_start(index) + (slot - group) / 2
            if stacked:
                base = positive[index] if value >= 0 else negative[index]
                top = base + value
                if value >= 0:
                    positive[index] = top
                else:
                    negative[index] = top
            else:
                along += series_index * across
                base, top = 0.0, value
            start, end = value_at(base), value_at(top)
            canvas.fill_rect(_bar_rect(horizontal, along, across, start, end), colour)
            if not spec.value_labels:
                continue
            text = plain_number(value, spec.decimal)
            centre = along + across / 2
            if stacked:
                if abs(end - start) < canvas.line:
                    continue
                middle = (start + end) / 2
                if horizontal:
                    canvas.text(
                        middle, centre - small * LINE_HEIGHT / 2, text, size=small, align="center"
                    )
                else:
                    canvas.text(
                        centre, middle - small * LINE_HEIGHT / 2, text, size=small, align="center"
                    )
                continue
            if horizontal:
                outward = value >= 0
                if not outward and end - canvas.size * 0.25 - canvas.width_of(text, small) < floor:
                    outward = True
                x = end + (canvas.size * 0.25 if outward else -canvas.size * 0.25)
                canvas.text(
                    x,
                    centre - small * LINE_HEIGHT / 2,
                    text,
                    size=small,
                    align="left" if outward else "right",
                )
            else:
                y = end - small * LINE_HEIGHT if value >= 0 else end
                if value < 0 and y + small * LINE_HEIGHT > floor:
                    y = end - small * LINE_HEIGHT
                canvas.text(centre, y, text, size=small, align="center")


def _draw_lines(canvas, slot, slot_start, value_at, stacked: bool) -> None:
    spec = canvas.spec
    weight = max(1.0, canvas.size / 7)
    small = canvas.size * 0.85
    running = [0.0] * len(spec.categories)
    for series in spec.series:
        colour = rgb(series.color)
        points: list[tuple[float, float] | None] = []
        lower: list[tuple[float, float]] = []
        for index, value in enumerate(series.values):
            x = slot_start(index) + slot / 2
            if spec.type == "area":
                base = running[index] if stacked else 0.0
                top = base + (value or 0.0)
                if stacked:
                    running[index] = top
                points.append((x, value_at(top)))
                lower.append((x, value_at(base)))
            else:
                points.append(None if value is None else (x, value_at(value)))
        if spec.type == "area":
            outline = [point for point in points if point is not None]
            canvas.polygon(outline + lower[::-1], colour, fill_opacity=AREA_OPACITY)
        run: list[tuple[float, float]] = []
        for point in [*points, None]:
            if point is None:
                if len(run) > 1:
                    canvas.polygon(run, None, colour, weight, closed=False)
                run = []
                continue
            run.append(point)
        for index, point in enumerate(points):
            value = series.values[index]
            if point is None or value is None:
                continue
            if spec.type == "line":
                canvas.dot(point, weight * 1.7, colour)
            if spec.value_labels:
                canvas.text(
                    point[0],
                    point[1] - small * LINE_HEIGHT - weight,
                    plain_number(value, spec.decimal),
                    size=small,
                    align="center",
                )


def _draw_scatter(canvas: _Canvas, box: _Box) -> None:
    spec = canvas.spec
    xs: list[float] = []
    for category in spec.categories:
        value = parse_number(category)
        if value is None:
            raise _refuse(
                "scatterNeedsNumbers",
                "a scatter chart needs numbers in the first column",
                category=category[:40],
            )
        xs.append(value)
    ys = [value for values in _series_values(spec) for value in values if value is not None]
    x_ticks = nice_ticks(min(xs), max(xs))
    y_ticks = nice_ticks(min(ys), max(ys))
    size = canvas.size
    gap = size * 0.4
    _draw_axis_titles(canvas, box, spec.value_title, spec.category_title)
    plot = _Box(
        box.left + _tick_label_width(canvas, y_ticks) + gap,
        box.top + canvas.line / 2,
        box.right - _tick_label_width(canvas, x_ticks) / 2,
        box.bottom - canvas.line - size * 0.3,
    )
    if plot.width < size or plot.height < size:
        raise _refuse("chartTooSmall", "the chart is too small for its labels", width=spec.width)

    def x_at(value: float) -> float:
        return plot.left + (value - x_ticks.low) / (x_ticks.high - x_ticks.low) * plot.width

    def y_at(value: float) -> float:
        return plot.bottom - (value - y_ticks.low) / (y_ticks.high - y_ticks.low) * plot.height

    _draw_value_grid(canvas, plot, y_ticks, y_at, vertical=True)
    _draw_value_grid(canvas, plot, x_ticks, x_at, vertical=False)
    canvas.line_between((plot.left, plot.bottom), (plot.right, plot.bottom), AXIS_COLOUR, 0.75)
    canvas.line_between((plot.left, plot.top), (plot.left, plot.bottom), AXIS_COLOUR, 0.75)
    radius = max(1.5, size * 0.28)
    small = size * 0.85
    for series in spec.series:
        colour = rgb(series.color)
        for x, value in zip(xs, series.values, strict=True):
            if value is None:
                continue
            centre = (x_at(x), y_at(value))
            canvas.dot(centre, radius, colour)
            if spec.value_labels:
                canvas.text(
                    centre[0],
                    centre[1] - small * LINE_HEIGHT - radius,
                    plain_number(value, spec.decimal),
                    size=small,
                    align="center",
                )


def _arc(centre, radius: float, start: float, end: float) -> list[tuple[float, float]]:
    steps = max(2, math.ceil(math.degrees(end - start) / ARC_STEP_DEGREES))
    return [
        (
            centre[0] + radius * math.cos(start + (end - start) * step / steps),
            centre[1] + radius * math.sin(start + (end - start) * step / steps),
        )
        for step in range(steps + 1)
    ]


def _luminance(colour: tuple[float, float, float]) -> float:
    red, green, blue = colour
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def _draw_pie(canvas: _Canvas, box: _Box) -> None:
    spec = canvas.spec
    values = [value if value is not None and value > 0 else 0.0 for value in spec.series[0].values]
    total = sum(values)
    if total <= 0:
        raise _refuse("pieNeedsPositive", "a pie chart needs at least one value above zero")
    outside = spec.value_labels and not spec.legend
    labels = [
        f"{name} {percent_text(value / total, spec.decimal)}%" if outside else ""
        for name, value in zip(spec.categories, values, strict=True)
    ]
    reach = max((canvas.width_of(label) for label in labels), default=0.0)
    margin_x = reach + canvas.size if outside else 0.0
    margin_y = canvas.line if outside else 0.0
    radius = min(box.width / 2 - margin_x, box.height / 2 - margin_y)
    if radius < canvas.size:
        raise _refuse("chartTooSmall", "the chart is too small for its labels", width=spec.width)
    centre = (box.left + box.width / 2, box.top + box.height / 2)
    hole = radius * DOUGHNUT_HOLE if spec.type == "doughnut" else 0.0
    small = canvas.size * 0.85
    angle = -math.pi / 2
    for index, value in enumerate(values):
        if value <= 0:
            continue
        sweep = value / total * math.tau
        colour = rgb(spec.palette[index % len(spec.palette)])
        outer = _arc(centre, radius, angle, angle + sweep)
        inner = _arc(centre, hole, angle, angle + sweep)[::-1] if hole else [centre]
        separator = WHITE if value < total else None
        canvas.polygon(outer + inner, colour, separator, 1.0 if separator else 0)
        middle = angle + sweep / 2
        if spec.value_labels:
            share = percent_text(value / total, spec.decimal) + "%"
            if outside:
                anchor = radius + canvas.size * 0.5
                x = centre[0] + anchor * math.cos(middle)
                y = centre[1] + anchor * math.sin(middle) - canvas.line / 2
                canvas.text(x, y, labels[index], align="left" if math.cos(middle) >= 0 else "right")
            elif sweep > 0.25:
                distance = (radius + hole) / 2 if hole else radius * 0.62
                text_colour = (0.1, 0.1, 0.1) if _luminance(colour) > 0.6 else WHITE
                canvas.text(
                    centre[0] + distance * math.cos(middle),
                    centre[1] + distance * math.sin(middle) - small * LINE_HEIGHT / 2,
                    share,
                    size=small,
                    align="center",
                    colour=text_colour,
                )
        angle += sweep


def _check_data(spec: ChartSpec) -> None:
    if all(value is None for values in _series_values(spec) for value in values):
        raise _refuse("chartNoData", "the chart has no numbers to draw")


def chart_pdf(spec: ChartSpec, opacity: float = 1.0) -> tuple[pymupdf.Document, str]:
    _check_data(spec)
    fonts = load_fonts(spec.font_id)
    document = pymupdf.open()
    try:
        page = document.new_page(width=spec.width, height=spec.height)
        fonts.install(page)
        canvas = _Canvas(page, fonts, spec, opacity)
        pad = spec.font_size * 0.6
        box = _Box(pad, pad, spec.width - pad, spec.height - pad)
        _draw_title(canvas, box)
        _draw_legend(canvas, box)
        if spec.type in ("pie", "doughnut"):
            _draw_pie(canvas, box)
        elif spec.type == "scatter":
            _draw_scatter(canvas, box)
        elif spec.type in SAMPLE_TYPES:
            from vivepdf.ops import editor_chart_stats

            {
                "histogram": editor_chart_stats.draw_histogram,
                "box": editor_chart_stats.draw_box_plot,
                "dotplot": editor_chart_stats.draw_dot_plot,
            }[spec.type](canvas, box)
        else:
            _draw_category_chart(canvas, box)
    except BaseException:
        document.close()
        raise
    return document, fonts.missing("".join(canvas.regular_text), "".join(canvas.bold_text))


@op("editor.chart_preview", ChartSpec)
def chart_preview(params: ChartSpec, _progress: Progress) -> ChartPreviewResult:
    document, missing = chart_pdf(params)
    try:
        page = document[0]
        return ChartPreviewResult(
            svg=page.get_svg_image(text_as_path=True),
            width=page.rect.width,
            height=page.rect.height,
            missing_glyphs=missing,
        )
    finally:
        document.close()
