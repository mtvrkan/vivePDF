from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._redact_search import RedactArea
from vivepdf.ops.edit import RedactParams, SearchParams, redact, redact_preview
from vivepdf.ops.flatten import FlattenParams, flatten
from vivepdf.ops.header_footer import HeaderFooterParams, header_footer
from vivepdf.ops.ocr import (
    OcrAreaParams,
    OcrParams,
    OcrSearchableParams,
    OcrTextParams,
    ocr_area,
    ocr_searchable,
    ocr_text,
    run_ocr,
)
from vivepdf.ops.page_numbers import PageNumberParams, number_pages
from vivepdf.ops.repair import RepairParams, repair
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

FONT = "vivepdf/assets/fonts/DejaVuSans.ttf"


@pytest.fixture
def scanned_pdf(tmp_path: Path) -> Path:
    source = pymupdf.open()
    page = source.new_page()
    page.insert_text((72, 120), "Taranmis belge ornegi", fontsize=28, fontfile=FONT, fontname="dv")
    pixmap = page.get_pixmap(dpi=150)
    scanned = pymupdf.open()
    scanned_page = scanned.new_page(width=page.rect.width, height=page.rect.height)
    scanned_page.insert_image(scanned_page.rect, pixmap=pixmap)
    text_page = scanned.new_page()
    text_page.insert_text(
        (72, 100),
        "Bu sayfa zaten metin iceriyor ve OCR gerektirmez.",
        fontsize=12,
        fontfile=FONT,
        fontname="dv",
    )
    path = tmp_path / "scanned.pdf"
    scanned.save(path)
    scanned.close()
    source.close()
    return path


@pytest.fixture
def sensitive_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    lines = [
        "Ad: Ayşe Yılmaz",
        "E-posta: ayse@example.com",
        "TCKN: 12345678950",
        "Telefon: 0532 123 45 67",
        "Gizli not: proje X",
    ]
    for offset, line in enumerate(lines):
        page.insert_text((72, 100 + offset * 24), line, fontsize=12, fontfile=FONT, fontname="dv")
    path = tmp_path / "sensitive.pdf"
    document.save(path)
    document.close()
    return path


def test_ocr_adds_text_layer_and_skips_text_pages(scanned_pdf: Path, tmp_path: Path) -> None:
    result = run_ocr(
        OcrParams(path=str(scanned_pdf), output=str(tmp_path / "ocr.pdf"), dpi=150),
        silent_progress(),
    )
    assert result.page_count == 2 and result.ocr_pages == 1 and result.skipped_pages == 1
    with pymupdf.open(result.output) as document:
        assert "Taranmis" in document[0].get_text()
        assert "OCR gerektirmez" in document[1].get_text()
    forced = run_ocr(
        OcrParams(path=str(scanned_pdf), output=str(tmp_path / "ocr2.pdf"), dpi=150, mode="force"),
        silent_progress(),
    )
    assert forced.ocr_pages == 2


