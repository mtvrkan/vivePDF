from pathlib import Path

import numpy
import pymupdf
import pytest

from vivepdf.ops.watermark_detection import DetectWatermarkParams, detect_watermark
from vivepdf.ops.watermark_removal import (
    RemoveWatermarkParams,
    RemoveWatermarkResult,
    remove_watermark,
)
from vivepdf.rpc.progress import silent_progress

WIDTH = 400
HEIGHT = 560


def _body(number: int) -> numpy.ndarray:
    ink = numpy.zeros((HEIGHT, WIDTH), dtype=bool)
    for row in range(6):
        top = 50 + row * 40 + number * 25
        left = 40 + number * 17
        ink[top : top + 12, left : left + 220] = True
    ink[480:488, 60:340] = True
    return ink


def _speckled_stamp() -> numpy.ndarray:
    mark = numpy.zeros((HEIGHT, WIDTH), dtype=bool)
    mark[200:340, 60:340] = True
    speckle = numpy.zeros_like(mark)
    speckle[::3, ::3] = True
    return mark & speckle


def _solid_stamp() -> numpy.ndarray:
    mark = numpy.zeros((HEIGHT, WIDTH), dtype=bool)
    mark[380:440, 250:370] = True
    return mark


def _stencil_fax(path: Path, mark: numpy.ndarray, decode: str | None) -> Path:
    document = pymupdf.open()
    for number in range(6):
        ink = _body(number) | mark
        painted = ink if decode == "[1 0]" else ~ink
        packed = numpy.packbits(painted.astype(numpy.uint8), axis=1).tobytes()
        page = document.new_page(width=WIDTH, height=HEIGHT)
        image = document.get_new_xref()
        extra = f"/Decode {decode}" if decode else ""
        document.update_object(
            image,
            f"<</Type/XObject/Subtype/Image/Width {WIDTH}/Height {HEIGHT}"
            f"/ImageMask true/BitsPerComponent 1{extra}>>",
        )
        document.update_stream(image, packed, compress=True)
        document.xref_set_key(page.xref, "Resources", f"<</XObject<</Im1 {image} 0 R>>>>")
        content = document.get_new_xref()
        document.update_object(content, "<<>>")
        document.update_stream(
            content, f"q 0 0 0 rg {WIDTH} 0 0 {HEIGHT} 0 0 cm /Im1 Do Q".encode()
        )
        document.xref_set_key(page.xref, "Contents", f"{content} 0 R")
    document.save(path)
    document.close()
    return path


def _painted(path: Path, index: int) -> numpy.ndarray:
    with pymupdf.open(path) as document:
        pixmap = document[index].get_pixmap(colorspace=pymupdf.csGRAY, alpha=False)
        buffer = numpy.frombuffer(pixmap.samples, dtype=numpy.uint8)
        rows = buffer.reshape(pixmap.height, pixmap.stride)[:, : pixmap.width]
        return rows < 128


def _remove(source: Path, target: Path) -> RemoveWatermarkResult:
    return remove_watermark(
        RemoveWatermarkParams(
            path=str(source),
            output=str(target),
            raster=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )


@pytest.mark.parametrize("decode", [None, "[1 0]"])
def test_a_stencil_scan_is_scrubbed_and_stays_a_stencil(tmp_path: Path, decode: str | None) -> None:
    source = _stencil_fax(tmp_path / "stencil.pdf", _speckled_stamp(), decode)
    before = _painted(source, 0)
    result = _remove(source, tmp_path / "temiz.pdf")
    assert result.repainted_pages == 6
    with pymupdf.open(result.output) as document:
        xref = document[0].get_images(full=True)[0][0]
        assert document.xref_get_key(xref, "ImageMask")[1] == "true"
        assert document.xref_get_key(xref, "BitsPerComponent")[1] == "1"
        if decode:
            assert document.xref_get_key(xref, "Decode")[1].replace(" ", "") == "[10]"
    after = _painted(result.output, 0)
    body = _body(0)
    stamp_only = _speckled_stamp() & ~body
    assert before[stamp_only].sum() == stamp_only.sum()
    assert after[stamp_only].sum() == 0
    assert after[body].sum() >= body.sum() * 0.99
    assert not after[~(body | _speckled_stamp())].any()


def test_a_stencil_scan_stamp_is_offered_by_the_finder(tmp_path: Path) -> None:
    source = _stencil_fax(tmp_path / "stencil.pdf", _speckled_stamp(), None)
    result = detect_watermark(DetectWatermarkParams(path=str(source)), silent_progress())
    burned = [candidate for candidate in result.candidates if candidate.kind == "raster"]
    assert len(burned) == 1 and burned[0].pages == 6


def test_solid_repeated_ink_is_left_and_reported(tmp_path: Path) -> None:
    source = _stencil_fax(tmp_path / "solid.pdf", _solid_stamp(), None)
    result = _remove(source, tmp_path / "temiz.pdf")
    assert result.repainted_pages == 0
    assert result.solid_ink_pages == 6
    assert _painted(result.output, 0)[_solid_stamp()].all()


def test_a_scan_with_no_repeated_solid_ink_reports_none(tmp_path: Path) -> None:
    source = _stencil_fax(tmp_path / "noktali.pdf", _speckled_stamp(), None)
    with pymupdf.open(source) as document:
        for page in document:
            xref = page.get_images(full=True)[0][0]
            ink = _body(page.number) | _speckled_stamp()
            ink[480:488, 60:340] = False
            packed = numpy.packbits((~ink).astype(numpy.uint8), axis=1).tobytes()
            document.update_stream(xref, packed, compress=True)
        document.save(tmp_path / "kuralsiz.pdf")
    result = _remove(tmp_path / "kuralsiz.pdf", tmp_path / "temiz.pdf")
    assert result.repainted_pages == 6
    assert result.solid_ink_pages == 0
