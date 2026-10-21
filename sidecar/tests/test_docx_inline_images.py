import io
import zipfile
from pathlib import Path

import pymupdf
from PIL import Image

from vivepdf.ops.convert import DocxParams, to_docx
from vivepdf.rpc.progress import silent_progress

LOGO_BLUE = (51, 85, 204)


def _png(colour: tuple[int, int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (24, 24), colour).save(buffer, format="PNG")
    return buffer.getvalue()


def _add_inline_image(document: pymupdf.Document, page: pymupdf.Page, x: float, y: float) -> None:
    pixels = bytes(LOGO_BLUE) * (40 * 20)
    stream = (
        f"q 120 0 0 60 {x} {y} cm BI /W 40 /H 20 /CS /RGB /BPC 8 ID ".encode() + pixels + b" EI Q"
    )
    xref = document.get_new_xref()
    document.update_object(xref, "<<>>")
    document.update_stream(xref, stream)
    contents = " ".join(f"{content} 0 R" for content in page.get_contents())
    document.xref_set_key(page.xref, "Contents", f"[{contents} {xref} 0 R]")


def _letterhead_pdf(path: Path, crop: pymupdf.Rect | None = None, overlap: bool = False) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for line in range(12):
        page.insert_text((150, 300 + line * 20), f"Letter body line {line}", fontsize=11)
    if overlap:
        page.insert_image(pymupdf.Rect(150, 120, 270, 180), stream=_png((200, 30, 30)))
    _add_inline_image(document, page, 150, 662)
    if crop is not None:
        page.set_cropbox(crop)
    document.save(path)
    document.close()
    return path


def _media(target: Path) -> list[bytes]:
    with zipfile.ZipFile(target) as archive:
        return [archive.read(name) for name in archive.namelist() if name.startswith("word/media/")]


def _convert(source: Path, tmp_path: Path) -> Path:
    target = tmp_path / "letter.docx"
    to_docx(DocxParams(path=str(source), output=str(target)), silent_progress())
    return target


def test_a_logo_stored_inline_in_the_page_reaches_the_word_file(tmp_path: Path):
    source = _letterhead_pdf(tmp_path / "letter.pdf")
    with pymupdf.open(source) as document:
        assert [info["xref"] for info in document[0].get_image_info(xrefs=True)] == [0]

    media = _media(_convert(source, tmp_path))

    assert len(media) == 1
    with Image.open(io.BytesIO(media[0])) as image:
        middle = image.convert("RGB").getpixel((image.width // 2, image.height // 2))
    assert all(abs(got - want) <= 8 for got, want in zip(middle, LOGO_BLUE, strict=True))


def test_an_inline_logo_on_top_of_a_picture_is_not_added_twice(tmp_path: Path):
    source = _letterhead_pdf(tmp_path / "letter.pdf", overlap=True)

    media = _media(_convert(source, tmp_path))

    assert len(media) == 1


def test_an_inline_logo_on_a_page_with_an_offset_crop_box_is_kept(tmp_path: Path):
    source = _letterhead_pdf(tmp_path / "letter.pdf", crop=pymupdf.Rect(100, 80, 560, 760))

    media = _media(_convert(source, tmp_path))

    assert len(media) == 1
