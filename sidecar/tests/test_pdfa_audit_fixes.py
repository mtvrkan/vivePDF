from pathlib import Path

import pymupdf

from vivepdf.ops.pdfa import PdfaCheckParams, PdfaConvertParams, _claimed, check, convert
from vivepdf.rpc.progress import silent_progress


def _statuses(report) -> dict[str, str]:
    return {item.id: item.status for item in report.checks}


def _saved(document: pymupdf.Document, path: Path) -> Path:
    document.save(path)
    document.close()
    return path


def _report(path: Path):
    return check(PdfaCheckParams(path=str(path)), silent_progress())


def _converted(path: Path, tmp_path: Path):
    return convert(
        PdfaConvertParams(path=str(path), output=str(tmp_path / "archive.pdf")), silent_progress()
    )


def test_a_hidden_form_field_is_removed_from_the_field_list_too(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    for name, top, hidden in (("gorunen", 72, False), ("gizli", 120, True)):
        widget = pymupdf.Widget()
        widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
        widget.field_name = name
        widget.rect = pymupdf.Rect(72, top, 272, top + 24)
        if hidden:
            widget.field_flags = 0
        page.add_widget(widget)
    hidden_xref = next(w.xref for w in page.widgets() if w.field_name == "gizli")
    document.xref_set_key(hidden_xref, "F", str(pymupdf.PDF_ANNOT_IS_HIDDEN))
    source = _saved(document, tmp_path / "form.pdf")
    result = _converted(source, tmp_path)
    assert _statuses(result.report)["annotations"] == "pass"
    with pymupdf.open(result.output) as written:
        names = [widget.field_name for widget in written[0].widgets()]
        fields = written.xref_get_key(written.pdf_catalog(), "AcroForm/Fields")[1]
        references = [int(part) for part in fields.replace("[", " ").replace("]", " ").split()[::3]]
        for reference in references:
            assert written.xref_get_key(reference, "T")[0] == "string"
    assert names == ["gorunen"]
    assert len(references) == 1


def _cmyk_page(document: pymupdf.Document) -> None:
    page = document.new_page()
    page.draw_rect(pymupdf.Rect(72, 72, 200, 200), color=None, fill=(0, 1, 1, 0))


def _cmyk_intent(document: pymupdf.Document) -> None:
    profile = document.get_new_xref()
    document.update_object(profile, "<< /N 4 >>")
    document.update_stream(profile, b"cmyk profile placeholder")
    intent = document.get_new_xref()
    document.update_object(
        intent,
        "<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (FOGRA39)"
        f" /DestOutputProfile {profile} 0 R >>",
    )
    document.xref_set_key(document.pdf_catalog(), "OutputIntents", f"[{intent} 0 R]")


def test_cmyk_colour_is_accepted_under_a_cmyk_output_intent(tmp_path: Path) -> None:
    document = pymupdf.open()
    _cmyk_page(document)
    _cmyk_intent(document)
    report = _report(_saved(document, tmp_path / "cmyk.pdf"))
    assert _statuses(report)["colour"] == "pass"
    assert _statuses(report)["outputIntent"] == "pass"


def test_cmyk_colour_without_a_cmyk_intent_still_blocks(tmp_path: Path) -> None:
    document = pymupdf.open()
    _cmyk_page(document)
    report = _report(_saved(document, tmp_path / "cmyk.pdf"))
    assert _statuses(report)["colour"] == "fail"
    assert not report.convertible


def test_an_intent_without_a_profile_does_not_count(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Metin")
    intent = document.get_new_xref()
    document.update_object(intent, "<< /Type /OutputIntent /S /GTS_PDFA1 >>")
    document.xref_set_key(document.pdf_catalog(), "OutputIntents", f"[{intent} 0 R]")
    report = _report(_saved(document, tmp_path / "bare.pdf"))
    assert _statuses(report)["outputIntent"] == "fail"


def test_a_script_hidden_in_a_next_action_list_is_found_and_removed(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_link(
        {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(72, 72, 200, 90), "uri": "https://a.b"}
    )
    page = document.reload_page(page)
    link_xref = page.get_links()[0]["xref"]
    script = document.get_new_xref()
    document.update_object(script, "<< /S /JavaScript /JS (app.alert(1)) >>")
    document.xref_set_key(link_xref, "A/Next", f"[{script} 0 R]")
    source = _saved(document, tmp_path / "next.pdf")
    assert _statuses(_report(source))["actions"] == "fail"
    result = _converted(source, tmp_path)
    assert _statuses(result.report)["actions"] == "pass"


def test_a_note_without_fixed_zoom_and_rotation_is_reported_and_fixed(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Metin")
    note = page.add_text_annot((200, 200), "not")
    document.xref_set_key(note.xref, "F", str(pymupdf.PDF_ANNOT_IS_PRINT))
    source = _saved(document, tmp_path / "note.pdf")
    assert _statuses(_report(source))["annotations"] == "fail"
    result = _converted(source, tmp_path)
    assert _statuses(result.report)["annotations"] == "pass"


def test_rights_and_ids_in_the_old_xmp_are_kept(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Metin")
    document.set_xml_metadata(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
        'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" '
        'xmlns:custom="http://example.com/custom/">'
        '<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© Şirket</rdf:li></rdf:Alt></dc:rights>'
        "<xmpMM:DocumentID>uuid:1234</xmpMM:DocumentID>"
        "<custom:Secret>drop me</custom:Secret>"
        "</rdf:Description></rdf:RDF></x:xmpmeta>"
    )
    result = _converted(_saved(document, tmp_path / "xmp.pdf"), tmp_path)
    with pymupdf.open(result.output) as written:
        xmp = written.get_xml_metadata()
    assert "© Şirket" in xmp
    assert "uuid:1234" in xmp
    assert "drop me" not in xmp
    assert result.report.claimed == "PDF/A-2b"


def test_a_claim_written_with_single_quotes_is_read(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page()
    document.set_xml_metadata(
        "<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF "
        "xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>"
        "<rdf:Description rdf:about='' xmlns:pdfaid='http://www.aiim.org/pdfa/ns/id/' "
        "pdfaid:part='3' pdfaid:conformance='U'/></rdf:RDF></x:xmpmeta>"
    )
    assert _claimed(document) == "PDF/A-3u"


def test_every_layer_configuration_needs_a_name(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Metin")
    layer = document.add_ocg("Katman")
    config = document.get_new_xref()
    document.update_object(config, f"<< /ON [{layer} 0 R] >>")
    document.xref_set_key(document.pdf_catalog(), "OCProperties/Configs", f"[{config} 0 R]")
    source = _saved(document, tmp_path / "layers.pdf")
    assert _statuses(_report(source))["layers"] == "fail"
    result = _converted(source, tmp_path)
    assert _statuses(result.report)["layers"] == "pass"
