from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.privacy import InspectParams, inspect
from vivepdf.ops.privacy_sanitize import SanitizeParams, sanitize
from vivepdf.ops.stamp import StampParams, StampPreviewParams, stamp, stamp_preview
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

LONG_STAMP = "BU BELGE SIRKET ICI KULLANIM ICINDIR - DAGITILAMAZ - KOPYALANAMAZ"


def _pages(tmp_path: Path, name: str, count: int, width: float, height: float) -> Path:
    document = pymupdf.open()
    for index in range(count):
        document.new_page(width=width, height=height).insert_text(
            (40, 80), f"Sayfa {index + 1}", fontsize=11
        )
    path = tmp_path / name
    document.save(path)
    document.close()
    return path


def _mark_box(path: Path, needle: str) -> tuple[pymupdf.Rect | None, pymupdf.Rect]:
    document = pymupdf.open(path)
    page = document[0]
    box: pymupdf.Rect | None = None
    for quad in page.search_for(needle, quads=True):
        box = quad.rect if box is None else (box | quad.rect)
    page_rect = pymupdf.Rect(page.rect)
    document.close()
    return box, page_rect


def test_a_stamp_wider_than_the_page_is_shrunk_to_fit(tmp_path: Path):
    source = _pages(tmp_path, "wide.pdf", 2, 595, 842)
    target = tmp_path / "wide-stamped.pdf"
    stamp(
        StampParams(path=str(source), output=str(target), text=LONG_STAMP, font_size=28),
        silent_progress(),
    )
    box, page_rect = _mark_box(target, "SIRKET")
    assert box is not None
    assert box in page_rect + (-1, -1, 1, 1)


def test_a_huge_font_stays_on_the_page(tmp_path: Path):
    source = _pages(tmp_path, "huge.pdf", 1, 595, 842)
    target = tmp_path / "huge-stamped.pdf"
    stamp(
        StampParams(
            path=str(source), output=str(target), text="TASLAK", font_size=200, position="center"
        ),
        silent_progress(),
    )
    box, page_rect = _mark_box(target, "TASLAK")
    assert box is not None
    assert box in page_rect + (-1, -1, 1, 1)


def test_a_margin_bigger_than_the_page_still_leaves_the_stamp_visible(tmp_path: Path):
    source = _pages(tmp_path, "tiny.pdf", 1, 300, 420)
    target = tmp_path / "tiny-stamped.pdf"
    stamp(
        StampParams(
            path=str(source),
            output=str(target),
            text="ONAY",
            margin=100,
            position="bottom-right",
        ),
        silent_progress(),
    )
    box, page_rect = _mark_box(target, "ONAY")
    assert box is not None
    assert box in page_rect + (-1, -1, 1, 1)


def test_an_invalid_colour_is_refused(tmp_path: Path):
    source = _pages(tmp_path, "colour.pdf", 1, 595, 842)
    with pytest.raises(OpError) as caught:
        stamp(
            StampParams(
                path=str(source), output=str(tmp_path / "colour-out.pdf"), text="ONAY", color="mavi"
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_a_blank_stamp_draws_nothing_instead_of_an_empty_frame(tmp_path: Path):
    source = _pages(tmp_path, "blank.pdf", 1, 595, 842)
    with pytest.raises(OpError) as caught:
        stamp(
            StampParams(path=str(source), output=str(tmp_path / "blank-out.pdf"), text="   "),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    with pytest.raises(OpError):
        stamp_preview(StampPreviewParams(path=str(source), text="  "), silent_progress())


def test_a_placeholder_that_renders_empty_is_not_stamped(tmp_path: Path):
    source = _pages(tmp_path, "token.pdf", 2, 595, 842)
    target = tmp_path / "token-out.pdf"
    result = stamp(
        StampParams(path=str(source), output=str(target), text="{name}", name=""),
        silent_progress(),
    )
    document = pymupdf.open(target)
    drawings = sum(len(document[index].get_drawings()) for index in range(document.page_count))
    document.close()
    assert result.stamped == 0
    assert drawings == 0


def test_a_file_attachment_is_gone_after_the_privacy_clean(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((40, 80), "govde", fontsize=11)
    page.add_file_annot(pymupdf.Point(200, 200), b"COKGIZLIICERIK", "ek.txt")
    source = tmp_path / "attach.pdf"
    document.save(source)
    document.close()

    target = tmp_path / "attach-clean.pdf"
    result = sanitize(SanitizeParams(path=str(source), output=str(target)), silent_progress())
    after = inspect(InspectParams(path=str(target)), silent_progress())
    assert result.removed.get("fileAttachments") == 1
    assert after.file_attachments == 0
    assert b"COKGIZLIICERIK" not in target.read_bytes()


def test_sanitize_refuses_an_empty_selection(tmp_path: Path):
    source = _pages(tmp_path, "nothing.pdf", 1, 595, 842)
    with pytest.raises(OpError) as caught:
        sanitize(
            SanitizeParams(
                path=str(source),
                output=str(tmp_path / "nothing-out.pdf"),
                metadata=False,
                xmp_metadata=False,
                javascript=False,
                embedded_files=False,
                file_attachments=False,
                annotations=False,
                links=False,
                thumbnails=False,
                reset_forms=False,
                image_metadata=False,
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_document_level_javascript_is_found_and_removed(tmp_path: Path):
    source = _pages(tmp_path, "js.pdf", 1, 595, 842)
    document = pymupdf.open(source)
    xref = document.get_new_xref()
    document.update_object(xref, "<< /S /JavaScript /JS (app.alert\\('x'\\);) >>")
    document.xref_set_key(document.pdf_catalog(), "OpenAction", f"{xref} 0 R")
    document.saveIncr()
    document.close()

    before = inspect(InspectParams(path=str(source)), silent_progress())
    target = tmp_path / "js-clean.pdf"
    sanitize(SanitizeParams(path=str(source), output=str(target)), silent_progress())
    after = inspect(InspectParams(path=str(target)), silent_progress())
    assert before.javascript == 1
    assert after.javascript == 0
    assert b"app.alert" not in target.read_bytes()


def test_clearing_form_values_empties_them_but_keeps_the_fields(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    widget = pymupdf.Widget()
    widget.field_name = "adsoyad"
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.rect = pymupdf.Rect(40, 400, 300, 430)
    widget.field_value = "Ali Veli"
    page.add_widget(widget)
    source = tmp_path / "form.pdf"
    document.save(source)
    document.close()

    target = tmp_path / "form-clean.pdf"
    sanitize(
        SanitizeParams(path=str(source), output=str(target), reset_forms=True), silent_progress()
    )
    cleaned = pymupdf.open(target)
    values = [widget.field_value for widget in cleaned[0].widgets()]
    cleaned.close()
    assert values == [""]


def test_sanitize_reports_what_it_verified_not_what_it_measured(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 100), "gorunur metin", fontsize=12)
    document.set_metadata({"title": "Gizli", "author": "Biri"})
    source = tmp_path / "meta.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "clean.pdf"
    result = sanitize(
        SanitizeParams(
            path=str(source),
            output=str(target),
            annotations=True,
            links=True,
        ),
        silent_progress(),
    )
    assert result.removed.get("metadata") == 2
    assert "annotations" not in result.removed
    assert "links" not in result.removed
    again = inspect(InspectParams(path=str(target)), silent_progress())
    assert again.metadata == {}