def test_ocr_text_and_missing_language(scanned_pdf: Path, tmp_path: Path) -> None:
    text = ocr_text(OcrTextParams(path=str(scanned_pdf), pages="1", dpi=150), silent_progress())
    assert "Taranmis" in text.text
    with pytest.raises(OpError) as raised:
        run_ocr(
            OcrParams(path=str(scanned_pdf), output=str(tmp_path / "x.pdf"), languages=["jpn"]),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.TESSDATA_MISSING


def test_ocr_area_reads_an_existing_text_layer_without_ocr(scanned_pdf: Path) -> None:
    result = ocr_area(
        OcrAreaParams(path=str(scanned_pdf), page=1, rect=[60, 80, 400, 115]),
        silent_progress(),
    )
    assert result.recognized is False
    assert "metin" in result.text
    assert result.lines and result.lines[0].x1 > result.lines[0].x0


def test_ocr_area_recognises_a_scanned_region(scanned_pdf: Path) -> None:
    result = ocr_area(
        OcrAreaParams(path=str(scanned_pdf), page=0, rect=[50, 85, 500, 145], dpi=200),
        silent_progress(),
    )
    assert result.recognized is True
    assert "belge" in result.text.lower()
    assert all(line.y0 >= 80 and line.y1 <= 150 for line in result.lines)


def test_ocr_area_follows_page_rotation(scanned_pdf: Path, tmp_path: Path) -> None:
    rotated_path = tmp_path / "rotated.pdf"
    with pymupdf.open(scanned_pdf) as document:
        document[1].set_rotation(90)
        document.save(rotated_path)
    with pymupdf.open(rotated_path) as document:
        page = document[1]
        visible = pymupdf.Rect(60, 80, 400, 115) * page.rotation_matrix
        visible.normalize()
    result = ocr_area(
        OcrAreaParams(
            path=str(rotated_path),
            page=1,
            rect=[visible.x0, visible.y0, visible.x1, visible.y1],
        ),
        silent_progress(),
    )
    assert result.recognized is False
    assert "metin" in result.text


def test_ocr_area_rejects_unusable_rects(scanned_pdf: Path) -> None:
    for rect in ([100, 100, 101, 101], [-500, -500, -400, -400]):
        with pytest.raises(OpError) as error:
            ocr_area(OcrAreaParams(path=str(scanned_pdf), page=0, rect=rect), silent_progress())
        assert error.value.code is ErrorCode.INVALID_PARAMS
        assert error.value.data == {"reason": "rect"}
    with pytest.raises(OpError) as missing:
        ocr_area(
            OcrAreaParams(path=str(scanned_pdf), page=9, rect=[10, 10, 200, 200]),
            silent_progress(),
        )
    assert missing.value.data == {"reason": "page"}


def test_ocr_searchable_adds_hidden_text_and_keeps_the_picture(scanned_pdf: Path) -> None:
    with pymupdf.open(scanned_pdf) as document:
        before_images = document[0].get_images()
    result = ocr_searchable(OcrSearchableParams(path=str(scanned_pdf), dpi=200), silent_progress())
    assert result.pages == 1
    assert result.skipped == 1
    assert result.words > 0
    with pymupdf.open(scanned_pdf) as document:
        assert document.page_count == 2
        assert "belge" in document[0].get_text().lower()
        assert len(document[0].get_images()) == len(before_images)


def test_ocr_searchable_leaves_pages_that_already_have_text(scanned_pdf: Path) -> None:
    result = ocr_searchable(
        OcrSearchableParams(path=str(scanned_pdf), pages="2", dpi=150), silent_progress()
    )
    assert result.pages == 0
    assert result.skipped == 1


def test_repair_truncated_pdf(sample_pdf: Path, tmp_path: Path) -> None:
    data = sample_pdf.read_bytes()
    broken = tmp_path / "broken.pdf"
    broken.write_bytes(data[: len(data) - 120])
    result = repair(
        RepairParams(path=str(broken), output=str(tmp_path / "fixed.pdf")), silent_progress()
    )
    assert result.page_count == 3
    with pymupdf.open(result.output) as document:
        assert "Page 1" in document[0].get_text()
    with pytest.raises(OpError) as raised:
        repair(
            RepairParams(path=str(tmp_path / "nope.pdf"), output=str(tmp_path / "y.pdf")),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.FILE_NOT_FOUND


def test_page_numbers_and_header_footer(sample_pdf: Path, tmp_path: Path) -> None:
    numbered = number_pages(
        PageNumberParams(
            path=str(sample_pdf),
            output=str(tmp_path / "n.pdf"),
            template="Sayfa {n} / {total}",
            start=1,
        ),
        silent_progress(),
    )
    with pymupdf.open(numbered.output) as document:
        assert "Sayfa 2 / 3" in document[1].get_text()
    with pytest.raises(OpError):
        number_pages(
            PageNumberParams(
                path=str(sample_pdf), output=str(tmp_path / "bad.pdf"), template="xyz"
            ),
            silent_progress(),
        )
    stamped = header_footer(
        HeaderFooterParams(
            path=str(sample_pdf),
            output=str(tmp_path / "hf.pdf"),
            header_left="{file}",
            footer_right="Gizli {n}",
        ),
        silent_progress(),
    )
    with pymupdf.open(stamped.output) as document:
        text = document[2].get_text()
        assert "sample" in text and "Gizli 3" in text


def test_flatten_bakes_annotations(sample_pdf: Path, tmp_path: Path) -> None:
    with pymupdf.open(sample_pdf) as document:
        document[0].add_freetext_annot(pymupdf.Rect(72, 300, 300, 340), "Not", fontsize=14)
        annotated = tmp_path / "annotated.pdf"
        document.save(annotated)
    result = flatten(
        FlattenParams(path=str(annotated), output=str(tmp_path / "flat.pdf")), silent_progress()
    )
    with pymupdf.open(result.output) as document:
        assert len(list(document[0].annots())) == 0
        assert "Not" in document[0].get_text()


def test_redact_search_presets_and_area(sensitive_pdf: Path, tmp_path: Path) -> None:
    preview = redact_preview(
        SearchParams(path=str(sensitive_pdf), presets=["email", "tckn"], search_text=["proje X"]),
        silent_progress(),
    )
    assert {hit.text for hit in preview.hits} >= {"ayse@example.com", "12345678950", "proje X"}
    result = redact(
        RedactParams(
            path=str(sensitive_pdf),
            output=str(tmp_path / "redacted.pdf"),
            presets=["email", "tckn"],
            search_text=["proje X"],
            areas=[RedactArea(page=1, x0=60, y0=88, x1=400, y1=108)],
        ),
        silent_progress(),
    )
    assert result.redactions >= 4
    with pymupdf.open(result.output) as document:
        text = document[0].get_text()
        assert "example.com" not in text and "12345678950" not in text and "proje X" not in text
        assert "Ayşe" not in text
        assert "Telefon" in text
    with pytest.raises(OpError):
        redact(
            RedactParams(path=str(sensitive_pdf), output=str(tmp_path / "none.pdf")),
            silent_progress(),
        )


def test_redact_preview_respects_case_sensitivity(sensitive_pdf: Path) -> None:
    ignoring_case = redact_preview(
        SearchParams(path=str(sensitive_pdf), search_text=["proje x"]), silent_progress()
    )
    assert ignoring_case.hits
    matching_case = redact_preview(
        SearchParams(path=str(sensitive_pdf), search_text=["proje x"], case_sensitive=True),
        silent_progress(),
    )
    assert matching_case.hits == []
    same_case = redact_preview(
        SearchParams(path=str(sensitive_pdf), search_text=["proje X"], case_sensitive=True),
        silent_progress(),
    )
    assert len(same_case.hits) == len(ignoring_case.hits)


def test_redact_keeps_text_that_differs_only_in_case(sensitive_pdf: Path, tmp_path: Path) -> None:
    result = redact(
        RedactParams(
            path=str(sensitive_pdf),
            output=str(tmp_path / "case.pdf"),
            search_text=["PROJE X"],
            case_sensitive=True,
        ),
        silent_progress(),
    )
    assert result.redactions == 0
    with pymupdf.open(result.output) as document:
        assert "proje X" in document[0].get_text()


def test_ocr_area_reads_the_chosen_region_of_a_turned_scan(
    scanned_pdf: Path, tmp_path: Path
) -> None:
    with pymupdf.open(scanned_pdf) as scanned:
        picture = scanned[0].get_pixmap(dpi=150)
        width, height = scanned[0].rect.width, scanned[0].rect.height
    turned = pymupdf.open()
    page = turned.new_page(width=height, height=width)
    page.set_rotation(90)
    page.insert_image(page.rect * page.derotation_matrix, pixmap=picture, rotate=90)
    turned_path = tmp_path / "turned-scan.pdf"
    turned.save(turned_path)
    turned.close()
    visible = pymupdf.Rect(50, 85, 500, 145)
    result = ocr_area(
        OcrAreaParams(
            path=str(turned_path),
            page=0,
            rect=[visible.x0, visible.y0, visible.x1, visible.y1],
            dpi=200,
        ),
        silent_progress(),
    )
    assert result.recognized is True
    assert "belge" in result.text.lower()
    assert all(
        visible.contains(pymupdf.Rect(line.x0, line.y0, line.x1, line.y1)) for line in result.lines
    )
