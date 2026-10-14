from pathlib import Path

import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops.presentation import SaveDrawingsParams, save_drawings
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

RED = "#ff0000"


def _document(tmp_path: Path, rotation: int = 0, offset_crop: bool = False) -> Path:
    document = pymupdf.open()
    for _ in range(2):
        page = document.new_page(width=400, height=600)
        if offset_crop:
            page.set_cropbox(pymupdf.Rect(30, 20, 380, 590))
        page.set_rotation(rotation)
    path = tmp_path / f"sunum ş-{rotation}-{int(offset_crop)}.pdf"
    document.save(path)
    document.close()
    return path


def _save(path: Path, **fields: object):
    return save_drawings(SaveDrawingsParams(path=str(path), **fields), silent_progress())


def _pen(points: list[tuple[float, float]], **fields: object) -> dict:
    return {"tool": "pen", "color": RED, "width": 0.02, "points": points, **fields}


def _red_at(page: pymupdf.Page, x: float, y: float) -> bool:
    pixmap = page.get_pixmap(alpha=False)
    sx, sy = pixmap.width / page.rect.width, pixmap.height / page.rect.height
    red, green, blue = pixmap.pixel(int(x * page.rect.width * sx), int(y * page.rect.height * sy))
    return red > 200 and green < 80 and blue < 80


@pytest.mark.parametrize(
    ("rotation", "offset_crop"), [(0, False), (90, False), (180, True), (270, True)]
)
def test_page_strokes_land_where_they_were_drawn_on_turned_and_cropped_pages(
    tmp_path: Path, rotation: int, offset_crop: bool
):
    path = _document(tmp_path, rotation, offset_crop)

    result = _save(path, pages=[{"page": 2, "strokes": [_pen([(0.2, 0.3), (0.4, 0.3)])]}])

    assert result.annotations == 1
    with pymupdf.open(path) as document:
        page = document[1]
        assert [annot.type[1] for annot in page.annots()] == ["Ink"]
        assert _red_at(page, 0.3, 0.3)
        assert not _red_at(page, 0.7, 0.7)
        assert not list(document[0].annots())


def test_shapes_highlights_and_text_become_annotations_with_the_author(tmp_path: Path):
    path = _document(tmp_path)
    strokes = [
        {
            "tool": "highlighter",
            "color": "#ffd60a",
            "width": 0.04,
            "points": [(0.1, 0.1), (0.5, 0.1)],
        },
        {"tool": "arrow", "color": RED, "width": 0.01, "points": [(0.1, 0.5), (0.6, 0.5)]},
        {"tool": "rect", "color": RED, "width": 0.01, "points": [(0.2, 0.6), (0.4, 0.7)]},
        {
            "tool": "ellipse",
            "color": RED,
            "width": 0.01,
            "points": [(0.5, 0.6), (0.7, 0.8)],
            "opacity": 0.5,
        },
        {
            "tool": "text",
            "color": RED,
            "width": 0,
            "points": [(0.1, 0.85)],
            "text": "Şişli\nİkinci",
            "fontSize": 0.05,
            "size": (0.3, 0.1),
        },
    ]

    result = _save(path, author="Öğretmen", pages=[{"page": 1, "strokes": strokes}])

    assert result.annotations == 5
    with pymupdf.open(path) as document:
        page = document[0]
        annots = list(page.annots())
        assert [annot.type[1] for annot in annots] == ["Ink", "Ink", "Ink", "Ink", "FreeText"]
        assert all(annot.info["title"] == "Öğretmen" for annot in annots)
        assert annots[0].opacity == pytest.approx(0.45, abs=0.01)
        assert len(annots[1].vertices) == 2
        assert annots[3].opacity == pytest.approx(0.5, abs=0.01)
        assert "Şişli" in page.get_text()


def test_boards_become_new_pages_at_the_end_with_their_background(tmp_path: Path):
    path = _document(tmp_path)
    boards = [
        {
            "background": "black",
            "width": 1600,
            "height": 900,
            "strokes": [_pen([(0.1, 0.5), (0.9, 0.5)], color="#ffffff")],
        },
        {
            "background": "white",
            "width": 1600,
            "height": 900,
            "strokes": [_pen([(0.1, 0.5), (0.9, 0.5)])],
        },
    ]

    result = _save(path, boards=boards)

    assert result.pages_added == 2
    assert result.page_count == 4
    with pymupdf.open(path) as document:
        black, white = document[2], document[3]
        assert black.rect.width == pytest.approx(400)
        assert black.rect.height == pytest.approx(225)
        assert black.get_pixmap().pixel(5, 5) == (0, 0, 0)
        assert white.get_pixmap().pixel(5, 5) == (255, 255, 255)
        assert _red_at(white, 0.5, 0.5)
        assert len(list(black.annots())) == 1


