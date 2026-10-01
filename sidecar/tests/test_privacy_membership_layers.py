import re
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._layer_flatten import inline_memberships
from vivepdf.ops.privacy_sanitize import SanitizeParams, sanitize
from vivepdf.rpc.progress import silent_progress


def _sanitized_text(source: Path, tmp_path: Path) -> str:
    target = tmp_path / "temiz.pdf"
    sanitize(
        SanitizeParams(path=str(source), output=str(target), hidden_layers=True),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        assert document.get_ocgs() == {}
        return document[0].get_text()


@pytest.mark.parametrize(
    ("policy", "shown"),
    [("AnyOn", True), ("AllOn", False), ("AnyOff", True), ("AllOff", False)],
)
def test_membership_policies_decide_what_stays(tmp_path: Path, policy: str, shown: bool) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    hidden = document.add_ocg("Gizli", on=False)
    visible = document.add_ocg("Acik", on=True)
    membership = document.set_ocmd(ocgs=[hidden, visible], policy=policy)
    page.insert_text((72, 72), "govde metni")
    page.insert_text((72, 120), "uyelik metni", oc=membership)
    source = tmp_path / f"{policy}.pdf"
    document.save(source)
    document.close()
    text = _sanitized_text(source, tmp_path)
    assert "govde metni" in text
    assert ("uyelik metni" in text) is shown


def test_a_visibility_expression_is_evaluated(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    hidden = document.add_ocg("Gizli", on=False)
    visible = document.add_ocg("Acik", on=True)
    kept = document.set_ocmd(ve=["and", visible, ["not", hidden]])
    dropped = document.set_ocmd(ve=["or", hidden, ["not", visible]])
    page.insert_text((72, 72), "ifade dogru", oc=kept)
    page.insert_text((72, 120), "ifade yanlis", oc=dropped)
    source = tmp_path / "ifade.pdf"
    document.save(source)
    document.close()
    text = _sanitized_text(source, tmp_path)
    assert "ifade dogru" in text
    assert "ifade yanlis" not in text


def test_a_form_under_a_hidden_membership_is_erased(tmp_path: Path) -> None:
    stamp = pymupdf.open()
    stamp.new_page(width=200, height=100).insert_text((20, 60), "DAMGA", fontsize=30)
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    hidden = document.add_ocg("Gizli", on=False)
    membership = document.set_ocmd(ocgs=[hidden], policy="AllOn")
    page.insert_text((72, 72), "govde metni")
    page.show_pdf_page(pymupdf.Rect(100, 300, 300, 400), stamp, 0, oc=membership)
    source = tmp_path / "form.pdf"
    document.save(source)
    document.close()
    stamp.close()
    text = _sanitized_text(source, tmp_path)
    assert "DAMGA" not in text
    assert "govde metni" in text


def test_a_picture_under_a_hidden_membership_leaves_no_image_and_paints_nothing(
    tmp_path: Path,
) -> None:
    picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 8, 8), False)
    picture.set_rect(picture.irect, (200, 30, 30))
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    hidden = document.add_ocg("Gizli", on=False)
    membership = document.set_ocmd(ocgs=[hidden], policy="AnyOn")
    page.insert_text((72, 72), "govde metni")
    page.insert_image(pymupdf.Rect(100, 200, 300, 350), pixmap=picture, oc=membership)
    source = tmp_path / "resim.pdf"
    document.save(source)
    document.close()
    assert "govde metni" in _sanitized_text(source, tmp_path)
    with pymupdf.open(tmp_path / "temiz.pdf") as cleaned:
        for xref in range(1, cleaned.xref_length()):
            assert cleaned.xref_get_key(xref, "Subtype")[1] != "/Image"
        area = cleaned[0].get_pixmap(clip=pymupdf.Rect(100, 200, 300, 350))
        assert area.color_topusage()[0] == 1.0
        assert area.pixel(10, 10) == (255, 255, 255)


