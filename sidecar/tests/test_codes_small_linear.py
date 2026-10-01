from pathlib import Path

import numpy as np
import pymupdf
import pytest
import zxingcpp

from vivepdf.ops.codes import (
    CodesReadParams,
    barcode_regions,
    code_png,
    read_codes,
    read_page_codes,
)
from vivepdf.rpc.progress import silent_progress

FONT_TEXT = "Satır satır uzun bir paragraf metni burada yer alıyor; kodla karışmamalı. " * 3


def _modules(text: str, symbology) -> int:
    barcode = zxingcpp.create_barcode(text, symbology)
    return np.array(zxingcpp.write_barcode_to_image(barcode, scale=1)).shape[1]


def _stamped(
    tmp_path: Path, module_mm: float, code_format: str, rotation: int = 0, name: str = "k.pdf"
) -> tuple[Path, str]:
    text = f"VP-{int(module_mm * 100)}-SEKIL"
    symbology = (
        zxingcpp.BarcodeFormat.Code128
        if code_format == "code128"
        else zxingcpp.BarcodeFormat.Code39
    )
    width = _modules(text, symbology) * module_mm / 25.4 * 72
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for row in range(12):
        page.insert_text((72, 300 + row * 16), FONT_TEXT[:90], fontsize=10)
    page.insert_image(
        pymupdf.Rect(72, 100, 72 + width, 124),
        stream=code_png(text, code_format, "M", "#000000", "#ffffff"),
        keep_proportion=False,
    )
    page.set_rotation(rotation)
    path = tmp_path / name
    document.save(path)
    document.close()
    return path, text


@pytest.mark.parametrize(
    ("module_mm", "code_format"), [(0.2, "code128"), (0.25, "code39"), (0.3, "code39")]
)
def test_small_linear_codes_are_found_by_the_default_pass(
    tmp_path: Path, module_mm: float, code_format: str
) -> None:
    path, text = _stamped(tmp_path, module_mm, code_format, name="küçük kod.pdf")
    found = read_codes(CodesReadParams(path=str(path)), silent_progress())
    assert [code.text for code in found.codes] == [text]
    hit = found.codes[0]
    assert hit.x0 >= 60 and hit.y0 >= 90 and hit.y1 <= 135


def test_the_region_retry_is_what_finds_them(tmp_path: Path) -> None:
    path, _text = _stamped(tmp_path, 0.2, "code128")
    with pymupdf.open(path) as document:
        page = document[0]
        assert not read_page_codes(page, 150)
        regions = barcode_regions(page.get_pixmap(dpi=150, colorspace=pymupdf.csGRAY), 150)
    assert len(regions) == 1
    assert regions[0].contains(pymupdf.Rect(80, 104, 120, 120))


def test_a_code_on_a_turned_page_is_found(tmp_path: Path) -> None:
    path, text = _stamped(tmp_path, 0.2, "code128", rotation=90)
    found = read_codes(CodesReadParams(path=str(path)), silent_progress())
    assert [code.text for code in found.codes] == [text]


def test_plain_text_pages_yield_no_regions() -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for row in range(40):
        page.insert_text((40, 40 + row * 19), FONT_TEXT[:95], fontsize=11)
    pixmap = page.get_pixmap(dpi=150, colorspace=pymupdf.csGRAY)
    assert barcode_regions(pixmap, 150) == []
