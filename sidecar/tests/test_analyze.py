from pathlib import Path

import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops.analyze import (
    AnalyzeParams,
    FingerprintParams,
    ImposeParams,
    analyze,
    fingerprint,
    impose,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


def _analysis_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    document.new_page(width=595, height=842)
    text_page = document.new_page(width=595, height=842)
    text_page.insert_text((72, 72), "Hello world " * 20)
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 200), False)
    pixmap.set_rect(pixmap.irect, (0, 0, 0))
    image = tmp_path / "black.png"
    pixmap.save(image)
    image_page = document.new_page(width=595, height=842)
    image_page.insert_image(image_page.rect, filename=str(image))
    path = tmp_path / "analysis.pdf"
    document.save(path)
    document.close()
    return path


def test_analyze_detects_blank_text_and_scanned_pages(tmp_path: Path) -> None:
    path = _analysis_pdf(tmp_path)
    result = analyze(AnalyzeParams(path=str(path)), silent_progress())
    assert result.page_count == 3
    assert result.blank_pages == [0]
    assert result.scanned_pages == [2]
    assert result.pages[0].blank is True
    assert result.pages[0].has_text is False
    assert result.pages[1].has_text is True
    assert result.pages[1].blank is False
    assert result.pages[2].scanned is True


def test_analyze_finds_a_scanned_blank_sheet(tmp_path: Path) -> None:
    document = pymupdf.open()
    for _ in range(2):
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 620, 877), False)
        pixmap.set_rect(pixmap.irect, (238, 236, 230))
        page = document.new_page(width=595, height=842)
        page.insert_image(page.rect, pixmap=pixmap)
    document[1].draw_rect(pymupdf.Rect(100, 100, 400, 140), color=(0, 0, 0), fill=(0, 0, 0))
    path = tmp_path / "scan.pdf"
    document.save(path)
    document.close()
    result = analyze(AnalyzeParams(path=str(path)), silent_progress())
    assert result.blank_pages == [0]
    assert result.scanned_pages == [0, 1]


def test_impose_2up_page_count(sample_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "imposed.pdf"
    result = impose(
        ImposeParams(path=str(sample_pdf), output=str(output), layout="2up"),
        silent_progress(),
    )
    assert result.page_count == 2


def test_impose_booklet_page_count_is_multiple_of_two(sample_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "booklet.pdf"
    result = impose(
        ImposeParams(path=str(sample_pdf), output=str(output), layout="booklet"),
        silent_progress(),
    )
    assert result.page_count == 2
    assert result.page_count % 2 == 0


def test_impose_rejects_invalid_layout() -> None:
    with pytest.raises(ValidationError):
        ImposeParams(path="a.pdf", output="b.pdf", layout="7up")


def test_analyze_treats_a_page_number_or_left_blank_note_as_blank(
    tmp_path: Path,
) -> None:
    document = pymupdf.open()
    numbered = document.new_page(width=595, height=842)
    numbered.insert_text((290, 820), "12", fontsize=9)
    noted = document.new_page(width=595, height=842)
    noted.insert_text((200, 420), "This page intentionally left blank", fontsize=9)
    worded = document.new_page(width=595, height=842)
    worded.insert_text((72, 72), "Summary", fontsize=9)
    path = tmp_path / "numbered.pdf"
    document.save(path)
    document.close()
    result = analyze(AnalyzeParams(path=str(path)), silent_progress())
    assert result.blank_pages == [0, 1]
    assert result.pages[0].has_text is True


def test_analyze_rejects_a_missing_file(tmp_path: Path) -> None:
    from vivepdf.rpc.errors import OpError

    with pytest.raises(OpError):
        analyze(AnalyzeParams(path=str(tmp_path / "missing.pdf")), silent_progress())


def test_fingerprint_matches_a_copied_page_and_skips_blank_ones(tmp_path: Path) -> None:
    document = pymupdf.open()
    for text in ("Chapter one", "Chapter two"):
        document.new_page(width=595, height=842).insert_text((72, 72), text)
    document.new_page(width=595, height=842)
    document.fullcopy_page(0)
    path = tmp_path / "copies.pdf"
    document.save(path)
    document.close()
    result = fingerprint(FingerprintParams(path=str(path)), silent_progress())
    first, second, blank, copy = result.fingerprints
    assert result.page_count == 4
    assert first is not None and first == copy
    assert second is not None and second != first
    assert blank is None


def test_fingerprint_tells_apart_pages_that_differ_only_in_text(tmp_path: Path) -> None:
    document = pymupdf.open()
    for text in ("Invoice 1001", "Invoice 1002"):
        document.new_page(width=595, height=842).insert_text((72, 72), text)
    path = tmp_path / "invoices.pdf"
    document.save(path)
    document.close()
    first, second = fingerprint(FingerprintParams(path=str(path)), silent_progress()).fingerprints
    assert first != second


def test_fingerprint_of_a_missing_file_is_an_op_error(tmp_path: Path) -> None:
    with pytest.raises(OpError):
        fingerprint(FingerprintParams(path=str(tmp_path / "nope.pdf")), silent_progress())
