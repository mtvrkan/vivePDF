import re
import time
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document, unwrap_document
from vivepdf.ops._output import prepare_output, save_document
from vivepdf.ops._page_text import parse_color
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._redact_presets import PRESET_NAMES, PresetName, preset_matches
from vivepdf.ops._redact_search import (
    HIDDEN_MASK,
    RedactArea,
    _chained,
    _full_page_rect,
    _images_under,
    _line_characters,
    _pattern_needles,
    _regex_rects,
    _scrubber,
    _searchable,
    _term_rects,
    _words_under_areas,
    private_key_block_lines,
)
from vivepdf.ops._redaction import (
    MAX_AREAS,
    MAX_TEXTS,
    jpeg_images,
    recompress_redacted,
    scrub_page,
)
from vivepdf.ops._redaction_document import scrub_document
from vivepdf.ops._safe_pattern import MAX_PATTERNS, MatchClock, compile_safe_patterns
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class RedactParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    pages: str | None = None
    areas: list[RedactArea] = Field(default_factory=list, max_length=MAX_AREAS)
    search_text: list[str] = Field(default_factory=list, max_length=MAX_TEXTS)
    patterns: list[str] = Field(default_factory=list, max_length=MAX_PATTERNS)
    presets: list[PresetName] = Field(default_factory=list)
    case_sensitive: bool = False
    fill: str = "#000000"
    overlay_text: str = ""
    overlay_size: float = Field(default=9, ge=4, le=40)
    images: Literal["none", "overlapping", "all"] = "overlapping"
    graphics: Literal["touched", "contained"] = "touched"
    whole_pages: str | None = None
    scrub_hidden: bool = True
    whole_word: bool = False


class RedactResult(RpcModel):
    output: str
    page_count: int
    bytes: int
    redactions: int
    hidden: int = 0
    images_kept: int = 0


@op("security.redact", RedactParams)
def redact(params: RedactParams, progress: Progress) -> RedactResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    fill = parse_color(params.fill)
    flags = 0 if params.case_sensitive else re.IGNORECASE
    patterns = compile_safe_patterns(params.patterns, flags)
    clock = MatchClock()
    terms = [term for term in params.search_text if term.strip()]
    matching = bool(terms or patterns or params.presets)
    whole_pages = (params.whole_pages or "").strip()
    if not params.areas and not matching and not whole_pages:
        raise OpError(ErrorCode.INVALID_PARAMS, "nothing to redact")
    image_mode = {
        "none": pymupdf.PDF_REDACT_IMAGE_NONE,
        "overlapping": pymupdf.PDF_REDACT_IMAGE_PIXELS,
        "all": pymupdf.PDF_REDACT_IMAGE_REMOVE,
    }[params.images]
    graphics_mode = (
        pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED
        if params.graphics == "touched"
        else pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED
    )
    annot_options: dict[str, object] = {"fill": fill}
    label = params.overlay_text.strip()
    if label:
        annot_options.update(
            text=label,
            fontsize=params.overlay_size,
            align=pymupdf.TEXT_ALIGN_CENTER,
            text_color=(1, 1, 1) if sum(fill) < 1.5 else (0, 0, 0),
        )
    areas_by_page: dict[int, list[RedactArea]] = {}
    for area in params.areas:
        areas_by_page.setdefault(area.page - 1, []).append(area)
    term_scrub = (
        _scrubber(
            terms, patterns, params.presets, flags, label or HIDDEN_MASK, params.whole_word, clock
        )
        if params.scrub_hidden and matching
        else None
    )
    total = 0
    hidden = 0
    images_kept = 0
    with open_document(params.path, params.password) as document:
        area_texts = _words_under_areas(document, areas_by_page) if params.scrub_hidden else []
        area_scrub = (
            _scrubber(area_texts, [], [], re.IGNORECASE, label or HIDDEN_MASK, whole_word=True)
            if area_texts
            else None
        )
        scrub = _chained(term_scrub, area_scrub)
        searched = set(parse_page_ranges(params.pages, document.page_count))
        blanked = set(parse_page_ranges(whole_pages, document.page_count)) if whole_pages else set()
        indices = sorted(searched | blanked)
        for position, index in enumerate(indices):
            progress.check_cancelled()
            page = document[index]
            rects: list[pymupdf.Rect] = [
                pymupdf.Rect(a.x0, a.y0, a.x1, a.y1) for a in areas_by_page.get(index, [])
            ]
            if index in blanked:
                rects.append(_full_page_rect(page))
            if index in searched:
                lines = _line_characters(page) if terms else []
                for term in terms:
                    rects.extend(
                        _term_rects(page, term, params.case_sensitive, params.whole_word, lines)
                    )
                rects.extend(_regex_rects(page, patterns, params.presets, flags, clock))
            if rects:
                if params.images == "none" and index not in blanked:
                    images_kept += _images_under(page, rects)
                before, jpeg_sizes = jpeg_images(page)
                for rect in rects:
                    page.add_redact_annot(rect, **annot_options)
                page.apply_redactions(
                    images=pymupdf.PDF_REDACT_IMAGE_REMOVE if index in blanked else image_mode,
                    graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED
                    if index in blanked
                    else graphics_mode,
                )
                recompress_redacted(page, before, jpeg_sizes)
                total += len(rects)
            if rects or scrub is not None:
                hidden += scrub_page(page, rects, scrub or str)
            if position % 10 == 0:
                progress.report(
                    position / len(indices),
                    "progress.redacting",
                    {"current": position + 1, "total": len(indices)},
                )
        if scrub is not None:
            hidden += scrub_document(document, scrub)
        progress.report(0.9, "progress.saving")
        saved = save_document(document, target)
        return RedactResult(
            output=saved.output,
            page_count=saved.page_count,
            bytes=saved.bytes,
            redactions=total,
            hidden=hidden,
            images_kept=images_kept,
        )


