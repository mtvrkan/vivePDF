from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._redact_presets import preset_matches
from vivepdf.ops.edit import RedactParams, SearchParams, redact, redact_preview
from vivepdf.ops.privacy import InspectParams, inspect
from vivepdf.ops.privacy_sanitize import SanitizeParams, sanitize
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

VALID_TCKN = "12345678950"
INVALID_TCKN = "12345678901"
VALID_CARD = "4111 1111 1111 1111"
INVALID_CARD = "4111 1111 1111 1112"


@pytest.fixture
def leaky_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 72), "Contact: kisi@example.com")
    page.insert_text((72, 100), f"TC {VALID_TCKN} and {INVALID_TCKN}")
    page.insert_text((72, 128), f"Card {VALID_CARD} bad {INVALID_CARD}")
    page.insert_link(
        {
            "kind": pymupdf.LINK_URI,
            "from": pymupdf.Rect(72, 60, 300, 80),
            "uri": "https://example.com",
        }
    )
    page.add_text_annot((400, 400), "reviewer note")
    document.set_metadata({"title": "Secret", "author": "Someone"})
    document.set_xml_metadata("<x:xmpmeta xmlns:x='adobe:ns:meta/'/>")
    document.embfile_add("note.txt", b"hidden")
    xref = document.get_new_xref()
    document.update_object(xref, "<</S/JavaScript/JS(app.alert(1))>>")
    document.xref_set_key(document.pdf_catalog(), "OpenAction", f"{xref} 0 R")
    path = tmp_path / "leaky.pdf"
    document.save(path)
    document.close()
    return path


def test_preset_validation_filters_bad_checksums() -> None:
    text = f"{VALID_TCKN} {INVALID_TCKN} {VALID_CARD} {INVALID_CARD}"
    found = preset_matches(text, ["tckn", "card"])
    assert (
        "tckn",
        VALID_TCKN,
    ) in found
    assert all(needle != INVALID_TCKN for _, needle in found)
    assert ("card", VALID_CARD) in found
    assert all(needle != INVALID_CARD for _, needle in found)


def test_inspect_reports_everything(leaky_pdf: Path) -> None:
    report = inspect(InspectParams(path=str(leaky_pdf)), silent_progress())
    assert report.metadata["title"] == "Secret"
    assert report.xmp_metadata is True
    assert report.javascript >= 1
    assert report.embedded_files == ["note.txt"]
    assert report.annotations == 1
    assert report.link_count == 1
    assert report.links[0].uri == "https://example.com"
    assert report.sensitive == {"email": 1, "tckn": 1, "card": 1}
    assert report.page_count == 1


def test_sanitize_strips_and_reports(leaky_pdf: Path, tmp_path: Path) -> None:
    result = sanitize(
        SanitizeParams(
            path=str(leaky_pdf), output=str(tmp_path / "clean.pdf"), annotations=True, links=True
        ),
        silent_progress(),
    )
    assert result.removed["metadata"] == 2
    assert result.removed["javascript"] >= 1
    assert result.removed["embeddedFiles"] == 1
    assert result.removed["annotations"] == 1
    assert result.removed["links"] == 1
    report = inspect(InspectParams(path=result.output), silent_progress())
    assert report.metadata == {}
    with pymupdf.open(result.output) as document:
        left = {
            key: value
            for key, value in (document.metadata or {}).items()
            if value and key in {"title", "author", "subject", "keywords", "creator", "producer"}
        }
    assert left == {}, left
    assert report.xmp_metadata is False
    assert report.javascript == 0
    assert report.embedded_files == []
    assert report.annotations == 0
    assert report.link_count == 0
    assert report.sensitive["email"] == 1


def test_redact_card_preset_only_hits_valid_numbers(leaky_pdf: Path, tmp_path: Path) -> None:
    preview = redact_preview(SearchParams(path=str(leaky_pdf), presets=["card"]), silent_progress())
    assert [hit.text for hit in preview.hits] == [VALID_CARD]
    result = redact(
        RedactParams(
            path=str(leaky_pdf), output=str(tmp_path / "redacted.pdf"), presets=["card", "tckn"]
        ),
        silent_progress(),
    )
    assert result.redactions == 2
    with pymupdf.open(result.output) as document:
        text = document[0].get_text()
        assert VALID_CARD not in text
        assert VALID_TCKN not in text
        assert INVALID_TCKN in text


def test_sanitize_rejects_same_path(leaky_pdf: Path) -> None:
    with pytest.raises(OpError) as error:
        sanitize(SanitizeParams(path=str(leaky_pdf), output=str(leaky_pdf)), silent_progress())
    assert error.value.code == ErrorCode.INVALID_PARAMS
