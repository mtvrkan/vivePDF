from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._form_calc import evaluate, format_value, make_number
from vivepdf.ops.forms import FieldsParams, FillParams, fill_fields, list_fields
from vivepdf.ops.forms_batch import MergeParams, merge
from vivepdf.ops.forms_data import (
    FormDataExportParams,
    FormDataImportParams,
    export_data,
    import_data,
)
from vivepdf.ops.forms_export import ExportParams, export_forms
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

SELECTION = b"0.6 0.75 0.85 rg"


def _text(
    page: pymupdf.Page, name: str, top: float, calc: str | None = None, fmt: str | None = None
) -> None:
    widget = pymupdf.Widget()
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.field_name = name
    widget.rect = pymupdf.Rect(50, top, 200, top + 20)
    if calc:
        widget.script_calc = calc
        widget.field_flags = pymupdf.PDF_FIELD_IS_READ_ONLY
    if fmt:
        widget.script_format = fmt
    page.add_widget(widget)


@pytest.fixture
def calc_form(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    _text(page, "price", 40)
    _text(page, "qty", 70)
    _text(page, "item.1", 100)
    _text(page, "item.2", 130)
    _text(
        page,
        "total",
        160,
        'AFSimple_Calculate("SUM", new Array ("price", "qty"));',
        'AFNumber_Format(2, 0, 0, 0, "$", true);',
    )
    _text(page, "items", 190, 'AFSimple_Calculate("SUM", ["item"]);')
    _text(page, "average", 220, 'AFSimple_Calculate("AVG", new Array("price", "qty"));')
    _text(
        page,
        "line",
        250,
        '/** BVCALC price * qty EVCALC **/ event.value = AFMakeNumber(getField("price").value)'
        ' * AFMakeNumber(getField("qty").value);',
        'AFNumber_Format(1, 2, 2, 0, " ₺", false);',
    )
    _text(page, "grand", 280, "/** BVCALC (total + items) / 2 EVCALC **/ event.value = 0;")
    _text(page, "custom", 310, "event.value = this.getField('price').value * 3;")
    listbox = pymupdf.Widget()
    listbox.field_type = pymupdf.PDF_WIDGET_TYPE_LISTBOX
    listbox.field_name = "colors"
    listbox.rect = pymupdf.Rect(250, 40, 400, 120)
    listbox.choice_values = ["Red", "Green", "Blue", "Mavi ğ"]
    listbox.field_flags = pymupdf.PDF_CH_FIELD_IS_MULTI_SELECT
    page.add_widget(listbox)
    path = tmp_path / "calc form ş.pdf"
    document.save(path)
    document.close()
    return path


def _values(path: str) -> dict:
    return {
        field.name: field.value
        for field in list_fields(FieldsParams(path=path), silent_progress()).fields
    }


def test_fill_recalculates_standard_calculations_in_order(calc_form: Path, tmp_path: Path) -> None:
    result = fill_fields(
        FillParams(
            path=str(calc_form),
            output=str(tmp_path / "filled.pdf"),
            values={"price": "1250,5", "qty": "4", "item.1": "2", "item.2": "3"},
        ),
        silent_progress(),
    )
    assert (result.recalculated, result.calc_skipped) == (6, 0)
    values = _values(result.output)
    assert values["total"] == "1254.5"
    assert values["items"] == "5"
    assert values["average"] == "627.25"
    assert values["line"] == "5002"
    assert values["grand"] == "629.75"
    assert values["custom"] == "3751.5"
    document = pymupdf.open(result.output)
    shown = document[0].get_text()
    document.close()
    assert "$1,254.50" in shown
    assert "5.002,0 ₺" in shown


def test_multi_select_list_takes_several_values(calc_form: Path, tmp_path: Path) -> None:
    result = fill_fields(
        FillParams(
            path=str(calc_form),
            output=str(tmp_path / "multi.pdf"),
            values={"colors": ["Red", "Mavi ğ"]},
        ),
        silent_progress(),
    )
    fields = list_fields(FieldsParams(path=result.output), silent_progress()).fields
    colors = next(field for field in fields if field.name == "colors")
    assert colors.multi_select is True
    assert colors.value == ["Red", "Mavi ğ"]
    document = pymupdf.open(result.output)
    widget = next(item for item in document[0].widgets() if item.field_name == "colors")
    assert document.xref_get_key(widget.xref, "I") == ("array", "[0 3]")
    stream = document.xref_stream(int(document.xref_get_key(widget.xref, "AP/N")[1].split()[0]))
    document.close()
    assert stream.count(SELECTION) == 2


def test_multi_select_rejects_an_unknown_option(calc_form: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as caught:
        fill_fields(
            FillParams(
                path=str(calc_form),
                output=str(tmp_path / "bad.pdf"),
                values={"colors": ["Red", "Purple"]},
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS


@pytest.mark.parametrize("fmt", ["xfdf", "fdf"])
def test_multi_select_values_travel_through_data_files_and_recalculate(
    fmt: str, calc_form: Path, tmp_path: Path
) -> None:
    filled = fill_fields(
        FillParams(
            path=str(calc_form),
            output=str(tmp_path / "source.pdf"),
            values={"colors": ["Green", "Blue"], "price": "10", "qty": "2"},
        ),
        silent_progress(),
    )
    exported = export_data(
        FormDataExportParams(path=filled.output, output=str(tmp_path / "data"), format=fmt),
        silent_progress(),
    )
    imported = import_data(
        FormDataImportParams(
            path=str(calc_form), data_path=exported.output, output=str(tmp_path / "back.pdf")
        ),
        silent_progress(),
    )
    assert imported.recalculated == 6
    values = _values(imported.output)
    assert values["custom"] == "30"
    assert values["colors"] == ["Green", "Blue"]
    assert values["total"] == "12"


def test_merge_recalculates_and_splits_multi_select_cells(calc_form: Path, tmp_path: Path) -> None:
    data = tmp_path / "rows.csv"
    data.write_text("price;qty;colors\n3;5;Red; Blue\n", encoding="utf-8")
    data.write_text('price,qty,colors\n3,5,"Red; Blue"\n', encoding="utf-8")
    result = merge(
        MergeParams(path=str(calc_form), data_path=str(data), output_dir=str(tmp_path / "out")),
        silent_progress(),
    )
    assert result.recalculated == 6 and result.calc_skipped == 0
    values = _values(result.outputs[0].output)
    assert values["custom"] == "9"
    assert values["total"] == "8"
    assert values["colors"] == ["Red", "Blue"]
    table = export_forms(
        ExportParams(
            paths=[result.outputs[0].output],
            output=str(tmp_path / "table.csv"),
            format="csv",
            checked_label="Evet",
            unchecked_label="Hayır",
        ),
        silent_progress(),
    )
    assert "Red; Blue" in Path(table.output).read_text(encoding="utf-8-sig")


def test_number_formats_follow_acrobat_styles() -> None:
    assert format_value('AFNumber_Format(2, 0, 0, 0, "$", true);', 1234567.891) == "$1,234,567.89"
    assert format_value('AFNumber_Format(2, 2, 2, 0, " TL", false);', -1234.5) == "(1.234,50 TL)"
    assert format_value('AFNumber_Format(0, 1, 0, 0, "", true);', -0.4) == "0"
    assert format_value('AFNumber_Format(1, 3, 0, 0, "", true);', -2.25) == "-2,2"
    assert format_value("AFPercent_Format(1, 0);", 0.1234) == "12.3%"
    assert format_value("event.value = 1;", 3) is None
    assert make_number("1.234,5") == 0.0
    assert make_number(" 12,5 ") == 12.5
    assert make_number("Off") == 0.0


def test_unsupported_scripts_are_left_alone() -> None:
    def lookup(name: str) -> list[float]:
        return [2.0]

    def single(name: str) -> float:
        return 2.0

    assert evaluate("/** BVCALC a / (b - b) EVCALC **/", lookup, single) is None
    assert evaluate("/** BVCALC a + EVCALC **/", lookup, single) is None
    assert evaluate('AFSimple_Calculate("SUM", ["a"]); app.alert(1);', lookup, single) is None
    assert evaluate('AFSimple_Calculate("PRD", ["a", "b"])', lookup, single) == 4.0
    assert evaluate(r"/** BVCALC Unit\ Price * 3 EVCALC **/", lookup, single) == 6.0


def test_red_negative_styles_colour_the_shown_value(tmp_path: Path) -> None:
    from vivepdf.ops._form_calc import negative_colour

    assert negative_colour('AFNumber_Format(2, 0, 1, 0, "", true);', -5) == (1.0, 0.0, 0.0)
    assert negative_colour('AFNumber_Format(2, 0, 3, 0, "", true);', 5) == (0.0, 0.0, 0.0)
    assert negative_colour('AFNumber_Format(0, 0, 3, 0, "", true);', -0.2) == (0.0, 0.0, 0.0)
    assert negative_colour('AFNumber_Format(2, 0, 0, 0, "", true);', -5) is None
    document = pymupdf.open()
    page = document.new_page()
    _text(page, "a", 40)
    _text(page, "b", 70)
    _text(
        page,
        "diff",
        100,
        "/** BVCALC a - b EVCALC **/",
        'AFNumber_Format(2, 0, 3, 0, "", true);',
    )
    source = tmp_path / "diff.pdf"
    document.save(source)
    document.close()
    result = fill_fields(
        FillParams(path=str(source), output=str(tmp_path / "out.pdf"), values={"a": "1", "b": "3"}),
        silent_progress(),
    )
    with pymupdf.open(result.output) as filled:
        widget = next(item for item in filled[0].widgets() if item.field_name == "diff")
        assert widget.field_value == "-2"
        assert tuple(round(value, 2) for value in widget.text_color) == (1.0, 0.0, 0.0)
        assert "(2.00)" in filled[0].get_text()
