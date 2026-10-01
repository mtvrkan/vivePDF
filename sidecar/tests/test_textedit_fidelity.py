from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.fonts import TEXTEDIT_FONT
from vivepdf.ops.textedit import (
    FindReplaceParams,
    TextEdit,
    TextEditParams,
    TextSpansParams,
    find_replace,
    get_spans,
    replace_text,
)
from vivepdf.rpc.progress import silent_progress


def spans_of(path: str, page: int = 0) -> list[dict]:
    with pymupdf.open(path) as document:
        return [
            span
            for block in document[page].get_text("dict")["blocks"]
            for line in block.get("lines", [])
            for span in line.get("spans", [])
        ]


def span_with(path: str, needle: str) -> dict:
    return next(span for span in spans_of(path) if needle in span["text"])


def edit_of(span: dict, text: str, **overrides: object) -> TextEdit:
    return TextEdit(
        bbox=list(span["bbox"]),
        text=text,
        size=span["size"],
        color="#000000",
        font=span["font"],
        **overrides,
    )


@pytest.fixture
def lined(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 100), "Header line stays", fontsize=12, fontname="Times-Roman")
    page.insert_text((72, 114), "Replace this line", fontsize=12, fontname="Times-Roman")
    page.insert_text((72, 128), "Footer line stays", fontsize=12, fontname="Times-Roman")
    path = tmp_path / "lines.pdf"
    document.save(path)
    document.close()
    return path


def test_spans_report_the_embedded_font_reference(lined: Path) -> None:
    result = get_spans(TextSpansParams(path=str(lined), page=0), silent_progress())
    assert result.spans
    assert all(span.font_xref > 0 for span in result.spans)


def test_replacement_keeps_the_original_font_size_and_baseline(lined: Path, tmp_path: Path) -> None:
    before = span_with(str(lined), "Replace")
    result = replace_text(
        TextEditParams(
            path=str(lined),
            output=str(tmp_path / "new.pdf"),
            page=0,
            edits=[edit_of(before, "Renewed")],
        ),
        silent_progress(),
    )
    assert result.replaced == 1
    assert result.warnings == []
    after = span_with(result.output, "Renewed")
    assert after["size"] == pytest.approx(before["size"], abs=0.01)
    assert "Times" in after["font"]
    assert after["bbox"][1] == pytest.approx(before["bbox"][1], abs=0.6)


def test_replacement_leaves_the_neighbouring_lines_alone(lined: Path, tmp_path: Path) -> None:
    before = span_with(str(lined), "Replace")
    result = replace_text(
        TextEditParams(
            path=str(lined),
            output=str(tmp_path / "neighbours.pdf"),
            page=0,
            edits=[edit_of(before, "Renewed")],
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        text = document[0].get_text()
    assert "Header line stays" in text
    assert "Footer line stays" in text
    assert "Replace this line" not in text


def test_italic_source_is_replaced_with_an_italic_font(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 100), "Emphasis", fontsize=14, fontname="Times-Italic")
    source = tmp_path / "italic.pdf"
    document.save(source)
    document.close()

    before = spans_of(str(source))[0]
    result = replace_text(
        TextEditParams(
            path=str(source),
            output=str(tmp_path / "italic-new.pdf"),
            page=0,
            edits=[edit_of(before, "Stressed", italic=True)],
        ),
        silent_progress(),
    )
    after = spans_of(result.output)[0]
    assert "Italic" in after["font"] or bool(after["flags"] & 2)


def test_turkish_text_keeps_every_letter(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_font(fontname="dejavu", fontfile=str(TEXTEDIT_FONT))
    page.insert_text(
        (72, 100), "Eski metin", fontsize=13, fontname="dejavu", fontfile=str(TEXTEDIT_FONT)
    )
    source = tmp_path / "turkish.pdf"
    document.save(source)
    document.close()

    before = spans_of(str(source))[0]
    result = replace_text(
        TextEditParams(
            path=str(source),
            output=str(tmp_path / "turkish-new.pdf"),
            page=0,
            edits=[edit_of(before, "Değişiklik şğüöçİ")],
        ),
        silent_progress(),
    )
    assert "glyphsMissing" not in [warning.code for warning in result.warnings]
    with pymupdf.open(result.output) as saved:
        assert "Değişiklik şğüöçİ" in saved[0].get_text()


def test_text_that_cannot_fit_reports_a_warning_instead_of_vanishing(
    lined: Path, tmp_path: Path
) -> None:
    before = span_with(str(lined), "Replace")
    edit = edit_of(before, "This sentence will not fit into that sliver at any size")
    edit.bbox = [before["bbox"][0], before["bbox"][1], before["bbox"][0] + 3, before["bbox"][3]]
    result = replace_text(
        TextEditParams(
            path=str(lined), output=str(tmp_path / "overflow.pdf"), page=0, edits=[edit]
        ),
        silent_progress(),
    )
    assert [warning.code for warning in result.warnings] == ["textOverflow"]


def test_find_replace_keeps_the_original_size(lined: Path, tmp_path: Path) -> None:
    result = find_replace(
        FindReplaceParams(
            path=str(lined), output=str(tmp_path / "found.pdf"), find="line", replace="row"
        ),
        silent_progress(),
    )
    assert result.replaced == 3
    assert result.warnings == []
    replaced = [span for span in spans_of(result.output) if "row" in span["text"]]
    assert len(replaced) == 3
    assert all(span["size"] == pytest.approx(12.0, abs=0.01) for span in replaced)


def test_find_replace_removes_the_word_it_replaced(lined: Path, tmp_path: Path) -> None:
    result = find_replace(
        FindReplaceParams(
            path=str(lined), output=str(tmp_path / "gone.pdf"), find="line", replace="row"
        ),
        silent_progress(),
    )
    assert result.replaced == 3
    with pymupdf.open(result.output) as document:
        body = document[0].get_text()
    assert "line" not in body
    assert body.count("row") == 3
    assert "Header" in body and "Footer" in body and "stays" in body


def test_find_replace_leaves_the_rest_of_the_line_in_place(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 100), "kar karakter kar sonu", fontsize=12, fontname="Times-Roman")
    source = tmp_path / "words.pdf"
    document.save(source)
    document.close()
    result = find_replace(
        FindReplaceParams(
            path=str(source),
            output=str(tmp_path / "words-out.pdf"),
            find="kar",
            replace="buz",
            whole_word=True,
        ),
        silent_progress(),
    )
    assert result.replaced == 2
    with pymupdf.open(result.output) as produced:
        body = produced[0].get_text()
    assert "karakter" in body
    assert "sonu" in body
    assert body.count("buz") == 2
