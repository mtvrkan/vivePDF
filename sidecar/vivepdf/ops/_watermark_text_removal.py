import math
import re
from collections import defaultdict

import pymupdf

from vivepdf.ops._original_fonts import FontCodes
from vivepdf.ops.fonts import (
    lookup_font_xref,
    page_font_xrefs,
)
from vivepdf.ops.watermark_detection import (
    _turkish_lower,
)
from vivepdf.ops.watermark_restore import (
    _lost_bystanders,
    _put_back,
    _rest_of_words,
    _restore_plan,
)

FRAGMENT_MIN_LENGTH = 2
PINPOINT_REACH = 0.5
PINPOINT_SHARES = (0.5, 1.0, 0.25, 0.75, 1.4, 1.8)
OUTSIDE_FLAGS = ~pymupdf.TEXT_MEDIABOX_CLIP
MARK_SIZE_RATIO = 1.5


def _turkish_upper(value: str) -> str:
    return value.replace("i", "İ").replace("ı", "I").upper()


def _needle_variants(needle: str) -> list[str]:
    variants = [
        needle,
        needle.upper(),
        needle.lower(),
        needle.casefold(),
        _turkish_upper(needle),
        _turkish_lower(needle),
    ]
    return list(dict.fromkeys(variant for variant in variants if variant))


def _color_tuple(color: int) -> tuple[float, float, float]:
    return (
        ((color >> 16) & 0xFF) / 255,
        ((color >> 8) & 0xFF) / 255,
        (color & 0xFF) / 255,
    )


def _line_angle(direction: tuple[float, float]) -> float:
    angle = math.degrees(math.atan2(-float(direction[1]), float(direction[0])))
    return angle if abs(angle) > 0.05 else 0.0


def _search_area(page: pymupdf.Page) -> pymupdf.Rect:
    box = page.mediabox
    return pymupdf.Rect(
        box.x0 - box.width, box.y0 - box.height, box.x1 + box.width, box.y1 + box.height
    )


def _match_quads(page: pymupdf.Page, needles: list[str]) -> list[pymupdf.Quad]:
    quads: list[pymupdf.Quad] = []
    seen: set[tuple[int, ...]] = set()
    textpage = page.get_textpage(
        clip=_search_area(page), flags=pymupdf.TEXTFLAGS_SEARCH & OUTSIDE_FLAGS
    )
    for needle in needles:
        for variant in _needle_variants(needle):
            for quad in page.search_for(variant, quads=True, textpage=textpage):
                rect = quad.rect
                key = tuple(round(value * 10) for value in (rect.x0, rect.y0, rect.x1, rect.y1))
                if key in seen:
                    continue
                seen.add(key)
                quads.append(quad)
    return quads


def _page_characters(page: pymupdf.Page) -> list[dict]:
    fonts = page_font_xrefs(page)
    spans: list[dict] = []
    raw = page.get_text(
        "rawdict", clip=_search_area(page), flags=pymupdf.TEXTFLAGS_TEXT & OUTSIDE_FLAGS
    )
    for block in raw.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            angle = _line_angle(line.get("dir", (1.0, 0.0)))
            line_text = "".join(
                char.get("c", "")
                for span in line.get("spans", [])
                for char in span.get("chars", [])
            )
            for span in line.get("spans", []):
                span_chars = span.get("chars", [])
                chars = [char for char in span_chars if char.get("c", "").strip()]
                if not chars:
                    continue
                flags = int(span.get("flags", 0))
                spans.append(
                    {
                        "text": "".join(char["c"] for char in span_chars),
                        "line": line_text,
                        "chars": chars,
                        "all": span_chars,
                        "size": float(span.get("size", 0)) or 1.0,
                        "color": _color_tuple(int(span.get("color", 0))),
                        "font": span.get("font"),
                        "xref": lookup_font_xref(fonts, span.get("font", ""))[0],
                        "bold": bool(flags & 16),
                        "italic": bool(flags & 2),
                        "angle": angle,
                        "vertical": line.get("wmode") == 1,
                    }
                )
    return spans


def _compact(value: str) -> str:
    return _turkish_lower(re.sub(r"\s+", "", value))


def _style(span: dict) -> tuple:
    return (
        span["font"],
        round(span["size"], 1),
        tuple(round(value, 2) for value in span["color"]),
        round(span["angle"]),
    )


