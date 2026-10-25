import io
import math
from collections.abc import Callable
from pathlib import Path

import pymupdf
from docx.opc.constants import RELATIONSHIP_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from pdf2docx import Converter
from pdf2docx.common import docx as docx_helpers
from pdf2docx.common.Collection import ElementCollection
from pdf2docx.common.share import RectType
from pdf2docx.font.Fonts import Fonts
from pdf2docx.image import ImagesExtractor as images_extractor
from pdf2docx.page.Page import Page
from pdf2docx.page.Pages import Pages
from pdf2docx.page.RawPageFitz import RawPageFitz
from pdf2docx.shape.Shapes import Shapes
from pdf2docx.table.Cell import Cell
from pdf2docx.table.TableBlock import TableBlock
from pdf2docx.text.Line import Line
from pdf2docx.text.Lines import Lines
from pdf2docx.text.TextSpan import TextSpan

from vivepdf.ops._docx_bidi import mark_right_to_left
from vivepdf.ops._docx_contours import inner_contours
from vivepdf.ops._docx_fonts import embed_fonts
from vivepdf.ops._docx_graphics import add_slanted_text, add_unused_graphics
from vivepdf.ops._docx_images import (
    _to_raw_dict_even_when_empty,
    extract_images_inside_the_page,
    hide_page_text_and_images,
)
from vivepdf.ops._docx_lines import (
    make_line_keeping_word_gap,
    parse_line_break_before_list_items,
)
from vivepdf.ops._docx_parallel import ParallelParse, worker_count
from vivepdf.ops._docx_raw import STYLE_SUFFIX, extract_with_recognised_text
from vivepdf.ops._docx_running import RunningText, add_running_text
from vivepdf.ops._docx_tables import make_cell_sizing_its_column, make_table_with_cached_cells
from vivepdf.ops._output import write_atomically
from vivepdf.ops._pptx_layout import FONT_STYLE, FONT_SUFFIXES
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress

ANALYSIS_BAND = (0.05, 0.35)
PARSING_BAND = (0.35, 0.8)
MAKING_BAND = (0.82, 0.97)
CLIP_PIXEL_BUDGET = 40_000_000
MAX_CLIP_RATIO = 4.0


class ConversionCancelled(BaseException):
    pass


_unordered_text_style_shapes = Shapes.text_style_shapes.fget


def clip_ratio(largest_page_area: float) -> float:
    if largest_page_area <= 0:
        return MAX_CLIP_RATIO
    return max(1.0, min(MAX_CLIP_RATIO, math.sqrt(CLIP_PIXEL_BUDGET / largest_page_area)))


def _ordered_text_style_shapes(shapes: Shapes) -> ElementCollection:
    chosen = {id(shape) for shape in _unordered_text_style_shapes(shapes)}
    return ElementCollection([shape for shape in shapes._instances if id(shape) in chosen])


def _link_target(span: TextSpan) -> str | None:
    if not span.text.strip():
        return None
    for style in span.style:
        if style["type"] == RectType.HYPERLINK.value:
            return style["uri"]
    return None


def _make_span_with_valid_link(span: TextSpan, paragraph) -> None:
    run = paragraph.add_run(span.text)
    span._set_text_format(run)
    if span.char_spacing:
        docx_helpers.set_char_spacing(run, span.char_spacing)
    target = _link_target(span)
    if target is None:
        return
    link = OxmlElement("w:hyperlink")
    link.set(
        qn("r:id"), paragraph.part.relate_to(target, RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
    )
    link.set(qn("w:history"), "1")
    run._r.addprevious(link)
    link.append(run._r)


_plain_parse_pages = Converter.parse_pages


def _parse_pages_keeping_graphics(converter: Converter, **settings) -> Converter:
    _plain_parse_pages(converter, **settings)
    for page in converter.pages:
        if page.finalized:
            engine = converter.fitz_doc[page.id]
            add_unused_graphics(page, engine, settings["clip_image_res_ratio"])
            add_slanted_text(page, engine, settings["clip_image_res_ratio"])
    return converter


def _family_without_style(name: str) -> str:
    plain = name.split("+")[-1].split("-")[0]
    match = STYLE_SUFFIX.match(plain)
    return match.group(1).strip() if match else plain


def _without_style_words(name: str) -> str:
    words = name.split()
    while len(words) > 1 and FONT_STYLE.fullmatch(words[-1]):
        words.pop()
    return " ".join(words)


def _font_keys(name: str) -> list[str]:
    plain = _without_style_words(_family_without_style(name))
    bare = [
        plain[: -len(suffix)]
        for suffix in FONT_SUFFIXES
        if plain.endswith(suffix) and not plain[: -len(suffix)].endswith(" ")
    ]
    keys = [name.split("+")[-1], *bare[:1], plain]
    return [Fonts._to_descriptor(key) for key in keys if key]


def _exact_font(fonts: Fonts, font_name: str):
    for key in _font_keys(font_name or ""):
        for font in fonts:
            if font.descriptor == key:
                return font
    return None


def stabilise_pdf2docx() -> None:
    Fonts._normalized_font_name = staticmethod(_family_without_style)
    Fonts.get = _exact_font
    Converter.parse_pages = _parse_pages_keeping_graphics
    Lines.parse_line_break = parse_line_break_before_list_items
    Cell.make_docx = make_cell_sizing_its_column
    Line.make_docx = make_line_keeping_word_gap
    TextSpan.make_docx = _make_span_with_valid_link
    TableBlock.make_docx = make_table_with_cached_cells
    Shapes.text_style_shapes = property(_ordered_text_style_shapes)
    images_extractor.inner_contours = inner_contours
    images_extractor.ImagesExtractor.extract_images = extract_images_inside_the_page
    images_extractor.ImagesExtractor._to_raw_dict = staticmethod(_to_raw_dict_even_when_empty)
    images_extractor.ImagesExtractor._hide_page_text_and_images = staticmethod(
        hide_page_text_and_images
    )
    RawPageFitz.extract_raw_dict = extract_with_recognised_text


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
        font_source: pymupdf.Document | None = None,
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
        data = embed_fonts(
            data,
            self.converter.fitz_doc if font_source is None else font_source,
            indices,
            self.progress.check_cancelled,
        )
        write_atomically(target, lambda partial: partial.write_bytes(data))
        return [index + 1 for index in indices if index not in self.made_pages]
