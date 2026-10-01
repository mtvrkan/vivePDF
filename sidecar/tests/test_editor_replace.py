from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.ops.textedit import TextSpansParams, get_spans
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def text_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    page.insert_text((40, 80), "Hello world", fontsize=14)
    page.insert_text((40, 140), "Remove me", fontsize=12)
    rotated = document.new_page(width=400, height=300)
    rotated.insert_text((40, 80), "Sideways", fontsize=14)
    rotated.set_rotation(90)
    path = tmp_path / "text.pdf"
    document.save(path)
    document.close()
    return path


def _span(path: Path, page: int, needle: str, visible: bool):
    result = get_spans(
        TextSpansParams(path=str(path), page=page, visible=visible), silent_progress()
    )
    return next(span for span in result.spans if needle in span.text)


def test_replace_and_delete_existing_text(text_pdf: Path, tmp_path: Path):
    hello = _span(text_pdf, 0, "Hello", True)
    remove = _span(text_pdf, 0, "Remove", True)
    output = tmp_path / "edited.pdf"
    result = apply(
        EditorApplyParams(
            path=str(text_pdf),
            output=str(output),
            objects=[
                {
                    "kind": "edit",
                    "page": 1,
                    "x0": hello.bbox[0],
                    "y0": hello.bbox[1],
                    "x1": hello.bbox[2] + 40,
                    "y1": hello.bbox[3],
                    "text": "Merhaba dunya",
                    "fontSize": hello.size,
                    "color": hello.color,
                    "bold": hello.bold,
                    "italic": hello.italic,
                    "font": hello.font,
                },
                {
                    "kind": "edit",
                    "page": 1,
                    "x0": remove.bbox[0],
                    "y0": remove.bbox[1],
                    "x1": remove.bbox[2],
                    "y1": remove.bbox[3],
                    "text": "",
                },
            ],
        ),
        silent_progress(),
    )
    assert result.applied == 2
    document = pymupdf.open(output)
    text = document[0].get_text()
    document.close()
    assert "Merhaba dunya" in text
    assert "Hello world" not in text
    assert "Remove me" not in text


def test_visible_spans_follow_page_rotation(text_pdf: Path):
    raw = _span(text_pdf, 1, "Sideways", False)
    visible = _span(text_pdf, 1, "Sideways", True)
    assert raw.bbox != visible.bbox
    document = pymupdf.open(text_pdf)
    page = document[1]
    expected = pymupdf.Rect(raw.bbox) * page.rotation_matrix
    expected.normalize()
    document.close()
    assert [round(v, 1) for v in visible.bbox] == [round(v, 1) for v in expected]
