import pymupdf
from pdf2docx.common.share import rgb_value
from pdf2docx.image.ImageBlock import ImageBlock
from pdf2docx.image.ImagesExtractor import ImagesExtractor
from pdf2docx.layout.Layout import Layout
from pdf2docx.page.Page import Page
from pdf2docx.shape.Shape import Hyperlink, Shape

WHITE = rgb_value((1, 1, 1))
JOIN_GAP = 4.0
MIN_SIDE = 0.5
TILT_TOLERANCE = 0.035
FOREGROUND_LAYER = "251659264"


def _layout_shapes(layout: Layout, found: dict[int, Shape]) -> None:
    for shape in layout.shapes:
        found.setdefault(id(shape), shape)
    for block in layout.blocks:
        if not block.is_table_block:
            continue
        for row in block:
            for cell in row:
                if cell:
                    _layout_shapes(cell, found)


def unused_shapes(page: Page) -> list[Shape]:
    found: dict[int, Shape] = {}
    for section in page.sections:
        for column in section:
            _layout_shapes(column, found)
    return [
        shape
        for shape in found.values()
        if not shape.is_determined and not isinstance(shape, Hyperlink) and shape.color != WHITE
    ]


def _joined(rects: list[pymupdf.Rect]) -> list[pymupdf.Rect]:
    groups: list[pymupdf.Rect] = []
    for rect in sorted(rects, key=lambda area: (area.y0, area.x0)):
        merged = pymupdf.Rect(rect)
        reach = merged + (-JOIN_GAP, -JOIN_GAP, JOIN_GAP, JOIN_GAP)
        touching = [group for group in groups if reach.intersects(group)]
        while touching:
            for group in touching:
                merged |= group
                groups.remove(group)
            reach = merged + (-JOIN_GAP, -JOIN_GAP, JOIN_GAP, JOIN_GAP)
            touching = [group for group in groups if reach.intersects(group)]
        groups.append(merged)
    return groups


def graphic_areas(shapes: list[Shape], frame: pymupdf.Rect) -> list[pymupdf.Rect]:
    rects = []
    for shape in shapes:
        rect = pymupdf.Rect(shape.bbox)
        if rect.width < MIN_SIDE:
            rect.x0, rect.x1 = rect.x0 - MIN_SIDE, rect.x1 + MIN_SIDE
        if rect.height < MIN_SIDE:
            rect.y0, rect.y1 = rect.y0 - MIN_SIDE, rect.y1 + MIN_SIDE
        rects.append(rect)
    return [area & frame for area in _joined(rects) if not (area & frame).is_empty]


class ForegroundImageBlock(ImageBlock):
    def make_docx(self, p):
        from docx.oxml.ns import qn

        super().make_docx(p)
        anchors = p._p.findall(f".//{qn('wp:anchor')}")
        if anchors:
            anchors[-1].set("behindDoc", "0")
            anchors[-1].set("relativeHeight", FOREGROUND_LAYER)
        return p


def _float_block(
    pixmap: pymupdf.Pixmap, area: pymupdf.Rect, kind: type[ImageBlock] = ImageBlock
) -> ImageBlock:
    block = kind({"width": pixmap.width, "height": pixmap.height, "image": pixmap.tobytes()})
    block.update_bbox(area)
    block.set_float_image_block()
    return block


def add_unused_graphics(page: Page, engine: pymupdf.Page, ratio: float) -> None:
    areas = graphic_areas(unused_shapes(page), engine.rect)
    if not areas:
        return
    hidden = ImagesExtractor._hide_page_text_and_images(engine, rm_text=True, rm_image=True)
    try:
        matrix = pymupdf.Matrix(ratio, ratio)
        for area in areas:
            pixmap = engine.get_pixmap(clip=area, matrix=matrix, alpha=True)
            if pixmap.width and pixmap.height:
                page.float_images.append(_float_block(pixmap, area))
    finally:
        document = engine.parent
        for xref, stream in hidden.items():
            document.update_stream(xref, stream)


def _is_slanted(line: dict) -> bool:
    x, y = line["dir"]
    return abs(x) > TILT_TOLERANCE and abs(y) > TILT_TOLERANCE


def slanted_areas(engine: pymupdf.Page) -> list[pymupdf.Rect]:
    rects = [
        pymupdf.Rect(line["bbox"])
        for block in engine.get_text("dict", flags=0)["blocks"]
        for line in block.get("lines", [])
        if _is_slanted(line) and "".join(span["text"] for span in line["spans"]).strip()
    ]
    return [area & engine.rect for area in _joined(rects) if not (area & engine.rect).is_empty]


def _only_slanted_text(copy: pymupdf.Page) -> None:
    copy.add_redact_annot(copy.rect, fill=False)
    copy.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_REMOVE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
        text=pymupdf.PDF_REDACT_TEXT_NONE,
    )
    for block in copy.get_text("rawdict", flags=0)["blocks"]:
        for line in block.get("lines", []):
            if _is_slanted(line):
                continue
            for span in line["spans"]:
                for char in span["chars"]:
                    copy.add_redact_annot(char["bbox"], fill=False)
    copy.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_NONE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
    )


def add_slanted_text(page: Page, engine: pymupdf.Page, ratio: float) -> None:
    areas = slanted_areas(engine)
    if not areas:
        return
    with pymupdf.open() as single:
        single.insert_pdf(engine.parent, from_page=engine.number, to_page=engine.number)
        copy = single[0]
        _only_slanted_text(copy)
        matrix = pymupdf.Matrix(ratio, ratio)
        for area in areas:
            pixmap = copy.get_pixmap(clip=area, matrix=matrix, alpha=True)
            if pixmap.width and pixmap.height:
                page.float_images.append(_float_block(pixmap, area, ForegroundImageBlock))
