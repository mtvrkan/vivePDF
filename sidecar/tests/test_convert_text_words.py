import re
import zipfile
from pathlib import Path

import pymupdf

from vivepdf.ops._words import Vocabulary, join_plain_lines, plain_letters
from vivepdf.ops.convert import TextSourceParams
from vivepdf.ops.convert_text import MarkdownParams, TextParams, to_html, to_markdown, to_text
from vivepdf.ops.epub import EpubParams, to_epub
from vivepdf.rpc.progress import silent_progress

SIDECAR = Path(__file__).resolve().parent.parent
FONT = str(SIDECAR / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf")
LINES = (
    "Karar kurul tarafından verildi ve",
    "duyuru bu kurul tarafın-",
    "dan sonra yapıldı. Yeni",
    "siber-",
    "fiziksel sistemler geldi.",
)


def _hyphenated(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for number, line in enumerate(LINES):
        page.insert_text((72, 100 + number * 15), line, fontname="dejavu", fontfile=FONT)
    path = tmp_path / "tire.pdf"
    document.save(path)
    document.close()
    return path


def test_only_compatibility_letters_are_simplified() -> None:
    assert plain_letters("ﬁyat ﬂama ＡＢ１ 𝐱𝑦") == "fiyat flama AB1 xy"
    assert plain_letters("… x² 5µm 10Ω ½ ™") == "… x² 5µm 10Ω ½ ™"


def test_a_line_end_hyphen_joins_only_words_the_document_knows() -> None:
    vocabulary = Vocabulary(["tarafından Ortodoksluk"])
    assert vocabulary.joins("tarafın", "-", "dan")
    assert vocabulary.joins("Or", "-", "todoks")
    assert not vocabulary.joins("siber", "-", "fiziksel")
    assert not vocabulary.joins("Ankara", "-", "İzmir")
    assert vocabulary.joins("bilin", "­", "mez")


def test_plain_text_moves_the_word_fragment_up_a_line() -> None:
    vocabulary = Vocabulary(["tarafından"])
    text = "bu kurul tarafın-\ndan, sonra\nsiber-\nfiziksel\nson tarafın-\ndan"
    assert join_plain_lines(text, vocabulary) == (
        "bu kurul tarafından,\nsonra\nsiber-fiziksel\nson tarafından"
    )


def test_text_output_joins_split_words_and_keeps_real_hyphens(tmp_path: Path) -> None:
    result = to_text(
        TextParams(path=str(_hyphenated(tmp_path)), output=str(tmp_path / "tire.txt")),
        silent_progress(),
    )
    text = Path(result.output).read_text(encoding="utf-8")
    assert "duyuru bu kurul tarafından\nsonra yapıldı." in text
    assert "siber-fiziksel\nsistemler" in text


def test_html_joins_split_words_and_finds_the_turkish_language(tmp_path: Path) -> None:
    result = to_html(
        TextSourceParams(path=str(_hyphenated(tmp_path)), output=str(tmp_path / "tire.html")),
        silent_progress(),
    )
    html = Path(result.output).read_text(encoding="utf-8")
    assert html.startswith('<!doctype html><html lang="tr">')
    assert "kurul tarafından sonra" in html
    assert "siber-fiziksel sistemler" in html
    assert "﷐" not in html


def test_markdown_keeps_real_hyphens_and_drops_picture_text_marks(tmp_path: Path) -> None:
    result = to_markdown(
        MarkdownParams(path=str(_hyphenated(tmp_path)), output=str(tmp_path / "tire.md")),
        silent_progress(),
    )
    markdown = Path(result.output).read_text(encoding="utf-8")
    assert "kurul tarafından sonra" in markdown
    assert "siber-fiziksel sistemler" in markdown
    assert "﷐" not in markdown


def test_markdown_drops_picture_text_comments_and_extra_blank_lines(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.draw_rect(pymupdf.Rect(72, 72, 400, 300), color=(0, 0, 0), fill=(0.8, 0.9, 1))
    for row in range(6):
        page.draw_rect(
            pymupdf.Rect(90, 90 + row * 30, 140 + row * 40, 110 + row * 30), fill=(0.2, 0.4, 0.8)
        )
    page.insert_text((300, 200), "Grafik", fontname="dejavu", fontfile=FONT)
    page.insert_text((72, 400), "Birinci paragraf.", fontname="dejavu", fontfile=FONT)
    page.insert_text((72, 600), "İkinci paragraf.", fontname="dejavu", fontfile=FONT)
    source = tmp_path / "resim.pdf"
    document.save(source)
    document.close()
    result = to_markdown(
        MarkdownParams(path=str(source), output=str(tmp_path / "resim.md")), silent_progress()
    )
    markdown = Path(result.output).read_text(encoding="utf-8")
    assert "Birinci paragraf." in markdown and "İkinci paragraf." in markdown
    assert "picture text" not in markdown
    assert not re.search(r"\n[ \t]*\n[ \t]*\n", markdown)


def test_epub_takes_the_language_of_turkish_text_over_the_app_language(tmp_path: Path) -> None:
    result = to_epub(
        EpubParams(
            path=str(_hyphenated(tmp_path)), output=str(tmp_path / "tire.epub"), language="en"
        ),
        silent_progress(),
    )
    with zipfile.ZipFile(result.output) as archive:
        package = archive.read("OEBPS/content.opf").decode("utf-8")
        chapter = archive.read("OEBPS/text/chapter0001.xhtml").decode("utf-8")
    assert "<dc:language>tr</dc:language>" in package
    assert "kurul tarafından sonra" in chapter
