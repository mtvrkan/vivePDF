import re
from collections import Counter
from contextlib import ExitStack
from typing import Literal

import numpy as np
import pymupdf
from pydantic import Field

from vivepdf.ops._blank import blank_page
from vivepdf.ops._document import open_document
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._page_similarity import (
    PageSignature,
    duplicate_groups,
    page_ink,
    page_signature,
)
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._visibility import drop_unseen
from vivepdf.ops.page_geometry import PAPER_SIZES, visible_box
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

INK_DPI = 40
INK_DARK_THRESHOLD = 200
BLANK_INK_RATIO_LIMIT = 0.003
BLANK_IMAGE_COVERAGE_LIMIT = 0.02
SCANNED_TEXT_CHARS_LIMIT = 20
SCANNED_IMAGE_COVERAGE_LIMIT = 0.6
MAX_DUPLICATE_SOURCES = 200
INVISIBLE_TEXT = 3
OCR_LAYER_SHARE = 0.8
PAGE_NUMBER_ONLY = re.compile(r"[\s\d\-–—.,:/()\[\]|]{1,12}|[ivxlcdm]{1,7}\.?", re.IGNORECASE)
LEFT_BLANK_PHRASES = (
    "intentionally left blank",
    "intentionally blank",
    "bilerek boş bırakılmıştır",
    "bilerek boş bırakıldı",
    "kasten boş bırakılmıştır",
)

Layout = Literal["2up", "3up", "4up", "6up", "8up", "9up", "12up", "16up", "booklet", "custom"]
Paper = Literal["a4", "a3", "letter", "tabloid", "auto"]
Orientation = Literal["auto", "portrait", "landscape"]
Arrangement = Literal["rows", "columns"]
Reading = Literal["ltr", "rtl"]
Binding = Literal["left", "right"]
Duplex = Literal["both", "front", "back"]
CellScale = Literal["fit", "original"]

_GRID: dict[str, tuple[int, int]] = {
    "2up": (2, 1),
    "3up": (3, 1),
    "4up": (2, 2),
    "6up": (3, 2),
    "8up": (4, 2),
    "9up": (3, 3),
    "12up": (4, 3),
    "16up": (4, 4),
    "booklet": (2, 1),
}


class AnalyzeParams(RpcModel):
    path: str
    password: str | None = None
    pages: str | None = None


class PageAnalysis(RpcModel):
    index: int
    blank: bool
    scanned: bool
    has_text: bool
    text_chars: int
    image_coverage: float
    ink_ratio: float


class AnalyzeResult(RpcModel):
    page_count: int
    pages: list[PageAnalysis]
    blank_pages: list[int]
    scanned_pages: list[int]


def _image_coverage(page: pymupdf.Page) -> float:
    rect = page.rect
    area = rect.width * rect.height
    if area <= 0:
        return 0.0
    covered = 0.0
    for info in page.get_image_info():
        bbox = pymupdf.Rect(info["bbox"]) & rect
        if not bbox.is_empty:
            covered += bbox.width * bbox.height
    return min(covered / area, 1.0)


def _ink_ratio(page: pymupdf.Page) -> float:
    zoom = INK_DPI / 72
    matrix = pymupdf.Matrix(zoom, zoom)
    pixmap = page.get_pixmap(matrix=matrix, colorspace=pymupdf.csGRAY, alpha=False)
    samples = pixmap.samples
    if not samples:
        return 0.0
    return float((np.frombuffer(samples, dtype=np.uint8) < INK_DARK_THRESHOLD).mean())


def _meaningless_text(text: str) -> bool:
    if not text or PAGE_NUMBER_ONLY.fullmatch(text):
        return True
    folded = " ".join(text.casefold().split())
    return len(folded) <= 80 and any(phrase in folded for phrase in LEFT_BLANK_PHRASES)


