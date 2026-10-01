import zipfile
from pathlib import Path
from xml.etree import ElementTree

import pymupdf
import pytest

from vivepdf.ops.epub import EpubParams, chapter_title, plan_chapters, to_epub
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def book(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for index in range(6):
        page = document.new_page()
        page.insert_text((72, 100), f"Bölüm {index + 1}", fontsize=20)
        page.insert_text((72, 140), f"Bu {index + 1}. sayfanın gövde metnidir.", fontsize=11)
    document.set_toc([[1, "Giriş", 1], [1, "Gelişme", 3], [1, "Sonuç", 5]])
    path = tmp_path / "kitap.pdf"
    document.save(path)
    document.close()
    return path


def read_epub(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as archive:
        assert archive.namelist()[0] == "mimetype"
        assert archive.getinfo("mimetype").compress_type == zipfile.ZIP_STORED
        return {name: archive.read(name) for name in archive.namelist()}


def test_to_epub_uses_the_bookmarks_as_chapters(book: Path, tmp_path: Path) -> None:
    result = to_epub(
        EpubParams(path=str(book), output=str(tmp_path / "kitap.epub"), language="tr"),
        silent_progress(),
    )
    assert result.chapters == 3
    assert result.page_count == 6
    files = read_epub(Path(result.output))
    assert files["mimetype"] == b"application/epub+zip"
    assert "OEBPS/content.opf" in files
    assert "OEBPS/text/chapter0001.xhtml" in files
    nav = files["OEBPS/nav.xhtml"].decode("utf-8")
    assert "Giriş" in nav and "Gelişme" in nav and "Sonuç" in nav
    package = ElementTree.fromstring(files["OEBPS/content.opf"])
    spine = package.find("{http://www.idpf.org/2007/opf}spine")
    assert spine is not None and len(spine) == 3
    chapter = files["OEBPS/text/chapter0001.xhtml"].decode("utf-8")
    ElementTree.fromstring(chapter.split("<!DOCTYPE html>\n", 1)[1])
    assert 'xml:lang="tr"' in chapter


def test_to_epub_falls_back_to_page_chunks_without_bookmarks(book: Path, tmp_path: Path) -> None:
    with pymupdf.open(book) as document:
        document.set_toc([])
        plain = book.with_name("duz.pdf")
        document.save(plain)
    result = to_epub(
        EpubParams(path=str(plain), output=str(tmp_path / "duz.epub")), silent_progress()
    )
    assert result.chapters == 1
    assert result.page_count == 6


def test_to_epub_can_split_every_page(book: Path, tmp_path: Path) -> None:
    result = to_epub(
        EpubParams(path=str(book), output=str(tmp_path / "sayfalar.epub"), split="page"),
        silent_progress(),
    )
    assert result.chapters == 6
    files = read_epub(Path(result.output))
    assert "OEBPS/text/chapter0006.xhtml" in files


def test_chapter_split_without_bookmarks_is_rejected(book: Path, tmp_path: Path) -> None:
    with pymupdf.open(book) as document:
        document.set_toc([])
        plain = book.with_name("bos.pdf")
        document.save(plain)
    with pytest.raises(OpError) as caught:
        to_epub(
            EpubParams(path=str(plain), output=str(tmp_path / "x.epub"), split="chapter"),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "noBookmarks"}


def test_pictures_are_written_once_and_can_be_left_out(tmp_path: Path) -> None:
    document = pymupdf.open()
    picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 40))
    picture.set_rect(picture.irect, (30, 90, 160))
    stream = picture.tobytes("png")
    for _ in range(3):
        page = document.new_page()
        page.insert_text((72, 90), "Görselli sayfa", fontsize=14)
        page.insert_image(pymupdf.Rect(72, 120, 252, 240), stream=stream)
    source = tmp_path / "gorsel.pdf"
    document.save(source)
    document.close()

    with_images = to_epub(
        EpubParams(path=str(source), output=str(tmp_path / "a.epub")), silent_progress()
    )
    assert with_images.images == 1

    without = to_epub(
        EpubParams(path=str(source), output=str(tmp_path / "b.epub"), include_images=False),
        silent_progress(),
    )
    assert without.images == 0
    files = read_epub(Path(without.output))
    assert not any(name.startswith("OEBPS/images/") for name in files)


def test_to_epub_refuses_to_overwrite_without_permission(book: Path, tmp_path: Path) -> None:
    target = tmp_path / "var.epub"
    target.write_bytes(b"x")
    with pytest.raises(OpError) as caught:
        to_epub(EpubParams(path=str(book), output=str(target)), silent_progress())
    assert caught.value.data is not None and caught.value.data["exists"] is True
    to_epub(EpubParams(path=str(book), output=str(target), overwrite=True), silent_progress())
    assert target.stat().st_size > 100


def test_chapter_title_prefers_a_heading_then_the_page_range() -> None:
    assert chapter_title("<h1>Başlık <b>iki</b></h1><p>x</p>", 0, 3) == "Başlık iki"
    assert chapter_title("<p>düz metin</p>", 0, 3) == "1–4"
    assert chapter_title("<p>düz metin</p>", 2, 2) == "3"


def test_plan_chapters_keeps_only_the_requested_pages(book: Path) -> None:
    with pymupdf.open(book) as document:
        planned = plan_chapters(document, [2, 3], "auto")
    assert [block for _title, block in planned] == [[2, 3]]
    assert planned[0][0] == "Gelişme"
