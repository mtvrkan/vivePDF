import pymupdf
import pytest

from vivepdf.ops.editor_chart import ChartSpec, chart_pdf
from vivepdf.ops.editor_chart_stats import box_summary, histogram_bins, quantile
from vivepdf.rpc.errors import OpError

SCORES = [45, 52, 58, 61, 63, 65, 67, 70, 72, 72, 75, 78, 81, 84, 90, 98]


def _spec(chart_type: str, series: list[dict] | None = None, **extra) -> ChartSpec:
    series = series or [{"name": "Sınıf A", "color": "#2563eb", "values": SCORES}]
    count = max(len(entry["values"]) for entry in series)
    for entry in series:
        entry["values"] = entry["values"] + [None] * (count - len(entry["values"]))
    return ChartSpec.model_validate(
        {
            "type": chart_type,
            "categories": [str(index + 1) for index in range(count)],
            "series": series,
            "width": 360,
            "height": 240,
            "decimal": ",",
            **extra,
        }
    )


def _render(spec: ChartSpec) -> pymupdf.Page:
    document, _ = chart_pdf(spec)
    return document[0]


def test_auto_bins_use_round_edges_and_cover_every_value():
    bins = histogram_bins([float(value) for value in SCORES], None)
    assert bins.width == 10
    assert bins.start == 40
    assert bins.edges()[-1] >= 98
    assert bins.index_of(98) == bins.count - 1
    assert bins.index_of(45) == 0


def test_a_chosen_bin_count_splits_the_range_evenly_and_keeps_the_top_value():
    bins = histogram_bins([0.0, 10.0], 4)
    assert (bins.start, bins.width, bins.count) == (0, 2.5, 4)
    assert bins.index_of(10.0) == 3


def test_equal_values_fall_in_one_bin():
    bins = histogram_bins([5.0, 5.0, 5.0], None)
    assert bins.count == 1 and bins.index_of(5.0) == 0


def test_quartiles_interpolate_like_a_spreadsheet():
    ordered = [1.0, 2.0, 3.0, 4.0]
    assert quantile(ordered, 0.25) == pytest.approx(1.75)
    assert quantile(ordered, 0.5) == pytest.approx(2.5)
    assert quantile([7.0], 0.75) == 7.0


def test_box_summary_keeps_far_values_out_of_the_whiskers():
    summary = box_summary([10, 11, 12, 13, 14, 15, 60])
    assert summary.outliers == [60]
    assert summary.high == 15 and summary.low == 10
    assert summary.median == 13


def test_histogram_bars_are_counted_and_edges_are_real_text():
    page = _render(_spec("histogram", value_labels=True, legend=False))
    words = [word[4] for word in page.get_text("words")]
    for edge in ("40", "60", "80", "100"):
        assert edge in words
    fills = [
        item
        for item in page.get_drawings()
        if item.get("fill") == pytest.approx((0.145, 0.388, 0.922), abs=0.01)
    ]
    assert len(fills) == 6
    assert "4" in words


def test_two_series_share_each_bin_side_by_side():
    series = [
        {"name": "A", "color": "#2563eb", "values": [1, 2, 2, 3]},
        {"name": "B", "color": "#f97316", "values": [2, 3, 3, 3]},
    ]
    page = _render(_spec("histogram", series, bins=3, legend=False))
    blue = [
        item["rect"]
        for item in page.get_drawings()
        if item.get("fill") == pytest.approx((0.145, 0.388, 0.922), abs=0.01)
    ]
    orange = [
        item["rect"]
        for item in page.get_drawings()
        if item.get("fill") == pytest.approx((0.976, 0.451, 0.086), abs=0.01)
    ]
    assert len(blue) == 3 and len(orange) == 2
    assert min(rect.x0 for rect in orange) > min(rect.x0 for rect in blue)


def test_box_plot_draws_one_box_per_series_with_names_below():
    series = [
        {"name": "Şube A", "color": "#2563eb", "values": SCORES},
        {"name": "Şube B", "color": "#16a34a", "values": [55, 60, 62, 64, 70, 71, 73, 99]},
    ]
    page = _render(_spec("box", series, value_labels=True))
    text = page.get_text()
    assert "Şube A" in text and "Şube B" in text
    assert "71" in text
    strokes = [
        item
        for item in page.get_drawings()
        if item.get("color") == pytest.approx((0.086, 0.639, 0.29), abs=0.01)
    ]
    assert strokes


def test_dot_plot_stacks_repeated_values():
    page = _render(
        _spec(
            "dotplot",
            [{"name": "", "color": "#dc2626", "values": [1, 2, 2, 3, 3, 3]}],
            legend=False,
        )
    )
    dots = [
        item["rect"]
        for item in page.get_drawings()
        if item.get("fill") == pytest.approx((0.863, 0.149, 0.149), abs=0.01)
    ]
    assert len(dots) == 6
    columns: dict[float, int] = {}
    for rect in dots:
        key = round((rect.x0 + rect.x1) / 2, 1)
        columns[key] = columns.get(key, 0) + 1
    assert sorted(columns.values()) == [1, 2, 3]


def test_sample_charts_without_numbers_are_refused():
    with pytest.raises(OpError) as error:
        chart_pdf(_spec("box", [{"name": "x", "color": "#000000", "values": [None, None]}]))
    assert error.value.data and error.value.data["reason"] == "chartNoData"


def test_a_bin_count_outside_the_range_is_refused():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        _spec("histogram", bins=0)
    with pytest.raises(ValidationError):
        _spec("histogram", bins=51)
