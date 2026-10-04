from pathlib import Path

import numpy as np
import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops._studio_models import StudioRenderParams
from vivepdf.ops.editor_chart import ChartSpec, chart_pdf
from vivepdf.ops.editor_table import TableSpec, table_preview
from vivepdf.ops.studio import render
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

PLACEHOLDER_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"/>'
)


def _table(**change) -> dict:
    spec = {
        "cells": [["Ürün", "Adet"], ["Çay", "2"], ["Şeker", "14"]],
        "columnWidths": [2, 1],
        "align": ["left", "right"],
        "width": 200,
        "fontSize": 12,
        "header": True,
        "border": "all",
        "color": "#111111",
        "borderColor": "#333333",
        "headerFill": "#dbeafe",
    }
    spec.update(change)
    return spec


def _chart(**change) -> dict:
    spec = {
        "type": "column",
        "categories": ["Ocak", "Şubat", "Mart"],
        "series": [{"name": "Gelir", "color": "#2563eb", "values": [4, -2, 7]}],
        "title": "Aylık özet",
        "legend": True,
        "width": 300,
        "height": 200,
    }
    spec.update(change)
    return spec


def _flowchart() -> dict:
    return {
        "nodes": [
            {"id": "n1", "shape": "terminal", "text": "Başla"},
            {"id": "n2", "shape": "decision", "text": "Onay?"},
            {"id": "n3", "shape": "terminal", "text": "Bitir"},
        ],
        "edges": [
            {"source": "n1", "target": "n2"},
            {"source": "n2", "target": "n3", "label": "Evet"},
        ],
    }


def _item(kind: str, spec: dict, box=(20.0, 30.0, 200.0, 60.0), **extra) -> dict:
    x, y, width, height = box
    item = {
        "kind": "svg",
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "svg": PLACEHOLDER_SVG,
        "graphic": {"kind": kind, "spec": spec},
    }
    item.update(extra)
    return item


def _render(folder: Path, items: list[dict], **extra) -> Path:
    payload = {
        "pages": [{"width": 400, "height": 400, "items": items}],
        "output": str(folder / "graphics.pdf"),
        "overwrite": True,
    }
    payload.update(extra)
    return Path(render(StudioRenderParams.model_validate(payload), silent_progress()).output)


def _words(path: Path, page: int = 0) -> list[tuple[float, float, float, float, str]]:
    with pymupdf.open(path) as document:
        return [tuple(word[:5]) for word in document[page].get_text("words")]


def _pixels(path: Path) -> np.ndarray:
    with pymupdf.open(path) as document:
        pixmap = document[0].get_pixmap(alpha=False)
        return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)


def _height(spec: dict) -> float:
    return table_preview(TableSpec.model_validate(spec), silent_progress()).height


def test_a_studio_table_is_exported_as_real_text_inside_its_box(tmp_path: Path):
    spec = _table()
    height = _height(spec)
    words = _words(_render(tmp_path, [_item("table", spec, (20, 30, 200, height))]))
    texts = {word[4] for word in words}
    assert {"Ürün", "Adet", "Çay", "Şeker", "14"} <= texts
    for x0, y0, x1, y1, _ in words:
        assert x0 >= 20 and x1 <= 220.5
        assert y0 >= 30 and y1 <= 30 + height + 0.5


def test_table_cells_take_row_values_and_stay_inside_the_box(tmp_path: Path):
    spec = _table(cells=[["Ad", "Not"], ["{Ad}", "{Not}"]])
    height = _height(spec)
    target = _render(
        tmp_path,
        [_item("table", spec, (20, 30, 200, height))],
        rows=[{"Ad": "Ayşe", "Not": "95"}, {"Ad": "Uzun bir ad soyad yazısı burada", "Not": "70"}],
    )
    with pymupdf.open(target) as document:
        assert document.page_count == 2
        first = document[0].get_text()
        assert "Ayşe" in first and "95" in first and "{Ad}" not in first
        second = document[1]
        assert "Uzun" in second.get_text()
        for x0, y0, x1, y1, *_ in second.get_text("words"):
            assert x0 >= 20 and x1 <= 220.5
            assert y0 >= 30 and y1 <= 30 + height + 0.5


def test_table_cell_styles_change_fill_alignment_weight_and_border(tmp_path: Path):
    styles = [[{}, {}], [{"fill": "#ff0000", "bold": True}, {"align": "left"}], [{}, {}]]
    spec = _table(cellStyles=styles, borderWidth=3, stripes=True, stripeFill="#00ff00")
    preview = table_preview(TableSpec.model_validate(spec), silent_progress())
    assert sum(preview.column_widths) == pytest.approx(200)
    assert sum(preview.row_heights) == pytest.approx(preview.height)
    target = _render(tmp_path, [_item("table", spec, (0, 0, 200, preview.height))])
    pixels = _pixels(target)
    first, second = preview.row_heights[0], preview.row_heights[1]
    assert tuple(pixels[int(first + 3), 10]) == (255, 0, 0)
    assert tuple(pixels[int(first + second + 4), 180]) == (0, 255, 0)
    assert tuple(pixels[int(first + second / 2), 1]) != (255, 0, 0)
    with pymupdf.open(target) as document:
        spans = [
            span
            for block in document[0].get_text("dict")["blocks"]
            for line in block.get("lines", [])
            for span in line["spans"]
        ]
    tea = next(span for span in spans if span["text"] == "Çay")
    count = next(span for span in spans if span["text"] == "2")
    assert tea["flags"] & pymupdf.TEXT_FONT_BOLD or "Bold" in tea["font"]
    assert count["bbox"][0] < preview.column_widths[0] + 12