def test_blank_text_is_skipped(tmp_path: Path):
    path = _document(tmp_path)
    strokes = [
        {
            "tool": "text",
            "color": RED,
            "width": 0,
            "points": [(0.1, 0.1)],
            "text": "  ",
            "fontSize": 0.05,
            "size": (0.1, 0.1),
        },
        _pen([(0.1, 0.2), (0.2, 0.2)]),
    ]

    result = _save(path, pages=[{"page": 1, "strokes": strokes}])

    assert result.annotations == 1


def test_a_page_outside_the_document_is_refused_and_the_file_is_left_alone(tmp_path: Path):
    path = _document(tmp_path)
    before = path.read_bytes()

    with pytest.raises(OpError) as caught:
        _save(path, pages=[{"page": 9, "strokes": [_pen([(0.1, 0.1), (0.2, 0.2)])]}])

    assert caught.value.code is ErrorCode.INVALID_PARAMS
    assert caught.value.data and caught.value.data["reason"] == "pageOutOfRange"
    assert path.read_bytes() == before


def test_nothing_to_save_and_bad_colours_are_refused(tmp_path: Path):
    path = _document(tmp_path)

    with pytest.raises(OpError) as caught:
        _save(path)
    assert caught.value.data == {"reason": "empty"}

    with pytest.raises(ValidationError):
        SaveDrawingsParams(
            path=str(path), pages=[{"page": 1, "strokes": [_pen([(0, 0)], color="red")]}]
        )


RED_BOX_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">'
    '<rect width="100" height="50" fill="#ff0000"/></svg>'
)


def _item(anchor: tuple[float, float], size: tuple[float, float], **fields: object) -> dict:
    return {
        "tool": "drawing",
        "color": "#000000",
        "width": 0,
        "points": [anchor],
        "size": size,
        "svg": RED_BOX_SVG,
        **fields,
    }


@pytest.mark.parametrize(
    ("rotation", "offset_crop"), [(0, False), (90, False), (180, True), (270, True)]
)
def test_inserted_items_are_drawn_into_their_box_on_turned_and_cropped_pages(
    tmp_path: Path, rotation: int, offset_crop: bool
):
    path = _document(tmp_path, rotation, offset_crop)

    result = _save(path, pages=[{"page": 2, "strokes": [_item((0.2, 0.3), (0.4, 0.2))]}])

    assert result.annotations == 0
    with pymupdf.open(path) as document:
        page = document[1]
        assert not list(page.annots())
        assert _red_at(page, 0.4, 0.4)
        assert not _red_at(page, 0.1, 0.1)
        assert not _red_at(page, 0.8, 0.8)
        assert not _red_at(document[0], 0.4, 0.4)


def test_inserted_items_sit_beside_ink_and_on_boards(tmp_path: Path):
    path = _document(tmp_path)
    board = {
        "background": "white",
        "width": 1600,
        "height": 900,
        "strokes": [_item((0.4, 0.4), (0.2, 0.2))],
    }

    result = _save(
        path,
        pages=[
            {"page": 1, "strokes": [_item((0.1, 0.1), (0.3, 0.1)), _pen([(0.1, 0.8), (0.3, 0.8)])]}
        ],
        boards=[board],
    )

    assert result.annotations == 1
    with pymupdf.open(path) as document:
        assert _red_at(document[0], 0.25, 0.15)
        assert [annot.type[1] for annot in document[0].annots()] == ["Ink"]
        assert _red_at(document[2], 0.5, 0.5)


def test_an_item_without_a_picture_or_box_is_skipped(tmp_path: Path):
    path = _document(tmp_path)
    strokes = [
        _item((0.1, 0.1), (0.3, 0.1), svg=None),
        {**_item((0.5, 0.5), (0.3, 0.1)), "size": None},
        _item((0.6, 0.6), (0, 0)),
    ]

    result = _save(path, pages=[{"page": 1, "strokes": strokes}])

    assert result.annotations == 0
    with pymupdf.open(path) as document:
        assert not _red_at(document[0], 0.25, 0.15)
        assert not _red_at(document[0], 0.65, 0.55)


def test_an_unreadable_picture_is_refused_and_the_file_is_left_alone(tmp_path: Path):
    path = _document(tmp_path)
    before = path.read_bytes()

    with pytest.raises(OpError) as caught:
        _save(path, pages=[{"page": 1, "strokes": [_item((0.1, 0.1), (0.3, 0.1), svg="<svg")]}])

    assert caught.value.code is ErrorCode.INVALID_PARAMS
    assert path.read_bytes() == before
