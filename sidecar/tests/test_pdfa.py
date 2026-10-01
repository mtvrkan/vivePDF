from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.pdfa import PdfaCheckParams, PdfaConvertParams, check, convert
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


def _statuses(report) -> dict[str, str]:
    return {item.id: item.status for item in report.checks}


@pytest.fixture
def messy_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 72), "Archive me, café", fontname="helv")
    page.insert_text((72, 100), "Bold words", fontname="hebo")
    hidden = page.add_text_annot((300, 300), "secret note")
    hidden.set_flags(pymupdf.PDF_ANNOT_IS_HIDDEN)
    hidden.update()
    page.add_freetext_annot(pymupdf.Rect(72, 400, 300, 440), "Shown note")
    document.embfile_add("notes.txt", b"attached")
    catalog = document.pdf_catalog()
    script = document.get_new_xref()
    document.update_object(script, "<< /S /JavaScript /JS (app.alert(1)) >>")
    document.xref_set_key(catalog, "OpenAction", f"{script} 0 R")
    document.set_metadata({"title": "Yıllık rapor & özet", "author": "Tests"})
    path = tmp_path / "messy.pdf"
    document.save(path)
    document.close()
    return path


def test_the_check_lists_every_problem_and_says_it_can_be_fixed(messy_pdf: Path):
    report = check(PdfaCheckParams(path=str(messy_pdf)), silent_progress())
    statuses = _statuses(report)
    assert report.claimed is None
    assert not report.ready
    assert report.convertible
    for failing in ("actions", "fonts", "outputIntent", "metadata", "annotations", "attachments"):
        assert statuses[failing] == "fail", failing
    assert statuses["encryption"] == "pass"
    assert statuses["colour"] == "pass"


def test_conversion_fixes_everything_and_keeps_the_text(messy_pdf: Path, tmp_path: Path):
    target = tmp_path / "archive.pdf"
    result = convert(PdfaConvertParams(path=str(messy_pdf), output=str(target)), silent_progress())
    assert result.report.ready, [item for item in result.report.checks if item.status == "fail"]
    assert result.report.claimed == "PDF/A-2b"
    assert {"actions", "fonts", "outputIntent", "metadata", "annotations", "attachments"} <= set(
        result.fixed
    )
    with pymupdf.open(target) as document:
        page = document[0]
        assert "Archive me, café" in page.get_text()
        assert all(font[1] != "n/a" for font in document.get_page_fonts(0, full=True))
        assert document.embfile_count() == 0
        assert [annot.info["content"] for annot in page.annots()] == ["Shown note"]
        assert all(annot.flags & pymupdf.PDF_ANNOT_IS_PRINT for annot in page.annots())
        xml = document.get_xml_metadata()
        assert "Yıllık rapor &amp; özet" in xml
        assert document.metadata["title"] == "Yıllık rapor & özet"
        assert document.xref_get_key(-1, "ID")[0] == "array"
        catalog = document.pdf_catalog()
        assert document.xref_get_key(catalog, "OpenAction")[0] == "null"
        metadata_xref = int(document.xref_get_key(catalog, "Metadata")[1].split()[0])
        assert document.xref_get_key(metadata_xref, "Filter")[0] == "null"


def test_embedded_widths_match_the_standard_font(messy_pdf: Path, tmp_path: Path):
    target = tmp_path / "widths.pdf"
    convert(PdfaConvertParams(path=str(messy_pdf), output=str(target)), silent_progress())
    with pymupdf.open(target) as document:
        fonts = {font[3]: font[0] for font in document.get_page_fonts(0, full=True)}
        widths = document.xref_get_key(fonts["Helvetica"], "Widths")[1].strip("[]").split()
        assert int(widths[ord("W")]) == 944
        assert int(widths[ord("i")]) == 222
        assert document.xref_get_key(fonts["Helvetica"], "FontDescriptor/FontFile3")[0] == "xref"