def _analyze_page(document: pymupdf.Document, index: int) -> PageAnalysis:
    page = document[index]
    text = page.get_text("text").strip()
    text_chars = len(text)
    image_coverage = _image_coverage(page)
    ink_ratio = _ink_ratio(page)
    blank = _meaningless_text(text) and (
        (ink_ratio < BLANK_INK_RATIO_LIMIT and image_coverage < BLANK_IMAGE_COVERAGE_LIMIT)
        or (image_coverage > SCANNED_IMAGE_COVERAGE_LIMIT and blank_page(page))
    )
    scanned = (
        text_chars < SCANNED_TEXT_CHARS_LIMIT and image_coverage > SCANNED_IMAGE_COVERAGE_LIMIT
    )
    return PageAnalysis(
        index=index,
        blank=blank,
        scanned=scanned,
        has_text=text_chars > 0,
        text_chars=text_chars,
        image_coverage=image_coverage,
        ink_ratio=ink_ratio,
    )


class DuplicateSource(RpcModel):
    path: str
    password: str | None = None


class DuplicatesParams(RpcModel):
    sources: list[DuplicateSource] = Field(min_length=1, max_length=MAX_DUPLICATE_SOURCES)


class DuplicatesResult(RpcModel):
    page_counts: list[int]
    groups: list[list[int | None]]
    group_count: int


def _ocr_only(page: pymupdf.Page) -> bool:
    counts = Counter()
    for span in page.get_texttrace():
        counts[span.get("type") == INVISIBLE_TEXT] += len(span.get("chars", ()))
    total = counts[True] + counts[False]
    return total > 0 and counts[True] / total >= OCR_LAYER_SHARE


@op("pages.duplicates", DuplicatesParams)
def duplicates(params: DuplicatesParams, progress: Progress) -> DuplicatesResult:
    with ExitStack() as stack:
        documents = [
            stack.enter_context(open_document(source.path, source.password, require_pdf=False))
            for source in params.sources
        ]
        pages = [
            (document, index) for document in documents for index in range(document.page_count)
        ]
        total = len(pages)
        reading = progress.within(0.0, 0.6)
        signatures: list[PageSignature | None] = []
        for position, (document, index) in enumerate(pages):
            reading.check_cancelled()
            page = document[index]
            signatures.append(page_signature(page, _ocr_only(page)))
            if (position + 1) % 10 == 0:
                reading.report(
                    (position + 1) / total,
                    "progress.analyzing",
                    {"current": position + 1, "total": total},
                )
        groups = duplicate_groups(
            signatures,
            lambda position: page_ink(pages[position][0][pages[position][1]]),
            progress.within(0.6, 1.0),
        )
        page_counts = [document.page_count for document in documents]
    split: list[list[int | None]] = []
    offset = 0
    for count in page_counts:
        split.append(groups[offset : offset + count])
        offset += count
    labels = {group for group in groups if group is not None}
    return DuplicatesResult(page_counts=page_counts, groups=split, group_count=len(labels))


@op("pages.analyze", AnalyzeParams)
def analyze(params: AnalyzeParams, progress: Progress) -> AnalyzeResult:
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        pages: list[PageAnalysis] = []
        for position, index in enumerate(indices):
            progress.check_cancelled()
            pages.append(_analyze_page(document, index))
            if (position + 1) % 10 == 0:
                progress.report(
                    (position + 1) / len(indices),
                    "progress.analyzing",
                    {"current": position + 1, "total": len(indices)},
                )
        return AnalyzeResult(
            page_count=document.page_count,
            pages=pages,
            blank_pages=[page.index for page in pages if page.blank],
            scanned_pages=[page.index for page in pages if page.scanned],
        )


class ImposeParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    layout: Layout
    columns: int = Field(default=2, ge=1, le=12)
    rows: int = Field(default=2, ge=1, le=12)
    paper: Paper = "auto"
    orientation: Orientation = "auto"
    margin: float = Field(default=18.0, ge=0)
    gap: float = Field(default=8.0, ge=0)
    gutter: float = Field(default=0.0, ge=0, le=200)
    arrangement: Arrangement = "rows"
    reading: Reading = "ltr"
    binding: Binding = "left"
    duplex: Duplex = "both"
    flip_short_edge: bool = False
    creep: float = Field(default=0.0, ge=0, le=20)
    scale: CellScale = "fit"
    auto_rotate: bool = True
    border: bool = False
    border_width: float = Field(default=0.5, gt=0, le=6)
    guides: bool = False
    pages: str | None = None


class ImposeResult(OutputResult):
    sheets: int


def _grid_of(params: ImposeParams) -> tuple[int, int]:
    if params.layout == "custom":
        return (params.columns, params.rows)
    return _GRID[params.layout]


def _cell_order(cols: int, rows: int, arrangement: Arrangement, reading: Reading) -> list[int]:
    order: list[int] = []
    if arrangement == "rows":
        for row in range(rows):
            columns = range(cols) if reading == "ltr" else range(cols - 1, -1, -1)
            order.extend(row * cols + col for col in columns)
    else:
        columns = range(cols) if reading == "ltr" else range(cols - 1, -1, -1)
        for col in columns:
            order.extend(row * cols + col for row in range(rows))
    return order


def _common_rect(source: pymupdf.Document, indices: list[int]) -> pymupdf.Rect:
    seen: dict[tuple[int, int], pymupdf.Rect] = {}
    counts: Counter[tuple[int, int]] = Counter()
    for index in indices:
        rect = source[index].rect
        key = (round(rect.width), round(rect.height))
        seen.setdefault(key, rect)
        counts[key] += 1
    return seen[counts.most_common(1)[0][0]]


def _base_size(paper: Paper, common_rect: pymupdf.Rect) -> tuple[float, float]:
    if paper == "auto":
        return (common_rect.width, common_rect.height)
    return PAPER_SIZES[paper]


def _sheet_size(
    layout: Layout, paper: Paper, orientation: Orientation, common_rect: pymupdf.Rect
) -> tuple[float, float]:
    width, height = _base_size(paper, common_rect)
    if orientation == "landscape":
        want_landscape = True
    elif orientation == "portrait":
        want_landscape = False
    else:
        want_landscape = layout in ("2up", "booklet")
    if want_landscape != (width > height):
        width, height = height, width
    return (width, height)


def _padded_indices(indices: list[int], multiple: int) -> list[int | None]:
    padded: list[int | None] = list(indices)
    while len(padded) % multiple != 0:
        padded.append(None)
    return padded


def _booklet_order(count: int) -> list[int]:
    low, high = 0, count - 1
    order: list[int] = []
    pair_index = 0
    while low < high:
        if pair_index % 2 == 0:
            order.extend([high, low])
        else:
            order.extend([low, high])
        low += 1
        high -= 1
        pair_index += 1
    return order


def _cell_rect(
    sheet_rect: pymupdf.Rect,
    margin: float,
    gap: float,
    gutter: float,
    cols: int,
    rows: int,
    col: int,
    row: int,
) -> pymupdf.Rect:
    spine = cols % 2 == 0
    spine_gaps = gutter if spine else 0.0
    available_width = sheet_rect.width - 2 * margin - gap * (cols - 1) - spine_gaps
    available_height = sheet_rect.height - 2 * margin - gap * (rows - 1)
    cell_width = available_width / cols
    cell_height = available_height / rows
    x0 = sheet_rect.x0 + margin + col * (cell_width + gap)
    if spine and col >= cols // 2:
        x0 += gutter
    y0 = sheet_rect.y0 + margin + row * (cell_height + gap)
    return pymupdf.Rect(x0, y0, x0 + cell_width, y0 + cell_height)


