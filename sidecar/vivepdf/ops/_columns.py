import bisect
from collections.abc import Sequence
from dataclasses import dataclass

import pymupdf

GUTTER_MIN = 6.0
EDGE_SHARE = 0.2
PROSE_WORDS = 3
PROSE_LINES = 3
PROSE_SHARE = 0.5
CROSSING_SHARE = 0.25
SIDE_TOLERANCE = 1.0
MAX_CANDIDATES = 60
RULE_THICKNESS = 2.0
TABLE_RULES = 2
LINE_GAP = 1.0


def words_of(text: str) -> int:
    return sum(1 for token in text.split() if any(char.isalpha() for char in token))


def _prose(words: list[int]) -> bool:
    long = sum(1 for count in words if count >= PROSE_WORDS)
    return long >= PROSE_LINES and long >= len(words) * PROSE_SHARE


@dataclass(frozen=True, slots=True)
class Columns:
    split: float
    top: float
    bottom: float


def _x_side(rect: pymupdf.Rect, split: float) -> int | None:
    if rect.x1 < split:
        return 0
    if rect.x0 >= split - SIDE_TOLERANCE:
        return 1
    return None


def column_side(rect: pymupdf.Rect, columns: Columns) -> int | None:
    middle = (rect.y0 + rect.y1) / 2
    if not columns.top <= middle <= columns.bottom:
        return None
    return _x_side(rect, columns.split)


def _region(lines: list[tuple[pymupdf.Rect, int]], split: float) -> tuple[float, float] | None:
    sides = [_x_side(rect, split) for rect, _words in lines]
    left = [rect for (rect, _words), side in zip(lines, sides, strict=True) if side == 0]
    right = [rect for (rect, _words), side in zip(lines, sides, strict=True) if side == 1]
    if not left or not right:
        return None
    top = max(min(rect.y0 for rect in left), min(rect.y0 for rect in right))
    bottom = min(max(rect.y1 for rect in left), max(rect.y1 for rect in right))
    if bottom <= top:
        return None
    for side in (left, right):
        top, bottom = _continued(side, top, bottom)
    return top, bottom


def _continued(rects: list[pymupdf.Rect], top: float, bottom: float) -> tuple[float, float]:
    ordered = sorted(rects, key=lambda rect: rect.y0)
    last = bottom
    previous = None
    for rect in ordered:
        if rect.y1 <= bottom:
            previous = rect
            continue
        height = min(rect.height, previous.height) if previous else rect.height
        if rect.y0 - last > height * LINE_GAP:
            break
        last = max(last, rect.y1)
        previous = rect
    first = top
    following = None
    for rect in reversed(ordered):
        if rect.y0 >= top:
            following = rect
            continue
        height = min(rect.height, following.height) if following else rect.height
        if first - rect.y1 > height * LINE_GAP:
            break
        first = min(first, rect.y0)
        following = rect
    return first, last


def _fits(lines: list[tuple[pymupdf.Rect, int]], split: float) -> tuple[int, Columns | None]:
    region = _region(lines, split)
    if region is None:
        return 0, None
    columns = Columns(split, *region)
    sides: dict[int | None, list[tuple[pymupdf.Rect, int]]] = {0: [], 1: [], None: []}
    inside = [
        (rect, words) for rect, words in lines if region[0] <= (rect.y0 + rect.y1) / 2 <= region[1]
    ]
    for rect, words in inside:
        sides[_x_side(rect, split)].append((rect, words))
    left, right, crossing = sides[0], sides[1], sides[None]
    if len(left) < PROSE_LINES or len(right) < PROSE_LINES:
        return 0, None
    if len(crossing) > len(inside) * CROSSING_SHARE:
        return 0, None
    if split - max(rect.x1 for rect, _words in left) < GUTTER_MIN:
        return 0, None
    if not all(_prose([words for _rect, words in side]) for side in (left, right)):
        return 0, None
    return min(len(left), len(right)), columns


def column_split(lines: Sequence[tuple[pymupdf.Rect, int]]) -> Columns | None:
    if len(lines) < PROSE_LINES * 2:
        return None
    start = min(rect.x0 for rect, _words in lines)
    end = max(rect.x1 for rect, _words in lines)
    reach = (end - start) * EDGE_SHARE
    candidates = sorted(
        {round(rect.x0) for rect, _words in lines if start + reach < rect.x0 < end - reach}
    )
    if not candidates or len(candidates) > MAX_CANDIDATES:
        return None
    best, columns = max(
        (_fits(list(lines), split) for split in candidates), key=lambda item: item[0]
    )
    return columns if best else None


def column_order[Item](items: Sequence[tuple[pymupdf.Rect, Item]], columns: Columns) -> list[Item]:
    crossing = sorted(
        (rect.y0, position)
        for position, (rect, _item) in enumerate(items)
        if column_side(rect, columns) is None
    )
    tops = [top for top, _position in crossing]
    bands: list[tuple[list[Item], list[Item]]] = [([], []) for _ in range(len(crossing) + 1)]
    for rect, item in items:
        side = column_side(rect, columns)
        if side is not None:
            bands[bisect.bisect_right(tops, rect.y0)][side].append(item)
    ordered: list[Item] = []
    for band, (left, right) in enumerate(bands):
        ordered.extend(left)
        ordered.extend(right)
        if band < len(crossing):
            ordered.append(items[crossing[band][1]][1])
    return ordered


def _rules(drawing: dict) -> list[pymupdf.Rect]:
    rules = []
    for item in drawing.get("items", []):
        if item[0] == "l":
            start, end = pymupdf.Point(item[1]), pymupdf.Point(item[2])
            rules.append(pymupdf.Rect(start, end).normalize())
        elif item[0] == "re":
            rect = pymupdf.Rect(item[1])
            rules.extend([pymupdf.Rect(rect.tl, rect.tr), pymupdf.Rect(rect.bl, rect.br)])
    return [rule for rule in rules if rule.height <= RULE_THICKNESS]


def _merged(segments: list[tuple[float, float]]) -> list[tuple[float, float]]:
    merged: list[tuple[float, float]] = []
    for start, end in sorted(segments):
        if merged and start <= merged[-1][1] + RULE_THICKNESS:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _ruled_rows(page: pymupdf.Page, columns: Columns) -> bool:
    rows: dict[int, list[tuple[float, float]]] = {}
    for drawing in page.get_drawings():
        for rule in _rules(drawing):
            middle = (rule.y0 + rule.y1) / 2
            if columns.top < middle < columns.bottom:
                rows.setdefault(round(middle), []).append((rule.x0, rule.x1))
    crossing = sum(
        1
        for segments in rows.values()
        if any(
            start < columns.split - GUTTER_MIN and end > columns.split + GUTTER_MIN
            for start, end in _merged(segments)
        )
    )
    return crossing >= TABLE_RULES


def page_columns(page: pymupdf.Page, lines: Sequence[tuple[pymupdf.Rect, int]]) -> Columns | None:
    columns = column_split(lines)
    if columns is None or _ruled_rows(page, columns):
        return None
    return columns
