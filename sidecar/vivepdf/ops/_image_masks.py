import contextlib
import hashlib
from collections.abc import Iterable

import pymupdf
from pymupdf import mupdf

BLACK = (0, 0, 0)


def is_stencil(document: pymupdf.Document, xref: int) -> bool:
    return document.xref_get_key(xref, "ImageMask")[1] == "true"


def _fingerprint(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


class _StencilColours(mupdf.FzDevice2):
    def __init__(self, wanted: dict[str, int]) -> None:
        super().__init__()
        self.use_virtual_fill_image_mask()
        self.wanted = wanted
        self.colours: dict[int, tuple[int, int, int]] = {}

    def fill_image_mask(self, ctx, image, ctm, colorspace, color, alpha, color_params):
        compressed = mupdf.ll_fz_compressed_image_buffer(image)
        if compressed is None or compressed.buffer is None:
            return
        data = mupdf.FzBuffer(mupdf.ll_fz_keep_buffer(compressed.buffer)).fz_buffer_extract_copy()
        xref = self.wanted.get(_fingerprint(data))
        if xref is None or xref in self.colours:
            return
        converted = mupdf.ll_fz_convert_color(
            colorspace, color, mupdf.ll_fz_device_rgb(), None, color_params
        )
        self.colours[xref] = tuple(round(255 * value) for value in converted[:3])


def stencil_colours(page: pymupdf.Page, xrefs: Iterable[int]) -> dict[int, tuple[int, int, int]]:
    document = page.parent
    wanted = {_fingerprint(document.xref_stream_raw(xref)): xref for xref in xrefs}
    if not wanted:
        return {}
    device = _StencilColours(wanted)
    with contextlib.suppress(mupdf.FzErrorBase):
        mupdf.fz_run_page(page.this, device, mupdf.FzMatrix(), mupdf.FzCookie())
    return device.colours


def stencil_png(document: pymupdf.Document, xref: int, colour: tuple[int, int, int]) -> bytes:
    mask = pymupdf.Pixmap(document, xref)
    paint = pymupdf.Pixmap(pymupdf.csRGB, mask.irect, False)
    paint.set_rect(paint.irect, colour)
    return pymupdf.Pixmap(paint, mask).tobytes("png")
