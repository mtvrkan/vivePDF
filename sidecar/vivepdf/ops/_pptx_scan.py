import math
from dataclasses import dataclass

import numpy as np
import pymupdf

from vivepdf.ops._hidden_text import text_is_only_hidden
from vivepdf.ops._pptx_layout import DEFAULT_FAMILY, FILLED_FLAG, LineBox

SCAN_IMAGE_SHARE = 0.5
SAMPLE_DPI = 100
PAPER_RING = 3.0
WORD_PADDING = 1.0
INK_SHARE = 0.15
INK_DISTANCE = 120
WORD_GAP_SHARE = 0.35
MAX_REACH_SHARE = 0.6
MAX_SIZE_GROWTH = 1.6
BODY_SIZE_SPREAD = 1.25
STRAIGHT_ANGLES = (0, 90, 180, 270)
UPRIGHT_ANGLES = (90, 270)


@dataclass(frozen=True, slots=True)
class ScanWords:
    area: pymupdf.Rect
    paper: tuple[int, int, int]


def recognised_scan(page: pymupdf.Page) -> bool:
    if not page.get_images():
        return False
    matrix = page.rotation_matrix
    covered = sum(
        abs((pymupdf.Rect(info["bbox"]) * matrix) & page.rect) for info in page.get_image_info()
    )
    return covered >= SCAN_IMAGE_SHARE * abs(page.rect) and text_is_only_hidden(page)


def _region(pixels: np.ndarray, rect: pymupdf.Rect, scale: float) -> np.ndarray:
    height, width = pixels.shape[:2]
    x0, y0 = max(0, math.floor(rect.x0 * scale)), max(0, math.floor(rect.y0 * scale))
    x1, y1 = min(width, math.ceil(rect.x1 * scale)), min(height, math.ceil(rect.y1 * scale))
    if x1 <= x0 or y1 <= y0:
        return pixels[:0, :0].reshape(-1, 3)
    return pixels[y0:y1, x0:x1].reshape(-1, 3)


def _ink_columns(pixels: np.ndarray, paper: np.ndarray, top: int, bottom: int) -> np.ndarray:
    band = pixels[top:bottom].astype(np.int16)
    return (np.abs(band - paper).sum(axis=2) > INK_DISTANCE).any(axis=0)


def _reach(columns: np.ndarray, start: int, step: int, gap: int, limit: int) -> int:
    edge, quiet, position = start, 0, start
    while 0 <= position + step < len(columns) and abs(position + step - start) <= limit:
        position += step
        if columns[position]:
            edge, quiet = position, 0
        else:
            quiet += 1
            if quiet >= gap:
                break
    return edge


def _inked(
    pixels: np.ndarray, paper: np.ndarray, shown: pymupdf.Rect, scale: float
) -> pymupdf.Rect:
    height, width = pixels.shape[:2]
    top, bottom = max(0, math.floor(shown.y0 * scale)), min(height, math.ceil(shown.y1 * scale))
    left, right = max(0, math.floor(shown.x0 * scale)), min(width, math.ceil(shown.x1 * scale) - 1)
    if bottom <= top or right < left:
        return shown
    columns = _ink_columns(pixels, paper, top, bottom)
    inside = np.flatnonzero(columns[left : right + 1])
    if not len(inside):
        return shown
    gap = max(1, round(shown.height * WORD_GAP_SHARE * scale))
    limit = round(shown.width * MAX_REACH_SHARE * scale)
    first = _reach(columns, left + int(inside[0]), -1, gap, limit)
    last = _reach(columns, left + int(inside[-1]), 1, gap, limit)
    return pymupdf.Rect(first / scale, shown.y0, (last + 1) / scale, shown.y1)


def _inked_along(
    pixels: np.ndarray, paper: np.ndarray, shown: pymupdf.Rect, scale: float, upright: bool
) -> pymupdf.Rect:
    if not upright:
        return _inked(pixels, paper, shown, scale)
    turned = pymupdf.Rect(shown.y0, shown.x0, shown.y1, shown.x1)
    found = _inked(pixels.transpose(1, 0, 2), paper, turned, scale)
    return pymupdf.Rect(found.y0, found.x0, found.y1, found.x1)


def _stretch(box: LineBox, shown: pymupdf.Rect, upright: bool) -> None:
    centre = (shown.tl + shown.br) / 2
    box.width = shown.height if upright else shown.width
    box.left = centre.x - box.width / 2
    box.top = centre.y - box.height / 2


def _fitted_size(box: LineBox, ink_width: float) -> float:
    text = "".join(span["text"] for span in box.spans)
    unit = pymupdf.get_text_length(text, fontname="helv", fontsize=1)
    largest = max(span["size"] for span in box.spans)
    return min(ink_width / unit, largest * MAX_SIZE_GROWTH) if unit > 0 else largest


def dress_scan_lines(page: pymupdf.Page, boxes: list[LineBox]) -> list[ScanWords]:
    pixmap = page.get_pixmap(dpi=SAMPLE_DPI, colorspace=pymupdf.csRGB, alpha=False, annots=False)
    pixels = np.frombuffer(pixmap.samples, np.uint8).reshape(pixmap.height, pixmap.width, 3)
    scale = SAMPLE_DPI / 72
    matrix = page.rotation_matrix
    words: list[ScanWords] = []
    sized: list[tuple[LineBox, float]] = []
    for box in boxes:
        shown = box.area * matrix
        inner = _region(pixels, shown, scale)
        outer = _region(pixels, shown + (-PAPER_RING, -PAPER_RING, PAPER_RING, PAPER_RING), scale)
        if not len(inner) or not len(outer):
            continue
        paper = np.median(outer, axis=0)
        distance = np.abs(inner.astype(np.int16) - paper).sum(axis=1)
        darkest = inner[np.argsort(distance)[-max(1, int(len(inner) * INK_SHARE)) :]]
        red, green, blue = (int(part) for part in np.median(darkest, axis=0))
        if box.angle in STRAIGHT_ANGLES:
            shown = _inked_along(pixels, paper, shown, scale, box.angle in UPRIGHT_ANGLES)
            _stretch(box, shown, box.angle in UPRIGHT_ANGLES)
            sized.append((box, _fitted_size(box, box.width)))
        for span in box.spans:
            span["color"] = red << 16 | green << 8 | blue
            span["font"] = DEFAULT_FAMILY
            span["flags"] = 0
            span["char_flags"] = FILLED_FLAG
        padding = (-WORD_PADDING, -WORD_PADDING, WORD_PADDING, WORD_PADDING)
        words.append(ScanWords(shown + padding, tuple(int(part) for part in paper)))
    _even_sizes(sized)
    return words


def _even_sizes(sized: list[tuple[LineBox, float]]) -> None:
    if not sized:
        return
    body = float(np.median([size for _box, size in sized]))
    for box, size in sized:
        usual = body / BODY_SIZE_SPREAD <= size <= body * BODY_SIZE_SPREAD
        for span in box.spans:
            span["size"] = body if usual else size


def erase_scan_words(pixmap: pymupdf.Pixmap, words: list[ScanWords], dpi: int) -> None:
    scale = dpi / 72
    for word in words:
        area = pymupdf.IRect(
            math.floor(word.area.x0 * scale),
            math.floor(word.area.y0 * scale),
            math.ceil(word.area.x1 * scale),
            math.ceil(word.area.y1 * scale),
        )
        pixmap.set_rect(area & pixmap.irect, word.paper)
