from pathlib import Path

import pymupdf

from vivepdf.ops.compare import CompareParams, _aligned, compare
from vivepdf.rpc.progress import silent_progress


def _single(path: Path, draw) -> Path:
    document = pymupdf.open()
    draw(document.new_page(width=300, height=300))
    document.save(path)
    document.close()
    return path


def _visual(left: Path, right: Path):
    return compare(
        CompareParams(path_a=str(left), path_b=str(right), text=False), silent_progress()
    ).pages[0]


def test_a_colour_swap_with_the_same_brightness_is_seen(tmp_path: Path) -> None:
    red = _single(
        tmp_path / "red.pdf",
        lambda page: page.draw_rect(
            pymupdf.Rect(50, 50, 150, 150), color=None, fill=(0.8, 0.2, 0.2)
        ),
    )
    green = _single(
        tmp_path / "green.pdf",
        lambda page: page.draw_rect(
            pymupdf.Rect(50, 50, 150, 150), color=None, fill=(0.2, 0.47, 0.2)
        ),
    )
    assert _visual(red, green).changed_area > 0.05


def test_a_hairline_added_to_a_page_is_seen(tmp_path: Path) -> None:
    empty = _single(tmp_path / "empty.pdf", lambda page: None)
    lined = _single(
        tmp_path / "line.pdf",
        lambda page: page.draw_line((20, 150), (280, 150), color=(0, 0, 0), width=0.3),
    )
    assert _visual(empty, lined).changed_area > 0


def test_identical_pages_have_no_changed_area(tmp_path: Path) -> None:
    drawn = _single(
        tmp_path / "same.pdf",
        lambda page: page.draw_rect(
            pymupdf.Rect(50, 50, 150, 150), color=None, fill=(0.8, 0.2, 0.2)
        ),
    )
    assert _visual(drawn, drawn).changed_area == 0


def test_an_edited_page_after_an_inserted_one_is_paired_with_its_original() -> None:
    left = ["text:giris", "text:ikinci bolum metni burada uzun", "text:son"]
    right = [
        "text:giris",
        "text:tamamen yeni sayfa",
        "text:ikinci bolum metni orada uzun",
        "text:son",
    ]
    assert _aligned(left, right) == [(0, 0), (None, 1), (1, 2), (2, 3)]


def test_unrelated_pages_of_different_counts_are_not_forced_together() -> None:
    left = ["text:a", "text:eski bir", "text:z"]
    right = ["text:a", "text:yeni bir", "text:baska iki", "text:z"]
    pairs = _aligned(left, right)
    assert pairs[0] == (0, 0)
    assert pairs[-1] == (2, 3)
    assert {a for a, _ in pairs if a is not None} == {0, 1, 2}
    assert {b for _, b in pairs if b is not None} == {0, 1, 2, 3}


def test_a_page_only_in_one_file_has_no_changed_area(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "bir")
    one = tmp_path / "one.pdf"
    document.save(one)
    document.new_page().insert_text((72, 72), "iki")
    two = tmp_path / "two.pdf"
    document.save(two)
    document.close()
    result = compare(CompareParams(path_a=str(one), path_b=str(two)), silent_progress())
    extra = next(page for page in result.pages if not page.in_a)
    assert extra.changed_area == 0
    assert result.changed_pages == 1
