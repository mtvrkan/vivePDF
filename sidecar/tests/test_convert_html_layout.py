import base64
import io
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree

import pymupdf
from PIL import Image

from vivepdf.ops._markup import _image_block
from vivepdf.ops.convert import TextSourceParams
from vivepdf.ops.convert_text import to_html
from vivepdf.ops.epub import EpubParams, to_epub
from vivepdf.rpc.progress import silent_progress

SIDECAR = Path(__file__).resolve().parent.parent
FONT = str(SIDECAR / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf")
PICTURE = re.compile(r'src="data:image/png;base64,([^"]+)"')


def _write(page: pymupdf.Page, point: tuple[float, float], text: str, size: float = 12) -> None:
    page.insert_text(point, text, fontsize=size, fontname="dejavu", fontfile=FONT)


def _html(document: pymupdf.Document, tmp_path: Path) -> str:
    source = tmp_path / "kaynak.pdf"
    document.save(source)
    document.close()
    result = to_html(
        TextSourceParams(path=str(source), output=str(tmp_path / "sonuç.html")), silent_progress()
    )
    return Path(result.output).read_text(encoding="utf-8")


def _pictures(html: str) -> list[pymupdf.Pixmap]:
    return [pymupdf.Pixmap(base64.b64decode(data)) for data in PICTURE.findall(html)]


def _jpeg_with_mask() -> tuple[bytes, bytes]:
    colour = io.BytesIO()
    Image.new("RGB", (40, 40), (200, 30, 30)).save(colour, format="JPEG")
    mask = Image.new("L", (40, 40), 0)
    mask.paste(255, (10, 10, 30, 30))
    alpha = io.BytesIO()
    mask.save(alpha, format="PNG")
    return colour.getvalue(), alpha.getvalue()


def test_html_keeps_the_transparency_of_a_masked_jpeg(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=400, height=400)
    colour, mask = _jpeg_with_mask()
    page.insert_image(pymupdf.Rect(100, 100, 300, 300), stream=colour, mask=mask)

    html = _html(document, tmp_path)

    (picture,) = _pictures(html)
    assert picture.alpha
    assert picture.pixel(0, 0)[3] == 0
    assert picture.pixel(picture.width // 2, picture.height // 2)[3] == 255


def test_html_shows_only_the_part_of_a_picture_inside_the_crop_box(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=400, height=400)
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 100, 100), 0)
    pixmap.clear_with(90)
    page.insert_image(pymupdf.Rect(0, 100, 200, 300), pixmap=pixmap)
    page.set_cropbox(pymupdf.Rect(100, 0, 400, 400))

    html = _html(document, tmp_path)

    (picture,) = _pictures(html)
    assert picture.width == 50 and picture.height == 100
    assert 'width="100" height="200"' in html


def test_html_draws_a_chart_but_keeps_a_ruled_table_as_text(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 80), "Grafik başlığı")
    for number, height in enumerate((60, 120, 90, 150)):
        left = 100 + number * 60
        page.draw_rect(pymupdf.Rect(left, 300 - height, left + 40, 300), fill=(0.2, 0.4, 0.8))
    page.draw_line((90, 300), (350, 300))
    for row in range(4):
        page.draw_line((72, 400 + row * 30), (472, 400 + row * 30))
    for column in range(3):
        page.draw_line((72 + column * 200, 400), (72 + column * 200, 490))
    for row, (name, count) in enumerate((("Kalem", "3"), ("Defter", "5"), ("Silgi", "2"))):
        _write(page, (80, 420 + row * 30), name)
        _write(page, (280, 420 + row * 30), count)

    html = _html(document, tmp_path)

    assert len(_pictures(html)) == 1
    assert "Defter" in html and "Silgi" in html
    assert html.index("Grafik başlığı") < html.index("<img") < html.index("Kalem")


def test_html_keeps_links_on_a_cropped_turned_page(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    _write(page, (60, 80), "Bakınız site adresi burada")
    _write(page, (60, 110), "posta yazın")
    page.insert_link(
        {
            "kind": pymupdf.LINK_URI,
            "from": page.search_for("site adresi")[0],
            "uri": "https://x.org/a b",
        }
    )
    page.insert_link(
        {"kind": pymupdf.LINK_URI, "from": page.search_for("posta")[0], "uri": "mailto:a@x.org"}
    )
    page.insert_link(
        {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(60, 98, 160, 114), "uri": "javascript:x()"}
    )
    page.set_cropbox(pymupdf.Rect(40, 20, 380, 290))
    page.set_rotation(90)

    html = _html(document, tmp_path)

    assert '<a href="https://x.org/a%20b">site adresi</a>' in html
    assert '<a href="mailto:a@x.org">posta</a>' in html
    assert "javascript" not in html


def test_html_turns_bullets_into_a_list_and_splits_numbered_lines(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for row, line in enumerate(
        ("Giriş paragrafı", "• Birinci madde", "devamı burada", "-", "İkinci madde")
    ):
        _write(page, (72, 100 + row * 15), line)
    for row, line in enumerate(("1. Adım bir", "2. Adım iki", "3. Adım üç")):
        _write(page, (72, 300 + row * 15), line)

    html = _html(document, tmp_path)

    assert "<p>Giriş paragrafı</p>\n<ul>\n<li>Birinci madde devamı burada</li>" in html
    assert "<li>İkinci madde</li>\n</ul>" in html
    assert "<p>1. Adım bir</p>\n<p>2. Adım iki</p>\n<p>3. Adım üç</p>" in html


def test_html_places_a_picture_between_the_text_above_and_below(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (72, 100), "Üstteki metin")
    _write(page, (72, 500), "Alttaki metin")
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 20), 0)
    pixmap.clear_with(30)
    page.insert_image(pymupdf.Rect(72, 200, 272, 400), pixmap=pixmap)

    html = _html(document, tmp_path)

    assert html.index("Üstteki") < html.index("<img") < html.index("Alttaki")


def test_epub_chapters_with_lists_links_and_pictures_stay_valid_xml(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=400, height=400)
    _write(page, (60, 60), "• Madde & bağlantı")
    page.insert_link(
        {
            "kind": pymupdf.LINK_URI,
            "from": pymupdf.Rect(60, 48, 200, 64),
            "uri": "https://x.org/?a=1&b=2",
        }
    )
    colour, mask = _jpeg_with_mask()
    page.insert_image(pymupdf.Rect(100, 100, 300, 300), stream=colour, mask=mask)
    source = tmp_path / "kitap.pdf"
    document.save(source)
    document.close()

    result = to_epub(
        EpubParams(path=str(source), output=str(tmp_path / "kitap.epub")), silent_progress()
    )

    with zipfile.ZipFile(result.output) as archive:
        chapter = archive.read("OEBPS/text/chapter0001.xhtml").decode("utf-8")
        pictures = [name for name in archive.namelist() if name.startswith("OEBPS/images/")]
    ElementTree.fromstring(chapter)
    assert "<li><a href=" in chapter and "a=1&amp;b=2" in chapter
    assert len(pictures) == 1 and pictures[0].endswith(".png")


def test_unreadable_picture_data_is_left_out() -> None:
    block = {"image": b"not a picture", "bbox": (0, 0, 10, 10), "transform": (10, 0, 0, 10, 0, 0)}

    picture = _image_block(block, pymupdf.Rect(0, 0, 100, 100))

    assert picture is None
