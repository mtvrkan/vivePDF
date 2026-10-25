from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.convert import ExtractImagesParams, extract_images
from vivepdf.rpc.progress import silent_progress

AREA = pymupdf.Rect(72, 72, 272, 272)


def _picture(shade: int) -> pymupdf.Pixmap:
    picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 100, 100), 0)
    picture.clear_with(shade)
    return picture


def _list_unused(document: pymupdf.Document, number: int, xref: int) -> None:
    page_xref = document.page_xref(number)
    kind, value = document.xref_get_key(page_xref, "Resources")
    owner, path = (
        (int(value.split()[0]), "XObject") if kind == "xref" else (page_xref, "Resources/XObject")
    )
    document.xref_set_key(owner, f"{path}/Unused", f"{xref} 0 R")


def _extract(document: pymupdf.Document, tmp_path: Path, dedupe: bool = True) -> list[str]:
    tmp_path.mkdir(exist_ok=True)
    source = tmp_path / "görseller.pdf"
    document.save(source)
    document.close()
    result = extract_images(
        ExtractImagesParams(path=str(source), output_dir=str(tmp_path / "çıkan"), dedupe=dedupe),
        silent_progress(),
    )
    return [Path(path).name for path in result.outputs]


def _shade(tmp_path: Path, name: str) -> int:
    return pymupdf.Pixmap(str(tmp_path / "çıkan" / name)).pixel(50, 50)[0]


def test_an_image_listed_but_not_drawn_on_a_page_is_not_taken_from_it(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_image(AREA, pixmap=_picture(40))
    drawn_later = document.new_page().insert_image(AREA, pixmap=_picture(160))
    _list_unused(document, 0, drawn_later)

    names = _extract(document, tmp_path)

    assert names == ["görseller-1-01.png", "görseller-2-01.png"]
    assert _shade(tmp_path, names[0]) == 40
    assert _shade(tmp_path, names[1]) == 160


def test_an_image_drawn_on_two_pages_follows_the_dedupe_choice(tmp_path: Path) -> None:
    document = pymupdf.open()
    shared = document.new_page().insert_image(AREA, pixmap=_picture(90))
    document.new_page().insert_image(AREA, xref=shared)
    copy = pymupdf.open()
    copy.insert_pdf(document)

    assert _extract(document, tmp_path / "tek") == ["görseller-1-01.png"]
    assert _extract(copy, tmp_path / "hepsi", dedupe=False) == [
        "görseller-1-01.png",
        "görseller-2-01.png",
    ]


def test_an_image_no_page_draws_is_not_extracted(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_image(AREA, pixmap=_picture(40))
    unused = document.new_page().insert_image(AREA, pixmap=_picture(200))
    _list_unused(document, 0, unused)
    document.delete_page(1)

    names = _extract(document, tmp_path)

    assert names == ["görseller-1-01.png"]


def _masked(size: int) -> pymupdf.Document:
    document = pymupdf.open()
    image = document.new_page().insert_image(AREA, pixmap=_picture(90))
    mask = document.get_new_xref()
    document.update_object(
        mask,
        f"<</Type/XObject/Subtype/Image/Width {size}/Height {size}"
        "/ColorSpace/DeviceGray/BitsPerComponent 8>>",
    )
    half = size // 2
    document.update_stream(mask, (bytes(half) + b"\xff" * (size - half)) * size)
    document.xref_set_key(image, "SMask", f"{mask} 0 R")
    return document


@pytest.mark.parametrize("size", [40, 100, 300])
def test_a_transparency_mask_of_any_size_keeps_the_image_see_through(
    tmp_path: Path, size: int
) -> None:
    (name,) = _extract(_masked(size), tmp_path)

    picture = pymupdf.Pixmap(str(tmp_path / "çıkan" / name))
    assert picture.alpha
    assert picture.pixel(10, 50)[3] == 0
    assert picture.pixel(90, 50)[3] == 255


def _stencil(paint: str, decode: str = "") -> pymupdf.Document:
    document = pymupdf.open()
    page = document.new_page(width=300, height=300)
    page.insert_text((10, 20), "x")
    del page
    rows = bytearray()
    for y in range(80):
        row = bytearray(10)
        for x in range(80):
            if not (20 < x < 60 and 20 < y < 60):
                row[x // 8] |= 0x80 >> (x % 8)
        rows += row
    mask = document.get_new_xref()
    document.update_object(
        mask,
        "<</Type/XObject/Subtype/Image/Width 80/Height 80"
        f"/ImageMask true/BitsPerComponent 1{decode}>>",
    )
    document.update_stream(mask, bytes(rows))
    page_xref = document.page_xref(0)
    kind, value = document.xref_get_key(page_xref, "Resources")
    owner, path = (
        (int(value.split()[0]), "XObject") if kind == "xref" else (page_xref, "Resources/XObject")
    )
    document.xref_set_key(owner, path, f"<</M1 {mask} 0 R>>")
    content = document[0].get_contents()[0]
    drawing = f"\nq {paint} 160 0 0 160 70 70 cm /M1 Do Q\n".encode()
    document.update_stream(content, document.xref_stream(content) + drawing)
    return document


@pytest.mark.parametrize(("paint", "colour"), [("1 0 0 rg", (255, 0, 0)), ("0.2 g", (51, 51, 51))])
def test_a_stencil_mask_comes_out_in_its_paint_colour_on_a_clear_background(
    tmp_path: Path, paint: str, colour: tuple[int, int, int]
) -> None:
    (name,) = _extract(_stencil(paint), tmp_path)

    picture = pymupdf.Pixmap(str(tmp_path / "çıkan" / name))
    assert picture.alpha
    assert picture.pixel(40, 40) == (*colour, 255)
    assert picture.pixel(2, 2)[3] == 0


def test_an_inverted_stencil_mask_paints_the_other_side(tmp_path: Path) -> None:
    (name,) = _extract(_stencil("0 0 1 rg", "/Decode[1 0]"), tmp_path)

    picture = pymupdf.Pixmap(str(tmp_path / "çıkan" / name))
    assert picture.pixel(40, 40)[3] == 0
    assert picture.pixel(2, 2) == (0, 0, 255, 255)
