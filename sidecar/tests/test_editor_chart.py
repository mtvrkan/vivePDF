from pathlib import Path

import numpy as np
import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.ops.editor_chart import (
    ChartSpec,
    chart_pdf,
    chart_preview,
    format_number,
    nice_ticks,
    parse_number,
    percent_text,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

CATEGORIES = ["Ocak", "Şubat", "Mart", "Nisan"]
SERIES = [
    {"name": "Gelir", "color": "#2563eb", "values": [12, 15.5, 9, 18]},
    {"name": "Gider", "color": "#f97316", "values": [8, 9, None, -3]},
]
CHART_TYPES = ["column", "bar", "line", "area", "pie", "doughnut", "scatter"]


def _spec(**change) -> dict:
    spec = {
        "type": "column",
        "categories": CATEGORIES,
        "series": SERIES,
        "title": "Aylık özet",
        "categoryTitle": "Ay",
        "valueTitle": "Bin TL",
        "legend": True,
        "grid": True,
        "valueLabels": True,
        "width": 360,
        "height": 240,
        "fontSize": 10,
        "decimal": ",",
    }
    for key, value in change.items():
        head, *rest = key.split("_")
        spec[head + "".join(part.title() for part in rest)] = value
    return spec


def _pdf(tmp_path: Path, rotation: int = 0, offset_crop: bool = False) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    if offset_crop:
        page.set_cropbox(pymupdf.Rect(30, 20, 380, 290))
    page.set_rotation(rotation)
    path = tmp_path / f"grafik-{rotation}-{int(offset_crop)}.pdf"
    document.save(path)
    document.close()
    return path


def _place(source: Path, target: Path, box=(20.0, 20.0, 380.0, 260.0), **change):
    x0, y0, x1, y1 = box
    return apply(
        EditorApplyParams(
            path=str(source),
            output=str(target),
            objects=[
                {
                    "kind": "chart",
                    "page": 1,
                    "x0": x0,
                    "y0": y0,
                    "x1": x1,
                    "y1": y1,
                    **_spec(**change),
                }
            ],
        ),
        silent_progress(),
    )


def _drawn(**change) -> tuple[str, int]:
    document, _ = chart_pdf(ChartSpec.model_validate(_spec(**change)))
    try:
        page = document[0]
        return page.get_text(), len(page.get_drawings())
    finally:
        document.close()


def test_a_chart_is_written_with_real_searchable_labels(tmp_path: Path):
    target = tmp_path / "grafik.pdf"
    result = _place(_pdf(tmp_path), target)
    assert result.applied == 1
    assert result.warnings == []
    with pymupdf.open(target) as document:
        page = document[0]
        text = page.get_text()
        for word in ("Aylık özet", "Şubat", "Gelir", "Gider", "Bin TL", "15,5"):
            assert word in text
        assert page.search_for("Şubat")
        assert page.get_images() == []
        assert len(page.get_drawings()) > 10


@pytest.mark.parametrize("chart_type", CHART_TYPES)
def test_every_chart_type_draws_and_previews(chart_type: str):
    categories = ["1", "2,5", "4", "6"] if chart_type == "scatter" else CATEGORIES
    text, drawings = _drawn(type=chart_type, categories=categories)
    assert drawings > 3
    assert "Aylık özet" in text
    preview = chart_preview(
        ChartSpec.model_validate(_spec(type=chart_type, categories=categories)), silent_progress()
    )
    assert "<text" not in preview.svg
    assert preview.width == pytest.approx(360)
    assert preview.height == pytest.approx(240)


def test_a_pie_names_its_slices_and_skips_empty_or_negative_ones():
    text, _ = _drawn(type="pie", series=[SERIES[1]], value_labels=True)
    assert "Ocak" in text
    assert "Şubat" in text
    assert "Mart" not in text
    assert "Nisan" not in text
    assert "47,1%" in text


def test_a_pie_without_a_legend_writes_names_beside_the_slices():
    text, _ = _drawn(type="pie", series=[SERIES[0]], legend=False, value_labels=True)
    assert "Ocak 22%" in text
    assert "Şubat 28,4%" in text


def test_stacked_columns_reach_the_sum_of_their_parts():
    stacked, _ = _drawn(stacked=True, value_labels=False)
    side_by_side, _ = _drawn(stacked=False, value_labels=False)
    assert "30" in stacked.split()
    assert "30" not in side_by_side.split()


def test_series_without_names_stay_out_of_the_legend():
    text, _ = _drawn(series=[{**SERIES[0], "name": ""}], value_labels=False)
    assert "Gelir" not in text


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize("offset_crop", [False, True])
def test_the_chart_lands_in_the_visible_box_on_turned_pages(
    tmp_path: Path, rotation: int, offset_crop: bool
):
    source = _pdf(tmp_path, rotation, offset_crop)
    target = tmp_path / f"grafik-{rotation}-{offset_crop}.pdf"
    red = {"name": "", "color": "#ff0000", "values": [5, 5, 5, 5]}
    box = (30.0, 40.0, 210.0, 160.0)
    _place(
        source,
        target,
        box=box,
        series=[red],
        title="",
        category_title="",
        value_title="",
        value_labels=False,
        width=180,
        height=120,
    )
    with pymupdf.open(target) as document:
        pixmap = document[0].get_pixmap(matrix=pymupdf.Matrix(2, 2))
    pixels = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
        pixmap.height, pixmap.width, pixmap.n
    )
    found = (pixels[:, :, 0] > 200) & (pixels[:, :, 1] < 80) & (pixels[:, :, 2] < 80)
    rows, columns = np.nonzero(found)
    assert rows.size > 0
    x0, y0, x1, y1 = box
    assert x0 < columns.min() / 2 < columns.max() / 2 <= x1 + 1
    assert y0 < rows.min() / 2 < rows.max() / 2 <= y1 + 1


