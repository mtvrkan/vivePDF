from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.page_geometry import ResizeParams, resize_pages
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def annotated_pages(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for rotation in (0, 90):
        page = document.new_page(width=600, height=800)
        page.insert_text((20, 30), "HEADING", fontsize=12)
        page.insert_link(
            {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(20, 18, 110, 34), "uri": "https://a.b"}
        )
        page.add_highlight_annot(pymupdf.Rect(20, 18, 90, 34))
        page.add_ink_annot([[(100, 100), (150, 150)]])
        page.set_rotation(rotation)
    page = document.new_page(width=300, height=300)
    widget = pymupdf.Widget()
    widget.field_name = "name"
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.rect = pymupdf.Rect(20, 20, 150, 40)
    widget.field_value = "filled"
    page.add_widget(widget)
    document.set_toc([[1, "Start", 1], [1, "Form", 3]])
    path = tmp_path / "annotated.pdf"
    document.save(path)
    document.close()
    return path


@pytest.mark.parametrize("mode", ["fit", "fill", "stretch"])
def test_resize_keeps_links_annotations_fields_and_bookmarks(
    annotated_pages: Path, tmp_path: Path, mode: str
) -> None:
    output = tmp_path / f"{mode}.pdf"
    resize_pages(
        ResizeParams(path=str(annotated_pages), output=str(output), preset="a4", mode=mode),
        silent_progress(),
    )
    document = pymupdf.open(output)
    for page in list(document)[:2]:
        assert len(page.get_links()) == 1
        assert sorted(annot.type[1] for annot in page.annots()) == ["Highlight", "Ink"]
    widgets = list(document[2].widgets())
    assert [widget.field_value for widget in widgets] == ["filled"]
    assert [entry[1] for entry in document.get_toc()] == ["Start", "Form"]
    document.close()


def test_fit_moves_annotations_with_the_text(annotated_pages: Path, tmp_path: Path) -> None:
    output = tmp_path / "fit.pdf"
    resize_pages(
        ResizeParams(path=str(annotated_pages), output=str(output), preset="a3", mode="fit"),
        silent_progress(),
    )
    document = pymupdf.open(output)
    page = document[0]
    heading = page.search_for("HEADING")[0]
    link = page.get_links()[0]["from"]
    highlight = next(annot for annot in page.annots() if annot.type[1] == "Highlight").rect
    assert not (heading & link).is_empty
    assert not (heading & highlight).is_empty
    assert heading.height > 15
    document.close()


def test_rotated_page_keeps_its_orientation_and_all_its_content(
    annotated_pages: Path, tmp_path: Path
) -> None:
    source = pymupdf.open(annotated_pages)
    expected = source[1].rect
    source.close()
    output = tmp_path / "rotated.pdf"
    resize_pages(
        ResizeParams(path=str(annotated_pages), output=str(output), preset="a4", mode="fit"),
        silent_progress(),
    )
    document = pymupdf.open(output)
    page = document[1]
    assert page.rotation == 90
    assert (page.rect.width > page.rect.height) == (expected.width > expected.height)
    assert {round(page.rect.width), round(page.rect.height)} == {595, 842}
    assert page.search_for("HEADING")
    document.close()


def test_box_mode_respects_rotation(annotated_pages: Path, tmp_path: Path) -> None:
    output = tmp_path / "box.pdf"
    resize_pages(
        ResizeParams(path=str(annotated_pages), output=str(output), preset="a4", mode="box"),
        silent_progress(),
    )
    document = pymupdf.open(output)
    rotated = document[1]
    assert rotated.rect.width > rotated.rect.height
    assert round(rotated.rect.width) == 842
    document.close()
