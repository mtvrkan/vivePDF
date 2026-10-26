from pathlib import Path

import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops._document_equations import equation_size
from vivepdf.ops._document_markdown import document_markdown
from vivepdf.ops._studio_document import clean_html
from vivepdf.ops._studio_document_models import (
    MAX_EQUATIONS,
    StudioDocumentContent,
    StudioDocumentPreviewParams,
    StudioDocumentRenderParams,
)
from vivepdf.ops.studio_document import preview_document, render_document
from vivepdf.rpc.progress import silent_progress

BOX = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -750 2000 1000">'
    '<rect x="0" y="-750" width="2000" height="1000" fill="#000000"/></svg>'
)
WIDE = BOX.replace("2000", "60000")


def _inline(index: int = 0, width: float = 2, height: float = 1, depth: float = 0.25) -> str:
    return (
        f'<img src="vpeq-{index}" alt="x^2" '
        f'style="width:{width}em;height:{height}em;vertical-align:-{depth}em">'
    )


def _display(number: int, index: int = 0, latex: str = "a+b") -> str:
    return (
        f'<p id="e-{number}" class="eq" data-equation="{index}" data-latex="{latex}" '
        'style="text-align:right;text-indent:0;line-height:1.2;padding:0 0;margin:0.5em 0">'
        f"({number})</p>"
    )


def _render(tmp_path: Path, body: str, equations: list[str]) -> pymupdf.Document:
    params = StudioDocumentRenderParams.model_validate(
        {
            "html": body,
            "equations": equations,
            "output": str(tmp_path / "out.pdf"),
            "settings": {"fontSize": 12},
        }
    )
    return pymupdf.open(render_document(params, silent_progress()).output)


def _boxes(page: pymupdf.Page) -> list[pymupdf.Rect]:
    return [
        drawing["rect"]
        for drawing in page.get_drawings()
        if drawing.get("fill") == (0.0, 0.0, 0.0) and drawing["rect"].width > 5
    ]


def test_a_numbered_equation_is_drawn_centred_with_its_number_on_the_right(tmp_path: Path):
    document = _render(tmp_path, "<p>Before</p>" + _display(1), [BOX])
    page = document[0]

    boxes = _boxes(page)
    number = page.search_for("(1)")[0]

    assert len(boxes) == 1
    box = boxes[0]
    assert box.width == pytest.approx(24, abs=0.5)
    assert box.height == pytest.approx(12, abs=0.5)
    assert (box.x0 + box.x1) / 2 == pytest.approx(page.rect.width / 2, abs=40)
    assert number.x0 > box.x1
    assert number.y0 < (box.y0 + box.y1) / 2 < number.y1


def test_an_inline_equation_sits_where_the_text_leaves_room_for_it(tmp_path: Path):
    document = _render(tmp_path, f"<p>Value {_inline()} after</p>", [BOX])
    page = document[0]

    boxes = _boxes(page)
    before = page.search_for("Value")[0]
    after = page.search_for("after")[0]

    assert len(boxes) == 1
    box = boxes[0]
    assert box.width == pytest.approx(24, abs=0.5)
    assert before.x1 <= box.x0 < box.x1 <= after.x0
    assert box.y0 < before.y1 and box.y1 > before.y0


def test_a_wide_numbered_equation_shrinks_to_leave_room_for_its_number(tmp_path: Path):
    document = _render(tmp_path, _display(1), [WIDE])
    page = document[0]

    box = _boxes(page)[0]
    number = page.search_for("(1)")[0]

    assert box.x0 >= 0
    assert box.x1 < number.x0


def test_a_broken_or_missing_equation_is_skipped_and_the_rest_still_draws(tmp_path: Path):
    body = _display(1, 0) + _display(2, 1) + f"<p>{_inline(5)}</p>"

    document = _render(tmp_path, body, ["<svg><rect", BOX])

    assert len(_boxes(document[0])) == 1
    assert document[0].search_for("(1)") and document[0].search_for("(2)")


def test_cleaning_keeps_only_equation_pictures_that_exist():
    body = f"<p>{_inline(0)}{_inline(3)}</p>"

    cleaned = clean_html(body, 0, 1)

    assert 'src="vpeq-0"' in cleaned
    assert "vpeq-3" not in cleaned


def test_a_numbered_equation_starts_a_block_the_editor_can_find():
    params = StudioDocumentPreviewParams.model_validate(
        {"html": '<p id="b-0">Text</p>' + _display(1), "equations": [BOX]}
    )

    preview = preview_document(params, silent_progress())

    assert {block.id for block in preview.block_starts} == {"b-0", "e-1"}


def test_equations_become_markdown_maths():
    body = f"<p>Inline {_inline()} text</p>" + _display(3, latex="E=mc^2")
    content = StudioDocumentContent.model_validate({"html": body, "equations": [BOX]})

    markdown = document_markdown(content)

    assert "Inline $x^2$ text" in markdown
    assert "$$\nE=mc^2 \\tag{3}\n$$" in markdown


def test_the_size_comes_from_the_view_box_and_bad_ones_are_refused():
    assert equation_size(BOX) == (2.0, 1.0)
    assert equation_size('<svg viewBox="0 0 0 10"></svg>') is None
    assert equation_size("<svg></svg>") is None


def test_too_many_equations_are_refused():
    with pytest.raises(ValidationError):
        StudioDocumentContent.model_validate({"html": "", "equations": [BOX] * (MAX_EQUATIONS + 1)})
