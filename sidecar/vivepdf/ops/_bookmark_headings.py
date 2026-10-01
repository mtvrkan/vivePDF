import re
from collections import Counter

import pymupdf

from vivepdf.ops._bookmark_model import (
    BookmarkItem,
    BookmarksGenerateParams,
    BookmarksSuggestParams,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress

MAX_LINE_LENGTH = 120
MIN_LINE_LENGTH = 2
BODY_SIZE_RATIO = 1.15
BOLD_SIZE_BONUS = 1.0
LINE_MERGE_GAP = 0.75
MIN_LETTER_RATIO = 0.5
RUNNING_HEAD_MIN = 4
RUNNING_HEAD_SHARE = 0.2
HEADING_MARGIN = 6.0
ENUMERATOR = re.compile(r"\d+(?:[.)]\d*)*[.)]?")


def _line_size(line: dict) -> float:
    best = 0.0
    for span in line["spans"]:
        size = span["size"]
        if span["flags"] & 16:
            size += BOLD_SIZE_BONUS
        best = max(best, size)
    return best


def _line_text(line: dict) -> str:
    return "".join(span["text"] for span in line["spans"]).strip()


def _letter_ratio(text: str) -> float:
    stripped = [character for character in text if not character.isspace()]
    if not stripped:
        return 0.0
    return sum(1 for character in stripped if character.isalpha()) / len(stripped)


def _joined(parts: list[str]) -> str:
    title = " ".join(part.strip() for part in parts if part.strip())
    return re.sub(r"\s+", " ", title).strip()


def _merge_runs(
    lines: list[tuple[float, float, str, float]],
) -> list[tuple[float, str, float]]:
    merged: list[tuple[float, str, float]] = []
    run_size = 0.0
    run_bottom = 0.0
    run_anchor = 0.0
    run_parts: list[str] = []
    for size, top, text, anchor in lines:
        continues = (
            run_parts
            and size == run_size
            and 0 <= top - run_bottom <= size * LINE_MERGE_GAP
            and len(_joined([*run_parts, text])) <= MAX_LINE_LENGTH
        )
        if continues:
            run_parts.append(text)
        else:
            if run_parts:
                merged.append((run_size, _joined(run_parts), run_anchor))
            run_size, run_parts, run_anchor = size, [text], anchor
        run_bottom = top + size
    if run_parts:
        merged.append((run_size, _joined(run_parts), run_anchor))
    return merged


def _detect_headings(
    document,
    page_count: int,
    max_levels: int,
    min_font_size: float | None,
    progress: Progress | None = None,
) -> list[BookmarkItem]:
    size_counts: Counter[float] = Counter()
    lines_by_page: list[list[tuple[float, str, float]]] = []
    for index in range(page_count):
        if progress is not None:
            progress.check_cancelled()
            if index % 20 == 0:
                progress.report(
                    0.85 * index / max(1, page_count),
                    "progress.searching",
                    {"current": index + 1, "total": page_count},
                )
        page_lines: list[tuple[float, float, str, float]] = []
        page = document[index]
        page_dict = page.get_text("dict")
        for block in page_dict["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block["lines"]:
                text = _line_text(line)
                if not text or len(text) > MAX_LINE_LENGTH:
                    continue
                size = round(_line_size(line), 1)
                size_counts[size] += len(text)
                visible = pymupdf.Rect(line["bbox"]) * page.rotation_matrix
                anchor = round(max(0.0, visible.y0 - HEADING_MARGIN), 1)
                page_lines.append((size, round(line["bbox"][1], 1), text, anchor))
        page_lines.sort(key=lambda entry: entry[1])
        lines_by_page.append(_merge_runs(page_lines))
    if not size_counts:
        return []
    body_size = size_counts.most_common(1)[0][0]
    threshold = min_font_size if min_font_size is not None else body_size * BODY_SIZE_RATIO
    heading_sizes = sorted({size for size in size_counts if size >= threshold}, reverse=True)
    heading_sizes = heading_sizes[:max_levels]
    level_of = {size: level + 1 for level, size in enumerate(heading_sizes)}
    candidates: list[tuple[int, int, str, float]] = []
    for index, page_lines in enumerate(lines_by_page):
        page_candidates: list[tuple[int, str, float]] = []
        for size, text, anchor in page_lines:
            level = level_of.get(size)
            if level is None:
                continue
            if page_candidates and ENUMERATOR.fullmatch(page_candidates[-1][1]):
                previous_level, previous_text, previous_anchor = page_candidates.pop()
                level = previous_level
                text = _joined([previous_text, text])
                anchor = previous_anchor
            page_candidates.append((level, text, anchor))
        for level, text, anchor in page_candidates:
            if len(text) < MIN_LINE_LENGTH or _letter_ratio(text) < MIN_LETTER_RATIO:
                continue
            candidates.append((index + 1, level, text, anchor))
    repeats = Counter(text for _page, _level, text, _anchor in candidates)
    running_limit = max(RUNNING_HEAD_MIN, int(page_count * RUNNING_HEAD_SHARE))
    items: list[BookmarkItem] = []
    last_title: str | None = None
    for page, level, text, anchor in candidates:
        if repeats[text] >= running_limit:
            continue
        if text == last_title:
            continue
        items.append(BookmarkItem(level=level, title=text, page=page, top=anchor))
        last_title = text
    return items


def _normalized_levels(items: list[BookmarkItem]) -> list[BookmarkItem]:
    normalized: list[BookmarkItem] = []
    previous_level = 0
    for item in items:
        level = max(1, min(item.level, previous_level + 1))
        normalized.append(item.model_copy(update={"level": level}))
        previous_level = level
    return normalized


def _suggested_outline(
    document: pymupdf.Document,
    params: BookmarksSuggestParams | BookmarksGenerateParams,
    progress: Progress,
) -> list[BookmarkItem]:
    if params.mode == "everyPage":
        items = [
            BookmarkItem(level=1, title=params.label.replace("{n}", str(page)), page=page)
            for page in range(1, document.page_count + 1, params.every)
        ]
    else:
        items = _detect_headings(
            document, document.page_count, params.max_levels, params.min_font_size, progress
        )
        if not items:
            raise OpError(ErrorCode.INVALID_PARAMS, "no headings found", {"reason": "noHeadings"})
    return _normalized_levels(items)
