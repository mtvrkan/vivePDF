import re
from pathlib import Path

import pymupdf

from vivepdf.ops.metadata import SetMetadataParams, set_metadata
from vivepdf.ops.pdfa import PdfaConvertParams, convert
from vivepdf.rpc.progress import silent_progress

XMP_TEMPLATE = (
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    "{descriptions}"
    "</rdf:RDF></x:xmpmeta>"
    '<?xpacket end="w"?>'
)


def _pdf(path: Path, xmp: str | None, title: str = "Draft") -> Path:
    document = pymupdf.open()
    document.new_page()
    document.set_metadata({"title": title, "author": "Ann", "producer": "Old Tool"})
    if xmp is not None:
        document.set_xml_metadata(xmp)
    document.save(path)
    document.close()
    return path


def _edit(path: Path, **values: str) -> str:
    output = path.with_name("edited.pdf")
    set_metadata(
        SetMetadataParams(path=str(path), output=str(output), in_place=False, **values),
        silent_progress(),
    )
    with pymupdf.open(output) as document:
        return document.get_xml_metadata()


def test_a_new_title_and_author_replace_the_old_ones_in_the_xmp(tmp_path: Path):
    descriptions = (
        '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">'
        '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Draft</rdf:li></rdf:Alt></dc:title>'
        "<dc:creator><rdf:Seq><rdf:li>Ann</rdf:li></rdf:Seq></dc:creator>"
        "<dc:rights>Kept</dc:rights></rdf:Description>"
    )
    source = _pdf(tmp_path / "in.pdf", XMP_TEMPLATE.format(descriptions=descriptions))

    xml = _edit(source, title="Final & Signed", author="Ayşe Işık")

    assert "Draft" not in xml
    assert "Final &amp; Signed" in xml
    assert "<rdf:li>Ayşe Işık</rdf:li>" in xml
    assert "<dc:rights>Kept</dc:rights>" in xml


def test_a_producer_held_as_an_attribute_is_rewritten_in_place(tmp_path: Path):
    descriptions = (
        '<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" '
        'pdf:Producer="Old Tool"/>'
    )
    source = _pdf(tmp_path / "in.pdf", XMP_TEMPLATE.format(descriptions=descriptions))

    xml = _edit(source, producer='New "Tool"')

    assert "Old Tool" not in xml
    assert 'pdf:Producer="New &quot;Tool&quot;"' in xml
    assert "<pdf:Producer>" not in xml


def test_a_subject_missing_from_the_xmp_is_added_and_a_cleared_one_removed(tmp_path: Path):
    descriptions = (
        '<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">'
        "<pdf:Keywords>old, words</pdf:Keywords></rdf:Description>"
    )
    source = _pdf(tmp_path / "in.pdf", XMP_TEMPLATE.format(descriptions=descriptions))

    xml = _edit(source, subject="Quarterly report", keywords="")

    assert '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">Quarterly report' in xml
    assert "old, words" not in xml


def test_a_pdf_without_xmp_gets_none_added(tmp_path: Path):
    source = _pdf(tmp_path / "in.pdf", None)

    xml = _edit(source, title="Final")

    assert xml == ""


def test_a_pdfa_file_keeps_its_claim_and_matching_title_after_an_edit(tmp_path: Path):
    source = _pdf(tmp_path / "in.pdf", None)
    archived = tmp_path / "archived.pdf"
    convert(PdfaConvertParams(path=str(source), output=str(archived)), silent_progress())

    xml = _edit(archived, title="Final")

    assert "pdfaid:part" in xml
    assert '<rdf:li xml:lang="x-default">Final</rdf:li>' in xml
    assert "Draft" not in xml


def test_an_edit_moves_the_modify_dates_in_the_info_and_the_xmp_together(tmp_path: Path):
    descriptions = (
        '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" '
        'xmp:ModifyDate="2001-01-01T00:00:00Z">'
        "<xmp:MetadataDate>2001-01-01T00:00:00Z</xmp:MetadataDate></rdf:Description>"
    )
    source = _pdf(tmp_path / "in.pdf", XMP_TEMPLATE.format(descriptions=descriptions))

    xml = _edit(source, title="Final")

    with pymupdf.open(tmp_path / "edited.pdf") as document:
        info = document.metadata["modDate"]
    stamp = re.search(r'xmp:ModifyDate="([^"]+)"', xml).group(1)
    assert "2001" not in xml
    assert f"<xmp:MetadataDate>{stamp}</xmp:MetadataDate>" in xml
    assert info.startswith("D:" + re.sub(r"\D", "", stamp))
