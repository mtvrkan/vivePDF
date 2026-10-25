from dataclasses import dataclass, field

import pymupdf

from vivepdf.ops._cell_text import page_fragments, reads_upright, table_spans, table_texts
from vivepdf.ops._ocr_layer import Rule


@dataclass(slots=True)
class FoundTable:
    page: int
    number: int
    rows: list[list[str | None]]
    spans: list[tuple[int, int, int, int]] = field(default_factory=list)
    area: pymupdf.Rect = field(default_factory=pymupdf.Rect)
    last_page: int = -1
    edges: list[float] = field(default_factory=list)
    bold_head: bool = False
    top: bool = False
    bottom: bool = False
    lines_above: int = 0
    lines_below: int = 0


BORDERLESS_MIN_ROWS = 2
BORDERLESS_MIN_COLUMNS = 2


def _filled_rows(table: object) -> int:
    return sum(
        1
        for row in table.extract()
        if sum(1 for cell in row if cell and str(cell).strip()) >= BORDERLESS_MIN_COLUMNS
    )


PHRASE_GAP = 0.5
EDGE_SLACK = 0.5


def _row_words(page: pymupdf.Page, table: object) -> list[list[pymupdf.Rect]]:
    area = pymupdf.Rect(table.bbox)
    words = [
        pymupdf.Rect(word[:4]) * page.rotation_matrix
        for word in page.get_text("words", clip=area * page.derotation_matrix)
    ]
    rows = []
    for row in table.rows:
        box = pymupdf.Rect(row.bbox)
        rows.append([word for word in words if box.y0 <= (word.y0 + word.y1) / 2 <= box.y1])
    return rows


def _splits_phrases(rows: list[list[pymupdf.Rect]], left: float, edge: float, right: float) -> bool:
    joined = False
    for words in rows:
        before = [word for word in words if left <= (word.x0 + word.x1) / 2 < edge]
        after = [word for word in words if edge <= (word.x0 + word.x1) / 2 < right]
        if not after:
            continue
        if not before:
            return False
        last = max(before, key=lambda word: word.x1)
        first = min(after, key=lambda word: word.x0)
        if first.x0 - last.x1 > PHRASE_GAP * max(last.height, first.height):
            return False
        joined = True
    return joined


def _with_whole_phrases(page: pymupdf.Page, table: object) -> object:
    edges = _column_edges(table)
    rows = _row_words(page, table)
    kept = [edges[0]] + [
        edge
        for left, edge, right in zip(edges, edges[1:], edges[2:], strict=False)
        if not _splits_phrases(rows, left, edge, right)
    ]
    kept.append(edges[-1])
    if len(kept) == len(edges):
        return table
    clip = pymupdf.Rect(table.bbox) + (-EDGE_SLACK, -EDGE_SLACK, EDGE_SLACK, EDGE_SLACK)
    rebuilt = page.find_tables(
        use_layout=False,
        clip=clip,
        vertical_strategy="explicit",
        vertical_lines=kept,
        horizontal_strategy="text",
    ).tables
    for candidate in rebuilt:
        if candidate.col_count == len(kept) - 1:
            return candidate
    return table


def borderless_tables(page: pymupdf.Page) -> list:
    candidates = page.find_tables(use_layout=False, strategy="text").tables
    return [
        _with_whole_phrases(page, table)
        for table in candidates
        if table.col_count >= BORDERLESS_MIN_COLUMNS and _filled_rows(table) >= BORDERLESS_MIN_ROWS
    ]


RULE_THICKNESS = 2.0
RULE_SLACK = 2.0
RULE_GAP_FACTOR = 3.0
RULE_MIN_GAP = 36.0


def _rule_spans(rect: pymupdf.Rect, area: pymupdf.Rect) -> bool:
    return (
        rect.height <= RULE_THICKNESS
        and rect.x0 <= area.x0 + RULE_SLACK
        and rect.x1 >= area.x1 - RULE_SLACK
    )


def _ruled_bottom(page: pymupdf.Page, area: pymupdf.Rect) -> float | None:
    rules = sorted(
        rect.y1
        for rect in (
            pymupdf.Rect(drawing["rect"]) * page.rotation_matrix for drawing in page.get_drawings()
        )
        if rect.y0 >= area.y1 - RULE_SLACK and _rule_spans(rect, area)
    )
    bottom = area.y1
    gap = max(area.height * RULE_GAP_FACTOR, RULE_MIN_GAP)
    for edge in rules:
        if edge - bottom > gap:
            break
        bottom = max(bottom, edge)
    return bottom if bottom > area.y1 + RULE_SLACK else None


