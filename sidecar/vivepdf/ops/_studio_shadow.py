import io
import math

import numpy as np
import pymupdf
from PIL import Image, ImageFilter

from vivepdf.ops._studio_models import StudioShadowItem

SHARP_DPI = 300
SOFT_DPI = 150
SOFT_SIGMA = 2.0
MAX_SHADOW_PIXELS = 16_000_000
BLUR_REACH = 3

Source = tuple[pymupdf.Document, float]


def local_offset(item: StudioShadowItem) -> tuple[float, float]:
    angle = math.radians(item.rotation)
    cos, sin = math.cos(angle), math.sin(angle)
    dx, dy = item.shadow.x, item.shadow.y
    return dx * cos + dy * sin, -dx * sin + dy * cos


def shadow_margin(item: StudioShadowItem, inner: float) -> float:
    sigma = item.shadow.blur / 2
    lx, ly = local_offset(item)
    return inner + BLUR_REACH * sigma + max(abs(lx), abs(ly)) + 1


def _coverage(
    sources: list[Source],
    item: StudioShadowItem,
    margin: float,
    shift: tuple[float, float],
    scale: float,
) -> np.ndarray:
    document = pymupdf.open()
    try:
        page = document.new_page(width=item.width + 2 * margin, height=item.height + 2 * margin)
        for source, inner in sources:
            left = margin - inner + shift[0]
            top = margin - inner + shift[1]
            rect = pymupdf.Rect(
                left, top, left + item.width + 2 * inner, top + item.height + 2 * inner
            )
            page.show_pdf_page(rect, source, 0, keep_proportion=False)
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=True)
        samples = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
            pixmap.height, pixmap.width, pixmap.n
        )
        return samples[:, :, -1].astype(np.float32) / 255
    finally:
        document.close()


def _blurred(coverage: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return coverage
    image = Image.fromarray(np.clip(coverage * 255, 0, 255).astype(np.uint8), mode="L")
    return np.asarray(image.filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float32) / 255


def shadow_document(item: StudioShadowItem, sources: list[Source]) -> Source:
    sigma = item.shadow.blur / 2
    inner = max((margin for _, margin in sources), default=0.0)
    margin = shadow_margin(item, inner)
    width, height = item.width + 2 * margin, item.height + 2 * margin
    dpi = SHARP_DPI if sigma < SOFT_SIGMA else SOFT_DPI
    scale = min(dpi / 72, math.sqrt(MAX_SHADOW_PIXELS / max(width * height, 1.0)))
    alpha = _blurred(_coverage(sources, item, margin, local_offset(item), scale), sigma * scale)
    alpha = alpha * item.shadow.opacity
    if item.opacity < 1:
        content = _coverage(sources, item, margin, (0.0, 0.0), scale)
        alpha = item.opacity * alpha * (1 - content) / np.maximum(1 - content * item.opacity, 1e-6)
    red, green, blue = (int(item.shadow.color[index : index + 2], 16) for index in (1, 3, 5))
    pixels = np.empty((*alpha.shape, 4), dtype=np.uint8)
    pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2] = red, green, blue
    pixels[:, :, 3] = np.clip(np.rint(alpha * 255), 0, 255).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(pixels, mode="RGBA").save(buffer, format="PNG", optimize=True)
    document = pymupdf.open()
    page = document.new_page(width=width, height=height)
    page.insert_image(page.rect, stream=buffer.getvalue(), keep_proportion=False)
    return document, margin
