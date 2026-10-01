import io
import math
from collections.abc import Callable
from pathlib import Path

import pymupdf
from docx.table import Table, _Cell
from pdf2docx import Converter
from pdf2docx.common.Collection import ElementCollection
from pdf2docx.image import ImagesExtractor as images_extractor
from pdf2docx.page.Page import Page
from pdf2docx.page.Pages import Pages
from pdf2docx.page.RawPageFitz import RawPageFitz
from pdf2docx.shape.Shapes import Shapes
from pdf2docx.table.TableBlock import TableBlock

from vivepdf.ops._docx_bidi import mark_right_to_left
from vivepdf.ops._docx_contours import inner_contours
from vivepdf.ops._docx_parallel import ParallelParse, worker_count
from vivepdf.ops._docx_running import RunningText, add_running_text
from vivepdf.ops._output import write_atomically
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress

ANALYSIS_BAND = (0.05, 0.35)
PARSING_BAND = (0.35, 0.8)
MAKING_BAND = (0.82, 0.97)
HIDDEN_TEXT_SHARE = 0.9
HIDDEN_RENDER_MODE = 3
CLIP_PIXEL_BUDGET = 40_000_000
MAX_CLIP_RATIO = 4.0


class ConversionCancelled(BaseException):
    pass


class _MergeAwareCell(_Cell):
    def merge(self, other_cell):
        table = self._parent
        try:
            merged = super().merge(other_cell)
        except BaseException:
            table.cell_cache = None
            raise
        if isinstance(table, _CachedCellsTable):
            table.cover_span(merged._tc)
        return merged


class _CachedCellsTable(Table):
    cell_cache: list | None = None

    @property
    def _cells(self):
        if self.cell_cache is None:
            cells = Table._cells.fget(self)
            for cell in cells:
                cell.__class__ = _MergeAwareCell
            self.cell_cache = cells
        return self.cell_cache

    def cover_span(self, tc) -> None:
        if self.cell_cache is None:
            return
        columns = self._column_count
        cell = _MergeAwareCell(tc, self)
        for row in range(tc.top, tc.bottom):
            for column in range(tc.left, tc.right):
                self.cell_cache[row * columns + column] = cell


_plain_table_make_docx = TableBlock.make_docx
_unordered_text_style_shapes = Shapes.text_style_shapes.fget
_plain_extract_raw_dict = RawPageFitz.extract_raw_dict


def text_is_only_hidden(page: pymupdf.Page) -> bool:
    hidden = shown = 0
    for span in page.get_texttrace():
        count = len(span.get("chars", ()))
        if span.get("type") == HIDDEN_RENDER_MODE:
            hidden += count
        else:
            shown += count
    return hidden > 0 and hidden >= HIDDEN_TEXT_SHARE * (hidden + shown)


def _extract_with_recognised_text(raw_page: RawPageFitz, **settings):
    engine = raw_page.page_engine
    if engine is not None and settings.get("ocr") == 0 and text_is_only_hidden(engine):
        settings = {**settings, "ocr": 2}
    return _plain_extract_raw_dict(raw_page, **settings)


def clip_ratio(largest_page_area: float) -> float:
    if largest_page_area <= 0:
        return MAX_CLIP_RATIO
    return max(1.0, min(MAX_CLIP_RATIO, math.sqrt(CLIP_PIXEL_BUDGET / largest_page_area)))


def _make_table_with_cached_cells(block: TableBlock, table: Table) -> None:
    table.__class__ = _CachedCellsTable
    try:
        _plain_table_make_docx(block, table)
    finally:
        table.__class__ = Table


def _ordered_text_style_shapes(shapes: Shapes) -> ElementCollection:
    chosen = {id(shape) for shape in _unordered_text_style_shapes(shapes)}
    return ElementCollection([shape for shape in shapes._instances if id(shape) in chosen])


def hide_page_text_and_images(
    page: pymupdf.Page, rm_text: bool, rm_image: bool
) -> dict[int, bytes]:
    xref_list = [xref for (xref, _name, _invoker, _bbox) in page.get_xobjects()]
    xref_list.extend(page.get_contents())
    image_names = [item[7] for item in page.get_images(full=True)] if rm_image else []

    def hide_text(stream: bytes) -> tuple[bytes, bool]:
        result = stream
        found = False
        for key in ["BT", "Tm", "Td", "2 Tr"]:
            marker = key.encode()
            if marker in stream:
                found = True
                result = result.replace(marker, f"{key} 3 Tr".encode())
        return result, found

    def hide_images(stream: bytes) -> tuple[bytes, bool]:
        result = stream
        found = False
        for name in image_names:
            marker = f"/{name} Do".encode()
            if marker in stream:
                found = True
                result = result.replace(marker, b"")
        return result, found

    document = page.parent
    source: dict[int, bytes] = {}
    for xref in xref_list:
        original = document.xref_stream(xref)
        stream, found_text = hide_text(original) if rm_text else (original, False)
        stream, found_images = hide_images(stream) if rm_image else (stream, False)
        if found_text or found_images:
            document.update_stream(xref, stream)
            source[xref] = original
    return source


class _PageInItsOwnFrame:
    def __init__(self, page: pymupdf.Page) -> None:
        object.__setattr__(self, "_page", page)

    def __getattr__(self, name: str) -> object:
        return getattr(object.__getattribute__(self, "_page"), name)

    @property
    def cropbox(self) -> pymupdf.Rect:
        box = object.__getattribute__(self, "_page").cropbox
        return pymupdf.Rect(0, 0, box.width, box.height)


