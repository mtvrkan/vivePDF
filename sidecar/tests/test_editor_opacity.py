from pathlib import Path

import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def blank_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    document.new_page(width=400, height=300)
    path = tmp_path / "blank.pdf"
    document.save(path)
    document.close()
    return path


def test_text_object_with_opacity_applies_and_keeps_text(blank_pdf: Path, tmp_path: Path):
    output = tmp_path / "opacity.pdf"
    result = apply(
        EditorApplyParams(
            path=str(blank_pdf),
            output=str(output),
            objects=[
                {
                    "kind": "text",
                    "page": 1,
                    "x0": 40,
                    "y0": 40,
                    "x1": 300,
                    "y1": 90,
                    "text": "Faded text",
                    "opacity": 0.5,
                }
            ],
        ),
        silent_progress(),
    )
    assert result.applied == 1
    document = pymupdf.open(output)
    page = document[0]
    assert "Faded text" in page.get_text()
    content = page.read_contents().decode("latin-1", errors="ignore")
    assert " gs" in content or "/GS" in content
    document.close()


def test_opacity_defaults_to_opaque_when_omitted(blank_pdf: Path, tmp_path: Path):
    output = tmp_path / "opaque.pdf"
    result = apply(
        EditorApplyParams(
            path=str(blank_pdf),
            output=str(output),
            objects=[
                {
                    "kind": "text",
                    "page": 1,
                    "x0": 40,
                    "y0": 40,
                    "x1": 300,
                    "y1": 90,
                    "text": "Solid text",
                }
            ],
        ),
        silent_progress(),
    )
    assert result.applied == 1
    document = pymupdf.open(output)
    assert "Solid text" in document[0].get_text()
    document.close()


def test_opacity_out_of_range_is_rejected(blank_pdf: Path):
    with pytest.raises(ValidationError):
        EditorApplyParams(
            path=str(blank_pdf),
            output=str(blank_pdf),
            objects=[
                {
                    "kind": "text",
                    "page": 1,
                    "x0": 0,
                    "y0": 0,
                    "x1": 10,
                    "y1": 10,
                    "text": "x",
                    "opacity": 1.5,
                }
            ],
        )