def test_cell_styles_must_match_the_cells():
    with pytest.raises(ValidationError):
        TableSpec.model_validate(_table(cellStyles=[[{}, {}]]))


def test_a_chart_is_exported_with_real_text_and_negative_values(tmp_path: Path):
    words = _words(_render(tmp_path, [_item("chart", _chart(), (40, 40, 300, 200))]))
    texts = {word[4] for word in words}
    assert {"Aylık", "özet", "Ocak", "Şubat", "Mart", "Gelir"} <= texts
    assert any(text.startswith("-") or text.startswith("−") for text in texts)


@pytest.mark.parametrize("position", ["top", "bottom", "left", "right"])
def test_the_legend_sits_where_it_was_asked(position: str):
    spec = ChartSpec.model_validate(_chart(legendPosition=position, title=""))
    document, _ = chart_pdf(spec)
    with document:
        word = next(word for word in document[0].get_text("words") if word[4] == "Gelir")
    x0, y0, x1, y1 = word[:4]
    middle_x, middle_y = (x0 + x1) / 2, (y0 + y1) / 2
    if position == "top":
        assert middle_y < 40
    elif position == "bottom":
        assert middle_y > 160
    elif position == "left":
        assert middle_x < 100 and 60 < middle_y < 140
    else:
        assert middle_x > 200 and 60 < middle_y < 140


@pytest.mark.parametrize("chart_type", ["column", "bar"])
def test_negative_value_labels_stay_clear_of_the_category_labels(chart_type: str):
    series = [{"name": "Gelir", "color": "#2563eb", "values": [4, -2, 8]}]
    spec = ChartSpec.model_validate(_chart(type=chart_type, series=series, valueLabels=True))
    document, _ = chart_pdf(spec)
    with document:
        words = {word[4]: pymupdf.Rect(word[:4]) for word in document[0].get_text("words")}
    label = next(rect for text, rect in words.items() if text in ("-2", "−2"))
    assert not label.intersects(words["Şubat"])


def test_unknown_legend_positions_are_refused():
    with pytest.raises(ValidationError):
        ChartSpec.model_validate(_chart(legendPosition="middle"))


def test_a_chart_without_numbers_fails_the_export(tmp_path: Path):
    spec = _chart(series=[{"name": "Boş", "color": "#2563eb", "values": [None, None, None]}])
    with pytest.raises(OpError):
        _render(tmp_path, [_item("chart", spec, (40, 40, 300, 200))])


def test_a_flowchart_is_exported_with_real_text_and_opacity(tmp_path: Path):
    target = _render(tmp_path, [_item("flowchart", _flowchart(), (40, 40, 200, 260), opacity=0.5)])
    texts = {word[4] for word in _words(target)}
    assert {"Başla", "Onay?", "Bitir", "Evet"} <= texts
    with pymupdf.open(target) as document:
        objects = [document.xref_object(xref) for xref in range(1, document.xref_length())]
        assert any(" .5" in entry and "/ca" in entry for entry in objects)


def test_an_svg_item_without_a_graphic_still_draws_its_markup(tmp_path: Path):
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">'
        '<rect width="100" height="50" fill="#00ff00"/></svg>'
    )
    item = {"kind": "svg", "x": 0, "y": 0, "width": 100, "height": 50, "svg": svg}
    pixels = _pixels(_render(tmp_path, [item]))
    assert tuple(pixels[25, 50]) == (0, 255, 0)


def test_pie_slices_share_the_circle_by_value(tmp_path: Path):
    spec = _chart(
        type="pie",
        categories=["A", "B"],
        series=[{"name": "S", "color": "#2563eb", "values": [3, 1]}],
        title="",
        legend=False,
        palette=["#ff0000", "#0000ff"],
    )
    pixels = _pixels(_render(tmp_path, [_item("chart", spec, (0, 0, 300, 200))]))
    assert tuple(pixels[60, 110]) == (0, 0, 255)
    assert tuple(pixels[140, 190]) == (255, 0, 0)
    assert tuple(pixels[60, 190]) == (255, 0, 0)
    assert tuple(pixels[140, 110]) == (255, 0, 0)


@pytest.mark.parametrize("direction", ["down", "right"])
def test_flowchart_steps_follow_the_layout_direction(tmp_path: Path, direction: str):
    spec = {**_flowchart(), "direction": direction}
    words = {word[4]: word for word in _words(_render(tmp_path, [_item("flowchart", spec)]))}
    start, end = words["Başla"], words["Bitir"]
    if direction == "down":
        assert start[3] < end[1]
    else:
        assert start[2] < end[0]
