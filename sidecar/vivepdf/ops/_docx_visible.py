import pymupdf
from pymupdf import mupdf

DEVICE_CALLBACKS = (
    "clip_path",
    "clip_stroke_path",
    "clip_text",
    "clip_stroke_text",
    "clip_image_mask",
    "end_mask",
    "pop_clip",
    "fill_image",
    "fill_image_mask",
)


def _rect(area) -> pymupdf.Rect:
    return pymupdf.Rect(area.x0, area.y0, area.x1, area.y1)


def _placed(ctm) -> pymupdf.Rect:
    unit = mupdf.FzRect(mupdf.FzRect.Fixed_UNIT)
    return _rect(mupdf.ll_fz_transform_rect(unit.internal(), ctm))


class _VisibleImages(mupdf.FzDevice2):
    def __init__(self) -> None:
        super().__init__()
        self.found: list[tuple[pymupdf.Rect, pymupdf.Rect]] = []
        self.stack: list[pymupdf.Rect] = [pymupdf.INFINITE_RECT()]
        for name in DEVICE_CALLBACKS:
            getattr(self, f"use_virtual_{name}")()

    def _push(self, area: pymupdf.Rect) -> None:
        self.stack.append(pymupdf.Rect(self.stack[-1]) & area)

    def clip_path(self, _ctx, path, _even_odd, ctm, _scissor) -> None:
        self._push(_rect(mupdf.ll_fz_bound_path(path, None, ctm)))

    def clip_stroke_path(self, _ctx, path, stroke, ctm, _scissor) -> None:
        self._push(_rect(mupdf.ll_fz_bound_path(path, stroke, ctm)))

    def clip_text(self, _ctx, text, ctm, _scissor) -> None:
        self._push(_rect(mupdf.ll_fz_bound_text(text, None, ctm)))

    def clip_stroke_text(self, _ctx, text, stroke, ctm, _scissor) -> None:
        self._push(_rect(mupdf.ll_fz_bound_text(text, stroke, ctm)))

    def clip_image_mask(self, _ctx, _image, ctm, _scissor) -> None:
        self._push(_placed(ctm))

    def end_mask(self, _ctx, *_args) -> None:
        self.stack.append(pymupdf.Rect(self.stack[-1]))

    def pop_clip(self, _ctx) -> None:
        if len(self.stack) > 1:
            self.stack.pop()

    def _record(self, ctm) -> None:
        placed = _placed(ctm)
        self.found.append((placed, pymupdf.Rect(placed) & self.stack[-1]))

    def fill_image(self, _ctx, _image, ctm, _alpha, _color_params) -> None:
        self._record(ctm)

    def fill_image_mask(self, _ctx, _image, ctm, _colorspace, _color, _alpha, _params) -> None:
        self._record(ctm)


def visible_images(page: pymupdf.Page) -> list[tuple[pymupdf.Rect, pymupdf.Rect]]:
    rotation = page.rotation
    if rotation:
        page.set_rotation(0)
    device = _VisibleImages()
    try:
        mupdf.fz_run_page(page.this, device, mupdf.FzMatrix(), mupdf.FzCookie())
        mupdf.fz_close_device(device)
    finally:
        if rotation:
            page.set_rotation(rotation)
    return device.found
