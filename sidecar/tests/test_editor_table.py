from pathlib import Path

import numpy as np
import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.ops.editor_table import TableSpec, table_pdf, table_preview, wrap_cell
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

CELLS = [["Ürün", "Adet", "Fiyat"], ["Çay", "2", "15,50"], ["Şeker", "1", "40"]]
BOX = (40.0, 60.0, 280.0, 120.0)


def _spec(**change) -> dict:
    spec = {
        "cells": CELLS,
        "columnWidths": [2, 1, 1],
        "align": ["left", "center", "right"],
        "width": 240,
        "fontSize": 11,
        "header": True,
        "border": "all",
        "color": "#111111",
        "borderColor": "#333333",
        "headerFill": "#dbeafe",
        "stripes": False,
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
    path = tmp_path / f"tablo-{rotation}-{int(offset_crop)}.pdf"
    document.save(path)
    document.close()
    return path


def _place(source: Path, target: Path, box=BOX, **change):
    x0, y0, x1, y1 = box
    return apply(
        EditorApplyParams(
            path=str(source),
            output=str(target),
            objects=[
                {
                    "kind": "table",
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


def test_a_table_is_written_as_real_searchable_text(tmp_path: Path):
    target = tmp_path / "tablo.pdf"
    result = _place(_pdf(tmp_path), target)
    assert result.applied == 1
    assert result.warnings == []
    with pymupdf.open(target) as document:
        page = document[0]
        text = page.get_text()
        for word in ("Ürün", "Adet", "Fiyat", "Çay", "15,50", "Şeker"):
            assert word in text
        assert page.search_for("Şeker")
        assert page.get_images() == []
        assert len(page.get_drawings()) > 0


def test_cells_keep_their_rows_and_columns(tmp_path: Path):
    target = tmp_path / "tablo.pdf"
    _place(_pdf(tmp_path), target)
    with pymupdf.open(target) as document:
        words = {word[4]: word for word in document[0].get_text("words")}
    assert words["Ürün"][1] == pytest.approx(words["Adet"][1], abs=0.5)
    assert words["Çay"][1] > words["Ürün"][1]
    assert words["Adet"][0] > words["Ürün"][0]
    assert words["Fiyat"][0] > words["Adet"][0]
    assert words["Şeker"][1] > words["Çay"][1]


def test_the_table_fills_the_box_width_and_keeps_its_proportions(tmp_path: Path):
    document, _missing = table_pdf(TableSpec.model_validate(_spec()))
    natural = document[0].rect
    document.close()
    target = tmp_path / "tablo.pdf"
    _place(_pdf(tmp_path), target, box=(40, 60, 280, 60 + natural.height))
    with pymupdf.open(target) as placed:
        page = placed[0]
        rects = [drawing["rect"] for drawing in page.get_drawings()]
        left = min(rect.x0 for rect in rects)
        right = max(rect.x1 for rect in rects)
        top = min(rect.y0 for rect in rects)
        bottom = max(rect.y1 for rect in rects)
    assert left == pytest.approx(40, abs=1.5)
    assert right == pytest.approx(280, abs=1.5)
    assert top == pytest.approx(60, abs=1.5)
    assert bottom == pytest.approx(60 + natural.height, abs=1.5)


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize("offset_crop", [False, True])
def test_the_table_lands_in_the_visible_box_on_turned_pages(
    tmp_path: Path, rotation: int, offset_crop: bool
):
    source = _pdf(tmp_path, rotation, offset_crop)
    target = tmp_path / f"tablo-{rotation}-{offset_crop}.pdf"
    natural, _ = table_pdf(TableSpec.model_validate(_spec(header_fill="#ff0000", border="none")))
    scale = 200 / natural[0].rect.width
    height = natural[0].rect.height * scale
    natural.close()
    box = (30.0, 60.0, 230.0, 60.0 + height)
    _place(source, target, box=box, header_fill="#ff0000", border="none")
    with pymupdf.open(target) as document:
        page = document[0]
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(2, 2))
        pixels = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
            pixmap.height, pixmap.width, pixmap.n
        )
        red = (pixels[:, :, 0] > 200) & (pixels[:, :, 1] < 80) & (pixels[:, :, 2] < 80)
        rows, columns = np.nonzero(red)
        assert rows.size > 0
        x0, y0, x1, _y1 = box
        assert columns.min() / 2 == pytest.approx(x0, abs=2)
        assert columns.max() / 2 == pytest.approx(x1, abs=2)
        assert rows.min() / 2 == pytest.approx(y0, abs=2)
        dark = pixels[:, :, :3].max(axis=2) < 90
        text_rows, text_columns = np.nonzero(
            dark[int(y0 * 2) : int((y0 + 12) * 2), int(x0 * 2) : int(x1 * 2)]
        )
        assert text_rows.size > 0
        assert "Ürün" in page.get_text()


def test_border_styles_draw_the_expected_lines():
    def lines(border: str) -> int:
        document, _ = table_pdf(TableSpec.model_validate(_spec(border=border, header_fill=None)))
        try:
            return sum(len(drawing["items"]) for drawing in document[0].get_drawings())
        finally:
            document.close()

    assert lines("all") == 4 + 4
    assert lines("horizontal") == 4
    assert lines("outer") == 2 + 1 + 2
    assert lines("none") == 0


def test_stripes_and_header_fill_colour_the_right_rows():
    spec = TableSpec.model_validate(
        _spec(
            cells=[["A", "B", "C"], ["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]],
            border="none",
            stripes=True,
        )
    )
    document, _ = table_pdf(spec)
    try:
        fills = [drawing for drawing in document[0].get_drawings() if drawing.get("fill")]
    finally:
        document.close()
    assert len(fills) == 2
    header, stripe = sorted(fills, key=lambda drawing: drawing["rect"].y0)
    assert header["fill"] == pytest.approx((0xDB / 255, 0xEA / 255, 0xFE / 255), abs=0.01)
    assert all(
        header_channel < stripe_channel < 1
        for header_channel, stripe_channel in zip(
            header["fill"][:2], stripe["fill"][:2], strict=True
        )
    )


def test_long_text_wraps_inside_its_cell_and_the_row_grows():
    short, _ = table_pdf(TableSpec.model_validate(_spec()))
    long_cells = [row[:] for row in CELLS]
    long_cells[1][0] = "Çok uzun bir ürün adı ki tek satıra sığmaz ve alta geçmesi gerekir"
    tall, _ = table_pdf(TableSpec.model_validate(_spec(cells=long_cells)))
    try:
        assert tall[0].rect.height > short[0].rect.height + 10
        lines = [
            line for block in tall[0].get_text("dict")["blocks"] for line in block.get("lines", [])
        ]
        first_column_right = 240 * 2 / 4
        assert all(
            line["bbox"][2] <= first_column_right + 0.5
            for line in lines
            if line["bbox"][0] < first_column_right
        )
    finally:
        short.close()
        tall.close()


def test_wrap_breaks_words_that_do_not_fit_and_keeps_line_breaks():
    font = pymupdf.Font("helv")
    assert wrap_cell("a\nb", font, 10, 100) == ["a", "b"]
    assert wrap_cell("", font, 10, 100) == [""]
    pieces = wrap_cell("x" * 60, font, 10, 50)
    assert len(pieces) > 1
    assert all(font.text_length(piece, fontsize=10) <= 50 for piece in pieces)


def test_the_preview_is_an_svg_of_the_same_size_with_text_as_paths():
    preview = table_preview(TableSpec.model_validate(_spec()), silent_progress())
    assert preview.svg.startswith("<?xml") or preview.svg.startswith("<svg")
    assert "<text" not in preview.svg
    assert preview.width == pytest.approx(240)
    assert preview.height > 30
    assert preview.missing_glyphs == ""


def test_letters_the_font_lacks_are_reported(tmp_path: Path):
    cells = [row[:] for row in CELLS]
    cells[2][0] = "漢字"
    result = _place(_pdf(tmp_path), tmp_path / "tablo.pdf", cells=cells)
    assert [warning.code for warning in result.warnings] == ["glyphsMissing"]
    assert "漢" in result.warnings[0].detail


@pytest.mark.parametrize(
    "change",
    [
        {"cells": [["a", "b"], ["c"]], "column_widths": [1, 1], "align": ["left", "left"]},
        {"align": ["left"]},
        {"color": "red"},
        {"column_widths": [0, 1, 1]},
        {"cells": [["x"] * 3] * 61},
        {"font_size": 100},
    ],
)
def test_malformed_tables_are_refused(change: dict):
    with pytest.raises(ValidationError):
        TableSpec.model_validate(_spec(**change))


def test_a_table_taller_than_any_page_is_refused():
    cells = [["satır " * 300] for _ in range(60)]
    spec = TableSpec.model_validate(
        _spec(cells=cells, column_widths=[1], align=["left"], width=40, font_size=72)
    )
    with pytest.raises(OpError) as caught:
        table_pdf(spec)
    assert caught.value.data["reason"] == "tableTooTall"
