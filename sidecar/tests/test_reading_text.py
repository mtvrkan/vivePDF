from pathlib import Path

import pymupdf

from vivepdf.ops._reading_text import _block_text, _span_text
from vivepdf.ops.info import PageTextParams, page_text
from vivepdf.rpc.progress import silent_progress


def _slide(path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 80), "Hedefler", fontsize=20)
    page.insert_text((72, 200), "Operating systems and", fontsize=12, fontname="tiro")
    page.insert_text((72, 216), "what they do.", fontsize=12, fontname="tiro")
    document.save(path)
    document.close()
    return path


def test_blocks_are_separated_by_a_blank_line_and_lines_inside_a_block_are_kept(
    tmp_path: Path,
) -> None:
    source = _slide(tmp_path / "slide.pdf")

    result = page_text(PageTextParams(path=str(source)), silent_progress())

    assert result.pages[0].text == "Hedefler\n\nOperating systems and\nwhat they do."


def test_a_dingbat_bullet_in_the_private_use_area_reads_as_a_bullet() -> None:
    span = {"font": "Wingdings-Regular", "text": "\uf0a7Bu bölümde,"}

    assert _span_text(span) == "•Bu bölümde,"


def test_a_symbol_font_letter_reads_as_its_greek_letter_and_its_bullet_as_a_bullet() -> None:
    assert _span_text({"font": "Symbol", "text": "\uf061 + \uf062"}) == "α + β"
    assert _span_text({"font": "SymbolMT", "text": "\uf0b7 madde"}) == "• madde"


def test_ordinary_text_passes_through_and_blank_lines_are_dropped() -> None:
    block = {
        "lines": [
            {
                "spans": [
                    {"font": "Arial", "text": "İşletim "},
                    {"font": "Arial", "text": "Sistemleri"},
                ]
            },
            {"spans": [{"font": "Arial", "text": "   "}]},
            {"spans": [{"font": "Arial", "text": "Hafta 1"}]},
        ]
    }

    assert _block_text(block) == "İşletim Sistemleri\nHafta 1"


def test_a_page_without_text_reads_as_empty(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page()
    document.save(tmp_path / "blank.pdf")
    document.close()

    result = page_text(PageTextParams(path=str(tmp_path / "blank.pdf")), silent_progress())

    assert result.pages[0].text == ""