def _inline_properties(document: pymupdf.Document, page: pymupdf.Page) -> int:
    resources = int(document.xref_get_key(page.xref, "Resources")[1].split()[0])
    kind, value = document.xref_get_key(resources, "Properties")
    assert kind == "dict"
    for name, xref in re.findall(r"/(\w+)\s+(\d+)\s+0\s+R", value):
        if document.xref_get_key(int(xref), "Type")[1] == "/OCMD":
            inline = document.xref_object(int(xref), compressed=True)
            value = value.replace(f"/{name} {xref} 0 R", f"/{name}{inline}")
    document.xref_set_key(resources, "Properties", value)
    return resources


def test_an_inline_membership_in_the_property_list_is_evaluated(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    hidden = document.add_ocg("Gizli", on=False)
    visible = document.add_ocg("Acik", on=True)
    dropped = document.set_ocmd(ocgs=[hidden, visible], policy="AllOn")
    kept = document.set_ocmd(ocgs=[visible], policy="AllOn")
    page.insert_text((72, 72), "satir icinde gizli", oc=dropped)
    page.insert_text((72, 120), "satir icinde acik", oc=kept)
    resources = _inline_properties(document, page)
    assert "OCMD" in document.xref_get_key(resources, "Properties")[1]
    source = tmp_path / "satir-ici.pdf"
    document.save(source)
    document.close()
    text = _sanitized_text(source, tmp_path)
    assert "satir icinde gizli" not in text
    assert "satir icinde acik" in text


def test_inline_memberships_are_read_from_a_property_list() -> None:
    text = "<</MC0 5 0 R/MC1<</Type/OCMD/OCGs[4 0 R]/P/AllOff>>/MC2 /Name/MC3<</Type/OCG>>>>"
    assert inline_memberships(text) == {"MC1": "<</Type/OCMD/OCGs[4 0 R]/P/AllOff>>"}


def _annotated(path: Path, on: bool) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    layer = document.add_ocg("Katman", on=on)
    membership = document.set_ocmd(ocgs=[layer], policy="AllOn")
    page.insert_text((72, 72), "govde metni")
    note = page.add_text_annot((100, 200), "gizli not")
    square = page.add_rect_annot(pymupdf.Rect(100, 300, 200, 400))
    document.xref_set_key(note.xref, "OC", f"{layer} 0 R")
    document.xref_set_key(square.xref, "OC", f"{membership} 0 R")
    widget = pymupdf.Widget()
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.field_name = "gizli_alan"
    widget.rect = pymupdf.Rect(100, 500, 300, 520)
    page.add_widget(widget)
    field = next(page.widgets())
    document.xref_set_key(field.xref, "OC", f"{layer} 0 R")
    document.save(path)
    document.close()


def test_an_annotation_in_a_hidden_layer_is_deleted_not_rewritten(tmp_path: Path) -> None:
    source = tmp_path / "notlar.pdf"
    _annotated(source, on=False)
    target = tmp_path / "temiz.pdf"
    sanitize(
        SanitizeParams(path=str(source), output=str(target), hidden_layers=True, annotations=False),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        page = document[0]
        assert list(page.annots()) == []
        assert list(page.widgets()) == []
        for xref in range(1, document.xref_length()):
            assert document.xref_get_key(xref, "Subtype")[1] != "/Image"
        assert "govde metni" in page.get_text()


def test_an_annotation_in_a_visible_layer_stays_an_annotation(tmp_path: Path) -> None:
    source = tmp_path / "notlar.pdf"
    _annotated(source, on=True)
    target = tmp_path / "temiz.pdf"
    sanitize(
        SanitizeParams(path=str(source), output=str(target), hidden_layers=True, annotations=False),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        page = document[0]
        kinds = sorted(annot.type[1] for annot in page.annots())
        assert kinds == ["Square", "Text"]
        assert [widget.field_name for widget in page.widgets()] == ["gizli_alan"]
        for annot in page.annots():
            assert document.xref_get_key(annot.xref, "OC")[0] == "null"
