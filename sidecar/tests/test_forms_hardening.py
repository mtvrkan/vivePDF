from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._form_detect_params import DetectParams
from vivepdf.ops.forms import FieldsParams, FillParams, fill_fields, list_fields
from vivepdf.ops.forms_batch import DataPreviewParams, MergeParams, data_preview, merge
from vivepdf.ops.forms_data import (
    FormDataExportParams,
    FormDataImportParams,
    export_data,
    import_data,
)
from vivepdf.ops.forms_detect import detect_fields
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

TURKISH = "Çağrı Şükrü İĞDE ığüşöç"


def _add(page: pymupdf.Page, name: str, kind: int, rect: tuple, **extra) -> None:
    widget = pymupdf.Widget()
    widget.field_name = name
    widget.field_type = kind
    widget.rect = pymupdf.Rect(rect)
    for key, value in extra.items():
        setattr(widget, key, value)
    page.add_widget(widget)


@pytest.fixture
def form_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    _add(page, "ad", pymupdf.PDF_WIDGET_TYPE_TEXT, (72, 72, 300, 92))
    _add(
        page,
        "notlar",
        pymupdf.PDF_WIDGET_TYPE_TEXT,
        (72, 100, 300, 160),
        field_flags=pymupdf.PDF_TX_FIELD_IS_MULTILINE,
    )
    _add(page, "onay", pymupdf.PDF_WIDGET_TYPE_CHECKBOX, (72, 170, 88, 186))
    _add(
        page,
        "sehir",
        pymupdf.PDF_WIDGET_TYPE_COMBOBOX,
        (72, 200, 250, 220),
        choice_values=["Ankara", "İzmir", "Şanlıurfa"],
    )
    _add(
        page,
        "kilitli",
        pymupdf.PDF_WIDGET_TYPE_TEXT,
        (72, 330, 300, 350),
        field_flags=pymupdf.PDF_FIELD_IS_READ_ONLY,
        field_value="sabit",
    )
    path = tmp_path / "form ş.pdf"
    document.save(path)
    document.close()
    return path


def _page_text(path: Path) -> str:
    document = pymupdf.open(path)
    text = document[0].get_text()
    document.close()
    return text


@pytest.mark.parametrize("flatten", [False, True])
def test_turkish_values_are_drawn_not_left_blank(
    form_pdf: Path, tmp_path: Path, flatten: bool
) -> None:
    result = fill_fields(
        FillParams(
            path=str(form_pdf),
            output=str(tmp_path / "filled.pdf"),
            values={"ad": TURKISH, "notlar": "Birinci satır\nİkinci satır", "sehir": "Şanlıurfa"},
            flatten=flatten,
        ),
        silent_progress(),
    )
    text = _page_text(Path(result.output))
    assert TURKISH in text
    assert "İkinci satır" in text
    assert "Şanlıurfa" in text
    assert Path(result.output).stat().st_size < 200_000


def test_latin_values_keep_the_native_appearance(form_pdf: Path, tmp_path: Path) -> None:
    result = fill_fields(
        FillParams(path=str(form_pdf), output=str(tmp_path / "f.pdf"), values={"ad": "Plain"}),
        silent_progress(),
    )
    document = pymupdf.open(result.output)
    fonts = [
        xref for xref in range(1, document.xref_length()) if "VIVUNI" in document.xref_object(xref)
    ]
    document.close()
    assert not fonts


def test_read_only_field_is_not_overwritten(form_pdf: Path, tmp_path: Path) -> None:
    result = fill_fields(
        FillParams(
            path=str(form_pdf), output=str(tmp_path / "f.pdf"), values={"kilitli": "değişti"}
        ),
        silent_progress(),
    )
    assert result.filled == 0
    fields = list_fields(FieldsParams(path=result.output), silent_progress()).fields
    assert next(field for field in fields if field.name == "kilitli").value == "sabit"


def test_windows_turkish_csv_and_quoted_newlines_are_read(tmp_path: Path) -> None:
    legacy = tmp_path / "legacy.csv"
    legacy.write_bytes("Ad;Şehir\nÇağrı;İzmir\n".encode("cp1254"))
    preview = data_preview(DataPreviewParams(path=str(legacy)), silent_progress())
    assert preview.columns == ["Ad", "Şehir"]
    assert preview.rows[0] == {"Ad": "Çağrı", "Şehir": "İzmir"}
    quoted = tmp_path / "quoted.csv"
    quoted.write_bytes('ad,notlar\n"Soyadı, Adı","çok\nsatırlı"\n'.encode())
    rows = data_preview(DataPreviewParams(path=str(quoted)), silent_progress()).rows
    assert rows == [{"ad": "Soyadı, Adı", "notlar": "çok\nsatırlı"}]


