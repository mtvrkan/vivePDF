import base64
import contextlib
import difflib
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import numpy
import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document, unwrap_document
from vivepdf.ops._output import garbage_level, prepare_output
from vivepdf.ops._page_batch import SharedFonts, page_object_number
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

DIFF_DPI = 60
HASH_DPI = 12
HASH_SIDE = 8
BLOCK = 12
PIXEL_TOLERANCE = 32
REPORT_FONT = Path(__file__).resolve().parent.parent / "assets" / "fonts" / "DejaVuSans.ttf"
REPORT_FONT_NAME = "vivereport"
REMOVED_COLOUR = (0.85, 0.15, 0.15)
ADDED_COLOUR = (0.1, 0.6, 0.25)
AREA_COLOUR = (0.9, 0.55, 0.0)
LABEL_COLOUR = (0.3, 0.3, 0.3)
SUMMARY_ROWS_PER_PAGE = 40
REPORT_SPREAD_LIMIT = 500
SIZE_TOLERANCE = 1.0
BLANK = 255
EXHAUSTIVE_ALIGNMENT_LIMIT = 4_000_000
KEY_PROGRESS_STRIDE = 25
KEY_SHARE = 0.3
REPLACE_PAIRING_LIMIT = 10_000
MIN_PAIR_SIMILARITY = 0.35
MARGIN_SHARE = 0.07
MARK_LIMIT = 300
LINE_GAP = 1.5
RUN_GAP = 2


class CompareParams(RpcModel):
    path_a: str
    password_a: str | None = None
    path_b: str
    password_b: str | None = None
    output: str | None = None
    overwrite: bool = False
    visual: bool = True
    text: bool = True
    render_dpi: int = Field(default=110, ge=50, le=200)
    ignore_case: bool = False
    ignore_punctuation: bool = False
    ignore_margins: bool = False


class ChangeMark(RpcModel):
    kind: Literal["text", "area"]
    box: tuple[float, float, float, float]


class PageDiff(RpcModel):
    page: int
    page_a: int | None = None
    page_b: int | None = None
    in_a: bool
    in_b: bool
    added_words: int
    removed_words: int
    changed_area: float
    size_changed: bool = False
    snippets: list[str]
    marks_a: list[ChangeMark] = []
    marks_b: list[ChangeMark] = []


class CompareResult(RpcModel):
    output: str | None
    pages_a: int
    pages_b: int
    changed_pages: int
    added_words: int
    removed_words: int
    report_spreads: int = 0
    pages: list[PageDiff]


@dataclass
class WordMarks:
    removed: list[pymupdf.Rect] = field(default_factory=list)
    added: list[pymupdf.Rect] = field(default_factory=list)
    removed_runs: list[list[pymupdf.Rect]] = field(default_factory=list)
    added_runs: list[list[pymupdf.Rect]] = field(default_factory=list)


@dataclass(frozen=True)
class TextRules:
    ignore_case: bool = False
    ignore_punctuation: bool = False
    ignore_margins: bool = False


PLAIN_TEXT = TextRules()
WordEntry = tuple[str, pymupdf.Rect, pymupdf.Rect]


def _normalised(word: str, rules: TextRules) -> str:
    if rules.ignore_punctuation:
        word = "".join(char for char in word if not unicodedata.category(char).startswith("P"))
    return word.casefold() if rules.ignore_case else word


def _in_body(rect: pymupdf.Rect, height: float, rules: TextRules) -> bool:
    if not rules.ignore_margins:
        return True
    middle = (rect.y0 + rect.y1) / 2
    return height * MARGIN_SHARE <= middle <= height * (1 - MARGIN_SHARE)


def _word_entries(page: pymupdf.Page, rules: TextRules = PLAIN_TEXT) -> list[WordEntry]:
    entries: list[WordEntry] = []
    height = page.rect.height
    for word in page.get_text("words", sort=True):
        raw = pymupdf.Rect(word[:4])
        visible = raw * page.rotation_matrix
        if not _in_body(visible, height, rules):
            continue
        text = _normalised(word[4], rules)
        if text:
            entries.append((text, visible, raw))
    return entries


