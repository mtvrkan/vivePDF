import zlib
from pathlib import Path

import pymupdf

from vivepdf.ops.image_extraction import ExtractImagesParams, extract_images
from vivepdf.rpc.progress import silent_progress

SIDE = 80


def _inline(page: pymupdf.Page, shade: int, top: int = 570, side: int = SIDE) -> None:
    page.insert_text((72, 72), " ")
    xref = page.get_contents()[-1]
    data = zlib.compress(bytes([shade, 30, 30] * (side * side)))
    stream = page.parent.xref_stream(xref) + (
        f"\nq 200 0 0 200 72 {top} cm BI /W {side} /H {side} /BPC 8 /CS /RGB /F /Fl ID ".encode()
        + data
        + b"\nEI Q"
    )
    page.parent.update_stream(xref, stream)


def _picture(shade: int) -> pymupdf.Pixmap:
    picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 100, 100), 0)
    picture.clear_with(shade)
    return picture


def _extract(document: pymupdf.Document, tmp_path: Path) -> list[Path]:
    source = tmp_path / "satır.pdf"
    document.save(source)
    document.close()
    result = extract_images(
        ExtractImagesParams(path=str(source), output_dir=str(tmp_path / "çıkan")),
        silent_progress(),
    )
    return [Path(path) for path in result.outputs]


def test_an_inline_picture_is_saved(tmp_path: Path) -> None:
    document = pymupdf.open()
    _inline(document.new_page(width=595, height=842), 200)

    outputs = _extract(document, tmp_path)

    assert [path.name for path in outputs] == ["satır-1-01.png"]
    picture = pymupdf.Pixmap(str(outputs[0]))
    assert (picture.width, picture.height) == (SIDE, SIDE)
    assert picture.pixel(10, 10) == (200, 30, 30)


def test_an_inline_picture_comes_after_the_stored_ones_without_repeating_them(
    tmp_path: Path,
) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(pymupdf.Rect(300, 72, 400, 172), pixmap=_picture(90))
    _inline(page, 200)

    outputs = _extract(document, tmp_path)

    assert [path.name for path in outputs] == ["satır-1-01.png", "satır-1-02.png"]
    assert pymupdf.Pixmap(str(outputs[1])).pixel(10, 10) == (200, 30, 30)


def test_the_same_inline_picture_on_two_pages_is_saved_once(tmp_path: Path) -> None:
    document = pymupdf.open()
    for _ in range(2):
        _inline(document.new_page(width=595, height=842), 200)

    outputs = _extract(document, tmp_path)

    assert [path.name for path in outputs] == ["satır-1-01.png"]


def test_a_tiny_inline_picture_is_counted_as_skipped(tmp_path: Path) -> None:
    document = pymupdf.open()
    _inline(document.new_page(width=595, height=842), 200, side=16)
    source = tmp_path / "küçük.pdf"
    document.save(source)
    document.close()

    result = extract_images(
        ExtractImagesParams(path=str(source), output_dir=str(tmp_path / "çıkan")),
        silent_progress(),
    )

    assert (result.count, result.skipped) == (0, 1)


def _replace_content(page: pymupdf.Page, body: bytes) -> None:
    page.insert_text((72, 72), " ")
    page.parent.update_stream(page.get_contents()[-1], body)


def test_an_inline_photo_stays_a_jpeg(tmp_path: Path) -> None:
    document = pymupdf.open()
    photo = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 96, 96), 0)
    photo.clear_with(150)
    _replace_content(
        document.new_page(width=595, height=842),
        b"q 200 0 0 200 72 500 cm BI /W 96 /H 96 /BPC 8 /CS /RGB /F /DCT ID "
        + photo.tobytes("jpg")
        + b"\nEI Q",
    )

    outputs = _extract(document, tmp_path)

    assert [path.suffix for path in outputs] == [".jpg"]


def test_an_inline_stencil_takes_its_paint_colour_on_a_clear_background(tmp_path: Path) -> None:
    document = pymupdf.open()
    _replace_content(
        document.new_page(width=595, height=842),
        b"q 0 0 1 rg 200 0 0 200 72 500 cm BI /W 96 /H 96 /IM true ID "
        + bytes([0b11110000] * (96 * 12))
        + b"\nEI Q",
    )

    outputs = _extract(document, tmp_path)

    picture = pymupdf.Pixmap(str(outputs[0]))
    assert picture.alpha
    assert picture.pixel(5, 5) == (0, 0, 255, 255)
    assert picture.pixel(0, 5)[3] == 0
