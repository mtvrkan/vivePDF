from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops import clipboard
from vivepdf.ops._clipboard import ClipboardContent, clipboard_kind, html_fragment
from vivepdf.ops.clipboard import ClipboardParams, clipboard_to_pdf
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

WINDOWS_HTML = (
    b"Version:0.9\r\nStartHTML:0000000105\r\nEndHTML:0000000201\r\n"
    b"StartFragment:0000000141\r\nEndFragment:0000000165\r\n"
    b"<html><body>\r\n<!--StartFragment--><b>Merhaba d\xc3\xbcnya</b><!--EndFragment-->\r\n"
    b"</body></html>"
)


def _paste(monkeypatch: pytest.MonkeyPatch, content: ClipboardContent) -> None:
    monkeypatch.setattr(clipboard, "read_clipboard", lambda: content)


def _params(tmp_path: Path) -> ClipboardParams:
    return ClipboardParams(output=str(tmp_path / "Clipboard.pdf"))


def test_windows_html_format_yields_only_the_copied_fragment():
    fragment = html_fragment(WINDOWS_HTML)

    assert "Merhaba dünya" in fragment
    assert "StartHTML" not in fragment


def test_kind_prefers_files_then_readable_html_then_pictures_then_text():
    picture = Image.new("RGB", (4, 4))

    assert clipboard_kind(ClipboardContent(files=["a.docx"], text="x")) == "files"
    assert clipboard_kind(ClipboardContent(html="<p>Tablo</p>", image=picture)) == "html"
    assert clipboard_kind(ClipboardContent(html='<img src="x.png">', image=picture)) == "image"
    assert clipboard_kind(ClipboardContent(text="  plain ")) == "text"
    assert clipboard_kind(ClipboardContent(text="   ")) is None


def test_a_screenshot_becomes_a_page_of_its_own_size(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _paste(monkeypatch, ClipboardContent(image=Image.new("RGB", (800, 400), (10, 120, 200))))

    result = clipboard_to_pdf(_params(tmp_path), silent_progress())

    assert result.kind == "image" and result.page_count == 1
    with pymupdf.open(result.output) as document:
        assert document[0].rect.width / document[0].rect.height == pytest.approx(2, rel=0.01)


def test_copied_text_keeps_its_paragraphs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _paste(monkeypatch, ClipboardContent(text="Birinci satır\nikinci satır\r\n\r\nYeni paragraf"))

    result = clipboard_to_pdf(_params(tmp_path), silent_progress())

    with pymupdf.open(result.output) as document:
        lines = [line.strip() for line in document[0].get_text().splitlines() if line.strip()]
    assert lines == ["Birinci satır", "ikinci satır", "Yeni paragraf"]


def test_rich_text_is_laid_out_without_scripts_or_web_pictures(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    html = (
        "<html><head><style>p{}</style></head><body><h2>Rapor</h2><script>x()</script>"
        '<table><tr><td>Ay</td><td>Gelir</td></tr></table><img src="https://e.example/a.png">'
        "</body></html>"
    )
    _paste(monkeypatch, ClipboardContent(html=html, text="Rapor"))

    result = clipboard_to_pdf(_params(tmp_path), silent_progress())

    assert result.kind == "html"
    with pymupdf.open(result.output) as document:
        text = document[0].get_text()
        assert "Rapor" in text and "Gelir" in text and "x()" not in text


def test_copied_files_are_handed_back_to_be_opened(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _paste(monkeypatch, ClipboardContent(files=["C:/docs/a.docx", "C:/docs/b.pdf"]))

    result = clipboard_to_pdf(_params(tmp_path), silent_progress())

    assert (result.kind, result.files, result.output) == (
        "files",
        ["C:/docs/a.docx", "C:/docs/b.pdf"],
        None,
    )


def test_an_empty_clipboard_is_reported(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _paste(monkeypatch, ClipboardContent())

    with pytest.raises(OpError) as error:
        clipboard_to_pdf(_params(tmp_path), silent_progress())

    assert error.value.data["reason"] == "clipboardEmpty"
    assert not (tmp_path / "Clipboard.pdf").exists()
