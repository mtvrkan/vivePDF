from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import _story
from vivepdf.ops._story import decode_text, story_pdf_bytes

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
