import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree

import pymupdf

from vivepdf.ops._markup_tables import table_html
from vivepdf.ops.convert import TextSourceParams
from vivepdf.ops.convert_text import to_html
from vivepdf.ops.epub import EpubParams, to_epub
from vivepdf.rpc.progress import silent_progress

SIDECAR = Path(__file__).resolve().parent.parent
FONT = str(SIDECAR / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf")


def _picture(color: tuple[int, int, int], side: int = 40) -> bytes:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, side, side), False)
    pixmap.set_rect(pixmap.irect, color)
    return pixmap.tobytes("png")


def _write(page: pymupdf.Page, point: tuple[float, float], text: str) -> None:
    page.insert_text(point, text, fontname="dejavu", fontfile=FONT)


def _html(document: pymupdf.Document, tmp_path: Path) -> str:
    source = tmp_path / "kaynak.pdf"
    document.save(source)
    document.close()
    result = to_html(
        TextSourceParams(path=str(source), output=str(tmp_path / "çıktı.html")), silent_progress()
    )
    return Path(result.output).read_text(encoding="utf-8")


def _ruled_table(page: pymupdf.Page) -> None:
    rows = (("Ad", "Adet", "Fiyat"), ("Elma", "3", "12,50"), ("Armut", "5", "20,00"))
    for row, values in enumerate(rows):
        for column, value in enumerate(values):
            cell = pymupdf.Rect(
                72 + column * 120, 300 + row * 24, 192 + column * 120, 324 + row * 24
            )
            page.draw_rect(cell, color=(0, 0, 0), width=0.8)
            _write(page, (cell.x0 + 6, cell.y0 + 17), value)


def test_html_leaves_out_a_slide_background_but_keeps_a_full_page_photo(tmp_path: Path) -> None:
    document = pymupdf.open()
    slide = document.new_page(width=720, height=540)
    slide.insert_image(slide.rect, stream=_picture((200, 220, 255)))
    _write(slide, (72, 100), "Slayt başlığı")
    photo = document.new_page(width=720, height=540)
    photo.insert_image(photo.rect, stream=_picture((90, 120, 60)))

    html = _html(document, tmp_path)

    assert "Slayt başlığı" in html
    assert html.count("data:image/png") == 1
    second = html[html.index('data-page="2"') :]
    assert "data:image/png" in second


def test_html_embeds_a_repeated_logo_once(tmp_path: Path) -> None:
    document = pymupdf.open()
    logo = _picture((220, 30, 30))
    for number in range(3):
        page = document.new_page(width=595, height=842)
        page.insert_image(pymupdf.Rect(72, 72, 132, 132), stream=logo)
        _write(page, (72, 200), f"Sayfa {number + 1} metni")

    html = _html(document, tmp_path)

    assert html.count("data:image/png") == 1
    assert html.count('<use href="#picture-1"') == 3
    assert '<symbol id="picture-1"' in html


def test_html_turns_a_ruled_table_into_a_table(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 250), "Fiyat listesi aşağıdadır.")
    _ruled_table(page)

    html = _html(document, tmp_path)

    assert "<p>Fiyat listesi aşağıdadır.</p>" in html
    assert "<tr><th>Ad</th><th>Adet</th><th>Fiyat</th></tr>" in html
    assert "<tr><td>Elma</td><td>3</td><td>12,50</td></tr>" in html
    assert "<p>Elma" not in html
    assert html.index("Fiyat listesi") < html.index("<table>")


def test_html_keeps_a_table_on_a_turned_page_as_text(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _ruled_table(page)
    page.set_rotation(90)

    html = _html(document, tmp_path)

    assert "<table>" not in html
    assert "Elma" in html and "Armut" in html


def test_table_cells_carry_their_row_and_column_spans() -> None:
    rows = [["Bölge", "Satış", None], ["Ege", "1", "2"], [None, "3", "4"]]

    markup = table_html(rows, [(0, 1, 0, 2), (1, 0, 2, 0)])

    assert markup == (
        '<table><tr><th>Bölge</th><th colspan="2">Satış</th></tr>'
        '<tr><td rowspan="2">Ege</td><td>1</td><td>2</td></tr>'
        "<tr><td>3</td><td>4</td></tr></table>"
    )


def test_epub_chapter_with_a_table_is_well_formed(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 250), "Fiyat listesi & notlar")
    _ruled_table(page)
    source = tmp_path / "tablo.pdf"
    document.save(source)
    document.close()

    result = to_epub(
        EpubParams(path=str(source), output=str(tmp_path / "tablo.epub"), language="tr"),
        silent_progress(),
    )

    with zipfile.ZipFile(result.output) as archive:
        chapter = archive.read("OEBPS/text/chapter0001.xhtml").decode("utf-8")
    ElementTree.fromstring(chapter)
    assert re.search(r"<td>Elma</td>", chapter)


def test_html_keeps_a_turned_table_as_text_after_a_markdown_conversion(tmp_path: Path) -> None:
    from pymupdf4llm.helpers import document_layout

    assert document_layout
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _ruled_table(page)
    page.set_rotation(90)

    html = _html(document, tmp_path)

    assert "Elma" in html and "Armut" in html
    assert "data:image/png" not in html


def _upright_turned_table(document: pymupdf.Document, rotation: int) -> None:
    page = document.new_page(width=595, height=842)
    page.set_rotation(rotation)
    turn = page.derotation_matrix
    page.insert_text(
        pymupdf.Point(72, 260) * turn,
        "Fiyat listesi",
        fontname="dejavu",
        fontfile=FONT,
        fontsize=16,
        rotate=rotation,
    )
    rows = (("Ad", "Adet", "Fiyat"), ("Elma", "3", "12,50"), ("Armut", "5", "20,00"))
    for row, values in enumerate(rows):
        for column, value in enumerate(values):
            cell = pymupdf.Rect(
                72 + column * 120, 300 + row * 24, 192 + column * 120, 324 + row * 24
            )
            page.draw_rect(cell * turn, color=(0, 0, 0), width=0.8)
            page.insert_text(
                pymupdf.Point(cell.x0 + 6, cell.y0 + 17) * turn,
                value,
                fontname="dejavu",
                fontfile=FONT,
                rotate=rotation,
            )


def test_html_reads_a_table_on_a_turned_page_whose_text_is_upright(tmp_path: Path) -> None:
    document = pymupdf.open()
    for rotation in (90, 180, 270):
        _upright_turned_table(document, rotation)

    html = _html(document, tmp_path)

    sections = re.findall(r"<section.*?</section>", html, re.S)
    assert len(sections) == 3
    for section in sections:
        assert section.count("<table>") == 1
        assert section.index("Fiyat listesi") < section.index("<table>")
        assert "<tr><th>Ad</th><th>Adet</th><th>Fiyat</th></tr>" in section
        assert "<tr><td>Armut</td><td>5</td><td>20,00</td></tr>" in section
        assert "data:image/png" not in section
