import zipfile
from pathlib import Path

import openpyxl
import pymupdf
import pytest
from lxml import etree

from vivepdf.external import libreoffice
from vivepdf.ops._sheet_print import print_ready_copy, print_ready_sheet
from vivepdf.ops.convert_to_pdf import FileToPdfParams, file_to_pdf
from vivepdf.rpc.progress import silent_progress

S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def worksheet(body: str, dimension: str = "A1:R20") -> bytes:
    return (
        f'<worksheet xmlns="{S}"><dimension ref="{dimension}"/><sheetData/>{body}</worksheet>'
    ).encode()


def children(raw: bytes) -> list[str]:
    return [etree.QName(child).localname for child in etree.fromstring(raw)]


def page_setup(raw: bytes) -> dict[str, str]:
    return dict(etree.fromstring(raw).find(f"{{{S}}}pageSetup").attrib)


def fit_flag(raw: bytes) -> dict[str, str]:
    return dict(etree.fromstring(raw).find(f"{{{S}}}sheetPr/{{{S}}}pageSetUpPr").attrib)


def wide_book(path: Path, columns: int = 18) -> Path:
    book = openpyxl.Workbook()
    book.active.append([f"Sütun {index}" for index in range(1, columns + 1)])
    book.save(path)
    return path


def test_a_wide_sheet_is_fitted_to_the_page_width_in_landscape() -> None:
    raw = worksheet(
        '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
        "<headerFooter/><drawing/>"
    )

    ready = print_ready_sheet(raw, "letter", "a4", True)

    assert children(ready) == [
        "sheetPr",
        "dimension",
        "sheetData",
        "pageMargins",
        "pageSetup",
        "headerFooter",
        "drawing",
    ]
    assert fit_flag(ready) == {"fitToPage": "1"}
    assert page_setup(ready) == {
        "paperSize": "1",
        "fitToWidth": "1",
        "fitToHeight": "0",
        "orientation": "landscape",
    }


def test_a_narrow_sheet_stays_upright_and_takes_the_fallback_paper() -> None:
    ready = print_ready_sheet(worksheet("", "A1:C40"), None, "a4", True)

    assert page_setup(ready) == {"paperSize": "9", "fitToWidth": "1", "fitToHeight": "0"}


def test_the_sheet_keeps_its_own_fit_orientation_and_paper_unless_one_is_chosen() -> None:
    raw = worksheet(
        '<pageSetup paperSize="8" orientation="portrait" fitToWidth="2" fitToHeight="3"/>'
    ).replace(
        b"<dimension",
        b'<sheetPr><tabColor rgb="FFFF0000"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension',
    )

    kept = print_ready_sheet(raw, None, "a4", True)
    chosen = print_ready_sheet(raw, "a4", "letter", True)

    assert page_setup(kept) == {
        "paperSize": "8",
        "orientation": "portrait",
        "fitToWidth": "2",
        "fitToHeight": "3",
    }
    assert page_setup(chosen)["paperSize"] == "9"
    assert page_setup(chosen)["fitToWidth"] == "2"


def test_the_fit_flag_goes_after_the_tab_colour() -> None:
    raw = worksheet("").replace(
        b"<dimension", b'<sheetPr><tabColor rgb="FFFF0000"/></sheetPr><dimension'
    )

    ready = print_ready_sheet(raw, None, "a4", True)

    properties = etree.fromstring(ready).find(f"{{{S}}}sheetPr")
    assert [etree.QName(child).localname for child in properties] == ["tabColor", "pageSetUpPr"]


def test_only_the_worksheets_of_the_copy_change(tmp_path: Path) -> None:
    source = wide_book(tmp_path / "rapor.xlsx")

    ready = print_ready_copy(source, tmp_path / "ready", "a4", "a4", True)

    assert ready != source and ready.name == "rapor.xlsx"
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(ready) as copy:
        assert original.namelist() == copy.namelist()
        for name in original.namelist():
            if name.startswith("xl/worksheets/"):
                assert b"fitToPage" in copy.read(name)
            else:
                assert copy.read(name) == original.read(name)
    assert b"fitToPage" not in zipfile.ZipFile(source).read("xl/worksheets/sheet1.xml")


@pytest.mark.parametrize("name", ["rapor.docx", "rapor.ods", "rapor.xls"])
def test_files_other_than_xlsx_are_passed_on_as_they_are(tmp_path: Path, name: str) -> None:
    source = tmp_path / name
    source.write_bytes(b"PK\x03\x04")

    assert print_ready_copy(source, tmp_path / "ready", "a4", "a4", True) == source


