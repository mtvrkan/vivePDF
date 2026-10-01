import time
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._date_names import date_names
from vivepdf.ops._form_script import (
    FormScripts,
    document_scripts,
    field_script,
    print_masked,
    printf,
)
from vivepdf.ops.forms import FieldsParams, FillParams, fill_fields, list_fields
from vivepdf.rpc.progress import silent_progress

LIBRARY = "function double(x) { return AFMakeNumber(x) * 2 }"
STREAM_LIBRARY = "function label(x) { return x > 5 ? 'High' : 'Low' }"


def _field(page: pymupdf.Page, name: str, top: float, calc: str = "", value: str = "") -> None:
    widget = pymupdf.Widget()
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.field_name = name
    widget.rect = pymupdf.Rect(50, top, 300, top + 20)
    if calc:
        widget.script_calc = calc
    if value:
        widget.field_value = value
    page.add_widget(widget)


def _add_document_scripts(document: pymupdf.Document) -> None:
    text_action = document.get_new_xref()
    document.update_object(text_action, f"<< /S /JavaScript /JS {pymupdf.get_pdf_str(LIBRARY)} >>")
    stream_code = document.get_new_xref()
    document.update_object(stream_code, "<< >>")
    document.update_stream(stream_code, STREAM_LIBRARY.encode())
    stream_action = document.get_new_xref()
    document.update_object(stream_action, f"<< /S /JavaScript /JS {stream_code} 0 R >>")
    leaf = document.get_new_xref()
    document.update_object(leaf, f"<< /Names [(b) {stream_action} 0 R] /Limits [(b) (b)] >>")
    tree = document.get_new_xref()
    document.update_object(tree, f"<< /Kids [{leaf} 0 R] /Names [(a) {text_action} 0 R] >>")
    document.xref_set_key(document.pdf_catalog(), "Names", f"<< /JavaScript {tree} 0 R >>")


