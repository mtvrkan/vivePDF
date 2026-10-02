import statistics

import pymupdf

from vivepdf.ops._redaction import jpeg_images, recompress_redacted

PAPER_RING = 4.0
PAPER_DPI = 48
WHITE = (1.0, 1.0, 1.0)


def _shown(page: pymupdf.Page, rect: pymupdf.Rect) -> pymupdf.Rect:
    if not page.rotation:
        return pymupdf.Rect(rect)
    shown = rect * page.rotation_matrix
    shown.normalize()
    return shown


def only_hidden_text(page: pymupdf.Page, rect: pymupdf.Rect) -> bool:
    spans = [
        span
        for block in page.get_text("dict", clip=_shown(page, rect))["blocks"]
        if block.get("type") == 0
        for line in block["lines"]
        for span in line["spans"]
        if span["text"].strip()
    ]
    return bool(spans) and all(span.get("alpha", 255) == 0 for span in spans)


def paper_colour(page: pymupdf.Page, rect: pymupdf.Rect) -> tuple[float, float, float]:
    shown = _shown(page, rect)
    ring = (
        pymupdf.Rect(
            shown.x0 - PAPER_RING,
            shown.y0 - PAPER_RING,
            shown.x1 + PAPER_RING,
            shown.y1 + PAPER_RING,
        )
        & page.rect
    )
    if ring.is_empty:
        return WHITE
    pixmap = page.get_pixmap(clip=ring, dpi=PAPER_DPI, annots=False, colorspace=pymupdf.csRGB)
    width, height = pixmap.width, pixmap.height
    if width < 1 or height < 1:
        return WHITE
    edge = (
        [(x, 0) for x in range(width)]
        + [(x, height - 1) for x in range(width)]
        + [(0, y) for y in range(height)]
        + [(width - 1, y) for y in range(height)]
    )
    channels = zip(*(pixmap.pixel(x, y)[:3] for x, y in edge), strict=True)
    red, green, blue = (statistics.median(channel) / 255 for channel in channels)
    return red, green, blue


def erase_scanned_words(
    page: pymupdf.Page, areas: list[tuple[pymupdf.Rect, tuple[float, float, float]]]
) -> None:
    if not areas:
        return
    before, jpeg_sizes = jpeg_images(page)
    for rect, colour in areas:
        page.add_redact_annot(rect, fill=colour)
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
        graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
    )
    recompress_redacted(page, before, jpeg_sizes)
