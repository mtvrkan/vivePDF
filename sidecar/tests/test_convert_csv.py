from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.convert_to_pdf import FileToPdfParams, file_to_pdf
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _convert(tmp_path: Path, text: str, name: str = "veri.csv") -> pymupdf.Document:
    source = tmp_path / name
    source.write_text(text, encoding="utf-8")
    result = file_to_pdf(
        FileToPdfParams(path=str(source), output=str(tmp_path / "veri.pdf")), silent_progress()
    )
    return pymupdf.open(result.output)


def _cells(document: pymupdf.Document) -> list[str]:
    return [line for page in document for line in page.get_text().splitlines()]


def test_values_come_out_exactly_as_written(tmp_path: Path) -> None:
    document = _convert(
        tmp_path,
        "TC;Posta;IBAN;Tarih;Tutar\n01234567890;06100;1234567890123456789012;03/04/2025;1.234,50\n",
    )

    assert _cells(document)[5:] == [
        "01234567890",
        "06100",
        "1234567890123456789012",
        "03/04/2025",
        "1.234,50",
    ]


def test_no_file_name_or_page_number_is_added(tmp_path: Path) -> None:
    document = _convert(tmp_path, "ad,yaş\nBeril Ertuğrul,30\n", name="liste.csv")

    assert _cells(document) == ["ad", "yaş", "Beril Ertuğrul", "30"]


def test_every_column_of_a_wide_table_stays_on_the_page(tmp_path: Path) -> None:
    header = ",".join(f"başlık{number:02}" for number in range(25))
    document = _convert(tmp_path, header + "\n" + ",".join(["değer"] * 25) + "\n")

    page = document[0]
    words = page.get_text("words")
    assert page.rect.width > page.rect.height
    assert {word[4] for word in words} >= {f"başlık{number:02}" for number in range(25)}
    assert max(word[2] for word in words) <= page.rect.width


def test_quoted_line_breaks_and_short_rows_keep_their_cells(tmp_path: Path) -> None:
    document = _convert(tmp_path, 'a;b;c\n"iki\nsatır";x\n')

    assert _cells(document) == ["a", "b", "c", "iki", "satır", "x"]


def test_an_empty_file_gives_one_blank_page(tmp_path: Path) -> None:
    document = _convert(tmp_path, "")

    assert document.page_count == 1
    assert document[0].get_text() == ""


def test_an_oversized_field_is_reported_as_unreadable(tmp_path: Path) -> None:
    with pytest.raises(OpError) as caught:
        _convert(tmp_path, '"' + "x" * 200_000 + '"\n')

    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data["reason"] == "fileUnreadable"
