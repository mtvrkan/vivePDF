from pathlib import Path

import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops.analyze import DuplicateSource, DuplicatesParams, duplicates
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

LINES = (
    "Operating systems manage memory, files and devices.",
    "A process is a program in execution with its own state.",
    "Scheduling decides which process runs next on the CPU.",
    "Virtual memory lets programs use more than the physical RAM.",
    "File systems organise data into directories and files.",
)


def _content_page(document: pymupdf.Document, title: str, lines=LINES, badge=(0.8, 0.1, 0.2)):
    page = document.new_page(width=720, height=540)
    page.draw_rect(pymupdf.Rect(0, 0, 720, 60), color=None, fill=badge)
    page.insert_text((40, 40), title, fontsize=26, color=(1, 1, 1))
    for row, line in enumerate(lines):
        page.insert_text((60, 120 + row * 34), f"- {line}", fontsize=16)
    page.draw_circle(pymupdf.Point(620, 440), 50, color=(0, 0, 0), fill=badge)
    return page


def _save(document: pymupdf.Document, path: Path) -> Path:
    document.save(path)
    document.close()
    return path


def _scan(source: Path, target: Path, dpi: int, offset: float) -> Path:
    original = pymupdf.open(source)
    scanned = pymupdf.open()
    for page in original:
        picture = page.get_pixmap(dpi=dpi).tobytes("png")
        sheet = scanned.new_page(width=page.rect.width + 30, height=page.rect.height + 30)
        sheet.insert_image(
            pymupdf.Rect(offset, offset, offset + page.rect.width, offset + page.rect.height),
            stream=picture,
        )
    original.close()
    return _save(scanned, target)


def _run(*paths: Path):
    sources = [DuplicateSource(path=str(path)) for path in paths]
    return duplicates(DuplicatesParams(sources=sources), silent_progress())


def test_a_copied_page_is_grouped_and_blank_pages_are_left_alone(tmp_path: Path) -> None:
    document = pymupdf.open()
    _content_page(document, "Chapter one")
    _content_page(document, "Chapter two", LINES[::-1])
    document.new_page(width=720, height=540)
    document.new_page(width=720, height=540)
    document.fullcopy_page(0)
    result = _run(_save(document, tmp_path / "copies.pdf"))
    first, second, blank, other_blank, copy = result.groups[0]
    assert result.page_counts == [5]
    assert first is not None and first == copy
    assert second is None
    assert blank is None and other_blank is None
    assert result.group_count == 1


def test_the_same_page_in_two_files_is_grouped(tmp_path: Path) -> None:
    left = pymupdf.open()
    _content_page(left, "Week 1")
    _content_page(left, "Processes", LINES[1:])
    right = pymupdf.open()
    _content_page(right, "Scheduling", LINES[2:])
    _content_page(right, "Processes", LINES[1:])
    result = _run(_save(left, tmp_path / "left.pdf"), _save(right, tmp_path / "right.pdf"))
    assert result.groups[0][1] is not None
    assert result.groups[0][1] == result.groups[1][1]
    assert result.groups[0][0] is None and result.groups[1][0] is None


def test_pages_that_differ_only_in_a_number_are_not_duplicates(tmp_path: Path) -> None:
    document = pymupdf.open()
    for week in ("1. Week", "7. Week", "11. Week"):
        _content_page(document, week)
    result = _run(_save(document, tmp_path / "covers.pdf"))
    assert result.groups[0] == [None, None, None]


def test_the_same_words_over_a_different_picture_are_not_duplicates(tmp_path: Path) -> None:
    document = pymupdf.open()
    for colour in ((0.8, 0.1, 0.2), (0.1, 0.3, 0.8)):
        page = document.new_page(width=720, height=540)
        page.insert_text((60, 480), "End of lecture", fontsize=28)
        shape = page.new_shape()
        if colour[0] > 0.5:
            shape.draw_circle(pymupdf.Point(360, 220), 140)
        else:
            shape.draw_rect(pymupdf.Rect(120, 80, 600, 380))
        shape.finish(color=(0, 0, 0), fill=colour, width=6)
        shape.commit()
    result = _run(_save(document, tmp_path / "ends.pdf"))
    assert result.groups[0] == [None, None]


def test_two_scans_of_the_same_pages_are_grouped_page_by_page(tmp_path: Path) -> None:
    document = pymupdf.open()
    _content_page(document, "Memory", LINES)
    _content_page(document, "Files", LINES[::-1], badge=(0.1, 0.5, 0.3))
    original = _save(document, tmp_path / "lecture.pdf")
    first = _scan(original, tmp_path / "scan-a.pdf", 150, 6)
    second = _scan(original, tmp_path / "scan-b.pdf", 200, 22)
    result = _run(first, second)
    assert result.groups[0][0] is not None and result.groups[0][0] == result.groups[1][0]
    assert result.groups[0][1] is not None and result.groups[0][1] == result.groups[1][1]
    assert result.groups[0][0] != result.groups[0][1]


def test_scans_of_different_text_pages_with_the_same_layout_stay_apart(tmp_path: Path) -> None:
    document = pymupdf.open()
    _content_page(document, "Memory", LINES)
    _content_page(document, "Memory", (*LINES[:4], "Paging splits memory into equal frames."))
    original = _save(document, tmp_path / "similar.pdf")
    result = _run(_scan(original, tmp_path / "similar-scan.pdf", 200, 10))
    assert result.groups[0] == [None, None]


def test_a_picture_file_matches_the_page_it_shows(tmp_path: Path) -> None:
    document = pymupdf.open()
    _content_page(document, "Diagram")
    original = _save(document, tmp_path / "diagram.pdf")
    picture = tmp_path / "diagram.png"
    with pymupdf.open(original) as opened:
        opened[0].get_pixmap(dpi=150).save(picture)
    result = _run(original, picture)
    assert result.groups[0][0] is not None and result.groups[0][0] == result.groups[1][0]


def test_a_missing_file_is_an_op_error(tmp_path: Path) -> None:
    with pytest.raises(OpError):
        _run(tmp_path / "nope.pdf")


def test_at_least_one_source_is_required() -> None:
    with pytest.raises(ValidationError):
        DuplicatesParams(sources=[])
