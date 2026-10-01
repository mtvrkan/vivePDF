from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.analyze import ImposeParams, impose
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture
def eight_pages(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for index in range(8):
        page = document.new_page(width=595, height=842)
        page.insert_text((200, 400), f"S{index + 1}", fontsize=40, fontname="dejavu", fontfile=FONT)
    path = tmp_path / "eight.pdf"
    document.save(path)
    document.close()
    return path


def _cells(path: Path, index: int) -> list[tuple[float, float, str]]:
    document = pymupdf.open(path)
    words = document[index].get_text("words")
    document.close()
    return sorted(
        (round(y0), round(x0), word)
        for x0, y0, _x1, _y1, word, *_rest in words
        if word.startswith("S")
    )


def _labels(path: Path, index: int) -> list[str]:
    return [word for _y, _x, word in _cells(path, index)]


def test_a_booklet_lays_the_pages_out_in_the_printer_order(eight_pages: Path, tmp_path: Path):
    target = tmp_path / "booklet.pdf"
    result = impose(
        ImposeParams(path=str(eight_pages), output=str(target), layout="booklet"), silent_progress()
    )
    assert result.sheets == 4
    assert _labels(target, 0) == ["S8", "S1"]
    assert _labels(target, 1) == ["S2", "S7"]
    assert _labels(target, 2) == ["S6", "S3"]
    assert _labels(target, 3) == ["S4", "S5"]


def test_binding_on_the_right_mirrors_every_spread(eight_pages: Path, tmp_path: Path):
    target = tmp_path / "rtl-binding.pdf"
    impose(
        ImposeParams(path=str(eight_pages), output=str(target), layout="booklet", binding="right"),
        silent_progress(),
    )
    assert _labels(target, 0) == ["S1", "S8"]
    assert _labels(target, 1) == ["S7", "S2"]


def test_the_front_pass_writes_only_the_sheets_that_print_first(eight_pages: Path, tmp_path: Path):
    front = tmp_path / "front.pdf"
    back = tmp_path / "back.pdf"
    front_result = impose(
        ImposeParams(path=str(eight_pages), output=str(front), layout="booklet", duplex="front"),
        silent_progress(),
    )
    back_result = impose(
        ImposeParams(path=str(eight_pages), output=str(back), layout="booklet", duplex="back"),
        silent_progress(),
    )
    assert front_result.sheets == 2
    assert back_result.sheets == 2
    assert _labels(front, 0) == ["S8", "S1"]
    assert _labels(back, 0) == ["S2", "S7"]


def test_reading_right_to_left_fills_the_cells_from_the_right(eight_pages: Path, tmp_path: Path):
    left = tmp_path / "ltr.pdf"
    right = tmp_path / "rtl.pdf"
    impose(ImposeParams(path=str(eight_pages), output=str(left), layout="4up"), silent_progress())
    impose(
        ImposeParams(path=str(eight_pages), output=str(right), layout="4up", reading="rtl"),
        silent_progress(),
    )
    assert _labels(left, 0) == ["S1", "S2", "S3", "S4"]
    assert _labels(right, 0) == ["S2", "S1", "S4", "S3"]


def test_filling_by_columns_walks_down_before_across(eight_pages: Path, tmp_path: Path):
    target = tmp_path / "columns.pdf"
    impose(
        ImposeParams(
            path=str(eight_pages), output=str(target), layout="4up", arrangement="columns"
        ),
        silent_progress(),
    )
    assert _labels(target, 0) == ["S1", "S3", "S2", "S4"]


def test_creep_moves_the_inner_sheets_towards_the_spine(eight_pages: Path, tmp_path: Path):
    plain = tmp_path / "plain.pdf"
    crept = tmp_path / "crept.pdf"
    impose(
        ImposeParams(path=str(eight_pages), output=str(plain), layout="booklet"), silent_progress()
    )
    impose(
        ImposeParams(path=str(eight_pages), output=str(crept), layout="booklet", creep=6),
        silent_progress(),
    )
    outer_left = _cells(plain, 3)[0][1]
    inner_left = _cells(crept, 3)[0][1]
    assert inner_left > outer_left


def test_a_gutter_pushes_the_two_halves_apart(eight_pages: Path, tmp_path: Path):
    plain = tmp_path / "nogutter.pdf"
    wide = tmp_path / "gutter.pdf"
    impose(ImposeParams(path=str(eight_pages), output=str(plain), layout="2up"), silent_progress())
    impose(
        ImposeParams(path=str(eight_pages), output=str(wide), layout="2up", gutter=40),
        silent_progress(),
    )
    assert _cells(wide, 0)[1][1] > _cells(plain, 0)[1][1]


def test_every_grid_size_places_the_pages_it_promises(eight_pages: Path, tmp_path: Path):
    for layout, per_sheet in [("2up", 2), ("3up", 3), ("4up", 4), ("6up", 6), ("8up", 8)]:
        target = tmp_path / f"{layout}.pdf"
        result = impose(
            ImposeParams(path=str(eight_pages), output=str(target), layout=layout),
            silent_progress(),
        )
        assert result.sheets == -(-8 // per_sheet), layout
        assert len(_labels(target, 0)) == min(per_sheet, 8), layout


def test_a_custom_grid_uses_the_rows_and_columns_it_is_given(eight_pages: Path, tmp_path: Path):
    target = tmp_path / "custom.pdf"
    result = impose(
        ImposeParams(path=str(eight_pages), output=str(target), layout="custom", columns=1, rows=4),
        silent_progress(),
    )
    assert result.sheets == 2
    assert _labels(target, 0) == ["S1", "S2", "S3", "S4"]


def test_a_booklet_keeps_its_own_order_whatever_the_reading_direction(
    eight_pages: Path, tmp_path: Path
):
    target = tmp_path / "booklet-rtl.pdf"
    impose(
        ImposeParams(
            path=str(eight_pages),
            output=str(target),
            layout="booklet",
            reading="rtl",
            arrangement="columns",
        ),
        silent_progress(),
    )
    assert _labels(target, 0) == ["S8", "S1"]
    assert _labels(target, 1) == ["S2", "S7"]
