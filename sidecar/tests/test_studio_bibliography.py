from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import studio_document
from vivepdf.ops._studio_document_models import (
    StudioDocumentOpenParams,
    StudioDocumentRenderParams,
)
from vivepdf.ops.studio_document import import_document, read_bibliography, render_document
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


def test_ris_and_csl_json_libraries_are_read_too(tmp_path: Path):
    ris = tmp_path / "zotero.ris"
    ris.write_text("TY  - JOUR\nAU  - Yılmaz, Ayşe\nER  - \n", encoding="utf-8", newline="\n")
    csl = tmp_path / "library.json"
    csl.write_text('[{"id": "yilmaz2020", "type": "book"}]', encoding="utf-8")

    assert _read(ris).text.startswith("TY  - JOUR")
    assert _read(csl).name == "library.json"


def test_other_files_missing_files_and_huge_files_are_refused(tmp_path: Path, monkeypatch):
    text = tmp_path / "notes.txt"
    text.write_text(ENTRY, encoding="utf-8", newline="\n")
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


def _import(path: Path):
    return import_document(
        StudioDocumentOpenParams.model_validate({"path": str(path)}), silent_progress()
    )


def test_a_pandoc_article_imports_with_its_metadata_citations_and_bibliography(tmp_path: Path):
    paper = tmp_path / "paper" / "article.md"
    paper.parent.mkdir()
    (paper.parent / "refs.bib").write_text(ENTRY, encoding="utf-8", newline="\n")
    (tmp_path / "outside.bib").write_text("@book{secret, title={No}}", encoding="utf-8")
    paper.write_text(
        "---\ntitle: Kent Isısı\nauthor: [Ayşe Yılmaz, Mehmet Doğan]\ndate: 2026\n"
        "bibliography: [refs.bib, ../outside.bib, missing.bib]\n---\n"
        "# Giriş\n\nIsı artıyor [@yilmaz2020, s. 4].\n\n# Kaynakça\n",
        encoding="utf-8",
    )

    result = _import(paper)

    assert result.title == "Kent Isısı"
    assert result.author == "Ayşe Yılmaz, Mehmet Doğan"
    assert result.date == "2026"
    assert result.references_title == "Kaynakça"
    assert result.bibliography == ENTRY
    assert "data-citation=" in result.html
    assert result.html.endswith('<div data-bibliography=""></div>')
    assert "title: Kent" not in result.html


def test_a_cited_markdown_file_picks_up_a_bib_file_with_its_own_name(tmp_path: Path):
    paper = tmp_path / "thesis.md"
    paper.write_text("Text [@yilmaz2020].\n", encoding="utf-8")
    (tmp_path / "thesis.bib").write_text(ENTRY, encoding="utf-8", newline="\n")
    plain = tmp_path / "notes.md"
    plain.write_text("No citations here.\n", encoding="utf-8")
    (tmp_path / "notes.bib").write_text(ENTRY, encoding="utf-8", newline="\n")

    cited = _import(paper)
    uncited = _import(plain)

    assert cited.bibliography == ENTRY
    assert cited.title == "thesis"
    assert uncited.bibliography == ""
    assert "data-bibliography" not in uncited.html
