from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.compare import CompareParams, compare
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)
CHAPTERS = ["Bolum A", "Bolum B", "Bolum C", "Bolum D", "Bolum E", "Bolum F"]


def _build(path: Path, lines: list[str]) -> Path:
    document = pymupdf.open()
    for text in lines:
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 120), text, fontsize=14, fontname="dejavu", fontfile=FONT)
    document.save(path)
    document.close()
    return path


@pytest.fixture
def original(tmp_path: Path) -> Path:
    return _build(tmp_path / "a.pdf", CHAPTERS)


def _changed(result) -> list:
    return [
        page
        for page in result.pages
        if page.added_words or page.removed_words or not (page.in_a and page.in_b)
    ]


def _run(original: Path, other: Path) -> object:
    return compare(
        CompareParams(path_a=str(original), path_b=str(other), visual=False), silent_progress()
    )


def test_an_inserted_page_is_the_only_thing_reported(original: Path, tmp_path: Path):
    other = _build(tmp_path / "b.pdf", [CHAPTERS[0], "YENI SAYFA", *CHAPTERS[1:]])
    result = _run(original, other)
    changed = _changed(result)
    assert len(changed) == 1
    assert changed[0].page_a is None
    assert changed[0].page_b == 2


def test_a_deleted_page_is_the_only_thing_reported(original: Path, tmp_path: Path):
    other = _build(tmp_path / "b.pdf", [CHAPTERS[0], *CHAPTERS[2:]])
    result = _run(original, other)
    changed = _changed(result)
    assert len(changed) == 1
    assert changed[0].page_a == 2
    assert changed[0].page_b is None


def test_pages_after_an_insertion_keep_their_own_numbers(original: Path, tmp_path: Path):
    other = _build(tmp_path / "b.pdf", [CHAPTERS[0], "YENI SAYFA", *CHAPTERS[1:]])
    result = _run(original, other)
    last = result.pages[-1]
    assert last.page_a == 6
    assert last.page_b == 7
    assert last.added_words == 0
    assert last.removed_words == 0


def test_an_edit_is_still_found_where_it_happened(original: Path, tmp_path: Path):
    other = _build(tmp_path / "b.pdf", [CHAPTERS[0], "Bolum B degisti", *CHAPTERS[2:]])
    result = _run(original, other)
    changed = _changed(result)
    assert len(changed) == 1
    assert changed[0].page_a == 2
    assert changed[0].page_b == 2
    assert changed[0].added_words > 0


def test_two_copies_of_the_same_document_report_nothing(original: Path, tmp_path: Path):
    other = _build(tmp_path / "b.pdf", CHAPTERS)
    assert _changed(_run(original, other)) == []


def test_a_page_moved_to_the_end_is_reported_once_at_each_end(original: Path, tmp_path: Path):
    other = _build(tmp_path / "b.pdf", [*CHAPTERS[1:], CHAPTERS[0]])
    result = _run(original, other)
    changed = _changed(result)
    assert len(changed) == 2
    assert {page.page_a for page in changed} == {1, None}
    assert {page.page_b for page in changed} == {None, 6}


def test_scanned_pages_with_no_text_still_line_up(tmp_path: Path):
    def scan(path: Path, marks: list[int]) -> Path:
        document = pymupdf.open()
        for mark in marks:
            page = document.new_page(width=400, height=560)
            page.draw_rect(pymupdf.Rect(40, 30 + mark * 70, 360, 90 + mark * 70), fill=(0, 0, 0))
        document.save(path)
        document.close()
        return path

    first = scan(tmp_path / "s1.pdf", [0, 2, 4, 6])
    second = scan(tmp_path / "s2.pdf", [0, 2, 5, 4, 6])
    result = compare(
        CompareParams(path_a=str(first), path_b=str(second), visual=False), silent_progress()
    )
    changed = _changed(result)
    assert len(changed) == 1
    assert changed[0].page_b == 3
