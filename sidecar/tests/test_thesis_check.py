from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._thesis_measure import family_name
from vivepdf.ops.thesis_check import ThesisCheckParams, check
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

MM = 72 / 25.4
SENTENCE = "The quick brown fox jumps over the lazy dog near the river bank."


def _page(
    document: pymupdf.Document,
    number: str | None,
    left_mm: float = 40,
    gap: float = 18,
    number_x: float | None = None,
    heading: tuple[str, str, float] | None = None,
) -> None:
    page = document.new_page(width=595, height=842)
    left = left_mm * MM
    y = 30 * MM + 12
    if heading:
        text, font, size = heading
        page.insert_text((left, y), text, fontname=font, fontsize=size)
        y += gap * 1.5
    for _ in range(18):
        page.insert_text((left, y), SENTENCE, fontname="tiro", fontsize=12)
        y += gap
    if number:
        width = pymupdf.get_text_length(number, fontname="tiro", fontsize=12)
        x = number_x if number_x is not None else (595 - width) / 2
        page.insert_text((x, 842 - 12 * MM), number, fontname="tiro", fontsize=12)


def _params(path: Path, **extra) -> ThesisCheckParams:
    return ThesisCheckParams.model_validate(
        {
            "path": str(path),
            "marginsMm": {"top": 25, "bottom": 25, "left": 40, "right": 25},
            "fontFamily": "Times New Roman",
            "fontSize": 12,
            "lineHeight": 1.5,
            **extra,
        }
    )


def _save(document: pymupdf.Document, path: Path) -> Path:
    document.save(path)
    document.close()
    return path


def test_thesis_that_follows_the_rules_passes(tmp_path: Path) -> None:
    document = pymupdf.open()
    _page(document, None)
    _page(document, "ii")
    _page(document, "iii")
    _page(document, "1", heading=("1. INTRODUCTION", "tibo", 14))
    _page(document, "2", heading=("2. METHOD", "tibo", 14))
    _page(document, "3")
    path = _save(document, tmp_path / "thesis.pdf")

    report = check(_params(path), silent_progress())

    by_id = {item.id: item for item in report.checks}
    assert report.ready, [item for item in report.checks if item.status != "pass"]
    assert report.page_count == 6 and report.text_pages == 6
    assert by_id["bodyFont"].found == "Times New Roman" and by_id["bodySize"].found == "12"
    assert by_id["lineSpacing"].status == "pass" and by_id["lineSpacing"].found == "18.0"
    assert by_id["frontRoman"].status == "pass" and by_id["headings"].status == "pass"


def test_rule_breaks_are_listed_with_their_pages(tmp_path: Path) -> None:
    document = pymupdf.open()
    _page(document, "i")
    _page(document, "1", heading=("1. INTRODUCTION", "tibo", 14))
    _page(document, "2", left_mm=30)
    _page(document, "3", number_x=500)
    _page(document, "7", heading=("2. METHOD", "tibo", 18))
    _page(document, None)
    _page(document, "9", gap=13)
    path = _save(document, tmp_path / "broken.pdf")

    report = check(_params(path, paper="letter"), silent_progress())

    by_id = {item.id: item for item in report.checks}
    assert not report.ready
    assert by_id["paper"].status == "fail" and by_id["paper"].found == "210×297"
    assert by_id["marginLeft"].pages == [3] and by_id["marginLeft"].found == "30.0"
    assert by_id["marginRight"].status == "pass"
    assert by_id["pageNumberPlace"].pages == [4]
    assert by_id["pageNumberOrder"].pages == [5]
    assert by_id["pageNumbers"].pages == [6] and by_id["pageNumbers"].status == "warn"
    assert by_id["lineSpacing"].status == "warn" and by_id["lineSpacing"].pages == [7]
    assert by_id["headings"].status == "warn" and by_id["headings"].pages == [5]


def test_mirrored_margins_swap_on_even_pages(tmp_path: Path) -> None:
    document = pymupdf.open()
    _page(document, "1")
    _page(document, "2", left_mm=25)
    path = _save(document, tmp_path / "mirrored.pdf")
    wide_right = {"top": 25, "bottom": 25, "left": 40, "right": 25}

    straight = check(_params(path, marginsMm=wide_right), silent_progress())
    mirrored = check(_params(path, marginsMm=wide_right, mirrored=True), silent_progress())

    assert {item.id: item for item in straight.checks}["marginLeft"].pages == [2]
    assert {item.id: item for item in mirrored.checks}["marginLeft"].status == "pass"


def test_scanned_pages_are_reported_and_a_textless_file_is_refused(tmp_path: Path) -> None:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), False)
    picture = tmp_path / "scan.png"
    pixmap.save(picture)
    mixed = pymupdf.open()
    _page(mixed, "1")
    mixed.new_page(width=595, height=842).insert_image(
        pymupdf.Rect(120, 120, 400, 400), filename=str(picture)
    )
    mixed_path = _save(mixed, tmp_path / "mixed.pdf")
    blank = pymupdf.open()
    blank.new_page(width=595, height=842)
    blank_path = _save(blank, tmp_path / "blank.pdf")

    report = check(_params(mixed_path), silent_progress())

    assert {item.id: item for item in report.checks}["text"].pages == [2]
    with pytest.raises(OpError) as caught:
        check(_params(blank_path), silent_progress())
    assert caught.value.data == {"reason": "noText"}


def test_rules_out_of_range_are_rejected() -> None:
    with pytest.raises(ValueError):
        ThesisCheckParams.model_validate(
            {
                "path": "/tmp/x.pdf",
                "marginsMm": {"top": -1, "bottom": 25, "left": 40, "right": 25},
                "fontSize": 12,
                "lineHeight": 1.5,
            }
        )


def test_contents_rows_are_not_headings_and_font_styles_share_a_family(tmp_path: Path) -> None:
    document = pymupdf.open()
    contents = document.new_page(width=595, height=842)
    for row, (title, page) in enumerate((("1. INTRODUCTION", "1"), ("2. METHOD", "2"))):
        contents.insert_text((114, 120 + row * 24), title, fontname="tibo", fontsize=12)
        contents.insert_text((510, 123 + row * 24), page, fontname="tibo", fontsize=12)
    contents.insert_text((114, 200), "3. RESULTS .......... 3", fontname="tibo", fontsize=12)
    _page(document, "1", heading=("1. INTRODUCTION", "tibo", 16))
    _page(document, "2", heading=("2. METHOD", "tibo", 16))
    path = _save(document, tmp_path / "contents.pdf")

    report = check(_params(path), silent_progress())

    by_id = {item.id: item for item in report.checks}
    assert by_id["headings"].status == "pass"
    assert family_name("ABCDEF+DejaVuSans-Bold") == "DejaVuSans"
    assert family_name("ABCDEF+DejaVu Sans Book") == "DejaVu Sans"
    assert family_name("TimesNewRomanPS-BoldMT") == "Times New Roman"
    assert family_name("Times New Roman") == "Times New Roman"
