from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.preflight import PreflightParams, check
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _pixmap_png(tmp_path: Path, size: int) -> Path:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, size, size), False)
    pixmap.set_rect(pixmap.irect, (120, 40, 40))
    path = tmp_path / f"img{size}.png"
    pixmap.save(path)
    return path


def test_encryption_is_reported_after_the_password_opened_it(encrypted_pdf: Path) -> None:
    report = check(PreflightParams(path=str(encrypted_pdf), password="secret"), silent_progress())
    assert report.encrypted is True
    assert {item.id: item.status for item in report.checks}["encryption"] == "warn"


def test_landscape_pages_of_the_same_paper_are_one_size(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page(width=595, height=842)
    document.new_page(width=842, height=595)
    rotated = document.new_page(width=595, height=842)
    rotated.set_rotation(90)
    path = tmp_path / "orient.pdf"
    document.save(path)
    document.close()
    report = check(PreflightParams(path=str(path)), silent_progress())
    assert report.page_sizes == ["210×297"]


def test_a_page_without_bleed_is_reported_even_when_another_page_has_it(tmp_path: Path) -> None:
    document = pymupdf.open()
    for index in range(2):
        page = document.new_page(width=595, height=842)
        page.draw_rect(page.rect, color=(0, 0, 0), fill=(0.1, 0.2, 0.6))
        if index == 0:
            page.set_mediabox(pymupdf.Rect(0, 0, 613, 860))
            page.set_bleedbox(pymupdf.Rect(0, 0, 613, 860))
            page.set_trimbox(pymupdf.Rect(9, 9, 604, 851))
    path = tmp_path / "bleed.pdf"
    document.save(path)
    document.close()
    report = check(PreflightParams(path=str(path)), silent_progress())
    bleed = next(item for item in report.checks if item.id == "bleed")
    assert report.has_bleed is True and bleed.count == 1 and bleed.status == "warn"


def test_offset_profile_is_stricter_than_digital(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(pymupdf.Rect(36, 36, 136, 136), filename=str(_pixmap_png(tmp_path, 300)))
    path = tmp_path / "rgb.pdf"
    document.save(path)
    document.close()
    digital = check(PreflightParams(path=str(path)), silent_progress())
    offset = check(PreflightParams(path=str(path), profile="offset"), silent_progress())
    digital_status = {item.id: item.status for item in digital.checks}
    offset_status = {item.id: item.status for item in offset.checks}
    assert digital_status["colorSpaces"] == "pass" and digital_status["images"] == "pass"
    assert offset_status["colorSpaces"] == "fail" and offset_status["images"] == "warn"
    assert offset.profile == "offset" and offset.ready is False


def test_type3_fonts_are_not_reported_as_unembedded(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "x")
    font = document.get_new_xref()
    proc = document.get_new_xref()
    document.update_object(proc, "<<>>")
    document.update_stream(proc, b"500 0 0 0 500 500 d1 0 0 500 500 re f")
    document.update_object(
        font,
        "<</Type/Font/Subtype/Type3/Name/T3/FontBBox[0 0 500 500]"
        "/FontMatrix[0.001 0 0 0.001 0 0]"
        f"/CharProcs<</a {proc} 0 R>>/Encoding<</Type/Encoding/Differences[97/a]>>"
        "/FirstChar 97/LastChar 97/Widths[500]>>",
    )
    document.xref_set_key(page.xref, "Resources", f"<</Font<</T3 {font} 0 R>>>>")
    document.update_stream(page.get_contents()[0], b"BT /T3 12 Tf 72 720 Td (a) Tj ET")
    path = tmp_path / "type3.pdf"
    document.save(path)
    document.close()
    report = check(PreflightParams(path=str(path)), silent_progress())
    assert report.unembedded_fonts == []


def test_a_file_without_pages_is_invalid(tmp_path: Path) -> None:
    path = tmp_path / "empty.pdf"
    path.write_bytes(b"%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")
    with pytest.raises(OpError) as error:
        check(PreflightParams(path=str(path)), silent_progress())
    assert error.value.code == ErrorCode.INVALID_PDF
