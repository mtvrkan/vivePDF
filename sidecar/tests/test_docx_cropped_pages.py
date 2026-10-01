import io
from pathlib import Path

import pymupdf
import pytest
from docx import Document
from PIL import Image

from vivepdf.ops.convert import DocxParams, to_docx
from vivepdf.rpc.progress import silent_progress


def _png(colour: tuple[int, int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (24, 24), colour).save(buffer, format="PNG")
    return buffer.getvalue()


def _cropped_pdf(path: Path, rotation: int) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=600, height=700)
    page.set_cropbox(pymupdf.Rect(100, 100, 400, 500))
    page.insert_image(pymupdf.Rect(40, 80, 140, 180), stream=_png((200, 30, 30)))
    page.insert_image(pymupdf.Rect(320, 120, 344, 144), stream=_png((30, 30, 200)))
    page.insert_image(pymupdf.Rect(332, 132, 356, 156), stream=_png((30, 160, 30)))
    page.set_rotation(rotation)
    anchor = pymupdf.Point(20, 40) * page.derotation_matrix
    page.insert_text(anchor, "Kirpilmis sayfa metni", fontsize=14, rotate=rotation)
    document.save(path)
    document.close()
    return path


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_a_picture_left_outside_an_offset_crop_box_does_not_stop_the_conversion(
    tmp_path: Path, rotation: int
):
    source = _cropped_pdf(tmp_path / "cropped.pdf", rotation)
    target = tmp_path / "cropped.docx"

    to_docx(DocxParams(path=str(source), output=str(target)), silent_progress())

    document = Document(str(target))
    text = " ".join(paragraph.text for paragraph in document.paragraphs)
    assert "Kirpilmis sayfa metni" in text
    assert len(document.inline_shapes) >= 1


def test_an_empty_clip_becomes_a_single_transparent_pixel_instead_of_an_error():
    from vivepdf.ops._docx_progress import _to_raw_dict_even_when_empty

    empty = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 0, 0), False)

    raw = _to_raw_dict_even_when_empty(empty, pymupdf.Rect(400, 20, 420, 40))

    assert (raw["width"], raw["height"]) == (1, 1)
    assert raw["bbox"] == (400, 20, 420, 40)
    with Image.open(io.BytesIO(raw["image"])) as image:
        assert image.convert("RGBA").getpixel((0, 0))[3] == 0
