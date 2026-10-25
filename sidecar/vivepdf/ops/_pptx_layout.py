import math
import re
from dataclasses import dataclass

import pymupdf

from vivepdf.ops._hidden_text import origin_key
from vivepdf.ops._line_gaps import wide_gap_starts
from vivepdf.ops._pptx_links import PageLink, link_at

FILLED_FLAG = 16
STROKED_FLAG = 32
STROKE_TRACE = 1
TEXT_FLAGS = pymupdf.TEXTFLAGS_TEXT | pymupdf.TEXT_COLLECT_STYLES
SLANT = 1e-3
MIN_SPACE_EXTRA_EM = 0.02
UNSAFE_CHARACTERS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")


@dataclass(slots=True)
class SlideFrame:
    left: int
    top: int
    ratio: float


@dataclass(slots=True)
class LineBox:
    left: float
    top: float
    width: float
    height: float
    angle: float
    spans: list[dict]
    area: pymupdf.Rect


def slide_text(text: str) -> str:
    return UNSAFE_CHARACTERS.sub("", text)


def _visible(span: dict) -> bool:
    return span.get("alpha", 255) > 0


def _direction(line: dict, matrix: pymupdf.Matrix) -> tuple[float, float]:
    origin = pymupdf.Point(0, 0) * matrix
    moved = pymupdf.Point(*line["dir"]) * matrix
    return moved.x - origin.x, moved.y - origin.y


def _space_extras(line: dict) -> dict[tuple[float, float], float]:
    if abs(line["dir"][1]) > SLANT or line["dir"][0] <= 0:
        return {}
    chars = [char for span in line["spans"] for char in span["chars"]]
    return {
        origin_key(space["origin"]): following["origin"][0]
        - space["origin"][0]
        - (space["bbox"][2] - space["bbox"][0])
        for space, following in zip(chars, chars[1:], strict=False)
        if space["c"] == " " and following["c"] != " "
    }


def _piece(
    span: dict,
    chars: list[dict],
    link: PageLink | None,
    extras: dict[tuple[float, float], float] | None = None,
) -> dict:
    bounds = pymupdf.Rect(chars[0]["bbox"])
    for char in chars[1:]:
        bounds |= char["bbox"]
    piece = {key: value for key, value in span.items() if key != "chars"}
    piece["text"] = "".join(char["c"] for char in chars)
    piece["bbox"] = tuple(bounds)
    piece["link"] = link
    gaps = [
        extras[key]
        for char in chars
        if extras and char["c"] == " " and (key := origin_key(char["origin"])) in extras
    ]
    extra = sum(gaps) / len(gaps) if gaps else 0.0
    piece["space_extra"] = extra if extra > span["size"] * MIN_SPACE_EXTRA_EM else 0.0
    return piece


def _segments(
    line: dict,
    hidden: set[tuple[float, float]],
    links: list[PageLink],
    breaks: set[int],
    extras: dict[tuple[float, float], float] | None = None,
) -> list[list[dict]]:
    segments: list[list[dict]] = [[]]
    index = 0
    for span in line["spans"]:
        run: list[dict] = []
        target: PageLink | None = None
        for char in span["chars"]:
            covered = origin_key(char["origin"]) in hidden
            if covered or index in breaks:
                if run:
                    segments[-1].append(_piece(span, run, target, extras))
                    run = []
                if segments[-1]:
                    segments.append([])
            index += 1
            if covered:
                continue
            link = link_at(links, char["bbox"]) if links else None
            if run and link is not target:
                segments[-1].append(_piece(span, run, target, extras))
                run = []
            target = link
            run.append(char)
        if run:
            segments[-1].append(_piece(span, run, target, extras))
    return [segment for segment in segments if segment]


