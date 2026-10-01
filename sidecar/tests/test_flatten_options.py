from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.flatten import FlattenParams, flatten
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture
def filled_form(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((60, 60), "Belge", fontsize=14, fontname="dejavu", fontfile=FONT)
    widget = pymupdf.Widget()
    widget.field_name = "ad"
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.rect = pymupdf.Rect(200, 140, 450, 175)
    widget.field_value = "Ayse Yilmaz"
    page.add_widget(widget)
    page.insert_link(
        {
            "kind": pymupdf.LINK_URI,
            "from": pymupdf.Rect(60, 300, 260, 320),
            "uri": "https://vivepdf.com",
        }
    )
    annotation = page.add_text_annot(pymupdf.Point(400, 300), "not")
    annotation.update()
    path = tmp_path / "form.pdf"
    document.save(path)
    document.close()
    return path


def _state(path: Path) -> dict:
    document = pymupdf.open(path)
    page = document[0]
    state = {
        "widgets": len(list(page.widgets())),
        "links": len(page.get_links()),
        "annots": len(list(page.annots())),
        "text": page.get_text(),
        "images": len(page.get_images()),
    }
    document.close()
    return state


def test_flattening_keeps_the_hyperlinks_by_default(filled_form: Path, tmp_path: Path):
    target = tmp_path / "flat.pdf"
    result = flatten(FlattenParams(path=str(filled_form), output=str(target)), silent_progress())
    state = _state(target)
    assert state["widgets"] == 0
    assert state["links"] == 1
    assert "Ayse Yilmaz" in state["text"]
    assert result.fields == 1


def test_links_can_be_dropped_on_request(filled_form: Path, tmp_path: Path):
    target = tmp_path / "nolinks.pdf"
    flatten(
        FlattenParams(path=str(filled_form), output=str(target), keep_links=False),
        silent_progress(),
    )
    assert _state(target)["links"] == 0


def test_keeping_the_form_leaves_the_widget_alone(filled_form: Path, tmp_path: Path):
    target = tmp_path / "keep.pdf"
    flatten(
        FlattenParams(path=str(filled_form), output=str(target), forms=False), silent_progress()
    )
    assert _state(target)["widgets"] == 1


def test_rasterising_turns_the_page_into_a_picture(filled_form: Path, tmp_path: Path):
    target = tmp_path / "raster.pdf"
    flatten(
        FlattenParams(path=str(filled_form), output=str(target), rasterize=True, dpi=100),
        silent_progress(),
    )
    state = _state(target)
    assert state["widgets"] == 0
    assert state["images"] == 1
    assert state["text"].strip() == ""


def test_the_page_keeps_its_size_when_rasterised(filled_form: Path, tmp_path: Path):
    target = tmp_path / "raster2.pdf"
    flatten(
        FlattenParams(path=str(filled_form), output=str(target), rasterize=True, dpi=100),
        silent_progress(),
    )
    document = pymupdf.open(target)
    rect = document[0].rect
    document.close()
    assert (round(rect.width), round(rect.height)) == (595, 842)
