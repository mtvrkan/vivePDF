import csv
from pathlib import Path
from typing import Any, Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._form_appearance import choice_label
from vivepdf.ops._output import (
    prepare_data_output,
    write_atomically,
)
from vivepdf.ops._spreadsheet import CellTyping, clean_text, inert_cell, needs_quote_prefix
from vivepdf.ops.forms import (
    FormField,
    describe_field,
    form_widgets,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

UNEXPORTED_KINDS = ("button", "signature")
TYPED_KINDS = ("text", "combobox")
CELL_TEXT_LIMIT = 32767
FILE_COLUMN = ""
FILE_HEADER = "file"


class ExportParams(RpcModel):
    paths: list[str] = Field(min_length=1)
    password: str | None = None
    output: str
    format: Literal["csv", "xlsx"] = "xlsx"
    delimiter: Literal[",", ";", "\t"] = ";"
    overwrite: bool = False
    checked_label: str = Field(default="1", max_length=40)
    unchecked_label: str = Field(default="0", max_length=40)


class ExportResult(RpcModel):
    output: str
    files: int
    columns: list[str]
    failed: list[str]


def _shown_value(field: FormField, widget: pymupdf.Widget, params: ExportParams) -> str:
    value = field.value
    if field.kind == "checkbox":
        return params.checked_label if value else params.unchecked_label
    if value is None or value is False:
        return ""
    if field.kind == "radio":
        labels = dict(zip(field.options, field.option_labels, strict=False))
        return labels.get(str(value)) or str(value)
    if field.kind in ("combobox", "listbox"):
        chosen = value if isinstance(value, list) else [str(value)]
        return "; ".join(choice_label(widget, item) for item in chosen)
    if isinstance(value, list):
        return "; ".join(value)
    return str(value)


def _form_record(path: str, params: ExportParams) -> tuple[dict[str, str], dict[str, str]]:
    with open_document(path, params.password) as document:
        record: dict[str, str] = {FILE_COLUMN: clean_text(Path(path).name)}
        kinds: dict[str, str] = {}
        _pages, groups = form_widgets(document)
        for name, widgets in groups.items():
            field = describe_field(document, name, widgets, 0)
            if field.kind in UNEXPORTED_KINDS:
                continue
            record[name] = clean_text(_shown_value(field, widgets[0], params))
            kinds[name] = field.kind
        return record, kinds


def _header(column: str) -> str:
    return column or FILE_HEADER


def _write_csv(
    partial: Path, columns: list[str], records: list[dict[str, str]], delimiter: str
) -> None:
    with partial.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=delimiter)
        writer.writerow([inert_cell(clean_text(_header(column))) for column in columns])
        for record in records:
            writer.writerow([inert_cell(record.get(column, "")) for column in columns])


def _text_cell(sheet: Any, text: str) -> Any:
    from openpyxl.cell import WriteOnlyCell

    value = clean_text(text)[:CELL_TEXT_LIMIT]
    cell = WriteOnlyCell(sheet, value=value)
    if needs_quote_prefix(value):
        cell.data_type = "s"
        cell.quotePrefix = True
    return cell


def _value_cell(sheet: Any, text: str, typing: CellTyping | None) -> Any:
    from openpyxl.cell import WriteOnlyCell

    typed = typing.typed(text) if typing else None
    if typed is None:
        return _text_cell(sheet, text)
    cell = WriteOnlyCell(sheet, value=typed.value)
    if typed.number_format:
        cell.number_format = typed.number_format
    return cell


def _write_xlsx(
    partial: Path, columns: list[str], records: list[dict[str, str]], kinds: dict[str, str]
) -> None:
    from openpyxl import Workbook

    typings = {
        column: CellTyping(record.get(column, "") for record in records)
        for column in columns
        if kinds.get(column) in TYPED_KINDS
    }
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet("Forms")
    sheet.freeze_panes = "A2"
    sheet.append([_text_cell(sheet, _header(column)) for column in columns])
    for record in records:
        sheet.append(
            [_value_cell(sheet, record.get(column, ""), typings.get(column)) for column in columns]
        )
    workbook.save(str(partial))


@op("forms.export", ExportParams)
def export_forms(params: ExportParams, progress: Progress) -> ExportResult:
    target = prepare_data_output(params.output, params.format, params.overwrite)
    columns: list[str] = [FILE_COLUMN]
    records: list[dict[str, str]] = []
    kinds: dict[str, str] = {}
    failed: list[str] = []
    for index, path in enumerate(params.paths):
        progress.check_cancelled()
        try:
            record, found = _form_record(path, params)
        except OpError as error:
            if error.code == ErrorCode.CANCELLED:
                raise
            failed.append(path)
        except (RuntimeError, ValueError):
            failed.append(path)
        else:
            records.append(record)
            for name, kind in found.items():
                kinds.setdefault(name, kind)
                if name not in columns:
                    columns.append(name)
        progress.report(
            (index + 1) / len(params.paths),
            "progress.analyzing",
            {"current": index + 1, "total": len(params.paths)},
        )
    if not records:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "none of the files could be read",
            {"reason": "noReadableFiles", "failed": failed},
        )
    if params.format == "csv":
        write_atomically(
            target, lambda partial: _write_csv(partial, columns, records, params.delimiter)
        )
    else:
        write_atomically(target, lambda partial: _write_xlsx(partial, columns, records, kinds))
    return ExportResult(
        output=str(target),
        files=len(records),
        columns=[_header(column) for column in columns],
        failed=failed,
    )
