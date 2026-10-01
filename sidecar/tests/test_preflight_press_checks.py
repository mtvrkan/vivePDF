from pathlib import Path

import pikepdf
import pymupdf

from vivepdf.ops.preflight import PreflightParams, check
from vivepdf.rpc.progress import silent_progress


def _checks(path: Path, profile: str = "digital") -> dict:
    report = check(PreflightParams(path=str(path), profile=profile), silent_progress())
    return {item.id: item for item in report.checks}


def _save(document: pymupdf.Document, path: Path) -> Path:
    document.save(path)
    document.close()
    return path


def test_checks_list_the_pages_they_found_something_on(tmp_path: Path) -> None:
    document = pymupdf.open()
    for _ in range(3):
        document.new_page(width=595, height=842).insert_text((100, 100), "Body text", fontsize=11)
    document[1].add_text_annot((200, 200), "Note")
    document[2].insert_text((100, 300), "Tiny print", fontsize=4)
    checks = _checks(_save(document, tmp_path / "pages.pdf"))
    assert checks["annotations"].pages == [2]
    assert checks["smallText"].status == "warn"
    assert checks["smallText"].pages == [3]
    assert checks["smallText"].value == "4"
    assert checks["safeZone"].status == "pass"
    assert checks["fonts"].pages == [1, 2, 3]


def test_text_close_to_the_trim_edge_is_outside_the_safe_zone(tmp_path: Path) -> None:
    document = pymupdf.open()
    edge = document.new_page(width=300, height=400)
    edge.insert_text((4, 200), "Edge", fontsize=11)
    trimmed = document.new_page(width=300, height=400)
    trimmed.set_trimbox(pymupdf.Rect(20, 20, 280, 380))
    trimmed.insert_text((24, 200), "Near the trim", fontsize=11)
    trimmed.insert_text((2, 10), "Slug", fontsize=6)
    clear = document.new_page(width=300, height=400)
    clear.set_trimbox(pymupdf.Rect(20, 20, 280, 380))
    clear.insert_text((60, 200), "Safe", fontsize=11)
    checks = _checks(_save(document, tmp_path / "safe.pdf"))
    assert checks["safeZone"].status == "warn"
    assert checks["safeZone"].pages == [1, 2]


def test_safe_zone_follows_an_offset_media_box(tmp_path: Path) -> None:
    document = pymupdf.open()
    for _ in range(2):
        document.new_page(width=300, height=400)
        document.xref_set_key(document[-1].xref, "MediaBox", "[100 100 400 500]")
        document.xref_set_key(document[-1].xref, "TrimBox", "[120 120 380 480]")
    document[0].insert_text((60, 200), "Well inside", fontsize=11)
    document[1].insert_text((23, 200), "At the trim", fontsize=11)
    checks = _checks(_save(document, tmp_path / "offset.pdf"))
    assert checks["safeZone"].pages == [2]


def test_ink_coverage_is_measured_for_press_profiles_only(tmp_path: Path) -> None:
    document = pymupdf.open()
    heavy = document.new_page(width=300, height=400)
    heavy.draw_rect(pymupdf.Rect(50, 50, 250, 250), color=None, fill=(1, 1, 1, 1))
    light = document.new_page(width=300, height=400)
    light.draw_rect(pymupdf.Rect(50, 50, 250, 250), color=None, fill=(0.2, 0, 0, 0))
    path = _save(document, tmp_path / "ink.pdf")
    assert "inkCoverage" not in _checks(path)
    ink = _checks(path, "offset")["inkCoverage"]
    assert ink.status == "fail"
    assert ink.value == "400"
    assert ink.pages == [1]


def test_pdfx_profiles_need_an_output_intent_a_trim_box_and_an_old_enough_version(
    tmp_path: Path,
) -> None:
    document = pymupdf.open()
    page = document.new_page(width=300, height=400)
    page.draw_rect(pymupdf.Rect(50, 50, 250, 250), color=None, fill=(0, 0, 0, 1), fill_opacity=0.5)
    checks = _checks(_save(document, tmp_path / "plain.pdf"), "pdfx1a")
    assert checks["outputIntent"].status == "fail"
    assert checks["trimBox"].status == "fail"
    assert checks["trimBox"].pages == [1]
    assert checks["pdfVersion"].status == "fail"
    assert checks["pdfVersion"].variant == "x1a"
    assert checks["pdfxId"].status == "warn"
    assert checks["transparency"].status == "fail"


def test_a_prepared_pdfx_file_passes_the_pdfx_checks(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=300, height=400)
    page.set_trimbox(pymupdf.Rect(10, 10, 290, 390))
    page.draw_rect(pymupdf.Rect(50, 50, 250, 250), color=None, fill=(0, 0.5, 0, 0))
    source = _save(document, tmp_path / "source.pdf")
    prepared = tmp_path / "x1a.pdf"
    with pikepdf.open(source) as pdf:
        intent = pdf.make_indirect(
            pikepdf.Dictionary(
                Type=pikepdf.Name.OutputIntent,
                S=pikepdf.Name.GTS_PDFX,
                OutputConditionIdentifier=pikepdf.String("FOGRA39"),
            )
        )
        pdf.Root.OutputIntents = pikepdf.Array([intent])
        pdf.docinfo[pikepdf.Name.GTS_PDFXVersion] = pikepdf.String("PDF/X-1a:2001")
        pdf.save(prepared, force_version="1.3")
    report = check(PreflightParams(path=str(prepared), profile="pdfx1a"), silent_progress())
    checks = {item.id: item for item in report.checks}
    assert checks["outputIntent"].status == "pass"
    assert checks["outputIntent"].value == "FOGRA39"
    assert checks["trimBox"].status == "pass"
    assert checks["pdfVersion"].status == "pass"
    assert checks["pdfxId"].status == "pass"
    assert report.pdfx_version == "PDF/X-1a:2001"
    assert report.ready is True


def test_pdfx4_allows_transparency_and_asks_for_managed_rgb(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=300, height=400)
    page.draw_rect(pymupdf.Rect(50, 50, 250, 250), color=None, fill=(0, 0, 0, 1), fill_opacity=0.5)
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 400, 400), False)
    pixmap.set_rect(pixmap.irect, (200, 30, 30))
    page.insert_image(pymupdf.Rect(60, 260, 120, 320), pixmap=pixmap)
    checks = _checks(_save(document, tmp_path / "x4.pdf"), "pdfx4")
    assert checks["transparency"].status == "pass"
    assert checks["transparency"].variant == "allowed"
    assert checks["colorSpaces"].status == "warn"
    assert checks["colorSpaces"].variant == "managed"
    assert checks["colorSpaces"].pages == [1]
    assert _checks(tmp_path / "x4.pdf", "pdfx1a")["colorSpaces"].status == "fail"