class SearchParams(RpcModel):
    path: str
    password: str | None = None
    search_text: list[str] = Field(default_factory=list, max_length=MAX_TEXTS)
    patterns: list[str] = Field(default_factory=list, max_length=MAX_PATTERNS)
    presets: list[PresetName] = Field(default_factory=list)
    case_sensitive: bool = False
    pages: str | None = None
    whole_word: bool = False


class ScanPresetsParams(RpcModel):
    path: str
    password: str | None = None
    pages: str | None = None


class ScanPresetsResult(RpcModel):
    counts: dict[str, int]
    pages_scanned: int
    page_count: int
    pages_selected: int = 0
    complete: bool = True


SCAN_SPREAD_PAGES = 60
SCAN_TIME_BUDGET = 25.0


def scan_order(indices: list[int]) -> list[int]:
    if len(indices) <= SCAN_SPREAD_PAGES:
        return list(indices)
    step = len(indices) / SCAN_SPREAD_PAGES
    spread = sorted({indices[int(position * step)] for position in range(SCAN_SPREAD_PAGES)})
    taken = set(spread)
    return spread + [index for index in indices if index not in taken]


@op("security.scan_presets", ScanPresetsParams)
def scan_presets(params: ScanPresetsParams, progress: Progress) -> ScanPresetsResult:
    presets = list(PRESET_NAMES)
    counts: dict[str, int] = {}
    with open_document(params.path, params.password, mutable=False) as cached:
        document = unwrap_document(cached)
        selected = parse_page_ranges(params.pages, document.page_count)
        order = scan_order(selected)
        deadline = time.monotonic() + SCAN_TIME_BUDGET
        scanned = 0
        for index in order:
            progress.check_cancelled()
            if scanned and time.monotonic() >= deadline:
                break
            for preset, _ in preset_matches(document[index].get_text(), presets):
                counts[preset] = counts.get(preset, 0) + 1
            scanned += 1
            if scanned % 10 == 1:
                progress.report(
                    scanned / max(1, len(order)),
                    "progress.scanning",
                    {"current": scanned, "total": len(order)},
                )
        return ScanPresetsResult(
            counts={name: counts[name] for name in presets if counts.get(name)},
            pages_scanned=scanned,
            page_count=document.page_count,
            pages_selected=len(order),
            complete=scanned == len(order),
        )


class SearchHit(RpcModel):
    page: int
    text: str
    x0: float
    y0: float
    x1: float
    y1: float


class SearchResult(RpcModel):
    hits: list[SearchHit]


@op("security.redact_preview", SearchParams)
def redact_preview(params: SearchParams, progress: Progress) -> SearchResult:
    flags = 0 if params.case_sensitive else re.IGNORECASE
    patterns = compile_safe_patterns(params.patterns, flags)
    clock = MatchClock()
    hits: list[SearchHit] = []
    with open_document(params.path, params.password, mutable=False) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        for index in indices:
            progress.check_cancelled()
            page = document[index]
            terms = [term for term in params.search_text if term.strip()]
            lines = _line_characters(page) if terms else []
            for term in terms:
                hits.extend(
                    SearchHit(page=index + 1, text=term, x0=r.x0, y0=r.y0, x1=r.x1, y1=r.y1)
                    for r in _term_rects(
                        page, term, params.case_sensitive, params.whole_word, lines
                    )
                )
            for needle in _pattern_needles(page.get_text(), patterns, params.presets, flags, clock):
                if not _searchable(needle):
                    continue
                hits.extend(
                    SearchHit(page=index + 1, text=needle, x0=r.x0, y0=r.y0, x1=r.x1, y1=r.y1)
                    for r in page.search_for(needle)
                )
            if "privateKey" in params.presets:
                known = {(round(hit.y0), round(hit.x0)) for hit in hits if hit.page == index + 1}
                hits.extend(
                    SearchHit(page=index + 1, text=text, x0=r.x0, y0=r.y0, x1=r.x1, y1=r.y1)
                    for text, r in private_key_block_lines(page)
                    if (round(r.y0), round(r.x0)) not in known
                )
            if len(hits) > 5000:
                break
    return SearchResult(hits=hits)
