from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._objects import key_holder, set_key
from vivepdf.ops.a11y import CheckParams
from vivepdf.ops.a11y import check as a11y_check
from vivepdf.ops.a11y_fix import FixParams
from vivepdf.ops.a11y_fix import fix as a11y_fix
from vivepdf.ops.forms_detect import _ensure_form_resources
from vivepdf.ops.pdfa import PdfaConvertParams
from vivepdf.ops.pdfa import convert as pdfa_convert
from vivepdf.rpc.progress import silent_progress


def _page(document: pymupdf.Document) -> pymupdf.Page:
    page = document.new_page(width=400, height=500)
    page.insert_text((40, 60), "merhaba")
    return page


@pytest.fixture
def indirect_preferences(tmp_path: Path) -> Path:
    document = pymupdf.open()
    _page(document)
    holder = document.get_new_xref()
    document.update_object(holder, "<</DisplayDocTitle false>>")
    document.xref_set_key(document.pdf_catalog(), "ViewerPreferences", f"{holder} 0 R")
    path = tmp_path / "indirect.pdf"
    document.save(path)
    document.close()
    return path


def test_the_title_flag_lands_even_when_the_preferences_are_stored_apart(
    indirect_preferences: Path, tmp_path: Path
):
    target = tmp_path / "out.pdf"
    a11y_fix(
        FixParams(
            path=str(indirect_preferences),
            output=str(target),
            title="Baslik",
            language="tr",
            display_doc_title=True,
        ),
        silent_progress(),
    )
    assert a11y_check(CheckParams(path=str(target)), silent_progress()).display_doc_title


def test_nothing_is_left_holding_a_placeholder(indirect_preferences: Path, tmp_path: Path):
    target = tmp_path / "out.pdf"
    a11y_fix(
        FixParams(path=str(indirect_preferences), output=str(target), display_doc_title=True),
        silent_progress(),
    )
    document = pymupdf.open(target)
    kind, value = document.xref_get_key(document.pdf_catalog(), "ViewerPreferences")
    stored = document.xref_object(int(value.split()[0])) if kind == "xref" else value
    document.close()
    assert "replace me" not in stored
    assert "true" in stored


def test_the_holder_of_a_direct_path_is_the_object_itself(tmp_path: Path):
    document = pymupdf.open()
    page = _page(document)
    document.xref_set_key(page.xref, "UserUnit", "1")
    holder, key = key_holder(document, page.xref, ["UserUnit"])
    assert holder == page.xref
    assert key == "UserUnit"
    document.close()


def test_the_holder_follows_a_reference_before_writing(tmp_path: Path):
    document = pymupdf.open()
    _page(document)
    catalog = document.pdf_catalog()
    apart = document.get_new_xref()
    document.update_object(apart, "<</Deep<</Leaf 1>>>>")
    document.xref_set_key(catalog, "Branch", f"{apart} 0 R")
    holder, key = key_holder(document, catalog, ["Branch", "Deep", "Leaf"])
    assert holder == apart
    assert key == "Deep/Leaf"
    set_key(document, catalog, ["Branch", "Deep", "Leaf"], "9")
    assert document.xref_get_key(apart, "Deep/Leaf") == ("int", "9")
    document.close()


def _apart(document: pymupdf.Document, owner: int, key: str, body: str) -> int:
    xref = document.get_new_xref()
    document.update_object(xref, body)
    document.xref_set_key(owner, key, f"{xref} 0 R")
    return xref


@pytest.fixture
def latex_form_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    _page(document)
    catalog = document.pdf_catalog()
    stream = document.get_new_xref()
    document.update_object(stream, "<<>>")
    document.update_stream(stream, b"<xdp/>")
    _apart(document, catalog, "AcroForm", f"<</Fields []/NeedAppearances true/XFA {stream} 0 R>>")
    layer = document.add_ocg("Katman")
    _apart(document, catalog, "OCProperties", f"<</OCGs [{layer} 0 R]/D <</ON [{layer} 0 R]>>>>")
    path = tmp_path / "latex-form.pdf"
    document.save(path)
    document.close()
    return path


def test_pdfa_conversion_reaches_a_form_and_layers_stored_as_separate_objects(
    latex_form_pdf: Path, tmp_path: Path
):
    target = tmp_path / "archived.pdf"

    pdfa_convert(PdfaConvertParams(path=str(latex_form_pdf), output=str(target)), silent_progress())

    document = pymupdf.open(target)
    catalog = document.pdf_catalog()
    assert document.xref_get_key(catalog, "AcroForm/XFA")[0] == "null"
    assert document.xref_get_key(catalog, "AcroForm/NeedAppearances")[0] == "null"
    assert document.xref_get_key(catalog, "OCProperties/D/Name")[0] == "string"
    document.close()


def test_form_detection_adds_its_font_to_a_form_stored_apart(tmp_path: Path):
    document = pymupdf.open()
    _page(document)
    form = _apart(document, document.pdf_catalog(), "AcroForm", "<</Fields []>>")

    _ensure_form_resources(document)

    assert document.xref_get_key(form, "DR/Font/Helv")[0] == "xref"
    assert document.xref_get_key(form, "DA") == ("string", "/Helv 0 Tf 0 g")
    document.close()


def test_form_detection_creates_the_form_when_there_is_none(tmp_path: Path):
    document = pymupdf.open()
    _page(document)

    _ensure_form_resources(document)

    assert document.xref_get_key(document.pdf_catalog(), "AcroForm/DR/Font/Helv")[0] == "xref"
    document.close()
