from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.ocr import OcrParams, run_ocr
from vivepdf.rpc.progress import silent_progress

FONT = "vivepdf/assets/fonts/DejaVuSans.ttf"
WORDS = "sayfa yan yatmis durumda"


@pytest.fixture
def sideways_scan(tmp_path: Path) -> Path:
    source = pymupdf.open()
    page = source.new_page(width=420, height=595)
    page.insert_text((40, 120), WORDS, fontsize=26, fontfile=FONT, fontname="dv")
    page.insert_text((40, 170), "ikinci satir burada", fontsize=26, fontfile=FONT, fontname="dv")
    pixmap = page.get_pixmap(dpi=150)
    source.close()

    scanned = pymupdf.open()
    sheet = scanned.new_page(width=595, height=420)
    sheet.insert_image(sheet.rect, pixmap=pixmap, rotate=90)
    path = tmp_path / "sideways.pdf"
    scanned.save(path)
    scanned.close()
    return path


def _ocr(sideways_scan: Path, tmp_path: Path, *, orientation: bool):
    target = tmp_path / f"out-{orientation}.pdf"
    result = run_ocr(
        OcrParams(
            path=str(sideways_scan),
            output=str(target),
            languages=["tur"],
            dpi=150,
            orientation=orientation,
        ),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        return result, document[0].get_text()


def test_a_sideways_page_is_turned_before_it_is_read(sideways_scan: Path, tmp_path: Path) -> None:
    result, text = _ocr(sideways_scan, tmp_path, orientation=True)
    assert result.rotated_pages == 1
    assert "yatmis" in text.casefold()


def test_left_alone_it_reads_the_page_sideways(sideways_scan: Path, tmp_path: Path) -> None:
    result, text = _ocr(sideways_scan, tmp_path, orientation=False)
    assert result.rotated_pages == 0
    assert "yatmis" not in text.casefold()


def test_an_upright_page_is_left_where_it_is(tmp_path: Path) -> None:
    source = pymupdf.open()
    page = source.new_page()
    page.insert_text((72, 120), WORDS, fontsize=28, fontfile=FONT, fontname="dv")
    page.insert_text((72, 170), "ikinci satir burada", fontsize=28, fontfile=FONT, fontname="dv")
    pixmap = page.get_pixmap(dpi=150)
    source.close()
    scanned = pymupdf.open()
    sheet = scanned.new_page()
    sheet.insert_image(sheet.rect, pixmap=pixmap)
    upright = tmp_path / "upright.pdf"
    scanned.save(upright)
    scanned.close()

    result, text = _ocr(upright, tmp_path, orientation=True)
    assert result.rotated_pages == 0
    assert "yatmis" in text.casefold()


def test_ideographs_count_towards_the_score() -> None:
    from vivepdf.ops._orientation import word_score

    assert word_score("这是一个中文句子的例子") >= 5
    assert word_score("これは日本語の文章です") >= 5
    assert word_score("Merhaba dünya") == 2
