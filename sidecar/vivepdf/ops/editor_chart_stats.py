import math
from dataclasses import dataclass

import pymupdf

from vivepdf.ops._scratch import LINE_HEIGHT, rgb
from vivepdf.ops.editor_chart import (
    AXIS_COLOUR,
    _Box,
    _Canvas,
    _draw_axis_titles,
    _draw_value_grid,
    _refuse,
    _tick_label_width,
    _Ticks,
    nice_ticks,
    plain_number,
)

MAX_AUTO_BINS = 30
BOX_SHARE = 0.5
BOX_FILL_OPACITY = 0.3
WHISKER_REACH = 1.5
CAP_SHARE = 0.5
SEPARATOR = (1.0, 1.0, 1.0)
NICE_MULTIPLES = (1, 2, 2.5, 5, 10)
DOT_SHARE = 0.35
MIN_DOT_RADIUS = 0.8
DOT_FIT_ROUNDS = 3


@dataclass
class Bins:
    start: float
    width: float
    count: int

    def edges(self) -> list[float]:
        return [self.start + index * self.width for index in range(self.count + 1)]

    def index_of(self, value: float) -> int:
        return min(self.count - 1, max(0, math.floor((value - self.start) / self.width + 1e-9)))


@dataclass
class BoxSummary:
    low: float
    q1: float
    median: float
    q3: float
    high: float
    outliers: list[float]


def _samples(canvas: _Canvas) -> list[list[float]]:
    return [
        [value for value in series.values if value is not None] for series in canvas.spec.series
    ]


def _nice_width(raw: float) -> float:
    magnitude = 10 ** math.floor(math.log10(raw))
    return min(
        (value * magnitude for value in NICE_MULTIPLES),
        key=lambda width: abs(math.log(width / raw)),
    )


def histogram_bins(values: list[float], bins: int | None) -> Bins:
    low, high = min(values), max(values)
    if high - low < 1e-12:
        return Bins(low - 0.5, 1.0, 1)
    if bins:
        return Bins(low, (high - low) / bins, bins)
    wanted = min(MAX_AUTO_BINS, math.ceil(math.log2(len(values)) + 1))
    width = _nice_width((high - low) / wanted)
    start = math.floor(low / width + 1e-9) * width
    return Bins(start, width, max(1, math.ceil((high - start) / width - 1e-9)))


def quantile(ordered: list[float], share: float) -> float:
    position = (len(ordered) - 1) * share
    below = math.floor(position)
    above = min(below + 1, len(ordered) - 1)
    return ordered[below] + (ordered[above] - ordered[below]) * (position - below)


def box_summary(values: list[float]) -> BoxSummary:
    ordered = sorted(values)
    q1, median, q3 = (quantile(ordered, share) for share in (0.25, 0.5, 0.75))
    reach = (q3 - q1) * WHISKER_REACH
    inside = [value for value in ordered if q1 - reach <= value <= q3 + reach]
    outliers = [value for value in ordered if value < q1 - reach or value > q3 + reach]
    return BoxSummary(inside[0], q1, median, q3, inside[-1], outliers)


def _count_ticks(highest: int) -> _Ticks:
    ticks = nice_ticks(0, max(1, highest))
    if ticks.step < 1:
        return _Ticks(0, max(1, highest), 1, 0)
    return _Ticks(0, ticks.high, ticks.step, 0)


def _plot_box(canvas: _Canvas, box: _Box, left_ticks: _Ticks | None, bottom_labels: int) -> _Box:
    size = canvas.size
    gap = size * 0.4
    left = box.left + (_tick_label_width(canvas, left_ticks) + gap if left_ticks else size * 0.5)
    plot = _Box(
        left,
        box.top + canvas.line / 2,
        box.right - size,
        box.bottom - bottom_labels * canvas.line - size * 0.3,
    )
    if plot.width < size or plot.height < size:
        raise _refuse(
            "chartTooSmall", "the chart is too small for its labels", width=canvas.spec.width
        )
    return plot


def _edge_labels(canvas: _Canvas, plot: _Box, positions: list[tuple[float, str]]) -> None:
    widest = max(canvas.width_of(text) for _, text in positions)
    spacing = (plot.width / max(1, len(positions) - 1)) if len(positions) > 1 else plot.width
    stride = max(1, math.ceil((widest + canvas.size) / max(spacing, 1e-6)))
    for index, (at, text) in enumerate(positions):
        if index % stride == 0:
            canvas.text(at, plot.bottom + canvas.size * 0.3, text, align="center")


def _decimals_for(width: float) -> int:
    return max(0, -math.floor(math.log10(width) + 1e-9)) if width < 1 else 0


