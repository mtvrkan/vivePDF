import tempfile
from collections.abc import Callable
from pathlib import Path

import pymupdf

from vivepdf.ops._form_rows import load_rows
from vivepdf.ops._naming import render_name, unique_name
from vivepdf.ops._output import prepare_output, save_document
from vivepdf.ops._sign_params import SignParams
from vivepdf.ops._studio_models import MAX_ROWS, StudioRenderParams, StudioSignOptions
from vivepdf.ops.sign import sign
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

Values = dict[str, str]


def merge_rows(params: StudioRenderParams) -> list[Values]:
    if not params.data_path:
        if params.split and not params.rows:
            raise OpError(ErrorCode.INVALID_PARAMS, "there are no rows", {"reason": "noRows"})
        return params.rows or [{}]
    _columns, rows, _sheets = load_rows(params.data_path, params.sheet)
    if not rows:
        raise OpError(ErrorCode.INVALID_PARAMS, "the data file has no rows", {"reason": "noRows"})
    if len(rows) > MAX_ROWS:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "too many rows", {"reason": "tooManyRows", "limit": MAX_ROWS}
        )
    return rows


def row_values(row: Values, index: int, date: str) -> Values:
    values = {"n": str(index + 1)}
    if date:
        values["date"] = date
    values.update(row)
    return values


def split_targets(params: StudioRenderParams, rows: list[Values]) -> list[Path]:
    if params.format != "pdf":
        raise OpError(
            ErrorCode.INVALID_PARAMS, "one file per row needs PDF", {"reason": "splitNeedsPdf"}
        )
    if not params.output_dir:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "an output folder is required", {"reason": "noOutputDir"}
        )
    folder = Path(params.output_dir)
    taken: set[str] = set()
    targets = []
    for index, row in enumerate(rows):
        values = row_values(row, index, params.date)
        targets.append(folder / f"{unique_name(render_name(params.pattern, values), taken)}.pdf")
    if not params.overwrite:
        existing = next((target for target in targets if target.exists()), None)
        if existing is not None:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"output already exists: {existing.name}",
                {"exists": True, "path": str(existing)},
            )
    folder.mkdir(parents=True, exist_ok=True)
    return targets


def _signed(source: Path, target: Path, options: StudioSignOptions) -> None:
    sign(
        SignParams(
            path=str(source),
            output=str(target),
            overwrite=True,
            certificate_path=options.certificate_path,
            certificate_password=options.certificate_password,
            visible=False,
            reason=options.reason,
            location=options.location,
        ),
        silent_progress(),
    )


def save_output(
    document: pymupdf.Document,
    target: Path,
    inputs: list[str],
    options: StudioSignOptions | None,
    save: Callable[[pymupdf.Document, Path], object] = save_document,
) -> int:
    final = prepare_output(str(target), inputs, True)
    if options is None:
        save(document, final)
        return final.stat().st_size
    with tempfile.TemporaryDirectory(prefix="vivepdf-studio-", ignore_cleanup_errors=True) as temp:
        unsigned = Path(temp) / "unsigned.pdf"
        save(document, unsigned)
        _signed(unsigned, final, options)
    return final.stat().st_size