def test_a_broken_or_untouched_workbook_is_passed_on_as_it_is(tmp_path: Path) -> None:
    broken = tmp_path / "bozuk.xlsx"
    broken.write_bytes(b"not a zip")
    source = wide_book(tmp_path / "rapor.xlsx")

    assert print_ready_copy(broken, tmp_path / "ready", "a4", "a4", True) == broken
    assert print_ready_copy(source, tmp_path / "ready", None, "a4", False) == source
    assert not (tmp_path / "ready" / "bozuk.xlsx").exists()


def test_libreoffice_gets_a_fitted_copy_with_the_chosen_paper(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = wide_book(tmp_path / "rapor.xlsx")
    received: list[bytes] = []

    def fake_convert(path: Path, output_dir: Path, _check) -> Path:
        received.append(zipfile.ZipFile(path).read("xl/worksheets/sheet1.xml"))
        produced = output_dir / f"{path.stem}.pdf"
        with pymupdf.open() as document:
            document.new_page()
            document.save(produced)
        return produced

    monkeypatch.setattr(libreoffice, "convert_to_pdf", fake_convert)

    file_to_pdf(
        FileToPdfParams(path=str(source), output=str(tmp_path / "out.pdf"), paper="letter"),
        silent_progress(),
    )

    [sheet] = received
    assert page_setup(sheet) == {
        "paperSize": "1",
        "fitToWidth": "1",
        "fitToHeight": "0",
        "orientation": "landscape",
    }
    assert b"fitToPage" not in zipfile.ZipFile(source).read("xl/worksheets/sheet1.xml")


def _sheet_xml(path: Path) -> bytes | None:
    if not zipfile.is_zipfile(path):
        return None
    return zipfile.ZipFile(path).read("xl/worksheets/sheet1.xml")


def _fake_pdf(received: list[tuple[Path, bytes | None]]):
    def fake_convert(path: Path, output_dir: Path, _check) -> Path:
        received.append((path, _sheet_xml(path)))
        produced = output_dir / f"{path.stem}.pdf"
        with pymupdf.open() as document:
            document.new_page()
            document.save(produced)
        return produced

    return fake_convert


def _upright_book(path: Path) -> Path:
    book_path = wide_book(path.with_name("taban.xlsx"))
    with zipfile.ZipFile(book_path) as original, zipfile.ZipFile(path, "w") as copy:
        for member in original.infolist():
            data = original.read(member)
            if member.filename == "xl/worksheets/sheet1.xml":
                data = data.replace(
                    b"</worksheet>", b'<pageSetup orientation="portrait"/></worksheet>'
                )
            copy.writestr(member, data)
    return path


@pytest.mark.parametrize("name", ["rapor.xls", "rapor.ods"])
def test_an_older_or_open_document_sheet_is_resaved_and_fitted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    source = tmp_path / name
    source.write_bytes(b"sheet")
    resaved: list[Path] = []
    received: list[tuple[Path, bytes | None]] = []

    def fake_resave(path: Path, output_dir: Path, _check) -> Path:
        resaved.append(path)
        output_dir.mkdir(parents=True, exist_ok=True)
        return _upright_book(output_dir / f"{path.stem}.xlsx")

    monkeypatch.setattr(libreoffice, "convert_to_xlsx", fake_resave)
    monkeypatch.setattr(libreoffice, "convert_to_pdf", _fake_pdf(received))

    file_to_pdf(
        FileToPdfParams(path=str(source), output=str(tmp_path / "out.pdf")), silent_progress()
    )

    assert resaved == [source]
    [(_path, sheet)] = received
    assert page_setup(sheet) == {
        "orientation": "landscape",
        "paperSize": "9",
        "fitToWidth": "1",
        "fitToHeight": "0",
    }


def test_an_older_sheet_is_not_resaved_when_nothing_is_asked(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "rapor.xls"
    source.write_bytes(b"sheet")
    received: list[tuple[Path, bytes | None]] = []
    monkeypatch.setattr(libreoffice, "convert_to_xlsx", lambda *_args: pytest.fail("resaved"))
    monkeypatch.setattr(libreoffice, "convert_to_pdf", _fake_pdf(received))

    file_to_pdf(
        FileToPdfParams(path=str(source), output=str(tmp_path / "out.pdf"), fit_columns=False),
        silent_progress(),
    )

    assert received == [(source, None)]


def test_a_macro_workbook_is_converted_and_fitted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = wide_book(tmp_path / "makrolu.xlsx").rename(tmp_path / "makrolu.xlsm")
    received: list[tuple[Path, bytes | None]] = []
    monkeypatch.setattr(libreoffice, "convert_to_pdf", _fake_pdf(received))

    file_to_pdf(
        FileToPdfParams(path=str(source), output=str(tmp_path / "out.pdf")), silent_progress()
    )

    [(path, sheet)] = received
    assert path != source
    assert fit_flag(sheet) == {"fitToPage": "1"}