def _fit_rect(cell: pymupdf.Rect, source_rect: pymupdf.Rect, scale: CellScale) -> pymupdf.Rect:
    factor = min(cell.width / source_rect.width, cell.height / source_rect.height)
    if scale == "original":
        factor = min(factor, 1.0)
    width, height = source_rect.width * factor, source_rect.height * factor
    x0 = cell.x0 + (cell.width - width) / 2
    y0 = cell.y0 + (cell.height - height) / 2
    return pymupdf.Rect(x0, y0, x0 + width, y0 + height)


def _creep_shift(creep: float, sheet_index: int, col: int, cols: int) -> float:
    if creep <= 0 or cols < 2:
        return 0.0
    toward_spine = creep * sheet_index
    return toward_spine if col < cols / 2 else -toward_spine


def _source_clip(
    source_rect: pymupdf.Rect, fit: pymupdf.Rect, visible: pymupdf.Rect, rotate: int
) -> pymupdf.Rect:
    turn = pymupdf.Matrix(-rotate)
    turned = source_rect * turn
    scale = fit.width / turned.width
    placement = (
        turn
        * pymupdf.Matrix(1, 0, 0, 1, -turned.x0, -turned.y0)
        * pymupdf.Matrix(scale, scale)
        * pymupdf.Matrix(1, 0, 0, 1, fit.x0, fit.y0)
    )
    clip = visible * ~placement
    return clip & source_rect


def _draw_cell_border(sheet: pymupdf.Page, cell: pymupdf.Rect, width: float) -> None:
    shape = sheet.new_shape()
    shape.draw_rect(cell)
    shape.finish(color=(0.75, 0.75, 0.75), width=width)
    shape.commit()


def _printable_copy(source: pymupdf.Document, progress: Progress) -> pymupdf.Document:
    copy = pymupdf.open()
    copy.insert_pdf(source)
    drop_unseen(copy, progress, printed_only=True, annotations=True, widgets=True)
    copy.bake(annots=True, widgets=True)
    for page in copy:
        if page.rotation:
            page.set_mediabox(visible_box(copy, page))
            page.remove_rotation()
    return copy


def _into_protected(original: pymupdf.Document, sheets: pymupdf.Document) -> pymupdf.Document:
    if not (original.metadata or {}).get("encryption"):
        return sheets
    source_pages = original.page_count
    original.insert_pdf(sheets)
    original.delete_pages(from_page=0, to_page=source_pages - 1)
    original.set_toc([])
    catalog = original.pdf_catalog()
    for key in ("AcroForm", "OpenAction", "PageLabels", "Outlines"):
        original.xref_set_key(catalog, key, "null")
    return original


def _check_cells(sheet_rect: pymupdf.Rect, params: ImposeParams, cols: int, rows: int) -> None:
    for col, row in ((0, 0), (cols - 1, rows - 1)):
        cell = _cell_rect(
            sheet_rect, params.margin, params.gap, params.gutter, cols, rows, col, row
        )
        if cell.is_empty or cell.width < 1 or cell.height < 1:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "the margin, gap and gutter leave no room for the pages",
                {"reason": "noRoom"},
            )


def _draw_fold_guides(sheet: pymupdf.Page, cols: int, rows: int, margin: float) -> None:
    shape = sheet.new_shape()
    rect = sheet.rect
    for col in range(1, cols):
        x = rect.x0 + rect.width * col / cols
        shape.draw_line(pymupdf.Point(x, rect.y0), pymupdf.Point(x, rect.y0 + margin / 2))
        shape.draw_line(pymupdf.Point(x, rect.y1 - margin / 2), pymupdf.Point(x, rect.y1))
    for row in range(1, rows):
        y = rect.y0 + rect.height * row / rows
        shape.draw_line(pymupdf.Point(rect.x0, y), pymupdf.Point(rect.x0 + margin / 2, y))
        shape.draw_line(pymupdf.Point(rect.x1 - margin / 2, y), pymupdf.Point(rect.x1, y))
    shape.finish(color=(0.6, 0.6, 0.6), width=0.4, dashes="[2 2] 0")
    shape.commit()


