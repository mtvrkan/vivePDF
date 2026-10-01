from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.links import (
    AutoLinkParams,
    LinksListParams,
    autolink,
    link_targets,
    list_links,
    mail_uri,
    web_uri,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


def _document(tmp_path: Path, lines: list[str], rotation: int = 0) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for index, line in enumerate(lines):
        page.insert_text(
            (72, 100 + index * 16), line, fontsize=12, fontname="dejavu", fontfile=FONT
        )
    page.set_rotation(rotation)
    path = tmp_path / "addresses.pdf"
    document.save(path)
    document.close()
    return path


def _uris(path: Path) -> list[str]:
    with pymupdf.open(path) as document:
        return [link.get("uri") for page in document for link in page.get_links()]


def test_addresses_stop_at_typographic_and_cjk_punctuation():
    assert [text for text, _uri in link_targets("“https://example.com/a”", True, True)] == [
        "https://example.com/a"
    ]
    assert [text for text, _uri in link_targets("https://example.com。次へ", True, True)] == [
        "https://example.com"
    ]
    assert [text for text, _uri in link_targets("«www.example.org»", True, True)] == [
        "www.example.org"
    ]


def test_non_ascii_addresses_are_encoded_for_the_link():
    assert web_uri("https://örnek.com/şehir?q=ı") == (
        "https://xn--rnek-4qa.com/%C5%9Fehir?q=%C4%B1"
    )
    assert web_uri("www.example.com/a%20b") == "https://www.example.com/a%20b"
    assert mail_uri("ayşe@örnek.com.tr") == "mailto:ay%C5%9Fe@xn--rnek-4qa.com.tr"


def test_an_email_with_turkish_letters_is_taken_whole():
    assert link_targets("ayşe.yılmaz@örnek.com.tr,", False, True) == [
        ("ayşe.yılmaz@örnek.com.tr", "mailto:ay%C5%9Fe.y%C4%B1lmaz@xn--rnek-4qa.com.tr")
    ]


def test_a_host_that_cannot_be_encoded_is_skipped():
    assert web_uri("https://" + "a" * 70 + "ö.com") is None


def test_a_wrapped_address_links_both_lines_to_the_whole_address(tmp_path: Path):
    source = _document(
        tmp_path, ["Belge: https://example.com/arsiv/2026/", "rapor-final.pdf adresinde."]
    )
    result = autolink(
        AutoLinkParams(path=str(source), output=str(tmp_path / "out.pdf")), silent_progress()
    )
    assert result.added == 1
    assert _uris(Path(result.output)) == [
        "https://example.com/arsiv/2026/rapor-final.pdf",
        "https://example.com/arsiv/2026/rapor-final.pdf",
    ]


def test_an_ordinary_next_line_is_not_glued_to_an_address(tmp_path: Path):
    source = _document(tmp_path, ["Bkz. https://example.com/", "sonra devam edin"])
    result = autolink(
        AutoLinkParams(path=str(source), output=str(tmp_path / "plain.pdf")), silent_progress()
    )
    assert _uris(Path(result.output)) == ["https://example.com/"]


def test_an_existing_output_is_refused_before_any_work(tmp_path: Path):
    source = _document(tmp_path, ["https://example.com"])
    taken = tmp_path / "taken.pdf"
    taken.write_bytes(b"%PDF-1.4")
    with pytest.raises(OpError) as refused:
        autolink(AutoLinkParams(path=str(source), output=str(taken)), silent_progress())
    assert refused.value.data["exists"] is True


def test_links_on_turned_pages_are_listed_where_they_show(tmp_path: Path):
    source = _document(tmp_path, ["https://example.com"], rotation=90)
    linked = autolink(
        AutoLinkParams(path=str(source), output=str(tmp_path / "turned.pdf")), silent_progress()
    )
    listed = list_links(LinksListParams(path=linked.output), silent_progress()).items
    with pymupdf.open(linked.output) as document:
        page = document[0]
        word = pymupdf.Rect(page.get_text("words")[0][:4]) * page.rotation_matrix
        visible = page.rect
    rect = pymupdf.Rect(listed[0].rect)
    assert visible.contains(rect)
    assert abs(rect.x0 - word.x0) < 3 and abs(rect.y0 - word.y0) < 3