def draw_histogram(canvas: _Canvas, box: _Box) -> None:
    spec = canvas.spec
    samples = _samples(canvas)
    bins = histogram_bins([value for values in samples for value in values], spec.bins)
    counts = [[0] * bins.count for _ in samples]
    for series_index, values in enumerate(samples):
        for value in values:
            counts[series_index][bins.index_of(value)] += 1
    ticks = _count_ticks(max(max(row) for row in counts))
    _draw_axis_titles(canvas, box, spec.value_title, spec.category_title)
    plot = _plot_box(canvas, box, ticks, 1)

    def y_at(value: float) -> float:
        return plot.bottom - (value - ticks.low) / (ticks.high - ticks.low) * plot.height

    _draw_value_grid(canvas, plot, ticks, y_at, vertical=True)
    slot = plot.width / bins.count
    across = slot / len(samples)
    small = canvas.size * 0.85
    for series_index, series in enumerate(spec.series):
        colour = rgb(series.color)
        for bin_index, count in enumerate(counts[series_index]):
            if not count:
                continue
            left = plot.left + bin_index * slot + series_index * across
            rect = pymupdf.Rect(left, y_at(count), left + across, plot.bottom)
            canvas.fill_rect(rect, colour)
            canvas.page.draw_rect(rect, color=SEPARATOR, width=0.5, stroke_opacity=canvas.opacity)
            if spec.value_labels:
                canvas.text(
                    left + across / 2,
                    rect.y0 - small * LINE_HEIGHT,
                    str(count),
                    size=small,
                    align="center",
                )
    decimals = _decimals_for(bins.width)
    edges = [
        (plot.left + index * slot, f"{edge:.{decimals}f}".replace(".", spec.decimal))
        for index, edge in enumerate(bins.edges())
    ]
    _edge_labels(canvas, plot, edges)
    canvas.line_between((plot.left, plot.bottom), (plot.right, plot.bottom), AXIS_COLOUR, 0.75)


def draw_box_plot(canvas: _Canvas, box: _Box) -> None:
    spec = canvas.spec
    samples = _samples(canvas)
    present = [value for values in samples for value in values]
    ticks = nice_ticks(min(present), max(present))
    _draw_axis_titles(canvas, box, spec.value_title, spec.category_title)
    names = [series.name.strip() for series in spec.series]
    plot = _plot_box(canvas, box, ticks, 1 if any(names) else 0)

    def y_at(value: float) -> float:
        return plot.bottom - (value - ticks.low) / (ticks.high - ticks.low) * plot.height

    _draw_value_grid(canvas, plot, ticks, y_at, vertical=True)
    slot = plot.width / len(samples)
    weight = max(0.75, canvas.size / 12)
    small = canvas.size * 0.85
    for index, (series, values) in enumerate(zip(spec.series, samples, strict=True)):
        middle = plot.left + slot * (index + 0.5)
        if names[index]:
            label = canvas.fitted(names[index], slot * 0.95)[0]
            canvas.text(middle, plot.bottom + canvas.size * 0.3, label, align="center")
        if not values:
            continue
        summary = box_summary(values)
        colour = rgb(series.color)
        half = slot * BOX_SHARE / 2
        cap = half * CAP_SHARE
        rect = pymupdf.Rect(middle - half, y_at(summary.q3), middle + half, y_at(summary.q1))
        canvas.fill_rect(pymupdf.Rect(rect), colour, BOX_FILL_OPACITY)
        canvas.page.draw_rect(rect, color=colour, width=weight, stroke_opacity=canvas.opacity)
        for end, edge in ((summary.high, summary.q3), (summary.low, summary.q1)):
            canvas.line_between((middle, y_at(edge)), (middle, y_at(end)), colour, weight)
            canvas.line_between(
                (middle - cap, y_at(end)), (middle + cap, y_at(end)), colour, weight
            )
        at = y_at(summary.median)
        canvas.line_between((middle - half, at), (middle + half, at), colour, weight * 2)
        for value in summary.outliers:
            canvas.dot((middle, y_at(value)), max(1.5, canvas.size * 0.22), colour)
        if spec.value_labels:
            canvas.text(
                middle + half + canvas.size * 0.25,
                at - small * LINE_HEIGHT / 2,
                plain_number(summary.median, spec.decimal),
                size=small,
            )
    canvas.line_between((plot.left, plot.bottom), (plot.right, plot.bottom), AXIS_COLOUR, 0.75)


def draw_dot_plot(canvas: _Canvas, box: _Box) -> None:
    spec = canvas.spec
    samples = _samples(canvas)
    present = [value for values in samples for value in values]
    ticks = nice_ticks(min(present), max(present))
    _draw_axis_titles(canvas, box, "", spec.category_title)
    plot = _plot_box(canvas, box, None, 1)
    plot.left += _tick_label_width(canvas, ticks) / 2
    plot.right -= _tick_label_width(canvas, ticks) / 2 - canvas.size

    def x_at(value: float) -> float:
        return plot.left + (value - ticks.low) / (ticks.high - ticks.low) * plot.width

    points = sorted(
        (x_at(value), series_index)
        for series_index, values in enumerate(samples)
        for value in values
    )
    radius = canvas.size * DOT_SHARE
    for _ in range(DOT_FIT_ROUNDS):
        columns = dot_columns(points, plot.left, 2 * radius)
        fitted = plot.height / (2 * max(len(stack) for stack in columns.values()) + 0.4)
        if fitted >= radius:
            break
        radius = max(MIN_DOT_RADIUS, fitted)
    columns = dot_columns(points, plot.left, 2 * radius)
    _draw_value_grid(canvas, plot, ticks, x_at, vertical=False)
    canvas.line_between((plot.left, plot.bottom), (plot.right, plot.bottom), AXIS_COLOUR, 0.75)
    colours = [rgb(series.color) for series in spec.series]
    for x, stack in columns.items():
        for level, series_index in enumerate(stack):
            canvas.page.draw_circle(
                (x, plot.bottom - radius * (2 * level + 1.2)),
                radius,
                color=None,
                fill=colours[series_index],
                width=0,
                fill_opacity=canvas.opacity,
            )


def dot_columns(
    points: list[tuple[float, int]], origin: float, diameter: float
) -> dict[float, list[int]]:
    buckets: dict[int, tuple[float, list[int]]] = {}
    for x, series_index in points:
        bucket = round((x - origin) / diameter)
        buckets.setdefault(bucket, (x, []))[1].append(series_index)
    return {x: members for x, members in buckets.values()}
