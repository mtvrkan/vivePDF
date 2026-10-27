from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import _thesis_measure
from vivepdf.ops._thesis_fonts import family_key, family_name
from vivepdf.ops._thesis_measure import PageFacts, TextLine
from vivepdf.ops._thesis_numbers import parse_number, roman_label, roman_value
from vivepdf.ops.thesis_check import ThesisCheckParams, build_thesis_report, check
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
    lines: int = 18,
    top_mm: float = 30,
    header: str | None = None,
    size: tuple[float, float] = (595, 842),
) -> pymupdf.Page:
    width, height = size
    page = document.new_page(width=width, height=height)
    left = left_mm * MM
    y = top_mm * MM + 12
    if header:
        page.insert_text((left, 14 * MM), header, fontname="tiro", fontsize=10)
    if heading:
        text, font, font_size = heading
        page.insert_text((left, y), text, fontname=font, fontsize=font_size)
        y += gap * 1.5
    for _ in range(lines):
        page.insert_text((left, y), SENTENCE, fontname="tiro", fontsize=12)
        y += gap
    if number:
        text_width = pymupdf.get_text_length(number, fontname="tiro", fontsize=12)
        x = number_x if number_x is not None else (width - text_width) / 2
        page.insert_text((x, height - 12 * MM), number, fontname="tiro", fontsize=12)
    return page


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


def _run(document: pymupdf.Document, path: Path, **extra) -> dict:
    report = check(_params(_save(document, path), **extra), silent_progress())
    return {item.id: item for item in report.checks} | {"ready": report.ready}


def _picture(page: pymupdf.Page, rect: pymupdf.Rect) -> None:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 30), False)
    pixmap.clear_with(120)
    page.insert_image(rect, pixmap=pixmap, keep_proportion=False)


def _clip_pictures(document: pymupdf.Document, page: pymupdf.Page, clip: pymupdf.Rect) -> None:
    height = page.rect.height
    box = f"q {clip.x0} {height - clip.y1} {clip.width} {clip.height} re W n ".encode()
    for xref in page.get_contents():
        stream = document.xref_stream(xref)
        if b" Do" in stream:
            document.update_stream(xref, box + stream + b" Q")


def test_thesis_that_follows_the_rules_passes(tmp_path: Path) -> None:
    document = pymupdf.open()
    _page(document, None)
    _page(document, "ii")
    _page(document, "iii")
    _page(document, "1", heading=("1. INTRODUCTION", "tibo", 14))
    _page(document, "2", heading=("2. METHOD", "tibo", 14))
    _page(document, "3")

    by_id = _run(document, tmp_path / "thesis.pdf")

    assert by_id["ready"]
    assert by_id["bodyFont"].found == "Times New Roman" and by_id["bodySize"].found == "12"
    assert by_id["lineSpacing"].status == "pass" and by_id["lineSpacing"].found == "18.0"
    assert by_id["frontRoman"].status == "pass" and by_id["headings"].status == "pass"
    assert by_id["pageNumbers"].status == "pass" and by_id["text"].status == "pass"


def test_rule_breaks_are_listed_with_their_pages_and_details(tmp_path: Path) -> None:
    document = pymupdf.open()
    _page(document, "i")
    _page(document, "1", heading=("1. INTRODUCTION", "tibo", 14))
    _page(document, "2", left_mm=30)
    _page(document, "3", number_x=500)
    _page(document, "5", heading=("2. METHOD", "tibo", 18))
    _page(document, None)
    _page(document, "7", gap=13)

    by_id = _run(document, tmp_path / "broken.pdf", paper="letter")

    assert not by_id["ready"]
    assert by_id["paper"].status == "fail" and by_id["paper"].found == "210×297"
    assert by_id["paper"].details[0].expected == "216×279"
    assert by_id["marginLeft"].pages == [3] and by_id["marginLeft"].found == "30.0"
    assert (by_id["marginLeft"].details[0].expected, by_id["marginLeft"].details[0].found) == (
        "40.0",
        "30.0",
    )
    assert by_id["marginRight"].status == "pass"
    place = by_id["pageNumberPlace"]
    assert place.pages == [4] and (place.details[0].expected, place.details[0].found) == (
        "center",
        "right",
    )
    order = by_id["pageNumberOrder"]
    assert order.pages == [5] and (order.details[0].expected, order.details[0].found) == ("4", "5")
    missing = by_id["pageNumbers"]
    assert missing.pages == [6] and missing.status == "warn" and missing.details[0].expected == "6"
    assert by_id["lineSpacing"].status == "warn" and by_id["lineSpacing"].pages == [7]
    assert by_id["lineSpacing"].details[0].found == "13.0"
    heading = by_id["headings"]
    assert heading.status == "warn" and heading.pages == [5]
    assert heading.details[0].expected == "Times New Roman|14|bold"
    assert heading.details[0].found == "Times New Roman|18|bold"
    assert heading.details[0].text == "2. METHOD"


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


