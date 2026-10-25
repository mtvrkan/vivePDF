import contextlib
import hashlib
import math
from dataclasses import dataclass

import pymupdf
from pymupdf import mupdf

from vivepdf.ops._page_images import MAX_IMAGE_SIDE

TOUCH_GAP = 1.0
TILE_SLACK = 1.02
INSIDE_SHARE = 0.9
DPI_SPREAD = 1.5
BACKDROP_SHARE = 0.9
SHOWN_PIXELS = 40_000_000
LOWEST_DPI = 72
PHOTO_QUALITY = 90


@dataclass(slots=True)
class ShownImage:
    area: pymupdf.Rect
    dpi: float
    photo: bool
    covered: float
    key: tuple[str, ...] | None


def _rect(rect) -> pymupdf.Rect:
    return pymupdf.Rect(rect.x0, rect.y0, rect.x1, rect.y1)


def _source_key(image, placed: pymupdf.Rect, area: pymupdf.Rect) -> str | None:
    compressed = mupdf.ll_fz_compressed_image_buffer(image)
    if compressed is None:
        return None
    data = mupdf.FzBuffer(mupdf.ll_fz_keep_buffer(compressed.buffer)).fz_buffer_extract_copy()
    crop = (
        (area.x0 - placed.x0) / placed.width,
        (area.y0 - placed.y0) / placed.height,
        area.width / placed.width,
        area.height / placed.height,
    )
    digest = hashlib.sha1(data)
    digest.update(f"{image.w}x{image.h}:{','.join(f'{value:.3f}' for value in crop)}".encode())
    return digest.hexdigest()


def _placed(ctm) -> pymupdf.Rect:
    corners = [
        pymupdf.Point(ctm.e + ctm.a * x + ctm.c * y, ctm.f + ctm.b * x + ctm.d * y)
        for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))
    ]
    return pymupdf.Rect(
        min(point.x for point in corners),
        min(point.y for point in corners),
        max(point.x for point in corners),
        max(point.y for point in corners),
    )


class _ShownImages(mupdf.FzDevice2):
    def __init__(self, page_area: pymupdf.Rect) -> None:
        super().__init__()
        for name in (
            "clip_path",
            "clip_stroke_path",
            "clip_text",
            "clip_stroke_text",
            "clip_image_mask",
            "begin_mask",
            "end_mask",
            "pop_clip",
            "fill_image",
            "fill_image_mask",
        ):
            getattr(self, f"use_virtual_{name}")()
        self.clips = [page_area]
        self.images: list[ShownImage] = []
        self.masking = 0

    def _push(self, area: pymupdf.Rect) -> None:
        self.clips.append(self.clips[-1] & area)

    def clip_path(self, ctx, path, even_odd, ctm, scissor):
        self._push(_rect(mupdf.ll_fz_bound_path(path, None, ctm)) & _rect(scissor))

    def clip_stroke_path(self, ctx, path, stroke, ctm, scissor):
        self._push(_rect(scissor))

    def clip_text(self, ctx, text, ctm, scissor):
        self._push(_rect(scissor))

    def clip_stroke_text(self, ctx, text, stroke, ctm, scissor):
        self._push(_rect(scissor))

    def clip_image_mask(self, ctx, image, ctm, scissor):
        self._push(_placed(ctm) & _rect(scissor))

    def begin_mask(self, ctx, area, luminosity, colorspace, color, color_params):
        self._push(_rect(area))
        self.masking += 1

    def end_mask(self, ctx, function):
        self.masking = max(0, self.masking - 1)

    def pop_clip(self, ctx):
        if len(self.clips) > 1:
            self.clips.pop()

    def _shown(self, image, ctm) -> None:
        if self.masking:
            return
        placed = _placed(ctm)
        area = placed & self.clips[-1]
        if area.is_empty or placed.width <= 0 or placed.height <= 0:
            return
        dpi = max(image.w / placed.width, image.h / placed.height) * 72
        photo = mupdf.ll_fz_compressed_image_type(image) == mupdf.FZ_IMAGE_JPEG
        key = _source_key(image, placed, area)
        self.images.append(
            ShownImage(area, dpi, photo, abs(area), (key,) if key is not None else None)
        )

    def fill_image(self, ctx, image, ctm, alpha, color_params):
        self._shown(image, ctm)

    def fill_image_mask(self, ctx, image, ctm, colorspace, color, alpha, color_params):
        self._shown(image, ctm)


