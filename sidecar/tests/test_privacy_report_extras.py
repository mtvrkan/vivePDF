from pathlib import Path

import pymupdf

from vivepdf.ops.privacy import InspectParams, inspect
from vivepdf.ops.privacy_sanitize import SanitizeParams, sanitize
from vivepdf.rpc.progress import silent_progress


def _two_pages() -> pymupdf.Document:
    document = pymupdf.open()
    for number in (1, 2):
        document.new_page().insert_text((72, 72), f"Page {number}")
    return document


def _save(document: pymupdf.Document, path: Path) -> Path:
    document.save(path)
    document.close()
    return path


def test_removing_links_keeps_links_inside_the_document(tmp_path: Path) -> None:
    document = _two_pages()
    page = document[0]
    page.insert_link(
        {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(72, 100, 200, 120), "uri": "https://x.test"}
    )
    page.insert_link(
        {"kind": pymupdf.LINK_GOTO, "from": pymupdf.Rect(72, 140, 200, 160), "page": 1}
    )
    source = _save(document, tmp_path / "links.pdf")
    result = sanitize(
        SanitizeParams(path=str(source), output=str(tmp_path / "out.pdf"), links=True),
        silent_progress(),
    )
    assert result.removed["links"] == 1
    with pymupdf.open(result.output) as cleaned:
        kinds = [link["kind"] for link in cleaned[0].get_links()]
    assert kinds == [pymupdf.LINK_GOTO]


def test_custom_document_properties_are_listed_and_removed(tmp_path: Path) -> None:
    document = _two_pages()
    document.set_metadata({"title": "Quarterly"})
    info = int(document.xref_get_key(-1, "Info")[1].split()[0])
    document.xref_set_key(info, "Company", "(ACME Hidden Ltd)")
    source = _save(document, tmp_path / "custom.pdf")
    report = inspect(InspectParams(path=str(source)), silent_progress())
    assert report.metadata["Company"] == "ACME Hidden Ltd"
    assert report.metadata["title"] == "Quarterly"
    result = sanitize(
        SanitizeParams(path=str(source), output=str(tmp_path / "out.pdf")), silent_progress()
    )
    assert result.removed["metadata"] == 2
    assert b"ACME Hidden" not in Path(result.output).read_bytes()


def test_cleaning_properties_gives_the_file_a_new_identifier(tmp_path: Path) -> None:
    source = _save(_two_pages(), tmp_path / "id.pdf")
    with pymupdf.open(source) as original:
        before = original.xref_get_key(-1, "ID")[1]
    result = sanitize(
        SanitizeParams(path=str(source), output=str(tmp_path / "out.pdf")), silent_progress()
    )
    with pymupdf.open(result.output) as cleaned:
        after = cleaned.xref_get_key(-1, "ID")[1]
    assert before[1:33] != after[1:33]
    kept = sanitize(
        SanitizeParams(
            path=str(source), output=str(tmp_path / "kept.pdf"), metadata=False, xmp_metadata=True
        ),
        silent_progress(),
    )
    with pymupdf.open(kept.output) as untouched:
        assert untouched.xref_get_key(-1, "ID")[1][1:33] == before[1:33]


def test_page_thumbnails_are_counted_and_removed(tmp_path: Path) -> None:
    document = _two_pages()
    thumb = document.get_new_xref()
    document.update_object(thumb, "<</Width 1/Height 1/ColorSpace/DeviceGray/BitsPerComponent 8>>")
    document.update_stream(thumb, b"\x00")
    document.xref_set_key(document.page_xref(0), "Thumb", f"{thumb} 0 R")
    source = _save(document, tmp_path / "thumb.pdf")
    assert inspect(InspectParams(path=str(source)), silent_progress()).thumbnails == 1
    result = sanitize(
        SanitizeParams(path=str(source), output=str(tmp_path / "out.pdf")), silent_progress()
    )
    assert result.removed["thumbnails"] == 1


def test_a_signed_document_is_reported(tmp_path: Path) -> None:
    document = _two_pages()
    document.xref_set_key(document.pdf_catalog(), "AcroForm", "<</Fields[]/SigFlags 3>>")
    source = _save(document, tmp_path / "signed.pdf")
    assert inspect(InspectParams(path=str(source)), silent_progress()).signatures == 1
    plain = _save(_two_pages(), tmp_path / "plain.pdf")
    assert inspect(InspectParams(path=str(plain)), silent_progress()).signatures == 0
