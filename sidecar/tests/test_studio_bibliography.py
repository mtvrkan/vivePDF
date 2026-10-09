from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import studio_document
from vivepdf.ops._studio_document_models import (
    StudioDocumentOpenParams,
    StudioDocumentRenderParams,
)
from vivepdf.ops.studio_document import read_bibliography, render_document
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

ENTRY = "@article{yilmaz2020, author = {Yılmaz, Ayşe}, title = {Çalışma}, year = 2020}\n"


def _read(path: Path):
    return read_bibliography(
        StudioDocumentOpenParams.model_validate({"path": str(path)}), silent_progress()
    )


def test_a_bib_file_is_read_as_text_in_its_own_encoding(tmp_path: Path):
    utf8 = tmp_path / "library.bib"
    utf8.write_bytes(ENTRY.encode("utf-8"))
    legacy = tmp_path / "old.bibtex"
    legacy.write_bytes("@book{muller, author = {Müller, Jörg}}".encode("cp1252"))

    modern = _read(utf8)
    older = _read(legacy)

    assert modern.text == ENTRY
    assert modern.name == "library.bib"
    assert "Müller, Jörg" in older.text


def test_other_files_missing_files_and_huge_files_are_refused(tmp_path: Path, monkeypatch):
    text = tmp_path / "notes.txt"
    text.write_text(ENTRY, encoding="utf-8")
    huge = tmp_path / "huge.bib"
    huge.write_text(ENTRY * 10, encoding="utf-8")
    monkeypatch.setattr(studio_document, "MAX_BIBLIOGRAPHY_BYTES", 32)

    with pytest.raises(OpError) as wrong:
        _read(text)
    with pytest.raises(OpError) as missing:
        _read(tmp_path / "gone.bib")
    with pytest.raises(OpError) as large:
        _read(huge)

    assert wrong.value.data["reason"] == "unsupportedType"
    assert missing.value.code == ErrorCode.FILE_NOT_FOUND
    assert large.value.data["reason"] == "sourceTooLarge"


def test_reference_entries_hang_under_their_first_line(tmp_path: Path):
    reference = (
        "Yılmaz, A. (2020). A long title that keeps going until it has to wrap onto "
        "a second line of the page so the hanging indent shows. <em>Journal</em>, 12(3), 45–67."
    )
    body = (
        f'<div class="references"><h1 id="h-1">References</h1><p class="ref">{reference}</p></div>'
    )
    payload = {"html": body, "output": str(tmp_path / "refs.pdf"), "title": "Refs"}

    result = render_document(StudioDocumentRenderParams.model_validate(payload), silent_progress())

    with pymupdf.open(result.output) as document:
        lines = [
            line
            for block in document[0].get_text("dict")["blocks"]
            for line in block.get("lines", [])
            if "".join(span["text"] for span in line["spans"]).strip()
        ]
        first = next(line for line in lines if line["spans"][0]["text"].startswith("Yılmaz"))
        second = lines[lines.index(first) + 1]
    assert second["bbox"][0] - first["bbox"][0] == pytest.approx(24, abs=1)
