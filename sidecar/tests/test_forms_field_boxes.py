from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.forms import FieldsParams, list_fields
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


def _form(path: Path, rotation: int = 0, crop: pymupdf.Rect | None = None) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    for name, rect in (
        ("first", pymupdf.Rect(60, 80, 300, 120)),
        ("second", pymupdf.Rect(300, 400, 540, 440)),
    ):
        widget = pymupdf.Widget()
        widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
        widget.field_name = name
        widget.rect = rect
        page.add_widget(widget)
    if crop is not None:
        page.set_cropbox(crop)
    page.set_rotation(rotation)
    document.save(path)
    document.close()
    return path


def _boxes(path: Path) -> dict:
    result = list_fields(FieldsParams(path=str(path)), silent_progress())
    return {box.name: box for box in result.boxes}


def test_every_field_box_is_a_fraction_of_the_page(tmp_path: Path):
    boxes = _boxes(_form(tmp_path / "form.pdf"))
    assert boxes["first"].page == 1
    assert (boxes["first"].left, boxes["first"].top) == pytest.approx((0.1, 0.1))
    assert (boxes["first"].width, boxes["first"].height) == pytest.approx((0.4, 0.05))
    assert (boxes["second"].left, boxes["second"].top) == pytest.approx((0.5, 0.5))


def test_a_turned_page_keeps_the_unrotated_fractions(tmp_path: Path):
    boxes = _boxes(_form(tmp_path / "turned.pdf", rotation=90))
    assert (boxes["first"].left, boxes["first"].top) == pytest.approx((0.1, 0.1))
    assert boxes["first"].width == pytest.approx(0.4)


def test_an_offset_crop_box_measures_from_its_own_corner(tmp_path: Path):
    boxes = _boxes(_form(tmp_path / "cropped.pdf", crop=pymupdf.Rect(50, 40, 550, 800)))
    assert boxes["first"].left == pytest.approx(10 / 500)
    assert boxes["first"].top == pytest.approx(40 / 760)
    assert boxes["first"].width == pytest.approx(240 / 500)


def test_a_document_without_fields_has_no_boxes(tmp_path: Path):
    document = pymupdf.open()
    document.new_page()
    path = tmp_path / "plain.pdf"
    document.save(path)
    document.close()
    assert _boxes(path) == {}


def test_a_missing_file_is_refused(tmp_path: Path):
    with pytest.raises(OpError):
        list_fields(FieldsParams(path=str(tmp_path / "missing.pdf")), silent_progress())