def test_scanned_body_pages_are_reported_and_a_textless_file_is_refused(tmp_path: Path) -> None:
    mixed = pymupdf.open()
    _page(mixed, "1", heading=("1. INTRODUCTION", "tibo", 14))
    _picture(mixed.new_page(width=595, height=842), pymupdf.Rect(0, 0, 595, 842))
    _page(mixed, "3")
    blank = pymupdf.open()
    blank.new_page(width=595, height=842)
    blank_path = _save(blank, tmp_path / "blank.pdf")

    by_id = _run(mixed, tmp_path / "mixed.pdf")

    assert by_id["text"].pages == [2] and by_id["text"].details[0].note == "scanned"
    assert by_id["pageNumbers"].status == "pass"
    with pytest.raises(OpError) as caught:
        check(_params(blank_path), silent_progress())
    assert caught.value.data == {"reason": "noText"}


def test_blank_pages_and_a_scanned_approval_page_are_not_flagged(tmp_path: Path) -> None:
    document = pymupdf.open()
    _page(document, None)
    _picture(document.new_page(width=595, height=842), pymupdf.Rect(0, 0, 595, 842))
    _page(document, "iii")
    _page(document, "1", heading=("1. INTRODUCTION", "tibo", 14))
    document.new_page(width=595, height=842)
    _page(document, "3")

    by_id = _run(document, tmp_path / "blank-pages.pdf")

    assert by_id["ready"]
    assert by_id["text"].status == "pass" and by_id["pageNumbers"].status == "pass"
    assert by_id["pageNumberOrder"].status == "pass"


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


def test_contents_rows_and_bold_table_cells_are_not_headings(tmp_path: Path) -> None:
    document = pymupdf.open()
    contents = document.new_page(width=595, height=842)
    for row, (title, page) in enumerate((("1. INTRODUCTION", "1"), ("2. METHOD", "2"))):
        contents.insert_text((114, 120 + row * 24), title, fontname="tibo", fontsize=12)
        contents.insert_text((510, 123 + row * 24), page, fontname="tibo", fontsize=12)
    contents.insert_text((114, 200), "3. RESULTS .......... 3", fontname="tibo", fontsize=12)
    _page(document, "1", heading=("1. INTRODUCTION", "tibo", 16))
    table = _page(document, "2", heading=("2. METHOD", "tibo", 16), lines=10)
    for column, cell in enumerate(("2019 Year", "Count", "Share")):
        table.insert_text((114 + column * 120, 500), cell, fontname="tibo", fontsize=10)

    by_id = _run(document, tmp_path / "contents.pdf")

    assert by_id["headings"].status == "pass"


def test_page_number_tokens_are_parsed_strictly() -> None:
    assert parse_number("Sayfa 5", 20) == ("arabic", 5, "5")
    assert parse_number("5 / 120", 20) == ("arabic", 5, "5")
    assert parse_number("- 5 -", 20) == ("arabic", 5, "5")
    assert parse_number("(IV)", 20) == ("roman", 4, "IV")
    assert parse_number("2026", 3000) is None
    assert parse_number("45", 20) is None
    assert parse_number("mi", 2000) is None and parse_number("di", 2000) is None
    assert parse_number("Vi", 20) is None and parse_number("iiii", 20) is None
    assert roman_value("xl") == 40 and roman_value("ix") == 9
    assert [roman_label(value) for value in (1, 4, 9, 14, 40, 99)] == [
        "i",
        "iv",
        "ix",
        "xiv",
        "xl",
        "xcix",
    ]


def test_cover_year_is_not_read_as_a_page_number(tmp_path: Path) -> None:
    document = pymupdf.open()
    cover = _page(document, None, lines=4)
    cover.insert_text((280, 842 - 30 * MM), "2026", fontname="tibo", fontsize=14)
    _page(document, "ii")
    _page(document, "1", heading=("1. INTRODUCTION", "tibo", 14))
    _page(document, "2")

    by_id = _run(document, tmp_path / "cover.pdf")

    assert by_id["pageNumberOrder"].status == "pass" and by_id["ready"]