def _line_box(line: dict, bounds: pymupdf.Rect, spans: list[dict], matrix) -> LineBox:
    shown = bounds * matrix
    dx, dy = _direction(line, matrix)
    angle = round(math.degrees(math.atan2(dy, dx)), 1) % 360
    if min(abs(part) for part in line["dir"]) > SLANT:
        quad = pymupdf.recover_line_quad(line, spans) * matrix
        length = abs(quad.ur - quad.ul)
        thickness = abs(quad.ll - quad.ul)
        center = (quad.ul + quad.lr) / 2
    else:
        along_x = abs(line["dir"][0]) >= abs(line["dir"][1])
        length = bounds.width if along_x else bounds.height
        thickness = bounds.height if along_x else bounds.width
        center = (shown.tl + shown.br) / 2
    return LineBox(
        left=center.x - length / 2,
        top=center.y - thickness / 2,
        width=length,
        height=thickness,
        angle=angle,
        spans=spans,
        area=bounds,
    )


def _hollow(span: dict) -> bool:
    flags = span.get("char_flags", FILLED_FLAG)
    return bool(flags & STROKED_FLAG) and not flags & FILLED_FLAG


def _mark_outlines(page: pymupdf.Page, blocks: list[dict]) -> None:
    spans = [
        span
        for block in blocks
        for line in block.get("lines", [])
        for span in line["spans"]
        if _hollow(span) and span["chars"]
    ]
    if not spans:
        return
    widths = {
        origin_key(char[2]): trace["linewidth"]
        for trace in page.get_texttrace()
        if trace["type"] == STROKE_TRACE
        for char in trace["chars"]
    }
    for span in spans:
        span["outline"] = widths.get(origin_key(span["chars"][0]["origin"]))


def _span_bounds(spans: list[dict]) -> pymupdf.Rect:
    bounds = pymupdf.Rect(spans[0]["bbox"])
    for span in spans[1:]:
        bounds |= span["bbox"]
    return bounds


def line_boxes(
    page: pymupdf.Page,
    hidden: set[tuple[float, float]] | None = None,
    links: list[PageLink] | None = None,
    show_hidden: bool = False,
) -> list[LineBox]:
    hidden = hidden or set()
    matrix = page.rotation_matrix
    boxes: list[LineBox] = []
    blocks = page.get_text("rawdict", flags=TEXT_FLAGS)["blocks"]
    _mark_outlines(page, blocks)
    for block in blocks:
        for line in block.get("lines", []):
            breaks = wide_gap_starts(line)
            whole = not breaks and all(
                (show_hidden or _visible(span)) and origin_key(char["origin"]) not in hidden
                for span in line["spans"]
                for char in span["chars"]
            )
            extras = _space_extras(line)
            for segment in _segments(line, hidden, links or [], breaks, extras):
                spans = [
                    span for span in segment if (show_hidden or _visible(span)) and span["text"]
                ]
                if not any(slide_text(span["text"]).strip() for span in spans):
                    continue
                bounds = pymupdf.Rect(line["bbox"]) if whole else _span_bounds(spans)
                boxes.append(_line_box(line, bounds, spans, matrix))
    return boxes


def page_notes(page: pymupdf.Page, hidden: set[tuple[float, float]] | None = None) -> str:
    if not hidden:
        return slide_text(page.get_text()).strip()
    lines = []
    for block in page.get_text("rawdict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]:
        for line in block.get("lines", []):
            text = "".join(
                char["c"]
                for span in line["spans"]
                for char in span["chars"]
                if origin_key(char["origin"]) not in hidden
            )
            if text.strip():
                lines.append(text)
    return slide_text("\n".join(lines)).strip()


def text_free_pixmap(
    document: pymupdf.Document,
    index: int,
    dpi: int,
    areas: list[pymupdf.Rect],
    drawn: list[list[pymupdf.Rect]] | None = None,
) -> pymupdf.Pixmap:
    with pymupdf.open() as single:
        single.insert_pdf(document, from_page=index, to_page=index, annots=True)
        single.bake(annots=True, widgets=False)
        page = single[0]
        for erased in drawn or []:
            for area in erased:
                page.add_redact_annot(area, fill=False, cross_out=False)
            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_NONE,
                graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
                text=pymupdf.PDF_REDACT_TEXT_NONE,
            )
        for area in areas:
            page.add_redact_annot(area, fill=False, cross_out=False)
        page.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_NONE,
            graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
            text=pymupdf.PDF_REDACT_TEXT_REMOVE,
        )
        return page.get_pixmap(dpi=dpi)
