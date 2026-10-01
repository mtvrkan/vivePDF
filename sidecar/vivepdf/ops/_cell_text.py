from dataclasses import dataclass

import pymupdf

WORD_GAP = 0.2
SAME_LINE = 0.5
EDGE_REACH = 36.0
SPAN_TOLERANCE = 1.0


@dataclass(slots=True)
class Glyph:
    text: str
    x0: float
    x1: float
    center_x: float
    center_y: float


@dataclass(slots=True)
class Fragment:
    baseline: float
    size: float
    horizontal: bool
    top: float
    glyphs: list[Glyph]
    low: float
    high: float


def page_fragments(page: pymupdf.Page) -> list[Fragment]:
    fragments: list[Fragment] = []
    raw = page.get_text("rawdict", flags=pymupdf.TEXTFLAGS_TEXT)
    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            horizontal = abs(line["dir"][1]) < 1e-3 and line["dir"][0] > 0
            for span in line["spans"]:
                glyphs = [
                    Glyph(
                        char["c"],
                        char["bbox"][0],
                        char["bbox"][2],
                        (char["bbox"][0] + char["bbox"][2]) / 2,
                        (char["bbox"][1] + char["bbox"][3]) / 2,
                    )
                    for char in span["chars"]
                ]
                if glyphs:
                    fragments.append(
                        Fragment(
                            span["origin"][1],
                            span["size"] or 1.0,
                            horizontal,
                            span["bbox"][1],
                            glyphs,
                            min(glyph.center_y for glyph in glyphs),
                            max(glyph.center_y for glyph in glyphs),
                        )
                    )
    return fragments


def _inside(glyph: Glyph, rect: pymupdf.Rect) -> bool:
    return rect.x0 <= glyph.center_x <= rect.x1 and rect.y0 <= glyph.center_y <= rect.y1


def _join(pieces: list[tuple[float, float, str]], size: float) -> str:
    text = ""
    previous_end: float | None = None
    for start, end, value in sorted(pieces, key=lambda piece: piece[0]):
        gap_is_word = previous_end is not None and start - previous_end > size * WORD_GAP
        if gap_is_word and not text.endswith(" ") and not value.startswith(" "):
            text += " "
        text += value
        previous_end = end
    return " ".join(text.split())


def cell_text(fragments: list[Fragment], cell: tuple[float, float, float, float]) -> str:
    rect = pymupdf.Rect(cell)
    rows: list[tuple[float, float, list[tuple[float, float, str]]]] = []
    for fragment in fragments:
        inside = [glyph for glyph in fragment.glyphs if _inside(glyph, rect)]
        if not inside:
            continue
        key = fragment.baseline if fragment.horizontal else fragment.top
        piece = (inside[0].x0, inside[-1].x1, "".join(glyph.text for glyph in inside))
        for row in rows:
            if abs(row[0] - key) <= fragment.size * SAME_LINE:
                row[2].append(piece)
                break
        else:
            rows.append((key, fragment.size, [piece]))
    lines = [_join(pieces, size) for _key, size, pieces in sorted(rows, key=lambda row: row[0])]
    return "\n".join(line for line in lines if line)


def _reaching_edges(
    cells: list[tuple[float, float, float, float] | None],
) -> list[tuple[float, float, float, float] | None]:
    present = [index for index, cell in enumerate(cells) if cell is not None]
    if not present:
        return cells
    reached = list(cells)
    first, last = present[0], present[-1]
    x0, y0, x1, y1 = reached[first]
    reached[first] = (x0 - EDGE_REACH, y0, x1, y1)
    x0, y0, x1, y1 = reached[last]
    reached[last] = (x0, y0, x1 + EDGE_REACH, y1)
    return reached


def _row_fragments(fragments: list[Fragment], cells: list) -> list[Fragment]:
    present = [cell for cell in cells if cell is not None]
    if not present:
        return []
    top = min(cell[1] for cell in present)
    bottom = max(cell[3] for cell in present)
    return [fragment for fragment in fragments if fragment.high >= top and fragment.low <= bottom]


def table_texts(
    table, fragments: list[Fragment], reach_edges: bool = False
) -> list[list[str | None]]:
    texts: list[list[str | None]] = []
    for row in table.rows:
        cells = _reaching_edges(row.cells) if reach_edges else row.cells
        nearby = _row_fragments(fragments, cells)
        texts.append([None if cell is None else cell_text(nearby, cell) for cell in cells])
    return texts


def _cell_at(cells: list, column: int):
    return cells[column] if column < len(cells) else None


def _column_starts(rows: list) -> list[float | None]:
    starts: list[float | None] = [None] * max((len(row.cells) for row in rows), default=0)
    for row in rows:
        for column, cell in enumerate(row.cells):
            if cell is not None and starts[column] is None:
                starts[column] = cell[0]
    return starts


def table_spans(table) -> list[tuple[int, int, int, int]]:
    rows = list(table.rows)
    starts = _column_starts(rows)
    covered: set[tuple[int, int]] = set()
    spans: list[tuple[int, int, int, int]] = []
    for row_index, row in enumerate(rows):
        for column, cell in enumerate(row.cells):
            if cell is None or (row_index, column) in covered:
                continue
            last_column = column
            while (
                last_column + 1 < len(row.cells)
                and row.cells[last_column + 1] is None
                and starts[last_column + 1] is not None
                and starts[last_column + 1] < cell[2] - SPAN_TOLERANCE
            ):
                last_column += 1
            last_row = row_index
            while (
                last_row + 1 < len(rows)
                and rows[last_row + 1].bbox[1] < cell[3] - SPAN_TOLERANCE
                and all(
                    _cell_at(rows[last_row + 1].cells, other) is None
                    for other in range(column, last_column + 1)
                )
            ):
                last_row += 1
            block = {
                (inner_row, inner_column)
                for inner_row in range(row_index, last_row + 1)
                for inner_column in range(column, last_column + 1)
            }
            if len(block) == 1 or block & covered:
                continue
            covered |= block
            spans.append((row_index, column, last_row, last_column))
    return spans