def _part_of_needle(text: str, compact_needles: list[str]) -> bool:
    return any(
        text in needle * (len(text) // len(needle) + 2) for needle in compact_needles if needle
    )


def _is_fragment(span: dict, compact_needles: list[str]) -> bool:
    text = _compact(span["text"])
    if not text or (len(text) < FRAGMENT_MIN_LENGTH and not span["angle"]):
        return False
    return _part_of_needle(text, compact_needles)


def _body_size(spans: list[dict]) -> float:
    weights: dict[float, int] = defaultdict(int)
    for span in spans:
        weights[round(span["size"], 1)] += len(span["chars"])
    return max(weights, key=lambda size: weights[size]) if weights else 0.0


def _span_looks_like_a_mark(span: dict, compact_needles: list[str], body_size: float) -> bool:
    if span["angle"] or span["size"] >= body_size * MARK_SIZE_RATIO:
        return True
    line = _compact(span["line"])
    return bool(line) and _part_of_needle(line, compact_needles)


def _centre(char: dict) -> pymupdf.Point:
    box = pymupdf.Rect(char["bbox"])
    return pymupdf.Point((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)


def _marked_characters(
    spans: list[dict], quads: list[pymupdf.Quad], needles: list[str]
) -> list[dict]:
    folded_needles = [_turkish_lower(needle) for needle in needles if needle.strip()]
    compact_needles = [_compact(needle) for needle in needles]
    body_size = _body_size(spans)
    bands = [quad.rect for quad in quads]
    marked: list[dict] = []
    styles: set[tuple] = set()
    for span in spans:
        if not _span_looks_like_a_mark(span, compact_needles, body_size):
            continue
        folded = _turkish_lower(span["text"])
        if any(needle in folded for needle in folded_needles):
            hit = [
                char
                for char in span["chars"]
                if any(not (pymupdf.Rect(char["bbox"]) & band).is_empty for band in bands)
            ]
        elif _part_of_needle(_compact(span["text"]), compact_needles):
            hit = [char for char in span["chars"] if any(_centre(char) in quad for quad in quads)]
        else:
            continue
        if hit:
            styles.add(_style(span))
            marked.extend(hit)
    taken = {id(char) for char in marked}
    for span in spans:
        if _style(span) in styles and _is_fragment(span, compact_needles):
            marked.extend(char for char in span["chars"] if id(char) not in taken)
    return marked


def _pinpoint_candidates(char: dict) -> list[pymupdf.Rect]:
    box = pymupdf.Rect(char["bbox"])
    origin = pymupdf.Point(char["origin"])
    middle = pymupdf.Point((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
    reach = PINPOINT_REACH
    points = [origin + (middle - origin) * share for share in PINPOINT_SHARES]
    return [pymupdf.Rect(p.x - reach, p.y - reach, p.x + reach, p.y + reach) for p in points]


def _pinpoints(marked: list[dict], spans: list[dict]) -> list[pymupdf.Rect]:
    taken = {id(char) for char in marked}
    others = [
        pymupdf.Rect(char["bbox"])
        for span in spans
        for char in span["chars"]
        if id(char) not in taken
    ]
    chosen: list[pymupdf.Rect] = []
    for char in marked:
        candidates = _pinpoint_candidates(char)
        near = [box for box in others if box.intersects(pymupdf.Rect(char["bbox"]))]
        free = next(
            (spot for spot in candidates if not any(spot.intersects(box) for box in near)),
            candidates[0],
        )
        chosen.append(free)
    return chosen


def _remove_text(page: pymupdf.Page, needles: list[str], codes: FontCodes | None = None) -> int:
    quads = _match_quads(page, needles)
    if not quads:
        return 0
    spans = _page_characters(page)
    marked = _marked_characters(spans, quads, needles)
    if not marked:
        return 0
    removed = sum(
        1
        for quad in quads
        if any(
            _centre(char) in quad or not (pymupdf.Rect(char["bbox"]) & quad.rect).is_empty
            for char in marked
        )
    )
    _redact_text(page, _pinpoints(marked, spans))
    lost = _lost_bystanders(spans, marked, _page_characters(page))
    rest = _rest_of_words(lost, marked)
    if rest:
        _redact_text(page, _pinpoints(rest, spans))
        lost = _lost_bystanders(spans, marked, _page_characters(page))
    _put_back(page, _restore_plan(page, lost), spans, marked, codes)
    return removed


def _redact_text(page: pymupdf.Page, boxes: list[pymupdf.Rect]) -> None:
    for box in boxes:
        page.add_redact_annot(box)
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_NONE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
    )