def test_hidden_number_on_the_first_chapter_page_keeps_the_order(tmp_path: Path) -> None:
    document = pymupdf.open()
    _page(document, None)
    _page(document, "ii")
    _page(document, None, heading=("1. INTRODUCTION", "tibo", 14))
    _page(document, "2")
    _page(document, "3")

    by_id = _run(document, tmp_path / "hidden.pdf")

    assert by_id["pageNumberOrder"].status == "pass"
    assert by_id["pageNumbers"].pages == [3] and by_id["pageNumbers"].details[0].expected == "1"


def test_arabic_front_pages_follow_the_front_roman_switch(tmp_path: Path) -> None:
    document = pymupdf.open()
    _page(document, None)
    _page(document, "2")
    _page(document, "3")
    _page(document, "4", heading=("1. INTRODUCTION", "tibo", 14))
    _page(document, "5")
    path = _save(document, tmp_path / "arabic.pdf")

    plain = check(_params(path, frontRoman=False), silent_progress())
    roman = check(_params(path), silent_progress())

    plain_by_id = {item.id: item for item in plain.checks}
    roman_by_id = {item.id: item for item in roman.checks}
    assert plain.ready and plain_by_id["frontRoman"].status == "skip"
    assert plain_by_id["pageNumberOrder"].status == "pass"
    front = roman_by_id["frontRoman"]
    assert front.status == "warn" and front.pages == [2, 3]
    assert (front.details[0].expected, front.details[0].found) == ("roman", "2")
    assert roman_by_id["pageNumberOrder"].status == "pass"


def test_front_pages_without_any_number_ask_for_roman(tmp_path: Path) -> None:
    document = pymupdf.open()
    _page(document, None)
    _page(document, None)
    _page(document, "1", heading=("1. INTRODUCTION", "tibo", 14))
    _page(document, "2")

    by_id = _run(document, tmp_path / "bare.pdf")

    assert by_id["frontRoman"].status == "warn" and by_id["frontRoman"].pages == [2]
    assert by_id["pageNumberOrder"].status == "pass"


def test_clipped_picture_is_measured_by_its_visible_part(tmp_path: Path) -> None:
    clipped = pymupdf.open()
    page = _page(clipped, "1", lines=4)
    _picture(page, pymupdf.Rect(60, 300, 535, 500))
    _clip_pictures(clipped, page, pymupdf.Rect(150, 320, 450, 480))
    loose = pymupdf.open()
    _picture(_page(loose, "1", lines=4), pymupdf.Rect(60, 300, 535, 500))

    clipped_by_id = _run(clipped, tmp_path / "clipped.pdf")
    loose_by_id = _run(loose, tmp_path / "loose.pdf")

    assert clipped_by_id["marginLeft"].status == "pass"
    assert clipped_by_id["marginRight"].status == "pass"
    assert loose_by_id["marginLeft"].pages == [1] and loose_by_id["marginRight"].pages == [1]


def test_running_headers_are_found_by_position(tmp_path: Path) -> None:
    document = pymupdf.open()
    for number, header in enumerate(("Chapter one",) * 3 + ("Chapter two",) * 2, start=1):
        _page(document, str(number), header=f"{header} {number % 2}")
    _page(document, "6", top_mm=12)
    _page(document, "7", header="Results")

    by_id = _run(document, tmp_path / "headers.pdf")

    assert by_id["marginTop"].pages == [6] and float(by_id["marginTop"].details[0].found) < 13


def test_drawings_count_and_white_backgrounds_do_not(tmp_path: Path) -> None:
    drawn = pymupdf.open()
    page = _page(drawn, "1")
    page.draw_rect(pymupdf.Rect(60, 400, 400, 500), color=(0, 0, 0), width=1)
    plain = pymupdf.open()
    plain_page = plain.new_page(width=595, height=842)
    plain_page.draw_rect(plain_page.rect, color=None, fill=(1, 1, 1))
    plain_page.draw_rect(pymupdf.Rect(10, 400, 50, 500), color=None, fill=(1, 1, 1))
    _page(plain, "2")

    drawn_by_id = _run(drawn, tmp_path / "drawn.pdf")
    plain_by_id = _run(plain, tmp_path / "plain.pdf")

    assert drawn_by_id["marginLeft"].pages == [1]
    assert drawn_by_id["marginLeft"].details[0].found == f"{(60 - 0.5) / MM:.1f}"
    assert plain_by_id["marginLeft"].status == "pass"


