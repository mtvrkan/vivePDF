import datetime as dt
import threading
from pathlib import Path

import pymupdf
import pytest
from openpyxl import Workbook

from vivepdf.ops._form_rows import normalize_key
from vivepdf.ops._sheet_cells import cell_text
from vivepdf.ops.forms import FieldsParams, list_fields
from vivepdf.ops.forms_batch import (
    DataPreviewParams,
    MergeParams,
    data_preview,
    merge,
    resolve_mapping,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress


def _radio_kid(xref: int, state: str, x: float) -> str:
    return (
        f"{xref} 0 obj << /Type /Annot /Subtype /Widget /Parent 5 0 R "
        f"/Rect [{x} 700 {x + 14} 714] /F 4 /P 3 0 R /MK << /CA (l) >> /AS /Off "
        f"/AP << /N << /{state} 20 0 R /Off 21 0 R >> >> >> endobj\n"
    )


@pytest.fixture
def form(tmp_path: Path) -> Path:
    objects = [
        "1 0 obj << /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 10 0 R 11 0 R] "
        "/DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv 30 0 R >> >> >> >> endobj\n",
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        "/Annots [6 0 R 7 0 R 8 0 R 10 0 R 11 0 R] >> endobj\n",
        "5 0 obj << /FT /Btn /Ff 49152 /T (size) /Opt [(Small) (Medium) (Large)] "
        "/Kids [6 0 R 7 0 R 8 0 R] >> endobj\n",
        _radio_kid(6, "S", 72),
        _radio_kid(7, "M", 100),
        _radio_kid(8, "L", 128),
        "10 0 obj << /Type /Annot /Subtype /Widget /FT /Tx /T (code) "
        "/Rect [72 600 250 620] /P 3 0 R /F 4 /V (AB) /DA (/Helv 10 Tf 0 g) >> endobj\n",
        "11 0 obj << /Type /Annot /Subtype /Widget /FT /Tx /T (note) "
        "/Rect [72 550 250 570] /P 3 0 R /F 4 /DA (/Helv 10 Tf 0 g) >> endobj\n",
        "20 0 obj << /Type /XObject /Subtype /Form /BBox [0 0 14 14] /Length 0 >> stream\n\n"
        "endstream endobj\n",
        "21 0 obj << /Type /XObject /Subtype /Form /BBox [0 0 14 14] /Length 0 >> stream\n\n"
        "endstream endobj\n",
        "30 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    ]
    raw = "%PDF-1.7\n" + "".join(objects) + "trailer << /Root 1 0 R /Size 31 >>\n%%EOF\n"
    path = tmp_path / "form.pdf"
    document = pymupdf.open("pdf", raw.encode("latin-1"))
    document.save(path)
    document.close()
    return path


def _csv(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "data.csv"
    path.write_text(text, encoding="utf-8")
    return path


def _values(path: str) -> dict:
    listed = list_fields(FieldsParams(path=path), silent_progress())
    return {field.name: field.value for field in listed.fields}


def _merge(form: Path, data: Path, out: Path, **extra) -> object:
    return merge(
        MergeParams(path=str(form), data_path=str(data), output_dir=str(out), **extra),
        silent_progress(),
    )


def test_skipped_field_is_not_guessed_from_a_matching_column(form: Path, tmp_path: Path) -> None:
    data = _csv(tmp_path, "note;code\nhello;ZZ\n")
    result = _merge(form, data, tmp_path / "out", mapping={"code": None})
    values = _values(result.outputs[0].output)
    assert values["note"] == "hello"
    assert values["code"] == "AB"
    assert "code" in result.unmatched_fields


def test_row_with_a_value_outside_the_choices_is_reported_and_others_are_made(
    form: Path, tmp_path: Path
) -> None:
    data = _csv(tmp_path, "note;size\nfirst;Large\nsecond;Huge\nthird;s\n")
    result = _merge(form, data, tmp_path / "out", pattern="{note}")
    assert [item.row for item in result.outputs] == [1, 3]
    assert [Path(item.output).name for item in result.outputs] == ["first.pdf", "third.pdf"]
    assert not (tmp_path / "out" / "second.pdf").exists()
    [failure] = result.failed
    assert failure.row == 2
    assert failure.code == ErrorCode.INVALID_PARAMS.value
    assert failure.reason == "notAnOption"
    assert failure.field == "size" and failure.value == "Huge"
    assert _values(result.outputs[0].output)["size"] == "L"
    assert _values(result.outputs[1].output)["size"] == "S"


def test_file_token_names_outputs_after_the_template_and_a_name_column_wins(
    form: Path, tmp_path: Path
) -> None:
    data = _csv(tmp_path, "name;note\nAyse;hi\n")
    result = _merge(form, data, tmp_path / "out", pattern="{file}-{name}")
    assert Path(result.outputs[0].output).name == "form-Ayse.pdf"


def test_existing_output_stops_the_run_before_any_file_is_written(
    form: Path, tmp_path: Path
) -> None:
    out = tmp_path / "out"
    out.mkdir()
    (out / "b.pdf").write_bytes(b"keep")
    data = _csv(tmp_path, "note\na\nb\n")
    with pytest.raises(OpError):
        _merge(form, data, out, pattern="{note}")
    assert not (out / "a.pdf").exists()
    assert (out / "b.pdf").read_bytes() == b"keep"


def test_cancelling_removes_the_files_this_run_created(form: Path, tmp_path: Path) -> None:
    event = threading.Event()

    def sink(_value: float, _message: str | None, _detail: dict | None) -> None:
        event.set()

    data = _csv(tmp_path, "note\na\nb\nc\n")
    out = tmp_path / "out"
    with pytest.raises(OpError) as caught:
        merge(
            MergeParams(path=str(form), data_path=str(data), output_dir=str(out), pattern="{note}"),
            Progress(sink, event),
        )
    assert caught.value.code == ErrorCode.CANCELLED
    assert list(out.glob("*.pdf")) == []


def test_chosen_delimiter_overrides_detection(tmp_path: Path) -> None:
    data = _csv(tmp_path, "note;code\nhi;X1\n")
    preview = data_preview(DataPreviewParams(path=str(data), delimiter=","), silent_progress())
    assert preview.columns == ["note;code"]
    piped = _csv(tmp_path, "note|code\nhi|X1\n")
    preview = data_preview(DataPreviewParams(path=str(piped), delimiter="|"), silent_progress())
    assert preview.columns == ["note", "code"]
    assert preview.rows[0] == {"note": "hi", "code": "X1"}


def test_spreadsheet_cells_are_read_as_they_are_shown(tmp_path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["date", "iso", "zip", "price", "share"])
    sheet.append([dt.datetime(2026, 9, 5), dt.datetime(2026, 9, 6), 123, 4.5, 0.25])
    sheet["A2"].number_format = "dd.mm.yyyy"
    sheet["B2"].number_format = "mm-dd-yy"
    sheet["C2"].number_format = "00000"
    sheet["D2"].number_format = "0.00"
    sheet["E2"].number_format = "0%"
    path = tmp_path / "data.xlsx"
    workbook.save(path)
    preview = data_preview(DataPreviewParams(path=str(path)), silent_progress())
    assert preview.rows[0] == {
        "date": "05.09.2026",
        "iso": "2026-09-06",
        "zip": "00123",
        "price": "4.50",
        "share": "25%",
    }


def test_keys_of_non_latin_columns_match_and_symbol_only_keys_do_not() -> None:
    assert normalize_key("Имя Фамилия") == normalize_key("имя_фамилия") == "имяфамилия"
    assert resolve_mapping(["имя_фамилия"], ["Имя Фамилия"], {}) == {"имя_фамилия": "Имя Фамилия"}
    assert resolve_mapping(["---"], ["***"], {}) == {}


def test_cell_text_follows_the_number_format() -> None:
    assert cell_text(dt.datetime(2026, 9, 5), "d mmmm yyyy") == "5 September 2026"
    assert cell_text(dt.datetime(2026, 9, 5, 14, 5), "hh:mm") == "14:05"
    assert cell_text(dt.time(9, 30), "h:mm AM/PM") == "9:30 AM"
    assert cell_text(1234.5, "#,##0.00") == "1234.50"
    assert cell_text(0.125, "0.0%") == "12.5%"
    assert cell_text(7, "@") == "7"
    assert cell_text(0.1 + 0.2, "General") == "0.3"
    assert cell_text(True, None) == "TRUE"
    assert cell_text(None, "0.00") == ""
