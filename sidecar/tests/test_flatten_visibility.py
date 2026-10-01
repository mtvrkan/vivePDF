from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.flatten import FlattenParams, flatten
from vivepdf.ops.forms import FillParams, fill_fields
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)
NAME = "Şükrü Çağlar"


def _form(tmp_path: Path) -> pymupdf.Document:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    widget = pymupdf.Widget()
    widget.field_name = "ad"
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.rect = pymupdf.Rect(60, 100, 400, 130)
    widget.field_value = "x"
    page.add_widget(widget)
    return document


def _filled(tmp_path: Path, stale: bool = False) -> Path:
    document = _form(tmp_path)
    blank = tmp_path / "blank.pdf"
    document.save(blank)
    document.close()
    filled = tmp_path / "filled.pdf"
    fill_fields(
        FillParams(path=str(blank), output=str(filled), values={"ad": NAME}), silent_progress()
    )
    if not stale:
        return filled
    with pymupdf.open(filled) as document:
        document.xref_set_key(document.pdf_catalog(), "AcroForm/NeedAppearances", "true")
        stale_path = tmp_path / "stale.pdf"
        document.save(stale_path)
    return stale_path


def _flatten(path: Path, tmp_path: Path, **options) -> tuple[str, object]:
    target = tmp_path / "flat.pdf"
    result = flatten(
        FlattenParams(path=str(path), output=str(target), overwrite=True, **options),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        return document[0].get_text(), result


@pytest.mark.parametrize("stale", [False, True])
def test_filled_text_outside_latin1_survives_flattening(tmp_path: Path, stale: bool):
    text, result = _flatten(_filled(tmp_path, stale), tmp_path)
    assert NAME in text
    assert result.fields == 1


def _marked(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for index, (label, flags) in enumerate(
        (("noview", 32), ("hiddenmark", 2), ("screenonly", 0), ("printed", 4))
    ):
        annotation = page.add_freetext_annot(
            pymupdf.Rect(60, 100 + index * 60, 300, 140 + index * 60), label, fontsize=12
        )
        annotation.set_flags(flags)
        annotation.update()
    path = tmp_path / "marked.pdf"
    document.save(path)
    document.close()
    return path


def test_annotations_a_reader_never_shows_are_dropped_not_burned_in(tmp_path: Path):
    text, result = _flatten(_marked(tmp_path), tmp_path)
    assert "noview" not in text and "hiddenmark" not in text
    assert "screenonly" in text and "printed" in text
    assert (result.hidden_annotations, result.annotations) == (2, 2)


def test_printed_only_also_drops_screen_only_annotations(tmp_path: Path):
    text, result = _flatten(_marked(tmp_path), tmp_path, printed_only=True)
    assert "screenonly" not in text and "printed" in text
    assert (result.hidden_annotations, result.annotations) == (3, 1)


def test_annotations_kept_as_annotations_are_neither_dropped_nor_counted(tmp_path: Path):
    source = _marked(tmp_path)
    target = tmp_path / "kept.pdf"
    result = flatten(
        FlattenParams(path=str(source), output=str(target), annotations=False),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        assert len(list(document[0].annots())) == 4
    assert (result.hidden_annotations, result.annotations) == (0, 0)


def test_signed_fields_and_xfa_forms_are_reported(tmp_path: Path):
    document = _form(tmp_path)
    page = document[0]
    signature = pymupdf.Widget()
    signature.field_name = "imza"
    signature.field_type = pymupdf.PDF_WIDGET_TYPE_SIGNATURE
    signature.rect = pymupdf.Rect(60, 200, 260, 260)
    page.add_widget(signature)
    signed = next(widget for widget in page.widgets() if widget.field_name == "imza")
    document.xref_set_key(signed.xref, "V", "<</Type/Sig/Filter/Adobe.PPKLite>>")
    document.xref_set_key(document.pdf_catalog(), "AcroForm/XFA", "(stub)")
    source = tmp_path / "signed.pdf"
    document.save(source)
    document.close()

    _, result = _flatten(source, tmp_path)

    assert (result.fields, result.signatures, result.xfa) == (1, 1, True)


def test_a_plain_form_reports_no_signatures_or_xfa(tmp_path: Path):
    _, result = _flatten(_filled(tmp_path), tmp_path)
    assert (result.signatures, result.hidden_annotations, result.xfa) == (0, 0, False)