def test_rotated_and_landscape_pages_use_visible_coordinates(tmp_path: Path) -> None:
    document = pymupdf.open()
    _page(document, "1")
    turned = document.new_page(width=842, height=595)
    turned.set_rotation(90)
    for row in range(18):
        point = pymupdf.Point(40 * MM, 30 * MM + 12 + row * 18) * turned.derotation_matrix
        turned.insert_text(point, SENTENCE, fontname="tiro", fontsize=12, rotate=90)
    corner = pymupdf.Point(290, 842 - 12 * MM) * turned.derotation_matrix
    turned.insert_text(corner, "2", fontname="tiro", fontsize=12, rotate=90)
    _page(document, "3", lines=10, size=(842, 595))
    _page(document, "4", left_mm=15, lines=10, size=(842, 595))

    by_id = _run(document, tmp_path / "turned.pdf")

    assert by_id["pageNumbers"].status == "pass" and by_id["pageNumberOrder"].status == "pass"
    sides = [by_id[f"margin{side}"] for side in ("Top", "Bottom", "Left", "Right")]
    failing = [detail for side in sides for detail in side.details]
    assert {detail.page for detail in failing} == {4} and not by_id["ready"]
    assert all(detail.note == "landscape" for detail in failing)


def test_single_spaced_reference_pages_do_not_warn(tmp_path: Path) -> None:
    def build(title: str | None) -> pymupdf.Document:
        document = pymupdf.open()
        _page(document, "1", heading=("1. INTRODUCTION", "tibo", 14))
        _page(document, "2")
        _page(document, "3")
        references = _page(document, "4", gap=13.8, heading=None)
        if title:
            references.insert_text((250, 60), title, fontname="tibo", fontsize=12)
        return document

    with_title = _run(build("KAYNAKLAR"), tmp_path / "references.pdf")
    english = _run(build("References"), tmp_path / "english.pdf")
    without = _run(build(None), tmp_path / "plain.pdf")

    assert with_title["lineSpacing"].status == "pass"
    assert english["lineSpacing"].status == "pass"
    assert without["lineSpacing"].status == "warn" and without["lineSpacing"].pages == [4]


def test_font_names_map_to_readable_families() -> None:
    assert family_name("ABCDEF+DejaVuSans-Bold") == "DejaVuSans"
    assert family_name("ABCDEF+DejaVu Sans Book") == "DejaVu Sans"
    for name in (
        "TimesNewRomanPS-BoldMT",
        "Times New Roman",
        "ABCDEF+TimesNewRomanPSMT",
        "Times New Roman,BoldItalic",
        "Times-Roman",
        "NimbusRomNo9L-Regu",
        "NimbusRomNo9L-MediItal",
        "TeXGyreTermesX-Regular",
        "TimesNewRomanTur",
        "Times New Roman Tur",
        "LiberationSerif-Bold",
        "Tinos",
    ):
        assert family_name(name) == "Times New Roman", name
    for name in ("Helvetica-Bold", "ArialMT", "LiberationSans", "NimbusSanL-Regu", "Arimo"):
        assert family_name(name) == "Arial", name
    assert family_name("CMR12") == "Computer Modern"
    assert family_name("") == "" and family_name("Unnamed-T3") == ""
    assert family_key("times") == family_key("Times New Roman")
    assert family_key("Calibri-Light") != family_key("Times New Roman")


def test_nameless_body_font_is_reported_as_unknown(tmp_path: Path) -> None:
    lines = [
        TextLine(
            rect=pymupdf.Rect(114, 90 + row * 18, 450, 103 + row * 18),
            text=SENTENCE,
            size=12,
            family="",
            bold=False,
            chars=len(SENTENCE),
            baseline=100 + row * 18,
            horizontal=True,
        )
        for row in range(10)
    ]
    pages = [PageFacts(width=595, height=842, lines=lines)]

    report = build_thesis_report(pages, _params(tmp_path / "unused.pdf"))

    font = {item.id: item for item in report.checks}["bodyFont"]
    assert font.status == "warn" and font.reason == "unknownFont" and font.found is None


def test_unreadable_pages_are_listed_instead_of_failing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    document = pymupdf.open()
    _page(document, "1")
    _page(document, "2")
    _page(document, "3")
    path = _save(document, tmp_path / "broken-page.pdf")
    original = _thesis_measure._read_page

    def flaky(page: pymupdf.Page, page_count: int, frame):
        if page.number == 1:
            raise RuntimeError("broken content stream")
        return original(page, page_count, frame)

    monkeypatch.setattr(_thesis_measure, "_read_page", flaky)

    report = check(_params(path), silent_progress())

    text = {item.id: item for item in report.checks}["text"]
    assert text.pages == [2] and text.details[0].note == "unreadable"
