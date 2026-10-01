import csv
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._cell_text import page_fragments, table_spans, table_texts
from vivepdf.ops._document import open_document
from vivepdf.ops._output import write_atomically
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._spreadsheet import CellTyping, clean_text, inert_cell, needs_quote_prefix
from vivepdf.ops.convert import FileResult, PdfSourceParams, _prepare_file
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.registry import op


class TablesResult(FileResult):
    table_count: int
    text_pages: list[int] = Field(default_factory=list)
    textless_pages: list[int] = Field(default_factory=list)


class XlsxParams(PdfSourceParams):
    sheets: Literal["table", "page", "single"] = "table"
    format: Literal["xlsx", "csv"] = "xlsx"
    borderless: bool = False
    page_label: str = Field(default="S", max_length=24)
    table_label: str = Field(default="T", max_length=24)
    text_label: str = Field(default="Text", max_length=24)


@dataclass(slots=True)
class _Table:
    page: int
    number: int
    rows: list[list[str | None]]
    spans: list[tuple[int, int, int, int]] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class SheetLabels:
    page: str = "S"
    table: str = "T"
    text: str = "Text"


Placed = list[tuple[int, _Table]]

SHEET_NAME_LIMIT = 31
SHEET_NAME_FORBIDDEN = re.compile(r"[\[\]:*?/\\]")
CELL_TEXT_LIMIT = 32767
COLUMN_WIDTH_RANGE = (8, 60)


def spreadsheet_cell(value: object) -> object:
    if value is None:
        return ""
    if isinstance(value, str):
        return inert_cell(clean_text(value))
    return value


def _page_lines(page: pymupdf.Page) -> list[str]:
    return [line for line in page.get_text().splitlines() if line.strip()]


def _page_span(first: int, last: int, label: str) -> str:
    return f"{label}{first}" if first == last else f"{label}{first}-{label}{last}"


def _placed(tables: list[_Table]) -> Placed:
    placed: Placed = []
    offset = 0
    for position, table in enumerate(tables):
        if position:
            offset += 1
        placed.append((offset, table))
        offset += len(table.rows)
    return placed


def sheet_plan(tables: list[_Table], sheets: str, labels: SheetLabels) -> list[tuple[str, Placed]]:
    if sheets == "single":
        title = _page_span(tables[0].page + 1, tables[-1].page + 1, labels.page)
        return [(title, _placed(tables))]
    if sheets == "page":
        pages: dict[int, list[_Table]] = {}
        for table in tables:
            pages.setdefault(table.page, []).append(table)
        return [(f"{labels.page}{page + 1}", _placed(group)) for page, group in pages.items()]
    return [
        (f"{labels.page}{table.page + 1}-{labels.table}{table.number + 1}", [(0, table)])
        for table in tables
    ]


def sheet_title(title: str, taken: set[str]) -> str:
    base = SHEET_NAME_FORBIDDEN.sub("", clean_text(title)).strip().strip("'").strip() or "1"
    candidate = base[:SHEET_NAME_LIMIT]
    number = 2
    while candidate.casefold() in taken:
        suffix = f" ({number})"
        candidate = base[: SHEET_NAME_LIMIT - len(suffix)] + suffix
        number += 1
    taken.add(candidate.casefold())
    return candidate


def _text_cell(sheet, text: str):
    from openpyxl.cell import WriteOnlyCell
    from openpyxl.styles import Alignment

    value = clean_text(text)[:CELL_TEXT_LIMIT]
    cell = WriteOnlyCell(sheet, value=value)
    if needs_quote_prefix(value):
        cell.data_type = "s"
        cell.quotePrefix = True
    if "\n" in value:
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    return cell


def _table_cell(sheet, text: str | None, typing: CellTyping):
    from openpyxl.cell import WriteOnlyCell

    if text is None or not text.strip():
        return None
    typed = typing.typed(clean_text(text))
    if typed is None:
        return _text_cell(sheet, text)
    cell = WriteOnlyCell(sheet, value=typed.value)
    if typed.number_format:
        cell.number_format = typed.number_format
    return cell


def _column_widths(rows: list[list[str | None]]) -> list[int]:
    low, high = COLUMN_WIDTH_RANGE
    widths: list[int] = []
    for row in rows:
        for column, text in enumerate(row):
            longest = max((len(line) for line in (text or "").splitlines()), default=0)
            if column == len(widths):
                widths.append(low)
            widths[column] = max(widths[column], min(high, longest + 2))
    return widths


def _set_widths(sheet, rows: list[list[str | None]]) -> None:
    from openpyxl.utils import get_column_letter

    for column, width in enumerate(_column_widths(rows), start=1):
        sheet.column_dimensions[get_column_letter(column)].width = width