@pytest.fixture
def scripted_form(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    _field(page, "amount", 40)
    _field(page, "note", 70)
    _field(page, "doubled", 100, 'event.value = double(getField("amount").value);')
    _field(page, "rating", 130, 'event.value = label(this.getField("amount").value);')
    _field(
        page,
        "shown",
        160,
        'event.value = util.printf("%,0.2f", getField("amount").value * 1000);',
    )
    _field(page, "kept", 190, "event.rc = false; event.value = 99;", value="7")
    _field(
        page,
        "writer",
        220,
        'var n = getField("note"); n.value = "set by " + event.targetName; event.value = 1;',
    )
    _field(page, "looping", 250, "while (true) {}")
    _field(page, "throwing", 280, "throw new Error('no');")
    _field(page, "pattern", 310, "event.value = /a/.test('a');")
    _field(page, "after", 340, "var t = 0; for (var i = 1; i <= 4; i++) t += i; event.value = t;")
    _add_document_scripts(document)
    path = tmp_path / "scripted.pdf"
    document.save(path)
    document.close()
    return path


def _values(path: str) -> dict:
    return {
        field.name: field.value
        for field in list_fields(FieldsParams(path=path), silent_progress()).fields
    }


def test_custom_scripts_use_document_functions_and_write_their_results(
    scripted_form: Path, tmp_path: Path
) -> None:
    started = time.monotonic()
    result = fill_fields(
        FillParams(
            path=str(scripted_form), output=str(tmp_path / "out.pdf"), values={"amount": "6,5"}
        ),
        silent_progress(),
    )
    assert time.monotonic() - started < 20
    assert (result.recalculated, result.calc_skipped) == (6, 2)
    values = _values(result.output)
    assert values["doubled"] == "13"
    assert values["rating"] == "High"
    assert values["shown"] == "6,500.00"
    assert values["kept"] == "7"
    assert values["writer"] == "1"
    assert values["note"] == "set by writer"
    assert values["after"] == "10"
    assert values["pattern"] == "true"
    assert values["looping"] in ("", None)


def test_document_scripts_are_read_from_strings_and_streams(scripted_form: Path) -> None:
    with pymupdf.open(scripted_form) as document:
        assert document_scripts(document) == [LIBRARY, STREAM_LIBRARY]
    with pymupdf.open() as empty:
        empty.new_page()
        assert document_scripts(empty) == []


def test_a_looping_document_cannot_spend_more_than_its_budget(scripted_form: Path) -> None:
    with pymupdf.open(scripted_form) as document:
        host = FormScripts(document, {"a": "1"})
        outcomes = [host.calculate("a", "while (true) {}").status for _ in range(6)]
        assert outcomes == ["failed"] * 6
        assert host.budget.steps <= 0
        assert host.calculate("a", "event.value = 2;").status == "failed"


def test_script_results_are_numbers_text_or_kept() -> None:
    with pymupdf.open() as document:
        host = FormScripts(document, {"a": "12,5", "b": "word", "c.1": "2", "c.2": "3"})
        number = host.calculate("x", 'event.value = getField("a").value * 2;')
        assert (number.status, number.raw, number.number) == ("value", "25", 25.0)
        text = host.calculate("x", 'event.value = getField("b").value + "!";')
        assert (text.status, text.raw, text.number) == ("value", "word!", None)
        padded = host.calculate("x", 'event.value = util.printf("%.2f", 3);')
        assert (padded.raw, padded.number) == ("3.00", 3.0)
        total = host.calculate("x", 'AFSimple_Calculate("SUM", "a, c");')
        assert total.number == 17.5
        children = host.calculate(
            "x", 'event.value = getField("c").getArray().length + "/" + getField("missing");'
        )
        assert children.raw == "2/null"
        assert host.calculate("x", "event.value = 1 / 0;").status == "failed"
        looped = "var a = []; a[0] = a; event.value = a;"
        assert host.calculate("x", looped).status == "failed"
        assert host.calculate("x", "event.value = null;").raw == ""
        assert host.calculate("x", "event.rc = false;").status == "kept"
        host.calculate("x", 'getField("b").value = 4.5; getField("zzz");')
        assert host.values["b"] == "4.5"
        assert host.take_changes() == {"b": ("4.5", 4.5)}


@pytest.mark.parametrize(
    ("format_text", "values", "expected"),
    [
        ("%d items", [3.9], "3 items"),
        ("%.2f", [1234.5], "1234.50"),
        ("%,0.2f", [1234567.891], "1,234,567.89"),
        ("%,2.1f", [-1234.56], "-1.234,6"),
        ("%+d|% d|%05d", [5.0, 5.0, -42.0], "+5| 5|-0042"),
        ("%x %s %%", [255.0, "text"], "ff text %"),
        ("%8s|", ["ab"], "      ab|"),
        ("%s and %s", ["one"], "one and undefined"),
    ],
)
def test_util_printf_follows_acrobat_flags(format_text: str, values: list, expected: str) -> None:
    assert printf(format_text, values) == expected


@pytest.mark.parametrize(
    ("raw", "script", "expected"),
    [
        ("2024-03-05", 'AFDate_FormatEx("dd.mm.yyyy");', "05.03.2024"),
        ("3/5/2024", "AFDate_Format(11);", "March 5, 2024"),
        ("5 Mar 2024", 'AFDate_FormatEx("dd/mm/yyyy");', "05/03/2024"),
        ("13:07", "AFTime_Format(1);", "1:07 pm"),
        ("1:07 pm", 'AFTime_FormatEx("HH:MM:ss");', "13:07:00"),
        ("not a date", 'AFDate_FormatEx("mm/dd/yyyy");', "not a date"),
        ("-1234.5", 'AFNumber_Format(2, 0, 2, 0, "$", true);', "($1,234.50)"),
        ("0,125", "AFPercent_Format(1, 2);", "12,5%"),
        ("abc", 'AFNumber_Format(2, 0, 0, 0, "", true);', ""),
        ("123456789", "AFSpecial_Format(1);", "12345-6789"),
        ("555 123 4567", "AFSpecial_Format(2);", "(555) 123-4567"),
        ("1234567", "AFSpecial_Format(2);", "123-4567"),
        ("123-45-6789x", "AFSpecial_Format(3);", "123-45-6789"),
        (
            "2024-03-05",
            'event.value = util.printd("dddd, mmmm d, yyyy", util.scand("yyyy-mm-dd",'
            " event.value));",
            "Tuesday, March 5, 2024",
        ),
        ("x", "event.value = util.printd(2, new Date(2024, 0, 2, 15, 4, 5));", "1/2/24 3:04:05 pm"),
        ("x", "event.value = util.printd(0, new Date(2024, 0, 2, 15, 4, 5));", "D:20240102150405"),
        ("x", 'event.value = util.scand("mm/dd/yyyy", "13/45/2024");', ""),
        ("x", "AFSpecial_Format(9);", None),
        ("x", 'util.printd("d", 5);', None),
    ],
)
def test_format_scripts_reshape_the_shown_value(
    raw: str, script: str, expected: str | None
) -> None:
    with pymupdf.open() as document:
        host = FormScripts(document, {"f": raw, "other": "kept"})
        assert host.format("f", script) == expected
        host.format("f", 'getField("other").value = "changed";')
        assert host.values == {"f": raw, "other": "kept"}
        assert host.take_changes() == {}


def test_validate_scripts_accept_or_refuse_a_value() -> None:
    with pymupdf.open() as document:
        host = FormScripts(document, {"n": "1"})
        in_range = "AFRange_Validate(true, 0, true, 10);"
        assert [host.validate("n", in_range, raw) for raw in ("5", "50", "-1", "", "abc")] == [
            True,
            False,
            False,
            True,
            True,
        ]
        assert host.validate("n", "AFRange_Validate(false, 0, true, 10);", "-99")
        assert not host.validate("n", "event.rc = event.value > 3;", "2")
        assert host.validate("n", "throw new Error('broken');", "2")


def test_print_masked_follows_acrobat_masks() -> None:
    assert print_masked(">AAA-9999*", "ab1c2345xyz") == "ABC-2345XYZ"
    assert print_masked("<XX?9", "A-B!7") == "ab!7"
    assert print_masked(chr(92) + "9 99", "123") == "9 12"
    assert print_masked("99-99", "1") == "1-"


def _action(script: str) -> str:
    return f"<< /S /JavaScript /JS {pymupdf.get_pdf_str(script)} >>"


def test_calculated_values_run_their_format_and_validate_scripts(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    _field(page, "start", 40)
    _field(page, "days", 70)
    _field(
        page,
        "due",
        100,
        'var d = util.scand("yyyy-mm-dd", getField("start").value); d.setDate(d.getDate()'
        ' + getField("days").value); event.value = util.printd("yyyy-mm-dd", d);',
    )
    _field(page, "capped", 130, "/** BVCALC days * 10 EVCALC **/", value="7")
    _field(page, "phone", 160, 'event.value = "5551234567";')
    widgets = {widget.field_name: widget for widget in page.widgets()}
    widgets["due"].script_format = 'AFDate_FormatEx("mmmm d, yyyy");'
    widgets["due"].update()
    widgets["phone"].script_format = "AFSpecial_Format(2);"
    widgets["phone"].update()
    document.xref_set_key(
        widgets["capped"].xref, "AA/V", _action("AFRange_Validate(true, 0, true, 100);")
    )
    source = tmp_path / "dates.pdf"
    document.save(source)
    document.close()
    with pymupdf.open(source) as saved:
        capped = next(item for item in saved[0].widgets() if item.field_name == "capped")
        assert field_script(saved, capped.xref, "V") == "AFRange_Validate(true, 0, true, 100);"
        assert field_script(saved, capped.xref, "F") is None

    def fill(days: str) -> dict:
        result = fill_fields(
            FillParams(
                path=str(source),
                output=str(tmp_path / f"out{days}.pdf"),
                values={"start": "2024-02-20", "days": days},
            ),
            silent_progress(),
        )
        with pymupdf.open(result.output) as filled:
            shown = filled[0].get_text()
        return {
            "summary": (result.recalculated, result.calc_skipped),
            "shown": shown,
            **_values(result.output),
        }

    small = fill("9")
    assert small["summary"] == (3, 0)
    assert small["due"] == "2024-02-29"
    assert "February 29, 2024" in small["shown"]
    assert small["capped"] == "90"
    assert small["phone"] == "5551234567"
    assert "(555) 123-4567" in small["shown"]
    refused = fill("12")
    assert refused["summary"] == (2, 0)
    assert refused["due"] == "2024-03-03"
    assert "March 3, 2024" in refused["shown"]
    assert refused["capped"] == "7"


@pytest.mark.parametrize(
    ("language", "raw", "script", "expected"),
    [
        ("tr", "2024-03-05", 'AFDate_FormatEx("dddd, d mmmm yyyy");', "Salı, 5 Mart 2024"),
        ("tr", "5 Ağustos 2024", 'AFDate_FormatEx("dd.mm.yyyy");', "05.08.2024"),
        ("ru", "2024-03-05", 'AFDate_FormatEx("d mmmm yyyy");', "5 марта 2024"),
        ("ru", "2024-03-05", 'AFDate_FormatEx("mmmm yyyy");', "март 2024"),
        ("de", "5 Mär 2024", 'AFDate_FormatEx("dd.mm.yyyy");', "05.03.2024"),
        ("es", "martes, 5 de junio de 2024", 'AFDate_FormatEx("yyyy-mm-dd");', "2024-06-05"),
        ("pt-BR", "2024-03-05", 'AFDate_FormatEx("ddd d mmm");', "ter 5 mar"),
        ("ja", "2024-03-05", 'AFDate_FormatEx("mmmm d dddd");', "3月 5 火曜日"),
        ("fr", "x", 'event.value = util.scand("d mmmm yyyy", "5 décembre 2024").getMonth();', "11"),
        ("en", "5 Mar 2024", 'AFDate_FormatEx("yyyy-mm-dd");', "2024-03-05"),
        ("xx", "2024-03-05", 'AFDate_FormatEx("mmmm");', "March"),
        ("it", "x", "event.value = app.language;", "ITA"),
    ],
)
def test_date_names_follow_the_app_language(
    language: str, raw: str, script: str, expected: str
) -> None:
    with pymupdf.open() as document:
        host = FormScripts(document, {"f": raw}, date_names(language))
        assert host.format("f", script) == expected


def test_forms_fill_writes_dates_in_the_requested_language(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    _field(page, "start", 40)
    _field(page, "due", 70, 'event.value = getField("start").value;')
    due = next(widget for widget in page.widgets() if widget.field_name == "due")
    due.script_format = 'AFDate_FormatEx("d mmmm yyyy");'
    due.update()
    source = tmp_path / "language.pdf"
    document.save(source)
    document.close()
    shown = {}
    for language in ("tr", None):
        result = fill_fields(
            FillParams(
                path=str(source),
                output=str(tmp_path / f"out-{language}.pdf"),
                values={"start": "2024-10-29"},
                language=language,
            ),
            silent_progress(),
        )
        with pymupdf.open(result.output) as filled:
            shown[language] = filled[0].get_text()
    assert "29 Ekim 2024" in shown["tr"]
    assert "29 October 2024" in shown[None]
