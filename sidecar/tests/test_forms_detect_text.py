from pathlib import Path

import pymupdf

from vivepdf.ops._form_detect_params import DetectParams
from vivepdf.ops._page_text import NUMBER_FONT
from vivepdf.ops.forms_detect import detect_fields
from vivepdf.rpc.progress import silent_progress

FONT = {"fontname": "dejavu", "fontfile": str(NUMBER_FONT), "fontsize": 11}


def _detect(document: pymupdf.Document, tmp_path: Path):
    source = tmp_path / "source.pdf"
    document.save(source)
    document.close()
    return detect_fields(
        DetectParams(path=str(source), output=str(tmp_path / "form.pdf")), silent_progress()
    )


def test_underscore_and_dot_blanks_become_text_fields(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 100), "Ad Soyad: ______________________", **FONT)
    page.insert_text((72, 140), "Tarih: ...............................", **FONT)
    result = _detect(document, tmp_path)
    fields = {field.name: field for field in result.fields}
    assert set(fields) == {"Ad_Soyad", "Tarih"}
    assert all(field.kind == "text" for field in result.fields)
    name = fields["Ad_Soyad"].rect
    assert name[0] > 120 and name[2] > 250
    assert 95 < name[3] < 106


def test_contents_leaders_before_page_numbers_are_not_fields(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 100), "Giris ............................................ 5", **FONT)
    page.insert_text((72, 140), "Adres: _____________________________", **FONT)
    result = _detect(document, tmp_path)
    assert [field.name for field in result.fields] == ["Adres"]


def test_box_characters_become_checkboxes_with_their_labels(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 100), "☐ Kabul ediyorum", **FONT)
    page.insert_text((72, 140), "□ Reddediyorum", **FONT)
    result = _detect(document, tmp_path)
    assert [(field.name, field.kind) for field in result.fields] == [
        ("Kabul_ediyorum", "checkbox"),
        ("Reddediyorum", "checkbox"),
    ]
    box = result.fields[0].rect
    assert box[0] >= 71 and box[2] <= 82 and 90 <= box[3] <= 101


def test_new_names_avoid_existing_fields_and_dots(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    widget = pymupdf.Widget()
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.field_name = "Ad_Soyad"
    widget.rect = pymupdf.Rect(72, 700, 300, 720)
    page.add_widget(widget)
    page.insert_text((72, 100), "Ad Soyad:", **FONT)
    page.draw_line((150, 104), (400, 104), width=0.8)
    page.insert_text((72, 140), "T.C. Kimlik No:", **FONT)
    page.draw_line((170, 144), (400, 144), width=0.8)
    result = _detect(document, tmp_path)
    assert [field.name for field in result.fields] == ["Ad_Soyad-2", "T_C_Kimlik_No"]
    output = pymupdf.open(result.output)
    assert sorted(widget.field_name for widget in output[0].widgets()) == [
        "Ad_Soyad",
        "Ad_Soyad-2",
        "T_C_Kimlik_No",
    ]


def test_fields_on_turned_pages_sit_on_their_lines(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 100), "Ad Soyad:", **FONT)
    page.draw_line((150, 104), (400, 104), width=0.8)
    page.set_rotation(90)
    result = _detect(document, tmp_path)
    [field] = result.fields
    assert field.rect[0] == 150 and field.rect[2] == 400
    output = pymupdf.open(result.output)
    [widget] = list(output[0].widgets())
    assert abs(widget.rect.y1 - 105) < 1 and abs(widget.rect.x0 - 150) < 1


def test_output_form_carries_the_default_font_resource(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 100), "Ad Soyad:", **FONT)
    page.draw_line((150, 104), (400, 104), width=0.8)
    result = _detect(document, tmp_path)
    output = pymupdf.open(result.output)
    catalog = output.pdf_catalog()
    assert output.xref_get_key(catalog, "AcroForm/DR/Font/Helv")[0] == "xref"
    assert output.xref_get_key(catalog, "AcroForm/DA") == ("string", "/Helv 0 Tf 0 g")
