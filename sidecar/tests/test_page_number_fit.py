import datetime
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._page_text import anchor_point
from vivepdf.ops._text_fit import ELLIPSIS, fit_line
from vivepdf.ops.header_footer import HeaderFooterParams, header_footer, slot_room
from vivepdf.ops.page_numbers import (
    PageNumberParams,
    label_rules,
    number_pages,
    render_furniture_text,
    render_page_label,
)
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture
def eight_pages(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for _ in range(8):
        document.new_page(width=595, height=842)
    path = tmp_path / "eight.pdf"
    document.save(path)
    document.close()
    return path


def _labels(path: Path) -> list[str]:
    with pymupdf.open(path) as document:
        return [page.get_label() for page in document]


def _words(path: Path, index: int) -> list[tuple[float, float, float, float, str]]:
    with pymupdf.open(path) as document:
        return [tuple(word[:5]) for word in document[index].get_text("words")]


def test_total_uses_the_same_style_and_padding_as_the_number():
    assert render_page_label("{n} / {total}", 3, 12, "", 0, "romanUpper") == "III / XII"
    assert render_page_label("{n} / {total}", 7, 120, "", 3) == "007 / 120"


def test_page_is_an_alias_for_the_number():
    assert render_page_label("Page {page}", 4, 9, "A-", 0) == "Page A-4"
    moment = datetime.datetime(2026, 9, 23, 10, 5)
    assert render_furniture_text("{page}/{total} {date}", 2, 5, "x.pdf", "%d.%m", moment) == (
        "2/5 23.09"
    )


def test_an_anchor_never_leaves_the_page():
    rect = pymupdf.Rect(0, 0, 200, 100)
    point = anchor_point(rect, 80, 12, "bottom-right", 180)
    assert 0 <= point.x <= 120
    assert 12 <= point.y <= 100
    point = anchor_point(rect, 80, 12, "top-left", 150)
    assert point.x <= 120
    assert point.y <= 100


def test_long_lines_shrink_then_end_with_an_ellipsis():
    font = pymupdf.Font(fontfile=FONT)
    text, size = fit_line(font, "kısa", 10, 200)
    assert (text, size) == ("kısa", 10)
    text, size = fit_line(font, "x" * 400, 10, 100)
    assert size == 4.0
    assert text.endswith(ELLIPSIS)
    assert font.text_length(text, fontsize=size) <= 100


def test_slots_share_the_row_they_are_in():
    assert slot_room(600, 50, {"left"}) == 500
    assert slot_room(600, 50, {"left", "right"}) == 250
    assert slot_room(600, 50, {"left", "center", "right"}) == pytest.approx(500 / 3)
    assert slot_room(600, 400, {"center"}) == 300


def test_label_rules_merge_continuous_runs():
    rules = label_rules([("D", "", 1), ("D", "", 2), ("r", "", 1), ("r", "", 2), ("D", "", 5)])
    assert [(rule["startpage"], rule["style"], rule["firstpagenum"]) for rule in rules] == [
        (0, "D", 1),
        (2, "r", 1),
        (4, "D", 5),
    ]


def test_page_labels_follow_a_split_range_and_close_after_it(eight_pages: Path, tmp_path: Path):
    target = tmp_path / "labels.pdf"
    number_pages(
        PageNumberParams(
            path=str(eight_pages),
            output=str(target),
            pages="2-3,6",
            style="romanLower",
            page_labels=True,
        ),
        silent_progress(),
    )
    assert _labels(target) == ["1", "i", "ii", "4", "5", "iii", "7", "8"]


def test_page_labels_keep_the_prefix_and_padding(eight_pages: Path, tmp_path: Path):
    target = tmp_path / "bates.pdf"
    number_pages(
        PageNumberParams(
            path=str(eight_pages),
            output=str(target),
            pages="1-3",
            prefix="DAVA-",
            padding=4,
            start=9,
            page_labels=True,
        ),
        silent_progress(),
    )
    assert _labels(target)[:4] == ["DAVA-0009", "DAVA-0010", "DAVA-0011", "4"]


def test_page_labels_keep_existing_labels_outside_the_range(eight_pages: Path, tmp_path: Path):
    source = tmp_path / "labelled.pdf"
    with pymupdf.open(eight_pages) as document:
        document.set_page_labels(
            [
                {"startpage": 0, "prefix": "", "style": "r", "firstpagenum": 1},
                {"startpage": 2, "prefix": "", "style": "D", "firstpagenum": 1},
            ]
        )
        document.save(source)
    target = tmp_path / "relabelled.pdf"
    number_pages(
        PageNumberParams(
            path=str(source), output=str(target), pages="5-6", start=40, page_labels=True
        ),
        silent_progress(),
    )
    assert _labels(target) == ["i", "ii", "1", "2", "40", "41", "5", "6"]


def test_a_zero_start_still_labels_the_page(eight_pages: Path, tmp_path: Path):
    target = tmp_path / "zero.pdf"
    number_pages(
        PageNumberParams(
            path=str(eight_pages), output=str(target), pages="1-2", start=0, page_labels=True
        ),
        silent_progress(),
    )
    assert _labels(target)[:3] == ["0", "1", "3"]


def test_numbering_reports_stamped_pages_once(eight_pages: Path, tmp_path: Path):
    result = number_pages(
        PageNumberParams(path=str(eight_pages), output=str(tmp_path / "n.pdf"), pages="1-3,2-4"),
        silent_progress(),
    )
    assert result.stamped == 4
    assert result.missing_glyphs == ""
    assert [word[4] for word in _words(Path(result.output), 1)] == ["2"]


def test_numbering_names_characters_the_font_cannot_show(eight_pages: Path, tmp_path: Path):
    result = number_pages(
        PageNumberParams(
            path=str(eight_pages), output=str(tmp_path / "cjk.pdf"), template="{n} 頁"
        ),
        silent_progress(),
    )
    assert result.missing_glyphs == "頁"


def test_crowded_header_slots_stay_apart(eight_pages: Path, tmp_path: Path):
    long_text = "Uzun bir başlık metni " * 6
    result = header_footer(
        HeaderFooterParams(
            path=str(eight_pages),
            output=str(tmp_path / "header.pdf"),
            pages="1",
            header_left=long_text,
            header_center=long_text,
            header_right=long_text,
        ),
        silent_progress(),
    )
    assert result.stamped == 1
    with pymupdf.open(result.output) as document:
        lines = [
            pymupdf.Rect(span["bbox"])
            for block in document[0].get_text("dict")["blocks"]
            for line in block.get("lines", [])
            for span in line["spans"]
            if span["text"].strip()
        ]
    assert len(lines) == 3
    lines.sort(key=lambda rect: rect.x0)
    assert lines[0].x1 <= lines[1].x0 + 1
    assert lines[1].x1 <= lines[2].x0 + 1
    assert all(rect.x0 >= 0 and rect.x1 <= 595 for rect in lines)
