import io

import pymupdf
import pytest
from PIL import Image, ImageCms

from vivepdf.ops._pixmaps import png_ready


def _icc_rgb_pixmap() -> pymupdf.Pixmap:
    buffer = io.BytesIO()
    Image.new("RGB", (4, 2), (10, 120, 200)).save(buffer, "JPEG2000")
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    document = pymupdf.open()
    document.new_page()
    icc = document.get_new_xref()
    document.update_object(icc, "<</N 3>>")
    document.update_stream(icc, profile)
    xref = document.get_new_xref()
    document.update_object(
        xref,
        "<</Type/XObject/Subtype/Image/Width 4/Height 2/BitsPerComponent 8"
        f"/ColorSpace [/ICCBased {icc} 0 R]/Filter/JPXDecode>>",
    )
    document.update_stream(xref, buffer.getvalue(), compress=False)
    return pymupdf.Pixmap(document, xref)


def test_a_cmyk_pixmap_is_turned_into_rgb():
    pixmap = pymupdf.Pixmap(pymupdf.csCMYK, pymupdf.IRect(0, 0, 2, 2), False)
    pixmap.clear_with(0)

    ready = png_ready(pixmap)

    assert ready.colorspace.name == "DeviceRGB"
    assert ready.tobytes("png").startswith(b"\x89PNG")


@pytest.mark.parametrize("colorspace", [pymupdf.csGRAY, pymupdf.csRGB])
def test_grey_and_rgb_pixmaps_are_passed_through_untouched(colorspace):
    pixmap = pymupdf.Pixmap(colorspace, pymupdf.IRect(0, 0, 2, 2), True)

    assert png_ready(pixmap) is pixmap


def test_an_icc_based_rgb_image_keeps_its_own_colours():
    pixmap = _icc_rgb_pixmap()
    assert pixmap.colorspace.name.startswith("ICCBased")

    assert png_ready(pixmap) is pixmap


def test_a_mask_without_colours_is_passed_through():
    pixmap = pymupdf.Pixmap(None, pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 2, 2), True))
    assert pixmap.colorspace is None

    assert png_ready(pixmap) is pixmap
