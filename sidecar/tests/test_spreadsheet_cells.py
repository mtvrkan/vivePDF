import csv
from pathlib import Path

import pymupdf

from vivepdf.ops._spreadsheet import CellTyping, clean_text, inert_cell, needs_quote_prefix
from vivepdf.ops.comments import CommentsExportParams, export_comments
from vivepdf.rpc.progress import silent_progress


def test_formula_like_text_is_neutralised() -> None:
    assert inert_cell('=HYPERLINK("http://x","y")') == '\'=HYPERLINK("http://x","y")'
    assert inert_cell("@SUM(A1)") == "'@SUM(A1)"
    assert inert_cell("+90 555 1234 x") == "'+90 555 1234 x"


def test_numbers_and_plain_text_are_left_alone() -> None:
    assert inert_cell("-5") == "-5"
    assert inert_cell("+1.250,50") == "+1.250,50"
    assert inert_cell("-12%") == "-12%"
    assert inert_cell("Ankara") == "Ankara"
    assert inert_cell("") == ""
    assert inert_cell(42) == 42


def test_comment_csv_cannot_carry_a_formula(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    note = page.add_text_annot((72, 72), '=cmd|"/c calc"!A1')
    note.set_info(title="=evil()")
    note.update()
    source = tmp_path / "notes.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "notes.csv"
    export_comments(
        CommentsExportParams(path=str(source), output=str(target), format="csv"),
        silent_progress(),
    )
    with target.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle, delimiter=";"))
    assert rows[1][2] == "'=evil()"
    assert rows[1][6].startswith("'=")


def _typed(texts: list[str], text: str):
    typed = CellTyping(texts).typed(text)
    return None if typed is None else (typed.value, typed.number_format)


def test_decimal_comma_documents_read_their_numbers() -> None:
    column = ["1.234,50", "12,75", "3"]
    assert _typed(column, "1.234,50") == (1234.5, "#,##0.00")
    assert _typed(column, "12,75") == (12.75, "0.00")
    assert _typed(column, "3") == (3, None)
    assert _typed(column, "1.234") == (1234, "#,##0")


def test_decimal_point_documents_read_their_numbers() -> None:
    column = ["1,234.50", "0.5"]
    assert _typed(column, "1,234.50") == (1234.5, "#,##0.00")
    assert _typed(column, "1,234") == (1234, "#,##0")


def test_ambiguous_grouping_stays_text_without_evidence() -> None:
    assert _typed(["1.234"], "1.234") is None


def test_identifiers_and_long_digit_runs_stay_text() -> None:
    assert _typed([], "00123") is None
    assert _typed([], "1234567890123456") is None
    assert _typed([], "12a") is None
    assert _typed([], "1\n2") is None


def test_percent_currency_and_negative_values() -> None:
    assert _typed([], "%12") == (0.12, "0%")
    assert _typed([], "12,5%") == (0.125, "0.0%")
    assert _typed([], "(1.250,00)") == (-1250.0, "#,##0.00")
    assert _typed([], "− 7") is None
    assert _typed([], "−7") == (-7, None)
    assert _typed([], "€5") == (5, '"€"0')
    assert _typed([], "5 ₺") == (5, '0 "₺"')
    assert _typed([], "(5") is None


def test_dates_are_typed_only_when_their_order_is_known() -> None:
    import datetime as dt

    assert _typed([], "2025-12-31") == (dt.date(2025, 12, 31), "yyyy-mm-dd")
    assert _typed([], "31.12.2025") == (dt.date(2025, 12, 31), "dd.mm.yyyy")
    assert _typed([], "03/04/2025") is None
    assert _typed(["25/12/2025"], "03/04/2025") == (dt.date(2025, 4, 3), "dd/mm/yyyy")
    assert _typed(["12/25/2025"], "03/04/2025") == (dt.date(2025, 3, 4), "mm/dd/yyyy")
    assert _typed(["1,5"], "03/04/2025") == (dt.date(2025, 4, 3), "dd/mm/yyyy")
    assert _typed([], "31.02.2025") is None


def test_clean_text_and_quote_prefix() -> None:
    assert clean_text("a\x01b\ud800c") == "abc"
    assert needs_quote_prefix("=1+1")
    assert not needs_quote_prefix("1+1")