_plain_extract_images = images_extractor.ImagesExtractor.extract_images


def _extract_images_inside_the_page(extractor, *args, **kwargs):
    page = extractor._page
    extractor._page = _PageInItsOwnFrame(page)
    try:
        return _plain_extract_images(extractor, *args, **kwargs)
    finally:
        extractor._page = page


_plain_to_raw_dict = images_extractor.ImagesExtractor._to_raw_dict


def _to_raw_dict_even_when_empty(image: pymupdf.Pixmap, bbox: pymupdf.Rect) -> dict:
    if image.width < 1 or image.height < 1:
        image = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 1, 1), True)
        image.clear_with(255)
        image.set_alpha(bytes(1))
    return _plain_to_raw_dict(image, bbox)


def stabilise_pdf2docx() -> None:
    TableBlock.make_docx = _make_table_with_cached_cells
    Shapes.text_style_shapes = property(_ordered_text_style_shapes)
    images_extractor.inner_contours = inner_contours
    images_extractor.ImagesExtractor.extract_images = _extract_images_inside_the_page
    images_extractor.ImagesExtractor._to_raw_dict = staticmethod(_to_raw_dict_even_when_empty)
    images_extractor.ImagesExtractor._hide_page_text_and_images = staticmethod(
        hide_page_text_and_images
    )
    RawPageFitz.extract_raw_dict = _extract_with_recognised_text


class ObservedPages(Pages):
    observer: Callable[[], None] | None = None

    def __iter__(self):
        for page in super().__iter__():
            if self.observer is not None and not page.skip_parsing:
                self.observer()
            yield page


class ObservedPage(Page):
    observer: Callable[[str], None] | None = None
    on_made: Callable[[int], None] | None = None

    def parse(self, **settings):
        if self.observer is not None:
            self.observer("parse")
        return super().parse(**settings)

    def make_docx(self, doc):
        if self.observer is not None:
            self.observer("make")
        made = super().make_docx(doc)
        if self.on_made is not None:
            self.on_made(self.id)
        return made


class DocxRun:
    def __init__(self, converter: Converter, progress: Progress, total: int):
        self.converter = converter
        self.progress = progress
        self.total = max(1, total)
        self.analysed = 0
        self.parsed = 0
        self.made = 0
        self.made_pages: set[int] = set()

    def _report(self, band: tuple[float, float], done: int) -> None:
        start, end = band
        self.progress.report(
            start + (end - start) * done / self.total,
            "progress.convertingPages",
            {"current": min(done + 1, self.total), "total": self.total},
        )

    def _stop_if_cancelled(self) -> None:
        if self.progress.cancelled:
            raise ConversionCancelled

    def on_analysed(self) -> None:
        self._stop_if_cancelled()
        self._report(ANALYSIS_BAND, self.analysed)
        self.analysed += 1

    def on_page(self, phase: str) -> None:
        self._stop_if_cancelled()
        if phase == "parse":
            start, end = PARSING_BAND
            self.progress.report(
                start + (end - start) * self.parsed / self.total, "progress.converting"
            )
            self.parsed += 1
            return
        self._report(MAKING_BAND, self.made)
        self.made += 1

    def _observe_pages(self) -> None:
        for page in self.converter.pages:
            page.__class__ = ObservedPage
            page.observer = self.on_page
            page.on_made = self.made_pages.add

    def _parse_here(self, indices: list[int], settings: dict) -> None:
        self.converter.load_pages(pages=indices)
        pages = self.converter.pages
        pages.__class__ = ObservedPages
        pages.observer = self.on_analysed
        try:
            self.converter.parse_document(**settings)
        finally:
            pages.observer = None
        self._stop_if_cancelled()
        self._observe_pages()
        self.converter.parse_pages(**settings)

    def _parse_in_workers(self, indices: list[int], settings: dict, workers: int) -> None:
        parser = ParallelParse(
            self.converter.filename_pdf,
            self.converter.password or None,
            self.on_analysed,
            self._stop_if_cancelled,
        )
        parsed = {page.id: page for page in parser.run(indices, settings, workers)}
        self._stop_if_cancelled()
        self.progress.report(PARSING_BAND[1], "progress.converting")
        self.converter.load_pages(pages=indices)
        pages = self.converter.pages
        pages.reset([parsed.get(page.id, page) for page in list(pages)])

    def run(
        self,
        indices: list[int],
        target: Path,
        image_ratio: float = MAX_CLIP_RATIO,
        right_to_left: bool = False,
        running: RunningText | None = None,
    ) -> list[int]:
        stabilise_pdf2docx()
        settings = {**self.converter.default_settings, "clip_image_res_ratio": image_ratio}
        workers = worker_count(len(indices))
        try:
            if workers > 1:
                self._parse_in_workers(indices, settings, workers)
            else:
                self._parse_here(indices, settings)
            self._stop_if_cancelled()
            self._observe_pages()
            buffer = io.BytesIO()
            self.converter.make_docx(buffer, **settings)
            self._stop_if_cancelled()
        except ConversionCancelled:
            raise OpError(ErrorCode.CANCELLED, "operation cancelled") from None
        data = buffer.getvalue()
        if running is not None and running.lines:
            data = add_running_text(data, running)
        if right_to_left:
            data = mark_right_to_left(data)
        write_atomically(target, lambda partial: partial.write_bytes(data))
        return [index + 1 for index in indices if index not in self.made_pages]
