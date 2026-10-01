from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.poster import PosterParams, poster, tile_name
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def quarters(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for word, (x, y) in {
        "NW": (100, 200),
        "NE": (420, 200),
        "SW": (100, 650),
        "SE": (420, 650),
    }.items():
        page.insert_text((x, y), word, fontsize=40)
    path = tmp_path / "quarters.pdf"
    document.save(path)
    document.close()
    return path


def _words(path: Path) -> list[set[str]]:
    with pymupdf.open(path) as document:
        return [{word[4] for word in page.get_text("words")} for page in document]


def test_a_page_is_enlarged_over_a_grid_of_sheets_in_reading_order(quarters: Path, tmp_path: Path):
    target = tmp_path / "poster.pdf"
    result = poster(PosterParams(path=str(quarters), output=str(target)), silent_progress())
    assert result.sheets == 4
    assert result.scale > 1.7
    sheets = _words(target)
    assert "NW" in sheets[0] and "A1" in " ".join(sheets[0])
    assert "NE" in sheets[1]
    assert "SW" in sheets[2]
    assert "SE" in sheets[3]
    with pymupdf.open(target) as document:
        assert all(round(page.rect.width) == 595 for page in document)


def test_a_wide_page_picks_the_orientation_that_prints_it_largest(tmp_path: Path):
    document = pymupdf.open()
    document.new_page(width=1200, height=400)
    source = tmp_path / "wide.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "wide-poster.pdf"
    result = poster(
        PosterParams(path=str(source), output=str(target), columns=3, rows=1, labels=False),
        silent_progress(),
    )
    assert result.sheets == 3
    with pymupdf.open(target) as output:
        assert output[0].rect.width > output[0].rect.height


def test_rows_names_continue_past_z():
    assert tile_name(0, 0) == "A1"
    assert tile_name(2, 25) == "Z3"
    assert tile_name(0, 26) == "AA1"


def test_a_page_outside_the_document_is_refused(quarters: Path, tmp_path: Path):
    with pytest.raises(OpError):
        poster(
            PosterParams(path=str(quarters), output=str(tmp_path / "x.pdf"), pages="9"),
            silent_progress(),
        )


def _blank(tmp_path: Path) -> Path:
    document = pymupdf.open()
    document.new_page(width=595, height=842)
    path = tmp_path / "blank.pdf"
    document.save(path)
    document.close()
    return path


def _poster(source: Path, tmp_path: Path, **options) -> pymupdf.Document:
    target = tmp_path / "tiles.pdf"
    poster(
        PosterParams(path=str(source), output=str(target), overwrite=True, **options),
        silent_progress(),
    )
    return pymupdf.open(target)


def _printable(sheet: pymupdf.Page, margin: float) -> pymupdf.Rect:
    return pymupdf.Rect(margin, margin, sheet.rect.width - margin, sheet.rect.height - margin)


@pytest.mark.parametrize("margin", [0.0, 28.0])
def test_sheet_labels_print_inside_the_printable_area(tmp_path: Path, margin: float):
    with _poster(_blank(tmp_path), tmp_path, margin=margin, overlap=14, cut_marks=False) as sheets:
        for sheet, name in zip(sheets, ("A1", "A2", "B1", "B2"), strict=True):
            printable = _printable(sheet, margin)
            words = [word for word in sheet.get_text("words") if word[4] == name]
            assert len(words) == 1, name
            label = pymupdf.Rect(words[0][:4])
            assert printable.contains(label), (name, label, printable)


def test_sheet_labels_sit_in_the_strip_the_next_sheet_covers(tmp_path: Path):
    margin, overlap = 28.0, 14.0
    with _poster(
        _blank(tmp_path), tmp_path, margin=margin, overlap=overlap, cut_marks=False
    ) as sheets:
        width, height = sheets[0].rect.width, sheets[0].rect.height
        labels = {
            word[4]: pymupdf.Rect(word[:4])
            for sheet in sheets
            for word in sheet.get_text("words")
            if word[4] in {"A1", "A2", "B1"}
        }
    bottom_strip = height - margin - overlap
    right_strip = width - margin - overlap
    assert labels["A1"].y0 >= bottom_strip - 0.5
    assert labels["A2"].y0 >= bottom_strip - 0.5
    assert labels["B1"].x0 >= right_strip - 0.5


def test_cut_marks_stay_inside_the_printable_area(tmp_path: Path):
    margin = 28.0
    with _poster(_blank(tmp_path), tmp_path, margin=margin, labels=False) as sheets:
        for sheet in sheets:
            printable = _printable(sheet, margin)
            printable = pymupdf.Rect(
                printable.x0 - 1, printable.y0 - 1, printable.x1 + 1, printable.y1 + 1
            )
            drawings = sheet.get_drawings()
            assert drawings
            for drawing in drawings:
                assert printable.contains(drawing["rect"]), drawing["rect"]
