from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import _story
from vivepdf.ops._story import decode_text, story_pdf_bytes
from vivepdf.ops.convert_to_pdf import FileToPdfParams, file_to_pdf
from vivepdf.rpc.progress import silent_progress

PAGE = pymupdf.paper_rect("a4")


def _picture(path: Path) -> None:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 24, 24), False)
    pixmap.clear_with(180)
    pixmap.save(str(path))


def _pictures_drawn(source: str, folder: Path) -> int:
    html = f'<p>text</p><img src="{source}">'
    data = story_pdf_bytes(html, PAGE, PAGE + (36, 36, -36, -36), archive_dirs=(folder,))
    with pymupdf.open("pdf", data) as document:
        return len(document[0].get_images())


@pytest.fixture
def folders(tmp_path: Path) -> tuple[Path, Path]:
    document = tmp_path / "document"
    document.mkdir()
    _picture(document / "beside.png")
    _picture(tmp_path / "outside.png")
    return document, tmp_path / "outside.png"


def test_a_picture_beside_the_document_is_drawn(folders: tuple[Path, Path]) -> None:
    document, _ = folders

    drawn = _pictures_drawn("beside.png", document)

    assert drawn == 1


def test_a_picture_above_the_document_folder_is_not_reached(folders: tuple[Path, Path]) -> None:
    document, _ = folders

    drawn = _pictures_drawn("../outside.png", document)

    assert drawn == 0


@pytest.mark.parametrize("form", ["absolute", "uri"])
def test_a_picture_named_by_its_full_path_is_not_read(
    folders: tuple[Path, Path], form: str
) -> None:
    document, outside = folders
    source = outside.as_uri() if form == "uri" else outside.as_posix()

    drawn = _pictures_drawn(source, document)

    assert drawn == 0


@pytest.mark.parametrize("system", ["UTF-8", "cp1252"])
def test_turkish_windows_text_reads_as_turkish_on_a_western_system(
    monkeypatch: pytest.MonkeyPatch, system: str
) -> None:
    monkeypatch.setattr(_story.locale, "getpreferredencoding", lambda _do_set: system)
    text = "Başlık: Ağaç, İğne, ışık, Şule"

    assert decode_text(text.encode("cp1254")) == text


def test_western_text_without_turkish_letters_stays_western(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(_story.locale, "getpreferredencoding", lambda _do_set: "UTF-8")
    text = "Café crème, naïve façade"

    assert decode_text(text.encode("cp1252")) == text


def test_a_non_western_system_encoding_still_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_story.locale, "getpreferredencoding", lambda _do_set: "cp1251")
    text = "Привет, мир"

    assert decode_text(text.encode("cp1251")) == text


def _converted(tmp_path: Path, name: str, text: str) -> pymupdf.Document:
    source = tmp_path / name
    source.write_text(text, encoding="utf-8")
    result = file_to_pdf(
        FileToPdfParams(path=str(source), output=str(tmp_path / "belge.pdf")), silent_progress()
    )
    return pymupdf.open(result.output)


def test_markdown_links_work_and_headings_become_bookmarks(tmp_path: Path) -> None:
    document = _converted(
        tmp_path,
        "belge.md",
        "# Giriş\n\nBkz. [site](https://example.com) ve [ekler](#ekler-bölümü).\n\n"
        "## Alt başlık\n\n" + "metin\n\n" * 80 + "# Ekler bölümü\n\nson\n",
    )

    toc = document.get_toc()
    links = document[0].get_links()
    appendix = next(page.number for page in document if page.search_for("Ekler bölümü"))
    assert appendix > 0
    assert [entry[:3] for entry in toc] == [
        [1, "Giriş", 1],
        [2, "Alt başlık", 1],
        [1, "Ekler bölümü", appendix + 1],
    ]
    assert links[0]["uri"] == "https://example.com"
    assert links[1]["page"] == appendix


def test_html_headings_that_skip_levels_and_unsafe_links_are_handled(tmp_path: Path) -> None:
    document = _converted(
        tmp_path,
        "sayfa.html",
        "<h2>Bölüm</h2><h4>Ayrıntı</h4><p>"
        '<a href="javascript:alert(1)">betik</a> <a href="file:///etc/passwd">dosya</a> '
        '<a href="#yok">kayıp</a> <a href="mailto:esma@example.com">posta</a></p>',
    )

    assert [entry[:2] for entry in document.get_toc()] == [[1, "Bölüm"], [2, "Ayrıntı"]]
    assert [link.get("uri") for link in document[0].get_links()] == ["mailto:esma@example.com"]


def test_plain_text_and_other_story_pages_get_no_bookmarks(tmp_path: Path) -> None:
    document = _converted(tmp_path, "not.txt", "# başlık değil\nhttps://example.com\n")
    data = story_pdf_bytes("<h1>Özet</h1>", PAGE, PAGE + (36, 36, -36, -36))

    assert document.get_toc() == []
    with pymupdf.open("pdf", data) as summary:
        assert summary.get_toc() == []
