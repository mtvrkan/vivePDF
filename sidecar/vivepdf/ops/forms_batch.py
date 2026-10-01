from pathlib import Path
from typing import Any

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._form_appearance import UnicodeAppearance, is_multi_select
from vivepdf.ops._form_calc import CalcSummary, recalculate
from vivepdf.ops._form_rows import (
    MAX_PREVIEW_ROWS,
    Delimiter,
    load_rows,
    normalize_key,
    unknown_placeholders,
)
from vivepdf.ops._naming import render_name, unique_name
from vivepdf.ops._output import (
    OutputResult,
    prepare_output,
    save_document,
)
from vivepdf.ops.forms import (
    FIELD_TYPES,
    FillReport,
    fill_field,
    form_widgets,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

TRUE_WORDS = {
    "1",
    "true",
    "yes",
    "y",
    "x",
    "on",
    "evet",
    "ja",
    "oui",
    "si",
    "sí",
    "sim",
    "да",
    "是",
    "はい",
    "예",
}


class DataPreviewParams(RpcModel):
    path: str
    sheet: str | None = None
    delimiter: Delimiter = "auto"
    limit: int = Field(default=5, ge=1, le=MAX_PREVIEW_ROWS)


class DataPreviewResult(RpcModel):
    columns: list[str]
    rows: list[dict[str, str]]
    total_rows: int
    sheets: list[str]


@op("forms.data_preview", DataPreviewParams)
def data_preview(params: DataPreviewParams, progress: Progress) -> DataPreviewResult:
    columns, rows, sheets = load_rows(params.path, params.sheet, params.delimiter)
    return DataPreviewResult(
        columns=columns, rows=rows[: params.limit], total_rows=len(rows), sheets=sheets
    )


def coerce_value(widget: pymupdf.Widget, raw: str) -> Any:
    kind = FIELD_TYPES.get(widget.field_type, "other")
    if kind == "checkbox":
        return raw.strip().casefold() in TRUE_WORDS
    if kind == "radio":
        return raw
    if is_multi_select(widget):
        return [part.strip() for part in raw.split(";") if part.strip()]
    return raw


class MergeParams(RpcModel):
    path: str
    password: str | None = None
    data_path: str
    sheet: str | None = None
    delimiter: Delimiter = "auto"
    output_dir: str
    pattern: str = "{file}-{n}"
    mapping: dict[str, str | None] = Field(default_factory=dict)
    flatten: bool = False
    overwrite: bool = False
    limit: int | None = Field(default=None, ge=1)
    language: str | None = Field(default=None, max_length=16)


class MergeOutput(RpcModel):
    output: str
    row: int


class MergeFailure(RpcModel):
    row: int
    code: str
    reason: str | None = None
    field: str | None = None
    value: str | None = None


class MergeResult(RpcModel):
    outputs: list[MergeOutput]
    rows: int
    skipped: int
    unmatched_fields: list[str]
    failed: list[MergeFailure] = Field(default_factory=list)
    recalculated: int = 0
    calc_skipped: int = 0


def resolve_mapping(
    field_names: list[str], columns: list[str], mapping: dict[str, str | None]
) -> dict[str, str]:
    by_key: dict[str, str] = {}
    for column in columns:
        key = normalize_key(column)
        if key:
            by_key.setdefault(key, column)
    resolved: dict[str, str] = {}
    for name in field_names:
        if name in mapping and mapping[name] is None:
            continue
        explicit = mapping.get(name)
        if explicit and explicit in columns:
            resolved[name] = explicit
            continue
        key = normalize_key(name)
        guess = by_key.get(key) if key else None
        if guess:
            resolved[name] = guess
    return resolved


def _row_names(
    pattern: str, stem: str, selected: list[dict[str, str]], mapping: dict[str, str]
) -> list[str | None]:
    taken: set[str] = set()
    names: list[str | None] = []
    digits = len(str(len(selected)))
    for index, row in enumerate(selected):
        if not any(row.get(column, "").strip() for column in mapping.values()):
            names.append(None)
            continue
        values = {
            "name": stem,
            **row,
            "file": stem,
            "n": f"{index + 1:0{digits}d}",
            "total": len(selected),
        }
        names.append(unique_name(render_name(pattern, values), taken))
    return names


def _merge_failure(row: int, error: OpError) -> MergeFailure:
    data = error.data if isinstance(error.data, dict) else {}
    return MergeFailure(
        row=row,
        code=error.code.value,
        reason=data.get("reason"),
        field=data.get("field"),
        value=None if data.get("value") is None else str(data.get("value")),
    )


@op("forms.merge", MergeParams)
def merge(params: MergeParams, progress: Progress) -> MergeResult:
    columns, rows, _sheets = load_rows(params.data_path, params.sheet, params.delimiter)
    if not rows:
        raise OpError(ErrorCode.INVALID_PARAMS, "data file has no rows", {"reason": "noRows"})
    unknown = unknown_placeholders(params.pattern, columns)
    if unknown:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"the name pattern uses unknown fields: {', '.join(unknown)}",
            {"reason": "unknownPlaceholders", "fields": unknown},
        )
    output_dir = Path(params.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(params.path).stem
    with open_document(params.path, params.password) as template:
        if not template.is_form_pdf:
            raise OpError(
                ErrorCode.INVALID_PARAMS, "document has no form fields", {"reason": "noForm"}
            )
        field_names = sorted(
            {
                widget.field_name
                for page in template
                for widget in page.widgets()
                if widget.field_name
                and FIELD_TYPES.get(widget.field_type) not in ("button", "signature", None)
                and not widget.field_flags & pymupdf.PDF_FIELD_IS_READ_ONLY
            }
        )
    mapping = resolve_mapping(field_names, columns, params.mapping)
    if not mapping:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "no field matches a column", {"reason": "noMapping"}
        )
    selected = rows[: params.limit] if params.limit else rows
    names = _row_names(params.pattern, stem, selected, mapping)
    targets = [
        None
        if name is None
        else prepare_output(str(output_dir / f"{name}.pdf"), [params.path], params.overwrite)
        for name in names
    ]
    outputs: list[MergeOutput] = []
    failed: list[MergeFailure] = []
    skipped = 0
    recalculated = 0
    calc_skipped = 0
    try:
        for index, (row, target) in enumerate(zip(selected, targets, strict=True)):
            progress.check_cancelled()
            if target is None:
                skipped += 1
                continue
            values = {field: row.get(column, "") for field, column in mapping.items()}
            try:
                saved, calculation = _merge_row(params, values, target)
            except OpError as error:
                if error.code == ErrorCode.CANCELLED:
                    raise
                failed.append(_merge_failure(index + 1, error))
                continue
            recalculated += calculation.recalculated
            calc_skipped += calculation.skipped
            outputs.append(MergeOutput(output=saved.output, row=index + 1))
            progress.report(
                (index + 1) / len(selected),
                "progress.filling",
                {"current": index + 1, "total": len(selected)},
            )
    except OpError as error:
        if error.code == ErrorCode.CANCELLED:
            for created in outputs:
                Path(created.output).unlink(missing_ok=True)
        raise
    return MergeResult(
        outputs=outputs,
        rows=len(selected),
        skipped=skipped,
        unmatched_fields=[name for name in field_names if name not in mapping],
        failed=failed,
        recalculated=recalculated,
        calc_skipped=calc_skipped,
    )


def _merge_row(
    params: MergeParams, values: dict[str, str], target: Path
) -> tuple[OutputResult, CalcSummary]:
    document = open_document(params.path, params.password)
    try:
        appearance = UnicodeAppearance(document)
        report = FillReport()
        _pages, groups = form_widgets(document)
        for field_name, raw in values.items():
            widgets = groups.get(field_name)
            if widgets:
                fill_field(widgets, coerce_value(widgets[0], raw), appearance, report)
        calculation = recalculate(document, appearance, params.language)
        appearance.finish()
        if params.flatten:
            document.bake(annots=False, widgets=True)
        return save_document(document, target), calculation
    finally:
        document.close()
