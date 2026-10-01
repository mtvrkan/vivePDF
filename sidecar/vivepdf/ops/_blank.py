import numpy as np
import pymupdf
from PIL import Image, ImageOps

BLANK_DPI = 50
BLANK_MARGIN = 0.04
BLANK_INK_LIMIT = 0.0002
BLANK_DARK_LEVEL = 180
BLANK_PAPER_GAP = 60
BLANK_MIN_PAPER = 128


def ink_share(gray: np.ndarray) -> float:
    height, width = gray.shape
    rows, columns = int(height * BLANK_MARGIN), int(width * BLANK_MARGIN)
    inner = gray[rows : height - rows, columns : width - columns]
    if inner.size == 0:
        return 0.0
    paper = float(np.percentile(inner, 90))
    if paper < BLANK_MIN_PAPER:
        return 1.0
    return float((inner < min(BLANK_DARK_LEVEL, paper - BLANK_PAPER_GAP)).mean())


def blank_image(image: Image.Image, dpi: int) -> bool:
    gray = ImageOps.grayscale(image)
    factor = max(1, round(dpi / BLANK_DPI))
    if factor > 1:
        gray = gray.reduce(factor)
    return ink_share(np.asarray(gray)) < BLANK_INK_LIMIT


def blank_page(page: pymupdf.Page) -> bool:
    if page.get_text("text").strip():
        return False
    pixmap = page.get_pixmap(dpi=BLANK_DPI, colorspace=pymupdf.csGRAY, alpha=False)
    gray = Image.frombytes("L", (pixmap.width, pixmap.height), pixmap.samples)
    return ink_share(np.asarray(gray)) < BLANK_INK_LIMIT
