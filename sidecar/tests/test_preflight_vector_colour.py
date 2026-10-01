from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.preflight import PreflightParams, check
from vivepdf.rpc.progress import silent_progress


def _document_with(tmp_path: Path, name: str, content: bytes) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=200, height=200)
    page.insert_text((20, 20), " ", fontsize=1)
    xref = page.get_contents()[0]
    document.update_stream(xref, content)
    path = tmp_path / name
    document.save(path)
    document.close()
    return path


def _set_resource(document: pymupdf.Document, page: pymupdf.Page, key: str, value: str) -> None:
    kind, target = document.xref_get_key(page.xref, "Resources")
    if kind == "xref":
        document.xref_set_key(int(target.split()[0]), key, value)
    else:
        document.xref_set_key(page.xref, f"Resources/{key}", value)


def _vector_check(path: Path, profile: str = "offset"):
    report = check(PreflightParams(path=str(path), profile=profile), silent_progress())
    return report, {item.id: item for item in report.checks}["vectorColors"]


def test_rgb_text_fails_the_offset_profile(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Kırmızı başlık", fontsize=14, color=(0.8, 0.1, 0.1))
    path = tmp_path / "rgb metin ş.pdf"
    document.save(path)
    document.close()
    report, item = _vector_check(path)
    assert item.status == "fail"
    assert item.count == 1
    assert report.vector_color_spaces == {"rgb": 1}
    assert report.ready is False
    _report, digital = _vector_check(path, "digital")
    assert digital.status == "pass"


def test_cmyk_vector_art_passes_the_offset_profile(tmp_path: Path) -> None:
    path = _document_with(tmp_path, "cmyk.pdf", b"q 0 0 0 1 k 0.2 0.3 0 0 K 10 10 80 80 re B Q")
    report, item = _vector_check(path)
    assert item.status == "pass"
    assert report.vector_color_spaces == {"cmyk": 1}


def test_mixed_rgb_and_cmyk_art_warns_in_the_digital_profile(tmp_path: Path) -> None:
    path = _document_with(tmp_path, "mixed.pdf", b"0 0 0 1 k 1 0 0 RG 10 10 80 80 re B")
    _report, item = _vector_check(path, "digital")
    assert item.status == "warn"
    assert item.value == "CMYK 1, RGB 1"


@pytest.mark.parametrize(
    ("space", "expected"),
    [
        ("[/ICCBased {icc} 0 R]", "rgb"),
        ("[/Indexed /DeviceRGB 1 <000000FFFFFF>]", "rgb"),
        ("[/Separation /Gold /DeviceCMYK {icc} 0 R]", "spot"),
        ("/DeviceCMYK", "cmyk"),
    ],
)
def test_named_colour_spaces_are_resolved_through_the_resources(
    tmp_path: Path, space: str, expected: str
) -> None:
    document = pymupdf.open()
    page = document.new_page(width=200, height=200)
    page.insert_text((20, 20), " ", fontsize=1)
    icc = document.get_new_xref()
    document.update_object(icc, "<</N 3>>")
    document.update_stream(icc, b"\x00" * 16)
    document.update_stream(page.get_contents()[0], b"/CS0 cs 1 scn 10 10 80 80 re f")
    _set_resource(document, page, "ColorSpace", f"<</CS0 {space.format(icc=icc)}>>")
    path = tmp_path / f"{expected}.pdf"
    document.save(path)
    document.close()
    report, _item = _vector_check(path)
    assert report.vector_color_spaces == {expected: 1}


def test_rgb_inside_a_form_xobject_is_found(tmp_path: Path) -> None:
    source = pymupdf.open()
    logo = source.new_page(width=100, height=100)
    logo.draw_rect(pymupdf.Rect(10, 10, 90, 90), color=(0, 0, 1), fill=(0, 1, 0))
    document = pymupdf.open()
    page = document.new_page()
    page.show_pdf_page(pymupdf.Rect(50, 50, 150, 150), source, 0)
    path = tmp_path / "form.pdf"
    document.save(path)
    document.close()
    report, item = _vector_check(path)
    assert report.vector_color_spaces == {"rgb": 1}
    assert item.status == "fail"


def test_an_rgb_shading_is_found(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=200, height=200)
    page.insert_text((20, 20), " ", fontsize=1)
    function = document.get_new_xref()
    document.update_object(function, "<</FunctionType 2/Domain[0 1]/C0[1 0 0]/C1[0 0 1]/N 1>>")
    shading = document.get_new_xref()
    document.update_object(
        shading,
        f"<</ShadingType 2/ColorSpace/DeviceRGB/Coords[0 0 200 0]/Function {function} 0 R>>",
    )
    document.update_stream(page.get_contents()[0], b"q /Sh0 sh Q")
    _set_resource(document, page, "Shading", f"<</Sh0 {shading} 0 R>>")
    path = tmp_path / "shading.pdf"
    document.save(path)
    document.close()
    report, item = _vector_check(path)
    assert report.vector_color_spaces == {"rgb": 1}
    assert item.status == "fail"


def test_text_in_the_default_black_reports_no_rgb(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Siyah metin", fontsize=12)
    path = tmp_path / "black.pdf"
    document.save(path)
    document.close()
    report, item = _vector_check(path)
    assert "rgb" not in report.vector_color_spaces
    assert item.status == "pass"


def test_rg_inside_a_text_string_is_not_an_operator(tmp_path: Path) -> None:
    path = _document_with(
        tmp_path, "string.pdf", b"BT /F1 12 Tf 10 10 Td (1 0 0 rg) Tj ET 0 0 0 1 k"
    )
    report, _item = _vector_check(path)
    assert report.vector_color_spaces == {"cmyk": 1}


def test_colour_after_restore_uses_the_saved_space(tmp_path: Path) -> None:
    path = _document_with(
        tmp_path,
        "restore.pdf",
        b"/DeviceCMYK cs q /DeviceRGB cs Q 0 0 0 1 sc 10 10 50 50 re f",
    )
    report, _item = _vector_check(path)
    assert report.vector_color_spaces == {"cmyk": 1}


def test_rgb_in_an_annotation_appearance_is_found(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    note = page.add_rect_annot(pymupdf.Rect(50, 50, 150, 100))
    note.set_colors(stroke=(0.9, 0.1, 0.1), fill=(0.1, 0.2, 0.9))
    note.update()
    path = tmp_path / "not ş.pdf"
    document.save(path)
    document.close()
    report, item = _vector_check(path)
    assert report.vector_color_spaces.get("rgb") == 1
    assert item.status == "fail"


def test_rgb_in_a_form_field_appearance_is_found(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    widget = pymupdf.Widget()
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.field_name = "ad"
    widget.rect = pymupdf.Rect(50, 50, 250, 80)
    widget.field_value = "Ayşe"
    widget.fill_color = (0.8, 0.9, 1.0)
    widget.text_color = (0.7, 0.1, 0.1)
    page.add_widget(widget)
    path = tmp_path / "alan.pdf"
    document.save(path)
    document.close()
    report, _item = _vector_check(path)
    assert report.vector_color_spaces.get("rgb") == 1


def test_an_rgb_page_transparency_group_is_found(tmp_path: Path) -> None:
    path = _document_with(tmp_path, "group.pdf", b"0 0 0 1 k 10 10 80 80 re f")
    with pymupdf.open(path) as document:
        document.xref_set_key(document[0].xref, "Group", "<</S/Transparency/CS/DeviceRGB>>")
        grouped = tmp_path / "group rgb.pdf"
        document.save(grouped)
    report, item = _vector_check(grouped)
    assert report.vector_color_spaces == {"cmyk": 1, "rgb": 1}
    assert item.status == "fail"


def test_an_rgb_form_transparency_group_is_found(tmp_path: Path) -> None:
    source = pymupdf.open()
    art = source.new_page(width=100, height=100)
    art.draw_rect(pymupdf.Rect(10, 10, 90, 90), color=(0, 0, 0, 1), fill=(0, 0, 0, 1))
    document = pymupdf.open()
    page = document.new_page()
    form = page.show_pdf_page(pymupdf.Rect(50, 50, 150, 150), source, 0)
    document.xref_set_key(form, "Group", "<</S/Transparency/CS/DeviceRGB>>")
    path = tmp_path / "form group.pdf"
    document.save(path)
    document.close()
    report, _item = _vector_check(path)
    assert report.vector_color_spaces == {"cmyk": 1, "rgb": 1}


def test_a_cmyk_annotation_keeps_the_offset_profile_clean(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    note = page.add_rect_annot(pymupdf.Rect(50, 50, 150, 100))
    note.update()
    xref = note.xref
    kind, value = document.xref_get_key(xref, "AP/N")
    appearance = int(value.split()[0])
    document.update_stream(appearance, b"0 0 0 1 K 1 w 0 0 100 50 re S")
    path = tmp_path / "cmyk not.pdf"
    document.save(path)
    document.close()
    report, item = _vector_check(path)
    assert kind == "xref"
    assert "rgb" not in report.vector_color_spaces
    assert item.status == "pass"