def _write_tables_sheet(sheet, placed: Placed, typing: CellTyping) -> None:
    from openpyxl.worksheet.cell_range import CellRange

    _set_widths(sheet, [row for _offset, table in placed for row in table.rows])
    written = 0
    for offset, table in placed:
        while written < offset:
            sheet.append([])
            written += 1
        for row in table.rows:
            sheet.append([_table_cell(sheet, text, typing) for text in row])
            written += 1
        for first_row, first_column, last_row, last_column in table.spans:
            sheet.merged_cells.add(
                CellRange(
                    min_row=offset + first_row + 1,
                    min_col=first_column + 1,
                    max_row=offset + last_row + 1,
                    max_col=last_column + 1,
                )
            )


def _write_lines_sheet(sheet, lines: list[tuple[int, str]]) -> None:
    _set_widths(sheet, [[None, text] for _page, text in lines])
    for page, text in lines:
        sheet.append([page, _text_cell(sheet, text)])


def _write_workbook(
    partial: Path,
    tables: list[_Table],
    lines: list[tuple[int, str]],
    sheets: str,
    labels: SheetLabels,
    first_page: int,
) -> None:
    from openpyxl import Workbook

    workbook = Workbook(write_only=True)
    taken: set[str] = set()
    if tables:
        typing = CellTyping(text for table in tables for row in table.rows for text in row if text)
        for title, placed in sheet_plan(tables, sheets, labels):
            _write_tables_sheet(
                workbook.create_sheet(title=sheet_title(title, taken)), placed, typing
            )
        if lines:
            _write_lines_sheet(workbook.create_sheet(title=sheet_title(labels.text, taken)), lines)
    else:
        pages = [page for page, _text in lines] or [first_page]
        title = _page_span(min(pages), max(pages), labels.page)
        _write_lines_sheet(workbook.create_sheet(title=sheet_title(title, taken)), lines)
    workbook.save(str(partial))


def _write_csv(partial: Path, tables: list[_Table], lines: list[tuple[int, str]]) -> None:
    rows: list[list[object]] = []
    if tables:
        for position, table in enumerate(tables):
            if position:
                rows.append([])
            rows.extend([spreadsheet_cell(text) for text in row] for row in table.rows)
    else:
        rows = [[page, spreadsheet_cell(text)] for page, text in lines]
    with partial.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        for row in rows:
            writer.writerow(row)


BORDERLESS_MIN_ROWS = 2
BORDERLESS_MIN_COLUMNS = 2


def _filled_rows(table: object) -> int:
    return sum(
        1
        for row in table.extract()
        if sum(1 for cell in row if cell and str(cell).strip()) >= BORDERLESS_MIN_COLUMNS
    )


def borderless_tables(page: pymupdf.Page) -> list:
    candidates = page.find_tables(use_layout=False, strategy="text").tables
    return [
        table
        for table in candidates
        if table.col_count >= BORDERLESS_MIN_COLUMNS and _filled_rows(table) >= BORDERLESS_MIN_ROWS
    ]


def _page_tables(page: pymupdf.Page, index: int, borderless: bool) -> list[_Table]:
    finder = page.find_tables(use_layout=False)
    found = finder.tables if finder is not None else []
    unruled = not found and borderless
    if unruled:
        found = borderless_tables(page)
    fragments = page_fragments(page) if found else []
    tables: list[_Table] = []
    for number, table in enumerate(found):
        rows = [
            row
            for row in table_texts(table, fragments, reach_edges=unruled)
            if not unruled or any(text and text.strip() for text in row)
        ]
        spans = [] if unruled else table_spans(table)
        tables.append(_Table(page=index, number=number, rows=rows, spans=spans))
    return tables


@op("convert.to_xlsx", XlsxParams)
def to_xlsx(params: XlsxParams, progress: Progress) -> TablesResult:
    suffix = ".csv" if params.format == "csv" else ".xlsx"
    target = _prepare_file(params.output, [params.path], params.overwrite, suffix)
    tables: list[_Table] = []
    text_by_page: dict[int, list[str]] = {}
    textless: list[int] = []
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        for position, index in enumerate(indices):
            progress.check_cancelled()
            page = document[index]
            found = _page_tables(page, index, params.borderless)
            tables.extend(found)
            if not found:
                page_lines = _page_lines(page)
                if page_lines:
                    text_by_page[index + 1] = page_lines
                else:
                    textless.append(index + 1)
            progress.report(
                position / len(indices),
                "progress.convertingPages",
                {"current": position + 1, "total": len(indices)},
            )
    keeps_text = not tables or params.format == "xlsx"
    lines = [
        (page, text)
        for page, page_lines in text_by_page.items()
        for text in page_lines
        if keeps_text
    ]
    labels = SheetLabels(params.page_label, params.table_label, params.text_label)
    if params.format == "csv":
        write_atomically(target, lambda partial: _write_csv(partial, tables, lines))
    else:
        write_atomically(
            target,
            lambda partial: _write_workbook(
                partial, tables, lines, params.sheets, labels, indices[0] + 1
            ),
        )
    return TablesResult(
        output=str(target),
        bytes=target.stat().st_size,
        table_count=len(tables),
        text_pages=sorted({page for page, _text in lines}),
        textless_pages=textless,
    )
