from pathlib import Path

import pymupdf

from vivepdf.ops.privacy import InspectParams, inspect
from vivepdf.ops.privacy_sanitize import SanitizeParams, sanitize
from vivepdf.rpc.progress import silent_progress


def _dirty(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for _ in range(2):
        document.new_page().insert_text((72, 72), "Body")
    catalog = document.pdf_catalog()
    launch = document.get_new_xref()
    document.update_object(launch, "<</S/Launch/F(cmd.exe)>>")
    document.xref_set_key(catalog, "OpenAction", f"{launch} 0 R")
    page_action = document.get_new_xref()
    document.update_object(page_action, "<</S/ImportData/F(data.fdf)>>")
    document.xref_set_key(document[1].xref, "AA", f"<</O {page_action} 0 R>>")
    document.xref_set_key(document[0].xref, "PieceInfo", "<</Illustrator<</Private(SECRET)>>>>")
    document.xref_set_key(catalog, "PieceInfo", "<</Word<</Private(ALSO)>>>>")
    path = tmp_path / "dirty.pdf"
    document.save(path)
    document.close()
    return path


def test_launch_and_import_actions_are_found_and_removed(tmp_path: Path) -> None:
    source = _dirty(tmp_path)
    report = inspect(InspectParams(path=str(source)), silent_progress())
    assert report.javascript == 2
    assert report.private_data == 2
    result = sanitize(
        SanitizeParams(path=str(source), output=str(tmp_path / "clean.pdf"), private_data=True),
        silent_progress(),
    )
    assert result.removed["javascript"] == 2
    assert result.removed["privateData"] == 2
    after = inspect(InspectParams(path=result.output), silent_progress())
    assert after.javascript == 0
    assert after.private_data == 0
    raw = Path(result.output).read_bytes()
    assert b"cmd.exe" not in raw
    with pymupdf.open(result.output) as document:
        assert document.xref_get_key(document.pdf_catalog(), "OpenAction")[0] == "null"
        assert "Body" in document[1].get_text()


def test_private_data_stays_when_not_asked(tmp_path: Path) -> None:
    source = _dirty(tmp_path)
    result = sanitize(
        SanitizeParams(
            path=str(source),
            output=str(tmp_path / "clean.pdf"),
            private_data=False,
            javascript=False,
        ),
        silent_progress(),
    )
    assert "privateData" not in result.removed
    assert inspect(InspectParams(path=result.output), silent_progress()).private_data == 2


def test_a_goto_open_action_survives(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page()
    document.new_page()
    catalog = document.pdf_catalog()
    document.xref_set_key(catalog, "OpenAction", f"[{document[1].xref} 0 R /Fit]")
    path = tmp_path / "goto.pdf"
    document.save(path)
    document.close()
    result = sanitize(
        SanitizeParams(path=str(path), output=str(tmp_path / "out.pdf")), silent_progress()
    )
    with pymupdf.open(result.output) as cleaned:
        assert cleaned.xref_get_key(cleaned.pdf_catalog(), "OpenAction")[0] == "array"
