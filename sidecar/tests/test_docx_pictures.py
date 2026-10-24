import io
import re
import zipfile
from pathlib import Path

import pymupdf
from docx.oxml.ns import qn
from lxml import etree
from PIL import Image

from vivepdf.ops.convert import DocxParams, to_docx
from vivepdf.rpc.progress import silent_progress

EMU_PER_PT = 12700
BANNER_RED = "CC1F3F"


def _gradient(width: int = 300, height: int = 200, alpha: bool = False) -> bytes:
    image = Image.new("RGBA" if alpha else "RGB", (width, height))
    pixels = image.load()
    for x in range(width):
        for y in range(height):
            colour = (x * 255 // width, y * 255 // height, 128)
            pixels[x, y] = (*colour, 255 if (x + y) % 2 else 200) if alpha else colour
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _convert(source: Path, tmp_path: Path) -> Path:
    target = tmp_path / "out.docx"
    to_docx(DocxParams(path=str(source), output=str(target)), silent_progress())
    return target


def _part(target: Path, name: str = "word/document.xml") -> str:
    with zipfile.ZipFile(target) as archive:
        return archive.read(name).decode()


def _media(target: Path) -> list[bytes]:
    with zipfile.ZipFile(target) as archive:
        return [archive.read(name) for name in archive.namelist() if name.startswith("word/media/")]


def _picture_widths_pt(target: Path) -> list[float]:
    return [int(cx) / EMU_PER_PT for cx in re.findall(r'<wp:extent cx="(\d+)"', _part(target))]


def test_a_picture_inside_a_clip_path_keeps_only_its_shown_part(tmp_path: Path):
    source = tmp_path / "clipped.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((60, 50), "Only the left half of the picture shows", fontsize=12)
    page.insert_image(pymupdf.Rect(60, 70, 360, 270), stream=_gradient())
    xref = page.get_contents()[-1]
    stream = document.xref_stream(xref)
    document.update_stream(
        xref, stream.replace(b"q\n300 0 0 200", b"q\n60 572 150 200 re W n\n300 0 0 200", 1)
    )
    document.save(source)
    document.close()

    widths = _picture_widths_pt(_convert(source, tmp_path))

    assert len(widths) == 1
    assert abs(widths[0] - 150) <= 2


def test_a_picture_running_off_the_page_is_kept_up_to_the_page_edge(tmp_path: Path):
    source = tmp_path / "overflow.pdf"
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((60, 50), "A picture that runs off the right edge", fontsize=12)
    page.insert_image(pymupdf.Rect(445, 80, 745, 280), stream=_gradient())
    document.save(source)
    document.close()

    target = _convert(source, tmp_path)

    assert len(_media(target)) == 1
    assert abs(_picture_widths_pt(target)[0] - 150) <= 2


def test_a_coloured_box_drawn_inside_a_picture_does_not_also_become_cell_shading(tmp_path: Path):
    source = tmp_path / "cover.pdf"
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=_gradient(120, 170))
    page.draw_rect(
        pymupdf.Rect(40, 40, 400, 200), color=None, fill=(0xCC / 255, 0x1F / 255, 0x3F / 255)
    )
    page.insert_image(pymupdf.Rect(300, 60, 380, 140), stream=_gradient(80, 80, alpha=True))
    page.insert_text((60, 120), "Faculty of Engineering", fontsize=20, color=(1, 1, 1))
    for line in range(8):
        page.insert_text((60, 300 + line * 20), f"Course outline line {line}", fontsize=11)
    document.save(source)
    document.close()

    xml = _part(_convert(source, tmp_path))

    assert BANNER_RED not in xml.upper()


def test_a_link_is_written_as_a_word_hyperlink_with_its_text(tmp_path: Path):
    source = tmp_path / "links.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((60, 80), "Lecturer: Beril Ertuğrul", fontsize=12)
    page.insert_text((60, 110), "beril@example.com", fontsize=12)
    page.insert_link(
        {
            "kind": pymupdf.LINK_URI,
            "from": pymupdf.Rect(58, 98, 170, 114),
            "uri": "mailto:beril@example.com",
        }
    )
    document.save(source)
    document.close()

    target = _convert(source, tmp_path)
    xml = _part(target)
    relations = _part(target, "word/_rels/document.xml.rels")

    links = etree.fromstring(xml.encode()).iter(qn("w:hyperlink"))
    texts = {"".join(link.itertext()): link.getparent().tag for link in links}
    assert texts == {"beril@example.com": qn("w:p")}
    assert 'Target="mailto:beril@example.com"' in relations


def _floating_pictures(target: Path) -> int:
    return _part(target).count("<wp:anchor")


def test_a_bar_chart_drawn_with_plain_boxes_reaches_the_word_file(tmp_path: Path):
    source = tmp_path / "chart.pdf"
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((56, 60), "Quarterly sales", fontsize=18)
    page.draw_rect(pymupdf.Rect(0, 0, 595, 6), color=None, fill=(0.16, 0.45, 0.85))
    for index, height in enumerate([97, 150, 203, 86, 139, 192]):
        left = 80 + index * 72
        page.draw_rect(
            pymupdf.Rect(left, 470 - height, left + 50, 470), color=None, fill=(0.62, 0.78, 0.96)
        )
    page.draw_line((70, 470), (520, 470), color=(0.38, 0.43, 0.5), width=1)
    document.save(source)
    document.close()

    target = _convert(source, tmp_path)

    assert _floating_pictures(target) >= 2
    widths = _picture_widths_pt(target)
    assert any(abs(width - 450) <= 6 for width in widths)
