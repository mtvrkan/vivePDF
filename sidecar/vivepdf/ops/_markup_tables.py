import html

import pymupdf

from vivepdf.ops._cell_text import page_fragments, reads_upright, table_spans, table_texts
from vivepdf.ops._spreadsheet import clean_text
from vivepdf.ops._words import plain_letters
from vivepdf.ops.convert_tables import is_page_frame

TABLE_ERRORS = (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase)


def filled_table(table) -> bool:
    try:
        cells = [cell for row in table.extract() for cell in row]
    except TABLE_ERRORS:
        return False
    return sum(1 for cell in cells if cell and cell.strip()) * 2 >= len(cells)


def _cell(tag: str, text: str | None, span: tuple[int, int] | None) -> str:
    rows, columns = span or (1, 1)
    attributes = (f' rowspan="{rows}"' if rows > 1 else "") + (
        f' colspan="{columns}"' if columns > 1 else ""
    )
    body = html.escape(plain_letters(clean_text(text or "")).strip(), quote=False)
    return f"<{tag}{attributes}>{body.replace(chr(10), '<br/>')}</{tag}>"


def table_html(rows: list[list[str | None]], spans: list[tuple[int, int, int, int]]) -> str:
    starts = {
        (top, left): (bottom - top + 1, right - left + 1) for top, left, bottom, right in spans
    }
    covered = {
        (row, column)
        for top, left, bottom, right in spans
        for row in range(top, bottom + 1)
        for column in range(left, right + 1)
    } - starts.keys()
    parts = ["<table>"]
    for row_index, row in enumerate(rows):
        tag = "th" if row_index == 0 else "td"
        cells = [
            _cell(tag, text, starts.get((row_index, column)))
            for column, text in enumerate(row)
            if (row_index, column) not in covered
        ]
        parts.append(f"<tr>{''.join(cells)}</tr>")
    parts.append("</table>")
    return "".join(parts)


def page_tables(page: pymupdf.Page) -> list[tuple[pymupdf.Rect, str]]:
    try:
        found = page.find_tables(use_layout=False).tables
    except TABLE_ERRORS:
        return []
    tables = [
        table
        for table in found
        if table.row_count > 1
        and table.col_count > 1
        and not is_page_frame(page, table)
        and filled_table(table)
    ]
    if not tables:
        return []
    fragments = page_fragments(page)
    tables = [table for table in tables if reads_upright(page, fragments, pymupdf.Rect(table.bbox))]
    return [
        (
            pymupdf.Rect(table.bbox) * page.derotation_matrix,
            table_html(table_texts(table, fragments), table_spans(table)),
        )
        for table in tables
    ]