def _words(page: pymupdf.Page, rules: TextRules = PLAIN_TEXT) -> list[str]:
    return [entry[0] for entry in _word_entries(page, rules)]


def _shape_key(page: pymupdf.Page) -> str:
    pixmap = page.get_pixmap(dpi=HASH_DPI, colorspace=pymupdf.csGRAY, alpha=False)
    if pixmap.width < HASH_SIDE or pixmap.height < HASH_SIDE:
        return ""
    cells = [
        pixmap.samples[
            (row * pixmap.height // HASH_SIDE) * pixmap.stride
            + (column * pixmap.width // HASH_SIDE)
        ]
        for row in range(HASH_SIDE)
        for column in range(HASH_SIDE)
    ]
    average = sum(cells) / len(cells)
    return "shape:" + "".join("1" if value < average else "0" for value in cells)


def _page_key(page: pymupdf.Page, rules: TextRules = PLAIN_TEXT) -> str:
    words = _words(page, rules)
    if words:
        return "text:" + " ".join(word.casefold() for word in words)
    return _shape_key(page)


def _common_ends(keys_a: list[str], keys_b: list[str]) -> tuple[int, int]:
    limit = min(len(keys_a), len(keys_b))
    head = 0
    while head < limit and keys_a[head] == keys_b[head]:
        head += 1
    tail = 0
    while tail < limit - head and keys_a[-1 - tail] == keys_b[-1 - tail]:
        tail += 1
    return head, tail


def _key_similarity(key_a: str, key_b: str) -> float:
    kind_a, _, body_a = key_a.partition(":")
    kind_b, _, body_b = key_b.partition(":")
    if kind_a != kind_b or not body_a or not body_b:
        return 0.0
    if kind_a == "shape":
        if len(body_a) != len(body_b):
            return 0.0
        return sum(x == y for x, y in zip(body_a, body_b, strict=True)) / len(body_a)
    return difflib.SequenceMatcher(a=body_a.split(), b=body_b.split(), autojunk=False).quick_ratio()


def _paired_by_similarity(
    left: list[int], right: list[int], keys_a: list[str], keys_b: list[str]
) -> list[tuple[int | None, int | None]]:
    rows, columns = len(left), len(right)
    similarity = [[_key_similarity(keys_a[a], keys_b[b]) for b in right] for a in left]
    score = [[0.0] * (columns + 1) for _ in range(rows + 1)]
    for row in range(rows - 1, -1, -1):
        for column in range(columns - 1, -1, -1):
            best = max(score[row + 1][column], score[row][column + 1])
            if similarity[row][column] >= MIN_PAIR_SIMILARITY:
                best = max(best, score[row + 1][column + 1] + similarity[row][column])
            score[row][column] = best
    pairs: list[tuple[int | None, int | None]] = []
    row = column = 0
    while row < rows and column < columns:
        paired = similarity[row][column]
        if (
            paired >= MIN_PAIR_SIMILARITY
            and score[row][column] == score[row + 1][column + 1] + paired
        ):
            pairs.append((left[row], right[column]))
            row += 1
            column += 1
        elif score[row][column] == score[row + 1][column]:
            pairs.append((left[row], None))
            row += 1
        else:
            pairs.append((None, right[column]))
            column += 1
    pairs.extend((left[index], None) for index in range(row, rows))
    pairs.extend((None, right[index]) for index in range(column, columns))
    return pairs


def _paired_by_position(left: list[int], right: list[int]) -> list[tuple[int | None, int | None]]:
    return [
        (
            left[position] if position < len(left) else None,
            right[position] if position < len(right) else None,
        )
        for position in range(max(len(left), len(right)))
    ]


def _aligned(keys_a: list[str], keys_b: list[str]) -> list[tuple[int | None, int | None]]:
    head, tail = _common_ends(keys_a, keys_b)
    middle_a = keys_a[head : len(keys_a) - tail]
    middle_b = keys_b[head : len(keys_b) - tail]
    exhaustive = len(middle_a) * len(middle_b) <= EXHAUSTIVE_ALIGNMENT_LIMIT
    matcher = difflib.SequenceMatcher(a=middle_a, b=middle_b, autojunk=not exhaustive)
    pairs: list[tuple[int | None, int | None]] = [(index, index) for index in range(head)]
    for tag, a0, a1, b0, b1 in matcher.get_opcodes():
        a0, a1, b0, b1 = a0 + head, a1 + head, b0 + head, b1 + head
        if tag == "equal":
            pairs.extend((a0 + step, b0 + step) for step in range(a1 - a0))
            continue
        left = list(range(a0, a1))
        right = list(range(b0, b1))
        if (
            tag == "replace"
            and len(left) != len(right)
            and len(left) * len(right) <= REPLACE_PAIRING_LIMIT
        ):
            pairs.extend(_paired_by_similarity(left, right, keys_a, keys_b))
        else:
            pairs.extend(_paired_by_position(left, right))
    first_a, first_b = len(keys_a) - tail, len(keys_b) - tail
    pairs.extend((first_a + step, first_b + step) for step in range(tail))
    return pairs


def _page_keys(
    document: pymupdf.Document,
    progress: Progress,
    band: tuple[float, float],
    rules: TextRules = PLAIN_TEXT,
) -> list[str]:
    keys: list[str] = []
    start, span = band
    total = document.page_count
    for index in range(total):
        if index % KEY_PROGRESS_STRIDE == 0:
            progress.check_cancelled()
            progress.report(
                start + span * index / max(1, total),
                "progress.comparing",
                {"current": index + 1, "total": total},
            )
        keys.append(_page_key(document[index], rules))
    return keys


def _text_diff(
    entries_a: list[WordEntry],
    entries_b: list[WordEntry],
    marks: WordMarks | None = None,
) -> tuple[int, int, list[str]]:
    words_a = [entry[0] for entry in entries_a]
    words_b = [entry[0] for entry in entries_b]
    matcher = difflib.SequenceMatcher(a=words_a, b=words_b, autojunk=False)
    added = removed = 0
    snippets: list[str] = []
    for tag, a0, a1, b0, b1 in matcher.get_opcodes():
        if tag == "equal":
            continue
        removed += a1 - a0
        added += b1 - b0
        if marks is not None:
            marks.removed.extend(entry[1] for entry in entries_a[a0:a1])
            marks.added.extend(entry[1] for entry in entries_b[b0:b1])
            if a1 > a0:
                marks.removed_runs.append([entry[2] for entry in entries_a[a0:a1]])
            if b1 > b0:
                marks.added_runs.append([entry[2] for entry in entries_b[b0:b1]])
        if len(snippets) < 6:
            before = " ".join(words_a[a0:a1])[:80]
            after = " ".join(words_b[b0:b1])[:80]
            snippets.append(
                f"− {before} · + {after}"
                if before and after
                else f"− {before}"
                if before
                else f"+ {after}"
            )
    return added, removed, snippets


def _changed_blocks(
    page_a: pymupdf.Page | None, page_b: pymupdf.Page | None, rules: TextRules = PLAIN_TEXT
) -> tuple[list[pymupdf.Rect], float, list[pymupdf.Rect]]:
    if page_a is None or page_b is None:
        return [], 0.0, []
    pixels_a = _pixels(page_a)
    pixels_b = _pixels(page_b)
    height = max(pixels_a.shape[0], pixels_b.shape[0])
    width = max(pixels_a.shape[1], pixels_b.shape[1])
    rows = -(-height // BLOCK)
    columns = -(-width // BLOCK)
    padded_a = _padded(pixels_a, rows * BLOCK, columns * BLOCK)
    padded_b = _padded(pixels_b, rows * BLOCK, columns * BLOCK)
    differs = (
        numpy.abs(padded_a.astype(numpy.int16) - padded_b.astype(numpy.int16)).max(axis=2)
        > PIXEL_TOLERANCE
    )
    changed = differs.reshape(rows, BLOCK, columns, BLOCK).any(axis=(1, 3))
    if rules.ignore_margins:
        band = int(rows * MARGIN_SHARE)
        changed[:band] = False
        changed[rows - band :] = False
    scale = 72.0 / DIFF_DPI
    merged: list[pymupdf.Rect] = []
    for row in range(rows):
        marked = numpy.flatnonzero(changed[row])
        if not marked.size:
            continue
        starts = [int(marked[0])]
        ends: list[int] = []
        for previous, current in zip(marked[:-1], marked[1:], strict=True):
            if current - previous > 2:
                ends.append(int(previous))
                starts.append(int(current))
        ends.append(int(marked[-1]))
        merged.extend(
            pymupdf.Rect(
                start * BLOCK * scale,
                row * BLOCK * scale,
                (end + 1) * BLOCK * scale,
                (row + 1) * BLOCK * scale,
            )
            for start, end in zip(starts, ends, strict=True)
        )
    regions = [
        pymupdf.Rect(
            column0 * BLOCK * scale,
            row0 * BLOCK * scale,
            (column1 + 1) * BLOCK * scale,
            (row1 + 1) * BLOCK * scale,
        )
        for row0, column0, row1, column1 in _regions(changed)
    ]
    return merged, float(changed.mean()) if changed.size else 0.0, regions


def _row_runs(marked: numpy.ndarray) -> list[tuple[int, int]]:
    if not marked.size:
        return []
    runs: list[tuple[int, int]] = []
    start = previous = int(marked[0])
    for current in marked[1:]:
        current = int(current)
        if current - previous > RUN_GAP:
            runs.append((start, previous))
            start = current
        previous = current
    runs.append((start, previous))
    return runs


def _regions(changed: numpy.ndarray) -> list[tuple[int, int, int, int]]:
    parent: list[int] = []
    boxes: list[list[int]] = []

    def find(label: int) -> int:
        while parent[label] != label:
            parent[label] = parent[parent[label]]
            label = parent[label]
        return label

    previous: list[tuple[int, int, int]] = []
    for row in range(changed.shape[0]):
        current: list[tuple[int, int, int]] = []
        for start, end in _row_runs(numpy.flatnonzero(changed[row])):
            label: int | None = None
            for other_start, other_end, other in previous:
                if other_start > end + RUN_GAP or other_end < start - RUN_GAP:
                    continue
                root = find(other)
                if label is None:
                    label = root
                elif root != label:
                    parent[root] = label
            if label is None:
                label = len(parent)
                parent.append(label)
                boxes.append([row, start, row, end])
            else:
                box = boxes[label]
                box[:] = [min(box[0], row), min(box[1], start), max(box[2], row), max(box[3], end)]
            current.append((start, end, label))
        previous = current
    merged: dict[int, list[int]] = {}
    for label, box in enumerate(boxes):
        root = find(label)
        if root not in merged:
            merged[root] = list(box)
            continue
        target = merged[root]
        target[:] = [
            min(target[0], box[0]),
            min(target[1], box[1]),
            max(target[2], box[2]),
            max(target[3], box[3]),
        ]
    return [tuple(box) for box in merged.values()]


def _same_line(left: pymupdf.Rect, right: pymupdf.Rect) -> bool:
    height = max(min(left.height, right.height), 1.0)
    overlap = min(left.y1, right.y1) - max(left.y0, right.y0)
    gap = right.x0 - left.x1
    return overlap >= height / 2 and -height <= gap <= height * LINE_GAP


def _merged_run(rects: list[pymupdf.Rect]) -> list[pymupdf.Rect]:
    merged: list[pymupdf.Rect] = []
    for rect in rects:
        if merged and _same_line(merged[-1], rect):
            merged[-1] = merged[-1] | rect
        else:
            merged.append(pymupdf.Rect(rect))
    return merged


def _fraction_box(
    rect: pymupdf.Rect, width: float, height: float
) -> tuple[float, float, float, float]:
    return (
        round(min(max(rect.x0 / width, 0.0), 1.0), 4),
        round(min(max(rect.y0 / height, 0.0), 1.0), 4),
        round(min(max(rect.x1 / width, 0.0), 1.0), 4),
        round(min(max(rect.y1 / height, 0.0), 1.0), 4),
    )


def _page_marks(
    page: pymupdf.Page, runs: list[list[pymupdf.Rect]], regions: list[pymupdf.Rect]
) -> list[ChangeMark]:
    width = page.cropbox.width or 1.0
    height = page.cropbox.height or 1.0
    marks: list[ChangeMark] = []
    for run in runs:
        for rect in _merged_run(run):
            if len(marks) >= MARK_LIMIT:
                return marks
            marks.append(ChangeMark(kind="text", box=_fraction_box(rect, width, height)))
    for region in regions:
        if len(marks) >= MARK_LIMIT:
            break
        visible = region & page.rect
        if visible.is_empty:
            continue
        raw = (visible * page.derotation_matrix).normalize()
        marks.append(ChangeMark(kind="area", box=_fraction_box(raw, width, height)))
    return marks


def _pixels(page: pymupdf.Page) -> numpy.ndarray:
    pixmap = page.get_pixmap(dpi=DIFF_DPI, colorspace=pymupdf.csRGB, alpha=False)
    rows = numpy.frombuffer(pixmap.samples, dtype=numpy.uint8).reshape(pixmap.height, pixmap.stride)
    return rows[:, : pixmap.width * pixmap.n].reshape(pixmap.height, pixmap.width, pixmap.n)


def _padded(pixels: numpy.ndarray, height: int, width: int) -> numpy.ndarray:
    padded = numpy.full((height, width, pixels.shape[2]), BLANK, dtype=numpy.uint8)
    padded[: pixels.shape[0], : pixels.shape[1]] = pixels
    return padded


def _size_changed(page_a: pymupdf.Page | None, page_b: pymupdf.Page | None) -> bool:
    if page_a is None or page_b is None:
        return False
    return (
        abs(page_a.rect.width - page_b.rect.width) > SIZE_TOLERANCE
        or abs(page_a.rect.height - page_b.rect.height) > SIZE_TOLERANCE
    )


def _label(
    page: pymupdf.Page,
    point: tuple[float, float],
    text: str,
    size: float = 9,
    fonts: SharedFonts | None = None,
) -> None:
    shared = (
        fonts.using(page, page_object_number(page), REPORT_FONT_NAME, REPORT_FONT)
        if fonts is not None
        else contextlib.nullcontext()
    )
    with shared:
        page.insert_text(
            point,
            text,
            fontsize=size,
            fontname=REPORT_FONT_NAME,
            fontfile=str(REPORT_FONT),
            color=LABEL_COLOUR,
        )


def _place_page(
    page: pymupdf.Page, box: pymupdf.Rect, source: pymupdf.Document, number: int, render_dpi: int
) -> None:
    source_page = source[number]
    rotation = source_page.rotation
    try:
        if rotation:
            source_page.set_rotation(0)
        try:
            page.show_pdf_page(box, source, number, keep_proportion=True, rotate=-rotation)
            return
        finally:
            if rotation:
                source_page.set_rotation(rotation)
    except Exception:  # noqa: BLE001
        pass
    pixmap = source[number].get_pixmap(dpi=render_dpi, alpha=False)
    page.insert_image(box, pixmap=pixmap, keep_proportion=True)


def _anchored(box: pymupdf.Rect, source_page: pymupdf.Page) -> tuple[pymupdf.Rect, float]:
    scale = min(box.width / source_page.rect.width, box.height / source_page.rect.height)
    return (
        pymupdf.Rect(
            box.x0,
            box.y0,
            box.x0 + source_page.rect.width * scale,
            box.y0 + source_page.rect.height * scale,
        ),
        scale,
    )


def _shade(
    page: pymupdf.Page,
    box: pymupdf.Rect,
    scale: float,
    rects: list[pymupdf.Rect],
    colour: tuple[float, float, float],
    filled: bool,
) -> None:
    shape = page.new_shape()
    drawn = 0
    for rect in rects:
        placed = (
            pymupdf.Rect(
                box.x0 + rect.x0 * scale,
                box.y0 + rect.y0 * scale,
                box.x0 + rect.x1 * scale,
                box.y0 + rect.y1 * scale,
            )
            & box
        )
        if placed.is_empty:
            continue
        shape.draw_rect(placed)
        drawn += 1
    if not drawn:
        return
    shape.finish(
        color=colour,
        fill=colour if filled else None,
        fill_opacity=0.25 if filled else 1,
        width=0.6,
    )
    shape.commit()


def _summary_lines(
    doc_a: pymupdf.Document, doc_b: pymupdf.Document, diffs: list[PageDiff], spreads: int
) -> list[str]:
    added = sum(diff.added_words for diff in diffs)
    removed = sum(diff.removed_words for diff in diffs)
    lines = [
        f"A  {Path(doc_a.name).name} · {doc_a.page_count} p",
        f"B  {Path(doc_b.name).name} · {doc_b.page_count} p",
        f"Δ  {len(diffs)} p · +{added} / −{removed}",
    ]
    if spreads < len(diffs):
        lines.append(f"⧉  {spreads} / {len(diffs)}")
    lines.append("")
    for diff in diffs:
        left = f"A{diff.page_a}" if diff.page_a else "A —"
        right = f"B{diff.page_b}" if diff.page_b else "B —"
        parts = [f"{left} ↔ {right}"]
        if diff.added_words or diff.removed_words:
            parts.append(f"+{diff.added_words} / −{diff.removed_words}")
        if diff.changed_area > 0.002:
            parts.append(f"{round(diff.changed_area * 100, 1)}%")
        if diff.size_changed and diff.page_a and diff.page_b:
            parts.append(
                f"{_size_text(doc_a[diff.page_a - 1])} → {_size_text(doc_b[diff.page_b - 1])}"
            )
        lines.append("   ".join(parts))
    return lines


def _size_text(page: pymupdf.Page) -> str:
    return f"{round(page.rect.width)}×{round(page.rect.height)} pt"


def _write_summary(
    report: pymupdf.Document,
    doc_a: pymupdf.Document,
    doc_b: pymupdf.Document,
    diffs: list[PageDiff],
    spreads: int,
    fonts: SharedFonts,
    progress: Progress,
) -> None:
    lines = _summary_lines(doc_a, doc_b, diffs, spreads)
    for offset in range(0, len(lines), SUMMARY_ROWS_PER_PAGE):
        progress.check_cancelled()
        page = report.new_page(width=595, height=842)
        for row, line in enumerate(lines[offset : offset + SUMMARY_ROWS_PER_PAGE]):
            if line:
                _label(page, (48, 64 + row * 18), line, size=11, fonts=fonts)


def _write_report(
    target: Path,
    doc_a: pymupdf.Document,
    doc_b: pymupdf.Document,
    diffs: list[PageDiff],
    blocks: dict[int, list[pymupdf.Rect]],
    marks: dict[int, WordMarks],
    render_dpi: int,
    progress: Progress,
) -> int:
    report = pymupdf.open()
    gap = 12.0
    fonts = SharedFonts(report)
    spread_diffs = diffs[:REPORT_SPREAD_LIMIT]
    _write_summary(
        report,
        doc_a,
        doc_b,
        [diff for diff in diffs if _is_changed(diff)],
        len(spread_diffs),
        fonts,
        progress,
    )
    for diff in spread_diffs:
        progress.check_cancelled()
        page_a = doc_a[diff.page_a - 1] if diff.page_a else None
        page_b = doc_b[diff.page_b - 1] if diff.page_b else None
        reference = page_a or page_b
        if reference is None:
            continue
        width = max(item.rect.width for item in (page_a, page_b) if item is not None)
        height = max(item.rect.height for item in (page_a, page_b) if item is not None)
        page = report.new_page(width=width * 2 + gap * 3, height=height + gap * 2 + 18)
        _label(
            page,
            (gap, 14),
            f"A · {Path(doc_a.name).name} · {f'p{diff.page_a}' if diff.page_a else '—'}",
            fonts=fonts,
        )
        _label(
            page,
            (width + gap * 2, 14),
            f"B · {Path(doc_b.name).name} · {f'p{diff.page_b}' if diff.page_b else '—'}",
            fonts=fonts,
        )
        top = 18 + gap
        left_box = pymupdf.Rect(gap, top, gap + width, top + height)
        right_box = pymupdf.Rect(width + gap * 2, top, width * 2 + gap * 2, top + height)
        scales: dict[str, float] = {}
        for key, source_page, source_doc, box in (
            ("a", page_a, doc_a, left_box),
            ("b", page_b, doc_b, right_box),
        ):
            if source_page is None:
                page.draw_rect(box, color=REMOVED_COLOUR, width=1, dashes="[4 4] 0")
                _label(page, (box.x0 + 12, box.y0 + 24), "—", size=18, fonts=fonts)
                continue
            placed, scales[key] = _anchored(box, source_page)
            _place_page(page, placed, source_doc, source_page.number, render_dpi)
        page_marks = marks.get(diff.page, WordMarks())
        for key, box in (("a", left_box), ("b", right_box)):
            if key in scales:
                _shade(page, box, scales[key], blocks.get(diff.page, []), AREA_COLOUR, False)
        if "a" in scales:
            _shade(page, left_box, scales["a"], page_marks.removed, REMOVED_COLOUR, True)
        if "b" in scales:
            _shade(page, right_box, scales["b"], page_marks.added, ADDED_COLOUR, True)
    with contextlib.suppress(Exception):
        report.subset_fonts()
    report.save(target, garbage=garbage_level(report), deflate=True)
    report.close()
    return len(spread_diffs)


def _is_changed(diff: PageDiff) -> bool:
    return bool(
        diff.added_words
        or diff.removed_words
        or diff.changed_area > 0.002
        or diff.size_changed
        or not (diff.in_a and diff.in_b)
    )


@op("compare.run", CompareParams)
def compare(params: CompareParams, progress: Progress) -> CompareResult:
    target = (
        prepare_output(params.output, [params.path_a, params.path_b], params.overwrite)
        if params.output
        else None
    )
    diffs: list[PageDiff] = []
    blocks: dict[int, list[pymupdf.Rect]] = {}
    marks: dict[int, WordMarks] = {}
    total_added = total_removed = 0
    spreads = 0
    rules = TextRules(
        ignore_case=params.ignore_case,
        ignore_punctuation=params.ignore_punctuation,
        ignore_margins=params.ignore_margins,
    )
    with (
        open_document(params.path_a, params.password_a) as doc_a,
        open_document(params.path_b, params.password_b) as doc_b,
    ):
        keys_a = _page_keys(doc_a, progress, (0.0, KEY_SHARE / 2), rules)
        keys_b = _page_keys(doc_b, progress, (KEY_SHARE / 2, KEY_SHARE / 2), rules)
        progress.check_cancelled()
        pairs = _aligned(keys_a, keys_b)
        count = len(pairs)
        for row, (index_a, index_b) in enumerate(pairs):
            progress.check_cancelled()
            page_a = doc_a[index_a] if index_a is not None else None
            page_b = doc_b[index_b] if index_b is not None else None
            added = removed = 0
            snippets: list[str] = []
            page_marks = WordMarks()
            if params.text:
                added, removed, snippets = _text_diff(
                    _word_entries(page_a, rules) if page_a else [],
                    _word_entries(page_b, rules) if page_b else [],
                    page_marks if page_a is not None and page_b is not None else None,
                )
                if page_marks.removed or page_marks.added:
                    marks[row + 1] = page_marks
            area = 0.0
            regions: list[pymupdf.Rect] = []
            if params.visual:
                rects, area, regions = _changed_blocks(page_a, page_b, rules)
                if rects:
                    blocks[row + 1] = rects
            total_added += added
            total_removed += removed
            diffs.append(
                PageDiff(
                    page=row + 1,
                    page_a=None if index_a is None else index_a + 1,
                    page_b=None if index_b is None else index_b + 1,
                    in_a=page_a is not None,
                    in_b=page_b is not None,
                    added_words=added,
                    removed_words=removed,
                    changed_area=round(area, 4),
                    size_changed=_size_changed(page_a, page_b),
                    snippets=snippets,
                    marks_a=_page_marks(page_a, page_marks.removed_runs, regions)
                    if page_a is not None
                    else [],
                    marks_b=_page_marks(page_b, page_marks.added_runs, regions)
                    if page_b is not None
                    else [],
                )
            )
            progress.report(
                KEY_SHARE + (1 - KEY_SHARE) * (row + 1) / max(1, count),
                "progress.comparing",
                {"current": row + 1, "total": count},
            )
        changed = [diff for diff in diffs if _is_changed(diff)]
        if target is not None:
            progress.report(0.95, "progress.saving")
            spreads = _write_report(
                target,
                doc_a,
                doc_b,
                changed or diffs[:1],
                blocks,
                marks,
                params.render_dpi,
                progress,
            )
        return CompareResult(
            output=str(target) if target else None,
            pages_a=doc_a.page_count,
            pages_b=doc_b.page_count,
            changed_pages=len(changed),
            added_words=total_added,
            removed_words=total_removed,
            report_spreads=spreads,
            pages=diffs,
        )


class PageImagesParams(RpcModel):
    path_a: str
    password_a: str | None = None
    path_b: str
    password_b: str | None = None
    page_a: int | None = Field(default=None, ge=1)
    page_b: int | None = Field(default=None, ge=1)
    dpi: int = Field(default=110, ge=50, le=200)


class PageImagesResult(RpcModel):
    image_a: str | None
    image_b: str | None
    width: int
    height: int


def _page_picture(
    path: str, password: str | None, number: int | None, dpi: int, side: str
) -> pymupdf.Pixmap | None:
    if number is None:
        return None
    with open_document(path, password, mutable=False) as cached:
        document = unwrap_document(cached)
        if number > document.page_count:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"page {number} is past the end of document {side}",
                {"reason": "page", "side": side},
            )
        return document[number - 1].get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB, alpha=False)


def _canvas_png(pixmap: pymupdf.Pixmap | None, width: int, height: int) -> str | None:
    if pixmap is None:
        return None
    canvas = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, width, height), False)
    canvas.clear_with(BLANK)
    canvas.copy(pixmap, pymupdf.IRect(0, 0, pixmap.width, pixmap.height))
    return base64.b64encode(canvas.tobytes("png")).decode("ascii")


@op("compare.pageImages", PageImagesParams)
def page_images(params: PageImagesParams, progress: Progress) -> PageImagesResult:
    if params.page_a is None and params.page_b is None:
        raise OpError(ErrorCode.INVALID_PARAMS, "no page to show", {"reason": "page"})
    picture_a = _page_picture(params.path_a, params.password_a, params.page_a, params.dpi, "a")
    progress.check_cancelled()
    picture_b = _page_picture(params.path_b, params.password_b, params.page_b, params.dpi, "b")
    pictures = [picture for picture in (picture_a, picture_b) if picture is not None]
    width = max(picture.width for picture in pictures)
    height = max(picture.height for picture in pictures)
    return PageImagesResult(
        image_a=_canvas_png(picture_a, width, height),
        image_b=_canvas_png(picture_b, width, height),
        width=width,
        height=height,
    )
