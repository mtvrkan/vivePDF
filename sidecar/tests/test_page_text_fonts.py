from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.fonts import font_name_for, resolve_choice
from vivepdf.ops.header_footer import HeaderFooterParams, header_footer
from vivepdf.ops.page_numbers import PageNumberParams, number_pages
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def blank(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for _ in range(2):
        document.new_page(width=595, height=842)
    path = tmp_path / "blank.pdf"
    document.save(path)
    document.close()
    return path


def _embedded_fonts(path: Path) -> set[str]:
    reader = pymupdf.open(path)
    names = {entry[4] for index in range(reader.page_count) for entry in reader[index].get_fonts()}
    reader.close()
    return names


def test_page_numbers_use_the_chosen_font(blank: Path, tmp_path: Path) -> None:
    target = tmp_path / "numbered.pdf"
    number_pages(
        PageNumberParams(
            path=str(blank), output=str(target), fontId="bundled:dejavu-sans", fontSize=14
        ),
        silent_progress(),
    )
    alias = font_name_for(resolve_choice("bundled:dejavu-sans", False))
    assert alias in _embedded_fonts(target)
    reader = pymupdf.open(target)
    assert reader[1].search_for("2")
    reader.close()


def test_page_numbers_fall_back_when_the_font_is_unknown(blank: Path, tmp_path: Path) -> None:
    target = tmp_path / "fallback.pdf"
    number_pages(
        PageNumberParams(path=str(blank), output=str(target), fontId="system:does-not-exist"),
        silent_progress(),
    )
    reader = pymupdf.open(target)
    assert reader[0].search_for("1")
    reader.close()


def test_header_footer_takes_a_font_and_bold(blank: Path, tmp_path: Path) -> None:
    target = tmp_path / "header.pdf"
    header_footer(
        HeaderFooterParams(
            path=str(blank),
            output=str(target),
            headerLeft="VIVEPDF",
            bold=True,
            fontId="bundled:dejavu-sans",
        ),
        silent_progress(),
    )
    alias = font_name_for(resolve_choice("bundled:dejavu-sans", True))
    assert alias in _embedded_fonts(target)
    reader = pymupdf.open(target)
    assert reader[0].search_for("VIVEPDF")
    reader.close()
