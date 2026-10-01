from pathlib import Path

import pymupdf

from vivepdf.ops import preflight as preflight_module
from vivepdf.ops.preflight import PreflightParams
from vivepdf.ops.preflight import check as preflight
from vivepdf.rpc.progress import silent_progress


def _status(report, name: str) -> str:
    return next(item.status for item in report.checks if item.id == name)


def _report(path: Path, profile: str = "digital"):
    return preflight(PreflightParams(path=str(path), profile=profile), silent_progress())


def test_a_sideways_image_is_measured_along_its_own_axes(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=400, height=600)
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 600, 200), False)
    page.insert_image(pymupdf.Rect(50, 50, 150, 350), pixmap=pixmap, rotate=90)
    path = tmp_path / "sideways.pdf"
    document.save(path)
    document.close()
    assert _report(path).min_dpi == 144


def test_a_rotated_page_is_checked_against_its_own_edges(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=400, height=600)
    page.draw_rect(pymupdf.Rect(380, 10, 400, 590), color=None, fill=(0, 0, 0))
    page.set_rotation(90)
    path = tmp_path / "rotated.pdf"
    document.save(path)
    document.close()
    report = _report(path)
    assert report.edge_pages == 1
    assert _status(report, "bleed") == "warn"


def test_a_fully_see_through_fill_counts_as_transparency(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().draw_rect(
        pymupdf.Rect(10, 10, 50, 50), color=None, fill=(1, 0, 0), fill_opacity=0
    )
    path = tmp_path / "clear.pdf"
    document.save(path)
    document.close()
    assert _report(path).transparency_pages == 1


def test_see_through_text_counts_as_transparency(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Yarı saydam", fill_opacity=0.5)
    path = tmp_path / "text.pdf"
    document.save(path)
    document.close()
    assert _report(path).transparency_pages == 1


def test_an_opaque_page_has_no_transparency(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Düz metin")
    path = tmp_path / "opaque.pdf"
    document.save(path)
    document.close()
    assert _report(path).transparency_pages == 0


def test_low_images_past_the_listing_limit_are_still_counted(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(preflight_module, "MAX_LOW_IMAGES", 2)
    document = pymupdf.open()
    page = document.new_page()
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 60), False)
    for index, dpi_box in enumerate((200, 150, 100, 60)):
        top = 20 + index * 180
        page.insert_image(pymupdf.Rect(20, top, 20 + dpi_box, top + dpi_box), pixmap=pixmap)
    path = tmp_path / "low.pdf"
    document.save(path)
    document.close()
    report = _report(path)
    assert len(report.low_images) == 2
    assert report.low_image_count == 4
    assert report.min_dpi == 21
    assert _status(report, "images") == "fail"
    assert next(item.count for item in report.checks if item.id == "images") == 4
