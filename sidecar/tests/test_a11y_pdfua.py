from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.a11y import CheckParams, check
from vivepdf.ops.a11y_fix import FixParams, fix
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _linked_table_pdf(tmp_path: Path, header: bool) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 100), "Kaynak sitesi")
    page.insert_link(
        {
            "kind": pymupdf.LINK_URI,
            "from": pymupdf.Rect(70, 88, 170, 104),
            "uri": "https://a.example",
        }
    )
    catalog = document.pdf_catalog()
    root = document.get_new_xref()
    table = document.get_new_xref()
    row = document.get_new_xref()
    cell = document.get_new_xref()
    document.update_object(root, f"<</Type/StructTreeRoot/K[{table} 0 R]>>")
    document.update_object(table, f"<</Type/StructElem/S/Table/P {root} 0 R/K[{row} 0 R]>>")
    document.update_object(row, f"<</Type/StructElem/S/TR/P {table} 0 R/K[{cell} 0 R]>>")
    kind = "TH" if header else "TD"
    document.update_object(cell, f"<</Type/StructElem/S/{kind}/P {row} 0 R>>")
    document.xref_set_key(catalog, "StructTreeRoot", f"{root} 0 R")
    document.xref_set_key(catalog, "MarkInfo", "<</Marked true>>")
    path = tmp_path / f"table-{kind}.pdf"
    document.save(path)
    document.close()
    return path


def _tagged_figure_pdf(tmp_path: Path) -> tuple[Path, int]:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 72), "Grafik")
    catalog = document.pdf_catalog()
    root = document.get_new_xref()
    figure = document.get_new_xref()
    document.update_object(root, f"<</Type/StructTreeRoot/K[{figure} 0 R]>>")
    document.update_object(
        figure, f"<</Type/StructElem/S/Figure/P {root} 0 R/Pg {page.xref} 0 R/K 0>>"
    )
    document.xref_set_key(catalog, "StructTreeRoot", f"{root} 0 R")
    document.xref_set_key(catalog, "MarkInfo", "<</Marked true>>")
    path = tmp_path / "figure.pdf"
    document.save(path)
    document.close()
    return path, figure


def test_table_without_header_cells_fails(tmp_path: Path) -> None:
    report = check(CheckParams(path=str(_linked_table_pdf(tmp_path, False))), silent_progress())
    statuses = {item.id: item.status for item in report.checks}
    assert report.tables == 1 and report.tables_without_headers == 1
    assert statuses["tableHeaders"] == "fail"


def test_table_with_header_cells_passes(tmp_path: Path) -> None:
    report = check(CheckParams(path=str(_linked_table_pdf(tmp_path, True))), silent_progress())
    assert {item.id: item.status for item in report.checks}["tableHeaders"] == "pass"


def test_tab_order_and_link_text_are_reported_and_fixed(tmp_path: Path) -> None:
    source = _linked_table_pdf(tmp_path, True)
    before = check(CheckParams(path=str(source)), silent_progress())
    statuses = {item.id: item.status for item in before.checks}
    assert before.tab_order_pages == 1 and statuses["tabOrder"] == "fail"
    assert before.links_without_text == 1 and statuses["linkText"] == "warn"
    result = fix(
        FixParams(
            path=str(source), output=str(tmp_path / "fixed.pdf"), tab_order=True, link_text=True
        ),
        silent_progress(),
    )
    assert result.changes == 2
    after = check(CheckParams(path=result.output), silent_progress())
    assert after.tab_order_pages == 0 and after.links_without_text == 0
    document = pymupdf.open(result.output)
    link = document[0].get_links()[0]
    assert document.xref_get_key(link["xref"], "Contents")[1] == "Kaynak sitesi"
    document.close()


def test_actual_text_counts_as_an_alternative(tmp_path: Path) -> None:
    source, figure = _tagged_figure_pdf(tmp_path)
    assert check(CheckParams(path=str(source)), silent_progress()).figures_without_alt == 1
    document = pymupdf.open(source)
    document.xref_set_key(figure, "ActualText", "(Grafik)")
    target = tmp_path / "actual.pdf"
    document.save(target)
    document.close()
    assert check(CheckParams(path=str(target)), silent_progress()).figures_without_alt == 0


def test_blank_alt_text_is_not_written(tmp_path: Path) -> None:
    source, figure = _tagged_figure_pdf(tmp_path)
    result = fix(
        FixParams(path=str(source), output=str(tmp_path / "x.pdf"), alt_texts={figure: "  "}),
        silent_progress(),
    )
    assert result.changes == 0


def test_accessibility_permission_is_checked(tmp_path: Path, sample_pdf: Path) -> None:
    document = pymupdf.open(sample_pdf)
    locked = tmp_path / "locked.pdf"
    document.save(locked, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="o", permissions=0)
    document.close()
    report = check(CheckParams(path=str(locked)), silent_progress())
    assert report.access_permission is False
    assert {item.id: item.status for item in report.checks}["accessPermission"] == "fail"
    assert check(CheckParams(path=str(sample_pdf)), silent_progress()).access_permission


def test_title_fix_updates_existing_xmp_title(sample_pdf: Path, tmp_path: Path) -> None:
    document = pymupdf.open(sample_pdf)
    document.set_xml_metadata(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt>'
        '<rdf:li xml:lang="x-default">Eski</rdf:li></rdf:Alt></dc:title></rdf:Description>'
        "</rdf:RDF></x:xmpmeta>"
    )
    source = tmp_path / "xmp.pdf"
    document.save(source)
    document.close()
    result = fix(
        FixParams(path=str(source), output=str(tmp_path / "out.pdf"), title="Yeni & <Başlık>"),
        silent_progress(),
    )
    document = pymupdf.open(result.output)
    xml = document.get_xml_metadata()
    document.close()
    assert "Eski" not in xml and "Yeni &amp; &lt;Başlık&gt;" in xml


def test_a_file_without_pages_is_invalid(tmp_path: Path) -> None:
    path = tmp_path / "empty.pdf"
    path.write_bytes(b"%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")
    with pytest.raises(OpError) as error:
        check(CheckParams(path=str(path)), silent_progress())
    assert error.value.code == ErrorCode.INVALID_PDF