def test_ticks_are_round_numbers_covering_the_data():
    ticks = nice_ticks(-3, 21)
    assert ticks.step == 5
    assert ticks.low == -5
    assert ticks.high == 25
    assert nice_ticks(0, 0.9).step == pytest.approx(0.2)
    quarter = nice_ticks(0, 1.1)
    assert quarter.step == pytest.approx(0.25)
    assert quarter.decimals == 2
    assert nice_ticks(4, 4).high > 4


def test_numbers_are_written_and_read_in_either_notation():
    assert format_number(2.5, 1, ",") == "2,5"
    assert format_number(-0.0001, 1, ".") == "0.0"
    for text, value in [
        ("1,5", 1.5),
        ("1.5", 1.5),
        ("1.234,5", 1234.5),
        ("1,234.5", 1234.5),
        (" 12 000 ", 12000),
        ("1.234.567", 1234567),
        ("−2", -2),
    ]:
        assert parse_number(text) == pytest.approx(value), text
    assert percent_text(0.2844, ",") == "28,4"
    assert percent_text(0.22018, ".") == "22"
    assert parse_number("abc") is None
    assert parse_number("nan") is None


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        (
            {"type": "pie", "series": [{**SERIES[0], "values": [0, -1, None, 0]}]},
            "pieNeedsPositive",
        ),
        ({"series": [{**SERIES[0], "values": [None, None, None, None]}]}, "chartNoData"),
        ({"type": "scatter"}, "scatterNeedsNumbers"),
        ({"width": 120, "height": 80, "font_size": 36}, "chartTooSmall"),
    ],
)
def test_charts_that_cannot_be_drawn_are_refused_with_a_reason(change: dict, reason: str):
    with pytest.raises(OpError) as caught:
        chart_pdf(ChartSpec.model_validate(_spec(**change)))
    assert caught.value.data["reason"] == reason


@pytest.mark.parametrize(
    "change",
    [
        {"series": [{**SERIES[0], "values": [1, 2]}]},
        {"series": [{**SERIES[0], "color": "blue"}]},
        {"series": [{**SERIES[0], "values": [1, 2, float("nan"), 4]}]},
        {"series": [SERIES[0]] * 9},
        {"categories": []},
        {"type": "radar"},
        {"palette": []},
    ],
)
def test_malformed_charts_are_refused(change: dict):
    with pytest.raises(ValidationError):
        ChartSpec.model_validate(_spec(**change))


def test_letters_the_font_lacks_are_reported(tmp_path: Path):
    result = _place(_pdf(tmp_path), tmp_path / "grafik.pdf", title="漢字")
    assert [warning.code for warning in result.warnings] == ["glyphsMissing"]
    assert "漢" in result.warnings[0].detail
