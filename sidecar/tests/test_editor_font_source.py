from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.ops.fonts import FONT_DIR
from vivepdf.rpc.progress import silent_progress

SOURCE_FONT = FONT_DIR / "DejaVuSans-Bold.ttf"


def _document_with_embedded_font(path: Path) -> int:
    document = pymupdf.open()
    page = document.new_page(width=400, height=400)
    page.insert_text((40, 80), "Kaynak metin", fontname="srcface", fontfile=str(SOURCE_FONT))
    document.save(path)
    xref = next(entry[0] for entry in document[0].get_fonts() if entry[1] == "ttf")
    document.close()
    return xref


@pytest.fixture
def blank_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    document.new_page(width=400, height=400)
    path = tmp_path / "target.pdf"
    document.save(path)
    document.close()
    return path


def _pasted_text(xref: int, source: str | None) -> dict:
    run = {"text": "Merhaba dünya", "font": "DejaVuSans-Bold", "fontXref": xref, "size": 16}
    if source is not None:
        run["fontSource"] = {"path": source}
    return {
        "id": "pasted",
        "kind": "text",
        "page": 1,
        "x0": 40,
        "y0": 40,
        "x1": 360,
        "y1": 140,
        "text": "Merhaba dünya",
        "fontSize": 16,
        "runs": [run],
    }


def _span_fonts(path: Path) -> set[str]:
    document = pymupdf.open(path)
    fonts = {
        span["font"]
        for block in document[0].get_text("dict")["blocks"]
        if block.get("type") == 0
        for line in block["lines"]
        for span in line["spans"]
        if span["text"].strip()
    }
    document.close()
    return fonts


def test_pasted_text_keeps_the_font_embedded_in_another_document(blank_pdf: Path, tmp_path: Path):
    source = tmp_path / "source.pdf"
    xref = _document_with_embedded_font(source)
    output = tmp_path / "pasted.pdf"

    result = apply(
        EditorApplyParams(
            path=str(blank_pdf), output=str(output), objects=[_pasted_text(xref, str(source))]
        ),
        silent_progress(),
    )

    assert any("Bold" in font for font in _span_fonts(output))
    assert not [warning for warning in result.warnings if warning.code == "fontSubstituted"]


def test_font_source_naming_the_target_itself_uses_its_own_font(tmp_path: Path):
    target = tmp_path / "own.pdf"
    xref = _document_with_embedded_font(target)
    output = tmp_path / "own-out.pdf"

    apply(
        EditorApplyParams(
            path=str(target), output=str(output), objects=[_pasted_text(xref, str(target))]
        ),
        silent_progress(),
    )

    assert any("Bold" in font for font in _span_fonts(output))


def test_missing_source_document_falls_back_with_a_warning(blank_pdf: Path, tmp_path: Path):
    output = tmp_path / "fallback.pdf"
    missing = tmp_path / "gone.pdf"

    result = apply(
        EditorApplyParams(
            path=str(blank_pdf), output=str(output), objects=[_pasted_text(7, str(missing))]
        ),
        silent_progress(),
    )

    assert _span_fonts(output)
    assert [
        warning.object_id for warning in result.warnings if warning.code == "fontSubstituted"
    ] == ["pasted"]
