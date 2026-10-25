import base64
import math

import pymupdf

from vivepdf.ops._markup_model import MarkupBlock, MarkupLine
from vivepdf.ops._markup_tables import filled_table
from vivepdf.ops._page_images import MAX_IMAGE_SIDE
from vivepdf.ops._pixmaps import png_ready

PICTURE_DPI = 150
PICTURE_PIXELS = 16_000_000
PASSTHROUGH_PICTURES = ("jpeg", "png")
CROP_TOLERANCE = 1.0
PICTURE_ERRORS = (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase)
GRAPHIC_MIN_SIDE = 36.0
GRAPHIC_MIN_PATHS = 3
GRAPHIC_MAX_SHARE = 0.85
GRAPHIC_TEXT_SHARE = 0.3
GRAPHIC_PROSE_WORDS = 8
GRAPHIC_PANEL_SHARE = 0.8
PAPER_WHITE = 0.98
BACKDROP_SHARE = 0.9


def picture_dpi(clip: pymupdf.Rect) -> int:
    square_inches = clip.width * clip.height / (72 * 72)
    by_pixels = math.sqrt(PICTURE_PIXELS / square_inches)
    by_side = (MAX_IMAGE_SIDE["png"] - 2) * 72 / max(clip.width, clip.height)
    return max(1, math.floor(min(PICTURE_DPI, by_pixels, by_side)))


def _picture(data: bytes, media: str, area: pymupdf.Rect) -> MarkupBlock:
    encoded = base64.b64encode(data).decode("ascii")
    return MarkupBlock(
        "figure",
        f'<img width="{round(area.width)}" height="{round(area.height)}" alt="" '
        f'src="data:{media};base64,{encoded}"/>',
    )


def _png_picture(pixmap: pymupdf.Pixmap, area: pymupdf.Rect) -> MarkupBlock:
    return _picture(png_ready(pixmap).tobytes("png"), "image/png", area)


def _placement(block: dict) -> pymupdf.Rect | None:
    a, b, c, d, e, f = block["transform"]
    if b or c or a <= 0 or d <= 0:
        return None
    return pymupdf.Rect(e, f, e + a, f + d)


def _cropped(pixmap: pymupdf.Pixmap, placed: pymupdf.Rect, shown: pymupdf.Rect):
    clip = pymupdf.IRect(
        math.floor((shown.x0 - placed.x0) / placed.width * pixmap.width),
        math.floor((shown.y0 - placed.y0) / placed.height * pixmap.height),
        math.ceil((shown.x1 - placed.x0) / placed.width * pixmap.width),
        math.ceil((shown.y1 - placed.y0) / placed.height * pixmap.height),
    ) & pymupdf.IRect(0, 0, pixmap.width, pixmap.height)
    if clip.is_empty:
        return None
    return pymupdf.Pixmap(pixmap, pixmap.width, pixmap.height, clip)


def _image_block(block: dict, visible: pymupdf.Rect) -> MarkupBlock | None:
    placed = _placement(block)
    area = placed or pymupdf.Rect(block["bbox"])
    shown = area & visible if placed else area
    cropped = (
        area.width - shown.width > CROP_TOLERANCE or area.height - shown.height > CROP_TOLERANCE
    )
    ext = block.get("ext")
    if (
        not cropped
        and not block.get("mask")
        and ext in PASSTHROUGH_PICTURES
        and block.get("colorspace", 3) <= 3
    ):
        return _picture(block["image"], f"image/{ext}", area)
    try:
        pixmap = pymupdf.Pixmap(block["image"])
        if block.get("mask") and not pixmap.alpha:
            mask = pymupdf.Pixmap(block["mask"])
            if (mask.width, mask.height) != (pixmap.width, pixmap.height):
                mask = pymupdf.Pixmap(mask, pixmap.width, pixmap.height, None)
            pixmap = pymupdf.Pixmap(png_ready(pixmap), mask)
        if cropped:
            pixmap = _cropped(pixmap, area, shown)
        if pixmap is None or pixmap.width == 0 or pixmap.height == 0:
            return None
        return _png_picture(pixmap, shown if cropped else area)
    except PICTURE_ERRORS:
        return None


def is_backdrop(area: pymupdf.Rect, visible: pymupdf.Rect, texts: list[pymupdf.Rect]) -> bool:
    if abs(area & visible) < abs(visible) * BACKDROP_SHARE:
        return False
    return any((rect.tl + rect.br) / 2 in area for rect in texts)


def _holds_text(
    lines: list[tuple[pymupdf.Rect, MarkupLine]], area: pymupdf.Rect, backdrop: float
) -> bool:
    inside = [(rect, line) for rect, line in lines if (rect.tl + rect.br) / 2 in area]
    if not any(line.text.strip() for _rect, line in inside):
        return False
    if backdrop >= abs(area) * GRAPHIC_PANEL_SHARE:
        return True
    if any(len(line.text.split()) >= GRAPHIC_PROSE_WORDS for _rect, line in inside):
        return True
    return sum(abs(rect & area) for rect, _line in inside) > abs(area) * GRAPHIC_TEXT_SHARE


def _shows(drawing: dict) -> bool:
    if drawing.get("type") != "f":
        return True
    fill = drawing.get("fill")
    if fill is None or not drawing.get("fill_opacity", 1):
        return False
    return any(channel < PAPER_WHITE for channel in fill)


def _is_table(page: pymupdf.Page, area: pymupdf.Rect) -> bool:
    try:
        tables = page.find_tables(clip=area * page.rotation_matrix, use_layout=False).tables
    except PICTURE_ERRORS:
        return False
    return any(
        filled_table(table) for table in tables if table.row_count > 1 and table.col_count > 1
    )


def graphic_areas(page, visible, lines) -> list[pymupdf.Rect]:
    drawings = [drawing for drawing in page.get_drawings() if _shows(drawing)]
    if len(drawings) < GRAPHIC_MIN_PATHS:
        return []
    areas = []
    for cluster in page.cluster_drawings(clip=visible, drawings=drawings):
        area = pymupdf.Rect(cluster) & visible
        if min(area.width, area.height) < GRAPHIC_MIN_SIDE:
            continue
        if abs(area) > abs(visible) * GRAPHIC_MAX_SHARE:
            continue
        touching = [(item, pymupdf.Rect(item["rect"]) & area) for item in drawings]
        touching = [(item, rect) for item, rect in touching if not rect.is_empty]
        backdrop = sum(abs(rect) for item, rect in touching if item.get("fill") is not None)
        if len(touching) < GRAPHIC_MIN_PATHS or _holds_text(lines, area, backdrop):
            continue
        if not _is_table(page, area):
            areas.append(area)
    return areas


def graphic_block(page: pymupdf.Page, area: pymupdf.Rect) -> MarkupBlock | None:
    clip = area * page.rotation_matrix
    pixmap = page.get_pixmap(clip=clip, dpi=picture_dpi(clip))
    if pixmap.width == 0 or pixmap.height == 0:
        return None
    return _png_picture(pixmap, area)
