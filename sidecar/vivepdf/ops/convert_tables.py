import csv
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._ocr_layer import Rule
from vivepdf.ops._output import write_atomically
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._split_tables import joined_across_pages
from vivepdf.ops._spreadsheet import CellTyping, clean_text, inert_cell, needs_quote_prefix
from vivepdf.ops._table_finding import RULE_SLACK, FoundTable, find_page_tables
from vivepdf.ops.convert import FileResult, TextSourceParams, _prepare_file, recognise_first
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.registry import op


class TablesResult(FileResult):
    table_count: int
    text_pages: list[int] = Field(default_factory=list)
    textless_pages: list[int] = Field(default_factory=list)
    ocr_pages: list[int] = Field(default_factory=list)


class XlsxParams(TextSourceParams):
    sheets: Literal["table", "page", "single"] = "table"
    format: Literal["xlsx", "csv"] = "xlsx"
    delimiter: Literal[",", ";", "\t"] = ","
    borderless: bool = False
    page_label: str = Field(default="S", max_length=24)
    table_label: str = Field(default="T", max_length=24)
    text_label: str = Field(default="Text", max_length=24)


@dataclass(frozen=True, slots=True)
class SheetLabels:
    page: str = "S"
    table: str = "T"
    text: str = "Text"


Placed = list[tuple[int, FoundTable]]

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


def _inside_any(box: pymupdf.Rect, areas: list[pymupdf.Rect]) -> bool:
    middle = pymupdf.Point((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
    return any(middle in area for area in areas)


def _lines_outside(page: pymupdf.Page, areas: list[pymupdf.Rect]) -> list[tuple[pymupdf.Rect, str]]:
    lines: list[tuple[pymupdf.Rect, str]] = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"])
            box = pymupdf.Rect(line["bbox"]) * page.rotation_matrix
            if text.strip() and not _inside_any(box, areas):
                lines.append((box, text))
    return lines


PAGE_END_SHARE = 0.25


def _mark_page_ends(
    tables: list[FoundTable], outside: list[tuple[pymupdf.Rect, str]], height: float
) -> None:
    first = min(tables, key=lambda table: table.area.y0)
    last = max(tables, key=lambda table: table.area.y1)
    first.top = first.area.y0 <= height * PAGE_END_SHARE
    last.bottom = last.area.y1 >= height * (1 - PAGE_END_SHARE)
    first.lines_above = sum(1 for box, _text in outside if box.y1 <= first.area.y0 + RULE_SLACK)
    last.lines_below = sum(1 for box, _text in outside if box.y0 >= last.area.y1 - RULE_SLACK)


def _page_span(first: int, last: int, label: str) -> str:
    return f"{label}{first}" if first == last else f"{label}{first}-{label}{last}"


def _placed(tables: list[FoundTable]) -> Placed:
    placed: Placed = []
    offset = 0
    for position, table in enumerate(tables):
        if position:
            offset += 1
        placed.append((offset, table))
        offset += len(table.rows)
    return placed


def sheet_plan(
    tables: list[FoundTable], sheets: str, labels: SheetLabels
) -> list[tuple[str, Placed]]:
    if sheets == "single":
        title = _page_span(tables[0].page + 1, tables[-1].last_page + 1, labels.page)
        return [(title, _placed(tables))]
    if sheets == "page":
        pages: dict[int, list[FoundTable]] = {}
        for table in tables:
            pages.setdefault(table.page, []).append(table)
        return [(f"{labels.page}{page + 1}", _placed(group)) for page, group in pages.items()]
    return [
        (
            f"{_page_span(table.page + 1, table.last_page + 1, labels.page)}"
            f"-{labels.table}{table.number + 1}",
            [(0, table)],
        )
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
    if "\n" in value or len(value) > COLUMN_WIDTH_RANGE[1]:
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


HEADER_MIN_CELLS = 2


def has_header(table: FoundTable, typing: CellTyping) -> bool:
    if len(table.rows) < 2:
        return False
    head = [clean_text(text) for text in table.rows[0] if text and text.strip()]
    if len(head) < HEADER_MIN_CELLS or any(typing.typed(text) for text in head):
        return False
    return table.bold_head or any(
        typing.typed(clean_text(text)) is not None
        for row in table.rows[1:]
        for text in row
        if text and text.strip()
    )


def _header_cells(cells: list) -> list:
    from openpyxl.styles import Font

    for cell in cells:
        if cell is not None:
            cell.font = Font(bold=True)
    return cells


def _write_tables_sheet(sheet, placed: Placed, typing: CellTyping) -> None:
    from openpyxl.worksheet.cell_range import CellRange

    _set_widths(sheet, [row for _offset, table in placed for row in table.rows])
    headed = [has_header(table, typing) for _offset, table in placed]
    if len(placed) == 1 and headed[0]:
        sheet.freeze_panes = "A2"
    written = 0
    for (offset, table), header in zip(placed, headed, strict=True):
        while written < offset:
            sheet.append([])
            written += 1
        for position, row in enumerate(table.rows):
            cells = [_table_cell(sheet, text, typing) for text in row]
            sheet.append(_header_cells(cells) if header and not position else cells)
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
    tables: list[FoundTable],
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


def _write_csv(
    partial: Path, tables: list[FoundTable], lines: list[tuple[int, str]], delimiter: str
) -> None:
    rows: list[list[object]] = []
    if tables:
        for position, table in enumerate(tables):
            if position:
                rows.append([])
            rows.extend([spreadsheet_cell(text) for text in row] for row in table.rows)
    else:
        rows = [[page, spreadsheet_cell(text)] for page, text in lines]
    with partial.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=delimiter)
        for row in rows:
            writer.writerow(row)


@op("convert.to_xlsx", XlsxParams)
def to_xlsx(params: XlsxParams, progress: Progress) -> TablesResult:
    suffix = ".csv" if params.format == "csv" else ".xlsx"
    target = _prepare_file(params.output, [params.path], params.overwrite, suffix)
    tables: list[FoundTable] = []
    text_by_page: dict[int, list[str]] = {}
    around_tables: dict[int, list[str]] = {}
    textless: list[int] = []
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        rules: dict[int, list[Rule]] = {}
        recognised, progress = recognise_first(document, indices, params, progress, rules)
        for position, index in enumerate(indices):
            progress.check_cancelled()
            page = document[index]
            scanned = rules.get(index) if index + 1 in recognised else None
            found = find_page_tables(page, index, params.borderless, scanned)
            tables.extend(found)
            if found:
                outside = _lines_outside(page, [table.area for table in found])
                _mark_page_ends(found, outside, page.cropbox.height)
                if outside:
                    around_tables[index + 1] = [text for _box, text in outside]
            else:
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
    if params.format == "csv" or params.sheets != "page":
        tables = joined_across_pages(tables, indices)
    keeps_text = not tables or params.format == "xlsx"
    lines = [
        (page, text)
        for page, page_lines in sorted({**text_by_page, **around_tables}.items())
        for text in page_lines
        if keeps_text
    ]
    labels = SheetLabels(params.page_label, params.table_label, params.text_label)
    if params.format == "csv":
        write_atomically(
            target, lambda partial: _write_csv(partial, tables, lines, params.delimiter)
        )
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
        text_pages=sorted(page for page in text_by_page if keeps_text),
        textless_pages=textless,
        ocr_pages=recognised,
    )
