import base64
import contextlib

import pymupdf

from vivepdf.ops._document import open_document
from vivepdf.ops._font_unicode import subset_fonts
from vivepdf.ops._objects import key_holder
from vivepdf.ops._output import (
    OutputResult,
    prepare_output,
    save_document,
)
from vivepdf.ops._page_batch import SharedFonts
from vivepdf.ops._ranges import filter_side, no_pages_selected, parse_page_ranges
from vivepdf.ops._watermark_image import _stamp_image, mark_pixmap, mark_source
from vivepdf.ops._watermark_style import (
    MarkPreviewResult,
    WatermarkParams,
    WatermarkPreviewParams,
    WatermarkStyle,
    _stamp_text,
    parse_color,
)
from vivepdf.ops.fonts import (
    resolve_choice,
    uncovered_glyphs,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.registry import op

VISIBILITY_LAYER_NAME = "Watermark"
WATERMARK_OPEN = b"/Artifact <</Type/Pagination/Subtype/Watermark>> BDC\n"
WATERMARK_CLOSE = b"\nEMC\n"


def draw_as_watermark(page: pymupdf.Page, draw) -> None:
    if not page.is_wrapped:
        page.wrap_contents()
    before = set(page.get_contents())
    draw()
    document = page.parent
    for xref in page.get_contents():
        if xref in before:
            continue
        document.update_stream(xref, WATERMARK_OPEN + document.xref_stream(xref) + WATERMARK_CLOSE)


def _burn_in(page: pymupdf.Page, dpi: int) -> None:
    document = page.parent
    rotation = page.rotation
    page.set_rotation(0)
    pixmap = page.get_pixmap(dpi=dpi, alpha=False, annots=False)
    content = document.get_new_xref()
    document.update_object(content, "<<>>")
    document.update_stream(content, b" ")
    page.set_contents(content)
    document.xref_set_key(page.xref, "Resources", "<<>>")
    for key in ("Group", "PieceInfo", "StructParents"):
        document.xref_set_key(page.xref, key, "null")
    page.insert_image(page.rect, pixmap=pixmap)
    page.set_rotation(rotation)


def first_selected_index(spec: str | None, page_count: int, side: str = "all") -> tuple[int, str]:
    try:
        selected = filter_side(parse_page_ranges(spec, page_count), side)
    except OpError:
        return 0, "badRange"
    if not selected:
        return 0, "noPagesSelected"
    return selected[0], ""


def render_preview(
    page: pymupdf.Page, width: int, page_number: int, page_count: int
) -> MarkPreviewResult:
    scale = width / max(page.rect.width, 1.0)
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
    return MarkPreviewResult(
        image=base64.b64encode(pixmap.tobytes("png")).decode("ascii"),
        width=pixmap.width,
        height=pixmap.height,
        page=page_number,
        page_count=page_count,
    )


def _validate_mark(params: WatermarkStyle) -> None:
    if params.kind == "text" and not (params.text and params.text.strip()):
        raise OpError(ErrorCode.INVALID_PARAMS, "watermark text is required")
    if params.kind == "image" and not params.image_path:
        raise OpError(ErrorCode.INVALID_PARAMS, "image path is required")
    if params.kind == "pdf" and not params.template_path:
        raise OpError(ErrorCode.INVALID_PARAMS, "template path is required")


def visibility_layer(document: pymupdf.Document, visibility: str) -> int:
    on_screen = visibility == "screen"
    layer = document.add_ocg(VISIBILITY_LAYER_NAME, on=on_screen)
    printed = "ON" if visibility == "print" else "OFF"
    viewed = "ON" if on_screen else "OFF"
    document.xref_set_key(
        layer, "Usage", f"<</Print<</PrintState/{printed}>>/View<</ViewState/{viewed}>>>>"
    )
    events = (
        f"<</Event/View/OCGs[{layer} 0 R]/Category[/View]>>"
        f"<</Event/Print/OCGs[{layer} 0 R]/Category[/Print]>>"
    )
    holder, key = key_holder(document, document.pdf_catalog(), ["OCProperties", "D", "AS"])
    kind, value = document.xref_get_key(holder, key)
    kept = value.strip()[1:-1] if kind == "array" else ""
    document.xref_set_key(holder, key, f"[{kept}{events}]")
    return layer


class _Mark:
    def __init__(self, params: WatermarkStyle) -> None:
        self.params = params
        self.color = parse_color(params.color)
        self.font_file = resolve_choice(params.font_id, params.bold)
        self.font = pymupdf.Font(fontfile=str(self.font_file)) if params.kind == "text" else None
        pixmap = mark_pixmap(params)
        self.source = mark_source(pixmap) if pixmap is not None else None

    def draw(
        self,
        page: pymupdf.Page,
        layer: int = 0,
        shared: tuple[SharedFonts, int] | None = None,
    ) -> None:
        if self.font is not None:
            draw_as_watermark(
                page,
                lambda: _stamp_text(
                    page, self.params, self.font, self.font_file, self.color, layer, shared
                ),
            )
        elif self.source is not None:
            draw_as_watermark(page, lambda: _stamp_image(page, self.params, self.source, layer))

    def close(self) -> None:
        if self.source is not None:
            self.source.close()


@op("security.watermark", WatermarkParams)
def watermark(params: WatermarkParams, progress: Progress) -> OutputResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    _validate_mark(params)
    mark = _Mark(params)
    try:
        with open_document(params.path, params.password) as document:
            indices = filter_side(parse_page_ranges(params.pages, document.page_count), params.side)
            if not indices:
                raise no_pages_selected()
            pages = [document[index] for index in indices]
            page_xrefs = [document.page_xref(index) for index in indices]
            fonts = SharedFonts(document)
            layer = (
                visibility_layer(document, params.visibility)
                if params.visibility != "always" and not params.flatten
                else 0
            )
            for position, (page, page_xref) in enumerate(zip(pages, page_xrefs, strict=True)):
                progress.check_cancelled()
                mark.draw(page, layer, (fonts, page_xref))
                if params.flatten:
                    _burn_in(page, params.flatten_dpi)
                if position % 20 == 0:
                    progress.report(
                        position / len(indices),
                        "progress.stamping",
                        {"current": position + 1, "total": len(indices)},
                    )
            if mark.font is not None and not params.flatten:
                with contextlib.suppress(Exception):
                    subset_fonts(document, fallback=False)
            progress.report(0.9, "progress.saving")
            return save_document(document, target)
    finally:
        mark.close()


@op("security.watermark_preview", WatermarkPreviewParams)
def watermark_preview(params: WatermarkPreviewParams, _progress: Progress) -> MarkPreviewResult:
    _validate_mark(params)
    mark = _Mark(params)
    missing = uncovered_glyphs(mark.font_file, params.text or "") if params.kind == "text" else ""
    try:
        with open_document(params.path, params.password) as document:
            index, pages_problem = first_selected_index(
                params.pages, document.page_count, params.side
            )
            page = document[index]
            mark.draw(page)
            result = render_preview(page, params.width, index + 1, document.page_count)
            result.missing_glyphs = missing
            result.pages_problem = pages_problem
            return result
    finally:
        mark.close()