def _with_ruled_body(page: pymupdf.Page, table: object) -> object:
    if table.row_count > 1:
        return table
    area = pymupdf.Rect(table.bbox)
    bottom = _ruled_bottom(page, area)
    if bottom is None:
        return table
    edges = sorted(
        {cell[0] for cell in table.cells if cell} | {cell[2] for cell in table.cells if cell}
    )
    clip = pymupdf.Rect(page.rect.x0, area.y0 - RULE_SLACK, page.rect.x1, bottom + RULE_SLACK)
    extended = page.find_tables(
        use_layout=False,
        clip=clip,
        vertical_strategy="explicit",
        vertical_lines=edges,
        horizontal_strategy="lines",
    ).tables
    for candidate in extended:
        if candidate.col_count == table.col_count and candidate.row_count > table.row_count:
            return candidate
    return table


OVERLAP_TOLERANCE = 1.0
FRAME_SHARE = 0.5


def _overlaps(cells: list[pymupdf.Rect]) -> bool:
    active: list[pymupdf.Rect] = []
    for cell in sorted(cells, key=lambda rect: rect.y0):
        active = [other for other in active if other.y1 - cell.y0 > OVERLAP_TOLERANCE]
        for other in active:
            shared = cell & other
            if shared.width > OVERLAP_TOLERANCE and shared.height > OVERLAP_TOLERANCE:
                return True
        active.append(cell)
    return False


def is_page_frame(page: pymupdf.Page, table: object) -> bool:
    cells = [pymupdf.Rect(cell) for cell in table.cells if cell]
    page_area = abs(page.rect)
    if any(abs(cell) > page_area * FRAME_SHARE for cell in cells):
        return True
    return _overlaps(cells)


def _without_empty_columns(rows: list[list[str | None]]) -> list[list[str | None]]:
    width = max((len(row) for row in rows), default=0)
    kept = [
        column
        for column in range(width)
        if any(column < len(row) and row[column] and row[column].strip() for row in rows)
    ]
    return [[row[column] if column < len(row) else None for column in kept] for row in rows]


def find_page_tables(
    page: pymupdf.Page, index: int, borderless: bool, scanned: list[Rule] | None = None
) -> list[FoundTable]:
    if scanned is None:
        finder = page.find_tables(use_layout=False)
    else:
        finder = page.find_tables(use_layout=False, add_lines=scanned) if scanned else None
    found = (
        [_with_ruled_body(page, table) for table in finder.tables if not is_page_frame(page, table)]
        if finder is not None
        else []
    )
    borderless = borderless or scanned is not None
    unruled = not found and borderless
    if unruled:
        found = borderless_tables(page)
    fragments = page_fragments(page) if found else []
    found = [table for table in found if reads_upright(page, fragments, pymupdf.Rect(table.bbox))]
    tables: list[FoundTable] = []
    for number, table in enumerate(found):
        reach = (page.rect.x0, page.rect.x1) if unruled else None
        rows = [
            row
            for row in table_texts(table, fragments, reach)
            if not unruled or any(text and text.strip() for text in row)
        ]
        if unruled:
            rows = _without_empty_columns(rows)
        spans = [] if unruled else table_spans(table)
        tables.append(
            FoundTable(
                page=index,
                number=number,
                rows=rows,
                spans=spans,
                area=pymupdf.Rect(table.bbox),
                last_page=index,
                edges=_column_edges(table),
                bold_head=_bold_head(page, table),
            )
        )
    return tables


def _column_edges(table: object) -> list[float]:
    return sorted({edge for cell in table.cells if cell for edge in (cell[0], cell[2])})


def _bold_head(page: pymupdf.Page, table: object) -> bool:
    if not table.rows:
        return False
    spans = [
        span
        for block in page.get_text(
            "dict", clip=pymupdf.Rect(table.rows[0].bbox) * page.derotation_matrix
        )["blocks"]
        for line in block.get("lines", [])
        for span in line["spans"]
        if span["text"].strip()
    ]
    return bool(spans) and all(
        span["flags"] & pymupdf.TEXT_FONT_BOLD or "bold" in span["font"].lower() for span in spans
    )