@op("pages.impose", ImposeParams)
def impose(params: ImposeParams, progress: Progress) -> ImposeResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with (
        open_document(params.path, params.password) as original,
        _printable_copy(original, progress) as source,
    ):
        indices = parse_page_ranges(params.pages, source.page_count)
        cols, rows = _grid_of(params)
        per_sheet = cols * rows
        booklet = params.layout == "booklet"
        if booklet:
            padded = _padded_indices(indices, 4)
            order = _booklet_order(len(padded))
            slots: list[int | None] = [padded[position] for position in order]
            if params.binding == "right":
                slots = [
                    slot
                    for position in range(0, len(slots), 2)
                    for slot in reversed(slots[position : position + 2])
                ]
        else:
            slots = list(indices)
        cell_order = (
            list(range(per_sheet))
            if booklet
            else _cell_order(cols, rows, params.arrangement, params.reading)
        )
        sheet_width, sheet_height = _sheet_size(
            params.layout, params.paper, params.orientation, _common_rect(source, indices)
        )
        _check_cells(pymupdf.Rect(0, 0, sheet_width, sheet_height), params, cols, rows)
        sheet_total = max(1, -(-len(slots) // per_sheet))
        wanted = range(sheet_total)
        if booklet and params.duplex == "front":
            wanted = range(0, sheet_total, 2)
        elif booklet and params.duplex == "back":
            wanted = range(1, sheet_total, 2)
        result = pymupdf.open()
        try:
            written = 0
            for sheet_index in wanted:
                progress.check_cancelled()
                position = sheet_index * per_sheet
                sheet = result.new_page(width=sheet_width, height=sheet_height)
                folio = sheet_index // 2 if booklet else 0
                back_side = booklet and sheet_index % 2 == 1
                for cell_index, page_index in enumerate(slots[position : position + per_sheet]):
                    slot = cell_order[cell_index]
                    col = slot % cols
                    row = slot // cols
                    turned = back_side and params.flip_short_edge
                    if turned:
                        row = rows - 1 - row
                        col = cols - 1 - col
                    cell = _cell_rect(
                        sheet.rect, params.margin, params.gap, params.gutter, cols, rows, col, row
                    )
                    if page_index is None:
                        continue
                    if params.border:
                        _draw_cell_border(sheet, cell, params.border_width)
                    shift = _creep_shift(params.creep, folio, col, cols) if booklet else 0.0
                    fit = _fit_rect(cell, source[page_index].rect, params.scale)
                    if shift:
                        fit = fit + (shift, 0, shift, 0)
                    rotate = 0
                    if params.auto_rotate:
                        page_rect = source[page_index].rect
                        if (page_rect.width > page_rect.height) != (cell.width > cell.height):
                            rotate = 90
                            fit = _fit_rect(
                                cell,
                                pymupdf.Rect(0, 0, page_rect.height, page_rect.width),
                                params.scale,
                            )
                            if shift:
                                fit = fit + (shift, 0, shift, 0)
                    if turned:
                        rotate += 180
                    visible = fit & cell
                    if shift and visible != fit and not visible.is_empty:
                        clip = _source_clip(source[page_index].rect, fit, visible, rotate)
                        sheet.show_pdf_page(visible, source, page_index, rotate=rotate, clip=clip)
                    else:
                        sheet.show_pdf_page(fit, source, page_index, rotate=rotate)
                if params.guides:
                    _draw_fold_guides(sheet, cols, rows, params.margin)
                written += 1
                if written % 10 == 0:
                    progress.report(written / sheet_total, "progress.imposing")
            progress.report(0.9, "progress.saving")
            saved = save_document(_into_protected(original, result), target)
        finally:
            result.close()
    return ImposeResult(**saved.model_dump(), sheets=written)