def test_merge_refuses_a_pattern_with_unknown_fields(form_pdf: Path, tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("ad,sehir\nAyşe,İzmir\n", encoding="utf-8")
    with pytest.raises(OpError) as raised:
        merge(
            MergeParams(
                path=str(form_pdf),
                data_path=str(data),
                output_dir=str(tmp_path / "out"),
                pattern="{name}-{Soyad}",
            ),
            silent_progress(),
        )
    assert raised.value.data == {"reason": "unknownPlaceholders", "fields": ["Soyad"]}
    result = merge(
        MergeParams(
            path=str(form_pdf),
            data_path=str(data),
            output_dir=str(tmp_path / "out"),
            pattern="{ad}-{n}",
        ),
        silent_progress(),
    )
    assert [Path(item.output).name for item in result.outputs] == ["Ayşe-1.pdf"]
    assert "kilitli" not in result.unmatched_fields
    assert "Ayşe" in _page_text(Path(result.outputs[0].output))


@pytest.mark.parametrize("data_format", ["xfdf", "fdf"])
def test_form_data_round_trips_through_xfdf_and_fdf(
    form_pdf: Path, tmp_path: Path, data_format: str
) -> None:
    filled = fill_fields(
        FillParams(
            path=str(form_pdf),
            output=str(tmp_path / "filled.pdf"),
            values={
                "ad": TURKISH,
                "notlar": "a (b) \\ c\nd",
                "onay": True,
                "sehir": "Şanlıurfa",
            },
        ),
        silent_progress(),
    )
    exported = export_data(
        FormDataExportParams(
            path=filled.output, output=str(tmp_path / f"data.{data_format}"), format=data_format
        ),
        silent_progress(),
    )
    assert exported.fields >= 4
    restored = import_data(
        FormDataImportParams(
            path=str(form_pdf), data_path=exported.output, output=str(tmp_path / "restored.pdf")
        ),
        silent_progress(),
    )
    assert restored.unmatched == []
    values = {
        field.name: field.value
        for field in list_fields(FieldsParams(path=restored.output), silent_progress()).fields
    }
    assert values["ad"] == TURKISH
    assert values["notlar"] == "a (b) \\ c\nd"
    assert values["onay"] is True
    assert values["sehir"] == "Şanlıurfa"
    assert values["kilitli"] == "sabit"
    assert TURKISH in _page_text(Path(restored.output))


def test_import_reports_fields_the_form_does_not_have(form_pdf: Path, tmp_path: Path) -> None:
    data = tmp_path / "extra.xfdf"
    data.write_text(
        '<?xml version="1.0" encoding="UTF-8"?><xfdf xmlns="http://ns.adobe.com/xfdf/">'
        '<fields><field name="ad"><value>Ali</value></field>'
        '<field name="grup"><field name="alt"><value>x</value></field></field></fields></xfdf>',
        encoding="utf-8",
    )
    result = import_data(
        FormDataImportParams(
            path=str(form_pdf), data_path=str(data), output=str(tmp_path / "o.pdf")
        ),
        silent_progress(),
    )
    assert result.filled == 1
    assert result.unmatched == ["grup.alt"]


def test_import_refuses_entities_and_garbage(form_pdf: Path, tmp_path: Path) -> None:
    hostile = tmp_path / "hostile.xfdf"
    hostile.write_text(
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><xfdf><fields>'
        '<field name="ad"><value>&a;</value></field></fields></xfdf>',
        encoding="utf-8",
    )
    garbage = tmp_path / "garbage.fdf"
    garbage.write_bytes(b"%FDF-1.2\n1 0 obj << /FDF << /Fields [ << /T (ad) /V (x")
    for source in (hostile, garbage):
        with pytest.raises(OpError) as raised:
            import_data(
                FormDataImportParams(
                    path=str(form_pdf), data_path=str(source), output=str(tmp_path / "o.pdf")
                ),
                silent_progress(),
            )
        assert raised.value.code == ErrorCode.INVALID_PARAMS
        assert raised.value.data == {"reason": "badData"}


def test_export_of_a_plain_document_is_refused(sample_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        export_data(
            FormDataExportParams(path=str(sample_pdf), output=str(tmp_path / "d.xfdf")),
            silent_progress(),
        )
    assert raised.value.data == {"reason": "noForm"}


def test_detect_finds_lines_and_boxes_on_a_scanned_form(tmp_path: Path) -> None:
    drawn = pymupdf.open()
    page = drawn.new_page()
    page.insert_text((72, 100), "Name:")
    page.draw_line((160, 102), (400, 102))
    page.draw_rect((72, 130, 84, 142))
    page.insert_text((90, 140), "I agree")
    pixmap = page.get_pixmap(dpi=150)
    scan = pymupdf.open()
    scan.new_page().insert_image(scan[0].rect, pixmap=pixmap)
    path = tmp_path / "scan.pdf"
    scan.save(path)
    result = detect_fields(
        DetectParams(path=str(path), output=str(tmp_path / "detected.pdf")), silent_progress()
    )
    kinds = sorted(field.kind for field in result.fields)
    assert kinds == ["checkbox", "text"]
    assert result.scanned_pages == [1]
    line = next(field for field in result.fields if field.kind == "text")
    assert abs(line.rect[0] - 160) < 3 and abs(line.rect[2] - 400) < 3
    box = next(field for field in result.fields if field.kind == "checkbox")
    assert abs(box.rect[0] - 72) < 3 and abs(box.rect[3] - 142) < 3


def test_export_writes_the_values_typed_in_the_app(form_pdf: Path, tmp_path: Path) -> None:
    exported = export_data(
        FormDataExportParams(
            path=str(form_pdf),
            output=str(tmp_path / "typed.xfdf"),
            values={"ad": TURKISH, "onay": True, "yok": "x"},
        ),
        silent_progress(),
    )
    restored = import_data(
        FormDataImportParams(
            path=str(form_pdf), data_path=exported.output, output=str(tmp_path / "typed.pdf")
        ),
        silent_progress(),
    )
    values = {
        field.name: field.value
        for field in list_fields(FieldsParams(path=restored.output), silent_progress()).fields
    }
    assert values["ad"] == TURKISH
    assert values["onay"] is True
    assert values["kilitli"] == "sabit"


def test_fill_accepts_an_empty_choice(form_pdf: Path, tmp_path: Path) -> None:
    filled = fill_fields(
        FillParams(path=str(form_pdf), output=str(tmp_path / "empty.pdf"), values={"sehir": ""}),
        silent_progress(),
    )
    values = {
        field.name: field.value
        for field in list_fields(FieldsParams(path=filled.output), silent_progress()).fields
    }
    assert values["sehir"] in ("", None)


def _as_scan(drawn: pymupdf.Document, path: Path) -> Path:
    scan = pymupdf.open()
    for page in drawn:
        target = scan.new_page(width=page.rect.width, height=page.rect.height)
        target.insert_image(target.rect, pixmap=page.get_pixmap(dpi=150))
    scan.save(path)
    scan.close()
    return path


def test_scanned_form_with_several_labelled_lines_keeps_its_fields(tmp_path: Path) -> None:
    drawn = pymupdf.open()
    page = drawn.new_page()
    for row, label in enumerate(("Name:", "Address:", "Phone:")):
        y = 100 + row * 40
        page.insert_text((72, y), label)
        page.draw_line((160, y + 2), (420, y + 2))
    page.draw_line((300, 300), (480, 300))
    page.insert_text((300, 314), "Signature", fontsize=9)
    page.draw_rect((72, 340, 84, 352))
    page.insert_text((90, 350), "I agree")
    page.insert_text((72, 385), "Notes")
    page.draw_rect((72, 392, 420, 470))
    result = detect_fields(
        DetectParams(
            path=str(_as_scan(drawn, tmp_path / "scan.pdf")), output=str(tmp_path / "out.pdf")
        ),
        silent_progress(),
    )
    kinds = sorted(field.kind for field in result.fields)
    assert kinds == ["checkbox", "text", "text", "text", "text", "text"]


def test_scanned_single_line_box_becomes_a_text_field(tmp_path: Path) -> None:
    drawn = pymupdf.open()
    page = drawn.new_page()
    page.insert_text((72, 140), "Date:")
    page.draw_rect((150, 125, 300, 145))
    page.insert_text((72, 200), "Office")
    page.draw_rect((150, 185, 300, 205))
    page.insert_text((160, 200), "Ankara")
    result = detect_fields(
        DetectParams(
            path=str(_as_scan(drawn, tmp_path / "boxes.pdf")), output=str(tmp_path / "out.pdf")
        ),
        silent_progress(),
    )
    assert [field.kind for field in result.fields] == ["text"]
    box = result.fields[0]
    assert abs(box.rect[0] - 150) < 3 and abs(box.rect[2] - 300) < 3
    assert abs(box.rect[3] - 146) < 3


def test_slide_and_diagram_pictures_give_no_raster_fields(tmp_path: Path) -> None:
    drawn = pymupdf.open()
    slide = drawn.new_page(width=720, height=540)
    slide.draw_rect(slide.rect, color=None, fill=(0.1, 0.3, 0.7))
    slide.draw_rect((40, 40, 680, 120), color=None, fill=(0.95, 0.6, 0.1))
    slide.insert_text((60, 90), "Quarterly results", fontsize=32, color=(1, 1, 1))
    for row in range(4):
        slide.draw_line((60, 200 + row * 60), (500, 200 + row * 60), color=(1, 1, 1), width=2)
    diagram = drawn.new_page(width=720, height=540)
    diagram.draw_line((100, 100), (620, 100), color=(0.2, 0.3, 0.6), width=1.5)
    for x in (100, 360, 620):
        diagram.draw_line((x, 100), (x, 140), color=(0.2, 0.3, 0.6), width=1.5)
        box = pymupdf.Rect(x - 60, 140, x + 60, 190)
        diagram.draw_rect(box, color=(0.2, 0.3, 0.6), width=1.5, radius=0.2)
        diagram.insert_text((x - 40, 170), "Branch", fontsize=14)
    diagram.draw_line((360, 60), (360, 100), color=(0.2, 0.3, 0.6), width=1.5)
    with pytest.raises(OpError) as caught:
        detect_fields(
            DetectParams(
                path=str(_as_scan(drawn, tmp_path / "slides.pdf")),
                output=str(tmp_path / "out.pdf"),
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS
