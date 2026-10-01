import math
import re

import pymupdf

from vivepdf.ops.tessdata import writable_tessdata_dir

ORIENTATION_DPI = 100
ORIENTATION_MIN_WORDS = 6
ORIENTATION_MIN_GAIN = 1.4
WORD_PATTERN = re.compile(r"[^\W\d_]{3,}", re.UNICODE)
IDEOGRAPH_PATTERN = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]")
IDEOGRAPHS_PER_WORD = 2
MAX_RENDER_PIXELS = 60_000_000
MIN_RENDER_DPI = 36


def capped_dpi(area: pymupdf.Rect, dpi: int) -> int:
    square_inches = (area.width / 72) * (area.height / 72)
    if square_inches <= 0:
        return dpi
    limit = int(math.sqrt(MAX_RENDER_PIXELS / square_inches))
    return max(MIN_RENDER_DPI, min(dpi, limit))


def word_score(text: str) -> int:
    ideographs = len(IDEOGRAPH_PATTERN.findall(text))
    alphabetic = len(WORD_PATTERN.findall(IDEOGRAPH_PATTERN.sub(" ", text)))
    return alphabetic + ideographs // IDEOGRAPHS_PER_WORD


def best_rotation(page: pymupdf.Page, language: str) -> int:
    original = page.rotation
    scores: dict[int, int] = {}
    try:
        for rotation in (0, 90, 180, 270):
            page.set_rotation((original + rotation) % 360)
            textpage = page.get_textpage_ocr(
                flags=0,
                language=language,
                dpi=capped_dpi(page.rect, ORIENTATION_DPI),
                full=True,
                tessdata=str(writable_tessdata_dir()),
            )
            scores[rotation] = word_score(page.get_text(textpage=textpage))
    finally:
        page.set_rotation(original)
    upright = scores[0]
    best = max(scores, key=lambda key: scores[key])
    if best == 0 or scores[best] < ORIENTATION_MIN_WORDS:
        return 0
    if scores[best] < max(upright, 1) * ORIENTATION_MIN_GAIN:
        return 0
    return best
