from pathlib import Path

import pymupdf

from vivepdf.ops.preflight import PreflightParams, check
from vivepdf.rpc.progress import silent_progress


def _pixmap_png(tmp_path: Path, size: int) -> Path:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, size, size), False)
    pixmap.set_rect(pixmap.irect, (120, 40, 40))
    path = tmp_path / f"img{size}.png"
    pixmap.save(path)
    return path


def test_preflight_flags_low_resolution_mixed_sizes_and_annotations(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(pymupdf.Rect(36, 36, 396, 396), filename=str(_pixmap_png(tmp_path, 200)))
    page.insert_text((72, 500), "Baskı", fontname="helv")
    page.add_highlight_annot(pymupdf.Rect(70, 485, 120, 505))
    document.new_page(width=612, height=792)
    document.new_page(width=595, height=842)
    path = tmp_path / "print.pdf"
    document.save(path)
    document.close()

    report = check(PreflightParams(path=str(path)), silent_progress())
    by_id = {item.id: item for item in report.checks}
    assert report.page_count == 3 and report.images == 1
    assert by_id["images"].status == "fail" and report.low_images[0].dpi == 40
    assert by_id["pageSizes"].status == "warn" and report.page_sizes[0] == "210×297"
    assert by_id["annotations"].status == "warn" and report.annotations == 1
    assert by_id["blankPages"].count == 2
    assert report.ready is False


def test_preflight_clean_document_is_ready(sample_pdf: Path) -> None:
    report = check(PreflightParams(path=str(sample_pdf)), silent_progress())
    by_id = {item.id: item for item in report.checks}
    assert by_id["images"].status == "pass" and by_id["pageSizes"].status == "pass"
    assert by_id["fonts"].status == "pass" or by_id["fonts"].count is not None
    assert report.page_sizes == ["210×297"]
