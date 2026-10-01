from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.page_numbers import (
    PageNumberParams,
    format_number,
    mirrored_position,
    number_pages,
    to_letters,
    to_roman,
)
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture
def six_pages(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for index in range(6):
        page = document.new_page(width=595, height=842)
        page.insert_text(
            (60, 90), f"govde {index + 1}", fontsize=11, fontname="dejavu", fontfile=FONT
        )
    path = tmp_path / "six.pdf"
    document.save(path)
    document.close()
    return path


def _stamped(path: Path, index: int) -> list[str]:
    document = pymupdf.open(path)
    words = [
        word for _x0, y0, _x1, _y1, word, *_rest in document[index].get_text("words") if y0 > 700
    ]
    document.close()
    return words


def _stamp_x(path: Path, index: int) -> float:
    document = pymupdf.open(path)
    spots = [
        x0 for x0, y0, _x1, _y1, _word, *_rest in document[index].get_text("words") if y0 > 700
    ]
    document.close()
    return min(spots) if spots else 0.0


def test_roman_numerals_count_the_way_they_should():
    assert [to_roman(value) for value in (1, 4, 9, 14, 40, 90, 400, 1987)] == [
        "i",
        "iv",
        "ix",
        "xiv",
        "xl",
        "xc",
        "cd",
        "mcmlxxxvii",
    ]


def test_letters_carry_past_z():
    assert [to_letters(value) for value in (1, 26, 27, 52, 53, 703)] == [
        "a",
        "z",
        "aa",
        "az",
        "ba",
        "aaa",
    ]


def test_each_style_renders_its_own_alphabet():
    assert format_number(4, "arabic") == "4"
    assert format_number(4, "romanLower") == "iv"
    assert format_number(4, "romanUpper") == "IV"
    assert format_number(4, "letterLower") == "d"
    assert format_number(4, "letterUpper") == "D"


def test_mirrored_positions_swap_only_on_even_pages():
    assert mirrored_position("bottom-left", 1) == "bottom-left"
    assert mirrored_position("bottom-left", 2) == "bottom-right"
    assert mirrored_position("bottom-right", 2) == "bottom-left"
    assert mirrored_position("bottom-center", 2) == "bottom-center"


def test_roman_numbering_is_stamped_on_the_page(six_pages: Path, tmp_path: Path):
    target = tmp_path / "roman.pdf"
    number_pages(
        PageNumberParams(path=str(six_pages), output=str(target), style="romanUpper"),
        silent_progress(),
    )
    assert _stamped(target, 0) == ["I"]
    assert _stamped(target, 3) == ["IV"]


def test_a_suffix_follows_the_number(six_pages: Path, tmp_path: Path):
    target = tmp_path / "suffix.pdf"
    number_pages(
        PageNumberParams(
            path=str(six_pages), output=str(target), prefix="EK-", suffix=".a", padding=3
        ),
        silent_progress(),
    )
    assert _stamped(target, 0) == ["EK-001.a"]


def test_mirrored_margins_move_the_number_across_on_even_pages(six_pages: Path, tmp_path: Path):
    target = tmp_path / "mirror.pdf"
    number_pages(
        PageNumberParams(
            path=str(six_pages),
            output=str(target),
            position="bottom-left",
            mirror_margins=True,
        ),
        silent_progress(),
    )
    assert _stamp_x(target, 0) < 200
    assert _stamp_x(target, 1) > 400


def test_numbering_only_the_odd_pages(six_pages: Path, tmp_path: Path):
    target = tmp_path / "odd.pdf"
    number_pages(
        PageNumberParams(path=str(six_pages), output=str(target), side="odd", template="<{n}>"),
        silent_progress(),
    )
    assert _stamped(target, 0) == ["<1>"]
    assert _stamped(target, 1) == []


def test_page_labels_tell_the_viewer_the_same_numbering(six_pages: Path, tmp_path: Path):
    target = tmp_path / "labels.pdf"
    number_pages(
        PageNumberParams(
            path=str(six_pages), output=str(target), style="romanLower", page_labels=True
        ),
        silent_progress(),
    )
    document = pymupdf.open(target)
    labels = [document[index].get_label() for index in range(3)]
    document.close()
    assert labels == ["i", "ii", "iii"]