def shown_images(page: pymupdf.Page) -> list[ShownImage]:
    device = _ShownImages(page.rect)
    with contextlib.suppress(mupdf.FzErrorBase):
        mupdf.fz_run_page(page.this, device, mupdf.FzMatrix(), mupdf.FzCookie())
    return device.images


def _touching(first: pymupdf.Rect, second: pymupdf.Rect) -> bool:
    return (
        first.x0 - TOUCH_GAP <= second.x1
        and second.x0 - TOUCH_GAP <= first.x1
        and first.y0 - TOUCH_GAP <= second.y1
        and second.y0 - TOUCH_GAP <= first.y1
    )


def _together(first: ShownImage, second: ShownImage) -> bool:
    if not _touching(first.area, second.area):
        return False
    overlap = abs(first.area & second.area)
    if overlap >= min(abs(first.area), abs(second.area)) * INSIDE_SHARE:
        return True
    if abs(first.area | second.area) <= (first.covered + second.covered - overlap) * TILE_SLACK:
        return True
    return max(first.dpi, second.dpi) <= min(first.dpi, second.dpi) * DPI_SPREAD


def merged_images(images: list[ShownImage]) -> list[ShownImage]:
    groups: list[ShownImage] = []
    for image in images:
        merged = ShownImage(
            pymupdf.Rect(image.area), image.dpi, image.photo, image.covered, image.key
        )
        joined = True
        while joined:
            joined = False
            for group in groups:
                if _together(group, merged):
                    groups.remove(group)
                    merged.covered += group.covered - abs(group.area & merged.area)
                    merged.area |= group.area
                    merged.dpi = max(merged.dpi, group.dpi)
                    merged.photo = merged.photo and group.photo
                    merged.key = (
                        tuple(sorted(merged.key + group.key))
                        if merged.key is not None and group.key is not None
                        else None
                    )
                    joined = True
                    break
        groups.append(merged)
    return sorted(groups, key=lambda group: (group.area.y0, group.area.x0))


def _is_backdrop(page: pymupdf.Page, images: list[ShownImage], position: int) -> bool:
    area = images[position].area
    if abs(area & page.rect) < abs(page.rect) * BACKDROP_SHARE:
        return False
    if any(not (image.area & area).is_empty for image in images[position + 1 :]):
        return True
    return any(
        span.get("alpha", 255) and span["text"].strip()
        for block in page.get_text("dict", clip=area)["blocks"]
        for line in block.get("lines", [])
        for span in line["spans"]
    )


def page_pictures(page: pymupdf.Page) -> tuple[list[ShownImage], int]:
    shown = shown_images(page)
    pictures = [
        image for position, image in enumerate(shown) if not _is_backdrop(page, shown, position)
    ]
    return merged_images(pictures), len(shown) - len(pictures)


def render_dpi(area: pymupdf.Rect, native: float) -> int:
    square_inches = area.width * area.height / (72 * 72)
    by_pixels = math.sqrt(SHOWN_PIXELS / square_inches) if square_inches else native
    by_side = (MAX_IMAGE_SIDE["png"] - 2) * 72 / max(area.width, area.height, 1)
    return max(1, math.floor(min(max(native, LOWEST_DPI), by_pixels, by_side)))


def shown_picture(page: pymupdf.Page, image: ShownImage) -> tuple[pymupdf.Pixmap, bytes, str]:
    pixmap = page.get_pixmap(clip=image.area, dpi=render_dpi(image.area, image.dpi))
    if image.photo:
        return pixmap, pixmap.tobytes("jpg", jpg_quality=PHOTO_QUALITY), "jpg"
    return pixmap, pixmap.tobytes("png"), "png"
