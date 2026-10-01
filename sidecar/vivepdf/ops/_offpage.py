import pymupdf

from vivepdf.ops._redaction import jpeg_images, recompress_redacted
from vivepdf.rpc.progress import Progress

CANCEL_STRIDE = 20
EDGE = 1.0
REACH = 100_000.0
TEXT_FLAGS = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_MEDIABOX_CLIP & ~pymupdf.TEXT_PRESERVE_IMAGES


def visible_area(page: pymupdf.Page) -> pymupdf.Rect:
    crop = page.cropbox
    media = page.mediabox
    shown = pymupdf.Rect(0, 0, crop.width, crop.height)
    return shown & pymupdf.Rect(
        media.x0 - crop.x0, media.y0 - crop.y0, media.x1 - crop.x0, media.y1 - crop.y0
    )


def _grown(area: pymupdf.Rect, amount: float) -> pymupdf.Rect:
    return pymupdf.Rect(area.x0 - amount, area.y0 - amount, area.x1 + amount, area.y1 + amount)


def _hidden(box: pymupdf.Rect, inner: pymupdf.Rect) -> bool:
    return not box.is_empty and not box.is_infinite and not box.intersects(inner)


def _hidden_spans(page: pymupdf.Page, inner: pymupdf.Rect) -> int:
    content = page.get_text("dict", flags=TEXT_FLAGS, clip=pymupdf.INFINITE_RECT())
    return sum(
        1
        for block in content.get("blocks", ())
        for line in block.get("lines", ())
        for span in line.get("spans", ())
        if str(span.get("text", "")).strip() and _hidden(pymupdf.Rect(span["bbox"]), inner)
    )


class OffPageTally:
    def __init__(self) -> None:
        self.spans = 0
        self.shown_images: set[int] = set()
        self.hidden_images: list[int] = []

    def add(self, page: pymupdf.Page) -> None:
        inner = _grown(visible_area(page), -EDGE)
        if inner.is_empty:
            return
        self.spans += _hidden_spans(page, inner)
        for info in page.get_image_info(xrefs=True):
            if int(info.get("width", 0)) * int(info.get("height", 0)) <= 1:
                continue
            box = pymupdf.Rect(info["bbox"])
            if _hidden(box, inner):
                self.hidden_images.append(int(info.get("xref", 0)))
            elif not box.is_empty:
                self.shown_images.add(int(info.get("xref", 0)))

    @property
    def total(self) -> int:
        unseen = sum(1 for xref in self.hidden_images if xref == 0 or xref not in self.shown_images)
        return self.spans + unseen


def _draws_outside(page: pymupdf.Page, area: pymupdf.Rect) -> bool:
    outer = _grown(area, EDGE)
    for _, box in page.get_bboxlog():
        rect = pymupdf.Rect(box)
        if not rect.is_empty and not outer.contains(rect):
            return True
    return False


def _bands(area: pymupdf.Rect) -> list[pymupdf.Rect]:
    return [
        pymupdf.Rect(-REACH, -REACH, REACH, area.y0),
        pymupdf.Rect(-REACH, area.y1, REACH, REACH),
        pymupdf.Rect(-REACH, -REACH, area.x0, REACH),
        pymupdf.Rect(area.x1, -REACH, REACH, REACH),
    ]


def remove_off_page(pages: list[tuple[pymupdf.Page, int]], progress: Progress) -> None:
    for position, (page, _) in enumerate(pages):
        if position % CANCEL_STRIDE == 0:
            progress.check_cancelled()
        area = visible_area(page)
        if area.is_empty or not _draws_outside(page, area):
            continue
        before, sizes = jpeg_images(page)
        for band in _bands(area):
            page.add_redact_annot(band, cross_out=False, fill=False)
        page.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
            graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
            text=pymupdf.PDF_REDACT_TEXT_REMOVE,
        )
        recompress_redacted(page, before, sizes)
