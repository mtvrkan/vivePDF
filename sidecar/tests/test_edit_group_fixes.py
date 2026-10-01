from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._bookmark_model import BookmarksGenerateParams
from vivepdf.ops.bookmarks import generate_bookmarks
from vivepdf.ops.forms import FillParams, ResetParams, fill_fields, reset_fields
from vivepdf.ops.header_footer import HeaderFooterParams, header_footer
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture
def form_document(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for index, name in enumerate(["adsoyad", "eposta"]):
        widget = pymupdf.Widget()
        widget.field_name = name
        widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
        widget.rect = pymupdf.Rect(200, 140 + index * 50, 450, 175 + index * 50)
        widget.field_value = ""
        page.add_widget(widget)
    path = tmp_path / "form.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def headed_document(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for index in range(3):
        page = document.new_page(width=595, height=842)
        page.insert_text((60, 90), f"{index + 1}.", fontsize=22, fontname="dejavu", fontfile=FONT)
        page.insert_text((90, 90), "Bolum", fontsize=22, fontname="dejavu", fontfile=FONT)
        page.insert_text((60, 118), "Basligi", fontsize=22, fontname="dejavu", fontfile=FONT)
        page.insert_text(
            (60, 170), "Govde metni burada.", fontsize=10, fontname="dejavu", fontfile=FONT
        )
    path = tmp_path / "headed.pdf"
    document.save(path)
    document.close()
    return path


def _page_text(path: Path, index: int = 0) -> str:
    document = pymupdf.open(path)
    text = document[index].get_text()
    document.close()
    return text


def test_resetting_a_form_clears_what_the_page_shows_not_only_the_stored_value(
    form_document: Path, tmp_path: Path
):
    filled = tmp_path / "filled.pdf"
    fill_fields(
        FillParams(
            path=str(form_document),
            output=str(filled),
            values={"adsoyad": "Ayse Yilmaz", "eposta": "ayse@ornek.com"},
        ),
        silent_progress(),
    )
    assert "Ayse Yilmaz" in _page_text(filled)

    cleared = tmp_path / "cleared.pdf"
    reset_fields(ResetParams(path=str(filled), output=str(cleared)), silent_progress())

    document = pymupdf.open(cleared)
    values = [widget.field_value for widget in document[0].widgets()]
    document.close()
    assert values == ["", ""]
    assert "Ayse Yilmaz" not in _page_text(cleared)
    assert "ayse@ornek.com" not in _page_text(cleared)


def test_header_and_footer_fill_in_the_date_and_time_placeholders(
    headed_document: Path, tmp_path: Path
):
    target = tmp_path / "stamped.pdf"
    header_footer(
        HeaderFooterParams(
            path=str(headed_document),
            output=str(target),
            footer_left="{date}",
            footer_right="{time}",
            header_center="{n}/{total}",
        ),
        silent_progress(),
    )
    text = _page_text(target)
    assert "{date}" not in text
    assert "{time}" not in text
    assert "1/3" in text


def test_a_heading_split_over_two_lines_becomes_one_bookmark(headed_document: Path, tmp_path: Path):
    target = tmp_path / "outlined.pdf"
    generate_bookmarks(
        BookmarksGenerateParams(path=str(headed_document), output=str(target)), silent_progress()
    )
    document = pymupdf.open(target)
    titles = [title for _level, title, _page in document.get_toc()]
    document.close()
    assert titles == ["1. Bolum Basligi", "2. Bolum Basligi", "3. Bolum Basligi"]


def test_body_text_does_not_become_a_bookmark(headed_document: Path, tmp_path: Path):
    target = tmp_path / "outlined2.pdf"
    generate_bookmarks(
        BookmarksGenerateParams(path=str(headed_document), output=str(target)), silent_progress()
    )
    document = pymupdf.open(target)
    titles = [title for _level, title, _page in document.get_toc()]
    document.close()
    assert all("Govde" not in title for title in titles)