def test_a_word_font_whose_name_has_spaces_is_embedded_under_the_same_name(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Yillik rapor")
    font_xref = document.get_page_fonts(0, full=True)[0][0]
    document.xref_set_key(font_xref, "BaseFont", "/Times#20New#20Roman,Bold")
    source = tmp_path / "word-font.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "archived.pdf"

    convert(PdfaConvertParams(path=str(source), output=str(target)), silent_progress())

    with pymupdf.open(target) as archived:
        font = archived.get_page_fonts(0, full=True)[0][0]
        assert archived.xref_get_key(font, "FontDescriptor/FontName") == (
            "name",
            "/Times New Roman,Bold",
        )
        assert archived.xref_get_key(font, "FontDescriptor/FontFile3")[0] == "xref"
        assert "Yillik rapor" in archived[0].get_text()


def test_a_font_that_cannot_be_replaced_blocks_the_conversion(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Hello")
    font_xref = document.get_page_fonts(0, full=True)[0][0]
    document.xref_set_key(font_xref, "BaseFont", "/Garamond-Premier")
    source = tmp_path / "garamond.pdf"
    document.save(source)
    document.close()
    report = check(PdfaCheckParams(path=str(source)), silent_progress())
    fonts = next(item for item in report.checks if item.id == "fonts")
    assert fonts.status == "fail" and not fonts.fixable
    assert fonts.value == "Garamond-Premier"
    assert not report.convertible
    with pytest.raises(OpError) as caught:
        convert(
            PdfaConvertParams(path=str(source), output=str(tmp_path / "out.pdf")), silent_progress()
        )
    assert caught.value.data["reason"] == "pdfaUnfixable"
    assert caught.value.data["checks"] == ["fonts"]
    assert not (tmp_path / "out.pdf").exists()


def test_a_password_protected_file_comes_out_unprotected(encrypted_pdf: Path, tmp_path: Path):
    report = check(PdfaCheckParams(path=str(encrypted_pdf), password="secret"), silent_progress())
    assert _statuses(report)["encryption"] == "fail"
    target = tmp_path / "open.pdf"
    result = convert(
        PdfaConvertParams(path=str(encrypted_pdf), password="secret", output=str(target)),
        silent_progress(),
    )
    assert "encryption" in result.fixed
    with pymupdf.open(target) as document:
        assert not document.needs_pass


def test_form_fields_keep_their_tick_mark_and_embedded_cid_fonts_get_a_glyph_map(tmp_path: Path):
    font = (
        Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
    )
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Türkçe ğüşiöç", fontname="dejavu", fontfile=str(font))
    box = pymupdf.Widget()
    box.field_type = pymupdf.PDF_WIDGET_TYPE_CHECKBOX
    box.field_name = "agree"
    box.rect = pymupdf.Rect(72, 100, 90, 118)
    box.field_value = True
    page.add_widget(box)
    document.xref_set_key(document.pdf_catalog(), "AcroForm/NeedAppearances", "true")
    source = tmp_path / "form.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "form-a.pdf"
    result = convert(PdfaConvertParams(path=str(source), output=str(target)), silent_progress())
    assert result.report.ready
    assert {"forms", "fonts"} <= set(result.fixed)
    with pymupdf.open(target) as output:
        fonts = [
            xref
            for xref in range(1, output.xref_length())
            if output.xref_get_key(xref, "BaseFont")[1] == "/ZapfDingbats"
        ]
        assert fonts
        assert "51/a19" in output.xref_get_key(fonts[0], "Encoding/Differences")[1]
        cid_fonts = [
            xref
            for xref in range(1, output.xref_length())
            if output.xref_get_key(xref, "Subtype")[1] == "/CIDFontType2"
        ]
        assert all(output.xref_get_key(xref, "CIDToGIDMap")[1] == "/Identity" for xref in cid_fonts)
        assert output.xref_get_key(output.pdf_catalog(), "AcroForm/NeedAppearances")[0] == "null"
