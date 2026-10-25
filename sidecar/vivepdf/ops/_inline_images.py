import re

import pymupdf

from vivepdf.ops._image_masks import BLACK, painted_stencil_png, stencil_paints

INLINE_IMAGE = re.compile(rb"\bBI\s*/")
SAME_PLACE = 1.0


def _has_inline_images(page: pymupdf.Page) -> bool:
    document = page.parent
    streams = [page.read_contents()]
    streams += [document.xref_stream(xref) or b"" for xref, *_rest in page.get_xobjects()]
    return any(INLINE_IMAGE.search(stream) for stream in streams)


def _paint_colour(
    paints: list[tuple[pymupdf.Rect, tuple[int, int, int]]], bbox: tuple[float, ...]
) -> tuple[int, int, int]:
    for placed, colour in paints:
        if all(abs(a - b) <= SAME_PLACE for a, b in zip(placed, bbox, strict=True)):
            return colour
    return BLACK


def inline_images(page: pymupdf.Page) -> list[tuple[bytes, str, int, int]]:
    if not _has_inline_images(page):
        return []
    inline = {info["number"] for info in page.get_image_info(xrefs=True) if not info["xref"]}
    if not inline:
        return []
    blocks = [
        block
        for block in page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_IMAGES)["blocks"]
        if block["type"] == 1 and block["number"] in inline and block["image"]
    ]
    paints = stencil_paints(page) if any(not block["colorspace"] for block in blocks) else []
    images = []
    for block in blocks:
        data, ext = block["image"], "jpg" if block["ext"] == "jpeg" else block["ext"]
        if not block["colorspace"]:
            data, ext = painted_stencil_png(data, _paint_colour(paints, block["bbox"])), "png"
        images.append((data, ext, block["width"], block["height"]))
    return images
