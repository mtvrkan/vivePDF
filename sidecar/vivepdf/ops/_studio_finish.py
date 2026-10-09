import io
import math
from collections.abc import Callable

import numpy as np
import pymupdf
from PIL import Image

from vivepdf.ops._studio_models import StudioFinishItem, StudioFinishTexture
from vivepdf.ops._studio_shadow import SHARP_DPI, Source, blurred

MAX_FINISH_PIXELS = 8_000_000
INNER = {"light": True, "away": True, "outerLight": False, "outerAway": False}

DrawSources = Callable[[pymupdf.Page, float], None]


def finish_reach(item: StudioFinishItem) -> float:
    recipe = item.recipe
    blur = max((layer.blur for layer in recipe.layers), default=0.0)
    return math.hypot(recipe.dx, recipe.dy) + 3 * blur + 2


def _coverage(
    width: float, height: float, scale: float, draw: DrawSources, margin: float
) -> np.ndarray:
    document = pymupdf.open()
    try:
        page = document.new_page(width=width, height=height)
        draw(page, margin)
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=True)
        samples = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
            pixmap.height, pixmap.width, pixmap.n
        )
        return samples[:, :, -1].astype(np.float32) / 255
    finally:
        document.close()


def _moved(values: np.ndarray, steps: int, axis: int) -> np.ndarray:
    size = values.shape[axis]
    result = np.zeros_like(values)
    if abs(steps) >= size:
        return result
    source = [slice(None), slice(None)]
    target = [slice(None), slice(None)]
    if steps >= 0:
        source[axis], target[axis] = slice(0, size - steps), slice(steps, size)
    else:
        source[axis], target[axis] = slice(-steps, size), slice(0, size + steps)
    result[tuple(target)] = values[tuple(source)]
    return result


def _shifted_axis(values: np.ndarray, offset: float, axis: int) -> np.ndarray:
    whole = math.floor(offset)
    part = offset - whole
    first = _moved(values, whole, axis)
    if part < 1e-6:
        return first
    return first * (1 - part) + _moved(values, whole + 1, axis) * part


def shifted(values: np.ndarray, dx: float, dy: float) -> np.ndarray:
    return _shifted_axis(_shifted_axis(values, dx, 1), dy, 0)


def _regions(coverage: np.ndarray, dx: float, dy: float) -> dict[str, np.ndarray]:
    toward_away = shifted(coverage, dx, dy)
    toward_light = shifted(coverage, -dx, -dy)
    return {
        "light": coverage * (1 - toward_away),
        "away": coverage * (1 - toward_light),
        "outerAway": toward_away * (1 - coverage),
        "outerLight": toward_light * (1 - coverage),
    }


def _rgb(colour: str) -> np.ndarray:
    return np.array([int(colour[index : index + 2], 16) / 255 for index in (1, 3, 5)], np.float32)


def _gradient(
    texture: StudioFinishTexture, shape: tuple[int, int], scale: float, margin: float
) -> tuple[np.ndarray, np.ndarray]:
    rows, columns = shape
    u = (np.arange(columns, dtype=np.float32) + 0.5) / scale - margin
    v = (np.arange(rows, dtype=np.float32) + 0.5) / scale - margin
    vx, vy = texture.x2 - texture.x1, texture.y2 - texture.y1
    length = max(vx * vx + vy * vy, 1e-9)
    along = ((u[None, :] - texture.x1) * vx + (v[:, None] - texture.y1) * vy) / length
    along = np.clip(along, 0, 1)
    offsets = np.maximum.accumulate(np.array([stop.offset for stop in texture.stops]))
    colours = np.array([_rgb(stop.color) for stop in texture.stops])
    colour = np.stack(
        [np.interp(along, offsets, colours[:, channel]) for channel in range(3)], axis=-1
    ).astype(np.float32)
    opacity = np.interp(along, offsets, [stop.opacity for stop in texture.stops]).astype(np.float32)
    return colour, opacity


def _overlay(
    item: StudioFinishItem, coverage: np.ndarray, scale: float, margin: float
) -> np.ndarray:
    recipe = item.recipe
    regions = _regions(coverage, recipe.dx * scale, recipe.dy * scale)
    colour = np.zeros((*coverage.shape, 3), dtype=np.float32)
    alpha = np.zeros(coverage.shape, dtype=np.float32)

    def over(paint: np.ndarray, amount: np.ndarray) -> None:
        nonlocal alpha
        colour[:] = paint * amount[..., None] + colour * (1 - amount[..., None])
        alpha = amount + alpha * (1 - amount)

    if recipe.texture is not None:
        paint, opacity = _gradient(recipe.texture, coverage.shape, scale, margin)
        over(paint, opacity * coverage)
    for layer in sorted(recipe.layers, key=lambda layer: INNER[layer.region]):
        spread = blurred(regions[layer.region], layer.blur * scale)
        clip = coverage if INNER[layer.region] else 1 - coverage
        over(_rgb(layer.color), spread * clip * layer.opacity)
    alpha = alpha * item.opacity
    kept = np.maximum(alpha, 1e-6)[..., None]
    shown = np.where(alpha[..., None] > 1e-6, colour * item.opacity / kept, 0)
    pixels = np.empty((*coverage.shape, 4), dtype=np.uint8)
    pixels[:, :, :3] = np.clip(np.rint(shown * 255), 0, 255).astype(np.uint8)
    pixels[:, :, 3] = np.clip(np.rint(alpha * 255), 0, 255).astype(np.uint8)
    return pixels


def finish_document(item: StudioFinishItem, draw: DrawSources) -> Source:
    margin = finish_reach(item)
    width, height = item.width + 2 * margin, item.height + 2 * margin
    scale = min(SHARP_DPI / 72, math.sqrt(MAX_FINISH_PIXELS / max(width * height, 1.0)))
    coverage = _coverage(width, height, scale, draw, margin)
    buffer = io.BytesIO()
    Image.fromarray(_overlay(item, coverage, scale, margin), mode="RGBA").save(
        buffer, format="PNG", optimize=True
    )
    document = pymupdf.open()
    page = document.new_page(width=width, height=height)
    page.insert_image(page.rect, stream=buffer.getvalue(), keep_proportion=False)
    return document, margin
