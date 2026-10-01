import io
from pathlib import Path

import numpy
import pymupdf
import pytest
from PIL import Image

from vivepdf.ops._raster import (
    background_of,
    coverage_of,
    gain_map,
    lift,
    mark_mask,
    scrubbed_ink,
)
from vivepdf.ops.watermark_detection import DetectWatermarkParams, detect_watermark
from vivepdf.ops.watermark_removal import RemoveWatermarkParams, remove_watermark
from vivepdf.rpc.progress import silent_progress

WIDTH = 480
HEIGHT = 640
BAND = (slice(300, 360), slice(60, 420))
BODY = (slice(80, 130), slice(60, 420))


def _page_frame(number: int, watermark: int | None) -> numpy.ndarray:
    frame = numpy.full((HEIGHT, WIDTH, 3), 246, dtype=numpy.uint8)
    frame[BODY][:, (number * 7) % 40 : (number * 7) % 40 + 180] = 30
    if watermark is not None:
        frame[BAND] = watermark
    return frame


def _scan(path: Path, pages: int, watermark: int | None) -> Path:
    document = pymupdf.open()
    for number in range(pages):
        frame = _page_frame(number, watermark)
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, WIDTH, HEIGHT, frame.tobytes(), False)
        page = document.new_page(width=WIDTH, height=HEIGHT)
        page.insert_image(page.rect, pixmap=pixmap)
    document.save(path)
    document.close()
    return path


@pytest.fixture
def marked_scan(tmp_path: Path) -> Path:
    return _scan(tmp_path / "scan.pdf", 6, 196)


@pytest.fixture
def clean_scan(tmp_path: Path) -> Path:
    return _scan(tmp_path / "clean-scan.pdf", 6, None)


def _rendered(path: Path, index: int) -> numpy.ndarray:
    document = pymupdf.open(path)
    pixmap = document[index].get_pixmap(colorspace=pymupdf.csRGB)
    frame = numpy.frombuffer(pixmap.samples, dtype=numpy.uint8)
    frame = frame.reshape(pixmap.height, pixmap.stride)[:, : pixmap.width * 3]
    frame = frame.reshape(pixmap.height, pixmap.width, 3)
    document.close()
    return frame


def test_a_mark_burned_into_every_page_is_found(marked_scan: Path):
    result = detect_watermark(DetectWatermarkParams(path=str(marked_scan)), silent_progress())
    burned = [candidate for candidate in result.candidates if candidate.kind == "raster"]
    assert len(burned) == 1
    assert burned[0].pages == 6
    assert burned[0].coverage is not None and burned[0].coverage > 0.05
    assert burned[0].preview


def test_a_scan_without_a_repeated_mark_offers_nothing(clean_scan: Path):
    result = detect_watermark(DetectWatermarkParams(path=str(clean_scan)), silent_progress())
    assert not any(candidate.kind == "raster" for candidate in result.candidates)


def test_a_document_that_is_not_a_scan_offers_nothing(tmp_path: Path):
    document = pymupdf.open()
    for number in range(6):
        page = document.new_page(width=WIDTH, height=HEIGHT)
        page.insert_text((60, 100), f"sayfa {number}", fontsize=14)
    path = tmp_path / "text.pdf"
    document.save(path)
    document.close()
    result = detect_watermark(DetectWatermarkParams(path=str(path)), silent_progress())
    assert not any(candidate.kind == "raster" for candidate in result.candidates)


def test_repainting_lifts_the_mark_to_the_paper_and_keeps_the_writing(
    marked_scan: Path, tmp_path: Path
):
    before = _rendered(marked_scan, 0)
    assert before[BAND].mean() < 210
    target = tmp_path / "repainted.pdf"
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(marked_scan),
            output=str(target),
            raster=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert result.repainted_pages == 6
    after = _rendered(target, 0)
    assert after[BAND].mean() > 240
    assert after[BODY].min() < 60
    assert abs(float(after[BAND].mean()) - float(after[20:60, 60:420].mean())) < 8


def test_every_page_of_the_scan_is_repainted(marked_scan: Path, tmp_path: Path):
    target = tmp_path / "repainted.pdf"
    remove_watermark(
        RemoveWatermarkParams(
            path=str(marked_scan),
            output=str(target),
            raster=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    for index in range(6):
        assert _rendered(target, index)[BAND].mean() > 240


def test_the_stack_reads_what_repeats_and_ignores_what_moves():
    stack = numpy.full((5, 40, 60, 3), 250, dtype=numpy.uint8)
    for index in range(5):
        stack[index, 5:10, index * 6 : index * 6 + 6] = 20
    stack[:, 20:30, 10:50] = 190
    background, agreed, paper = background_of(stack)
    mask = mark_mask(background, agreed, paper)
    assert mask[25, 30]
    assert not mask[7, 3]
    assert 0.1 < coverage_of(mask) < 0.25
    gain = gain_map(background, agreed, paper)
    lifted = lift(stack[0], gain)
    assert lifted[25, 30].mean() > 245
    assert lifted[7, 3].mean() < 60


def test_one_picture_shared_by_every_page_is_not_a_scan(tmp_path: Path):
    document = pymupdf.open()
    frame = _page_frame(0, 196)
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, WIDTH, HEIGHT, frame.tobytes(), False)
    xref = 0
    for _number in range(6):
        page = document.new_page(width=WIDTH, height=HEIGHT)
        if xref:
            page.insert_image(page.rect, xref=xref)
        else:
            page.insert_image(page.rect, pixmap=pixmap)
            xref = page.get_images(full=True)[0][0]
    path = tmp_path / "shared.pdf"
    document.save(path)
    document.close()
    result = detect_watermark(DetectWatermarkParams(path=str(path)), silent_progress())
    assert not any(candidate.kind == "raster" for candidate in result.candidates)


def test_a_grey_scan_stays_grey_after_repainting(tmp_path: Path):
    document = pymupdf.open()
    for number in range(5):
        frame = _page_frame(number, 196)[:, :, :1]
        pixmap = pymupdf.Pixmap(pymupdf.csGRAY, WIDTH, HEIGHT, frame.tobytes(), False)
        page = document.new_page(width=WIDTH, height=HEIGHT)
        page.insert_image(page.rect, pixmap=pixmap)
    path = tmp_path / "grey.pdf"
    document.save(path)
    document.close()
    target = tmp_path / "grey-clean.pdf"
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(path),
            output=str(target),
            raster=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert result.repainted_pages == 5
    cleaned = pymupdf.open(target)
    xref = cleaned[0].get_images(full=True)[0][0]
    assert pymupdf.Pixmap(cleaned, xref).n == 1
    cleaned.close()
    assert _rendered(target, 0)[BAND].mean() > 240


def test_the_mark_the_finder_shows_is_the_mark_it_lifts(marked_scan: Path):
    result = detect_watermark(DetectWatermarkParams(path=str(marked_scan)), silent_progress())
    burned = next(candidate for candidate in result.candidates if candidate.kind == "raster")
    assert burned.width is not None and burned.height is not None
    assert max(burned.width, burned.height) <= 192


FAX_WIDTH = 400
FAX_HEIGHT = 560


def _fax_frame(number: int, mark: numpy.ndarray | None) -> numpy.ndarray:
    ink = numpy.zeros((FAX_HEIGHT, FAX_WIDTH), dtype=bool)
    for row in range(6):
        top = 50 + row * 40 + number * 25
        left = 40 + number * 17
        ink[top : top + 12, left : left + 220] = True
    ink[480:488, 60:340] = True
    if mark is not None:
        ink |= mark
    return ink


def _fax_mark() -> numpy.ndarray:
    mark = numpy.zeros((FAX_HEIGHT, FAX_WIDTH), dtype=bool)
    mark[200:340, 60:340] = True
    speckle = numpy.zeros_like(mark)
    speckle[::3, ::3] = True
    return mark & speckle


def _fax(path: Path, pages: int, mark: numpy.ndarray | None) -> Path:
    document = pymupdf.open()
    for number in range(pages):
        ink = _fax_frame(number, mark)
        picture = Image.fromarray(numpy.where(ink, 0, 255).astype(numpy.uint8), mode="L")
        buffer = io.BytesIO()
        picture.convert("1", dither=Image.Dither.NONE).save(buffer, format="png")
        page = document.new_page(width=FAX_WIDTH, height=FAX_HEIGHT)
        page.insert_image(page.rect, stream=buffer.getvalue())
    document.save(path)
    document.close()
    return path


def _ink_at(path: Path, index: int) -> numpy.ndarray:
    document = pymupdf.open(path)
    xref = document[index].get_images(full=True)[0][0]
    pixmap = pymupdf.Pixmap(document, xref)
    buffer = numpy.frombuffer(pixmap.samples, dtype=numpy.uint8)
    rows = buffer.reshape(pixmap.height, pixmap.stride)[:, : pixmap.width]
    ink = rows.reshape(pixmap.height, pixmap.width) < 128
    document.close()
    return ink


@pytest.fixture
def marked_fax(tmp_path: Path) -> Path:
    return _fax(tmp_path / "fax.pdf", 6, _fax_mark())


def test_a_fax_keeps_its_one_bit_depth_after_scrubbing(marked_fax: Path, tmp_path: Path):
    target = tmp_path / "fax-clean.pdf"
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(marked_fax),
            output=str(target),
            raster=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert result.repainted_pages == 6
    document = pymupdf.open(target)
    xref = document[0].get_images(full=True)[0][0]
    assert document.xref_get_key(xref, "BitsPerComponent")[1] == "1"
    document.close()


def test_the_speckled_stamp_goes_and_the_typing_stays(marked_fax: Path, tmp_path: Path):
    target = tmp_path / "fax-clean.pdf"
    remove_watermark(
        RemoveWatermarkParams(
            path=str(marked_fax),
            output=str(target),
            raster=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    mark = _fax_mark()
    before = _ink_at(marked_fax, 0)
    after = _ink_at(target, 0)
    body = _fax_frame(0, None)
    stamp_only = mark & ~body
    assert stamp_only.sum() > 2000
    assert before[stamp_only].sum() == stamp_only.sum()
    assert after[stamp_only].sum() == 0
    assert after[body].sum() >= body.sum() * 0.99


def test_a_solid_rule_printed_on_every_page_is_left_alone(marked_fax: Path, tmp_path: Path):
    target = tmp_path / "fax-clean.pdf"
    remove_watermark(
        RemoveWatermarkParams(
            path=str(marked_fax),
            output=str(target),
            raster=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    rule = numpy.zeros((FAX_HEIGHT, FAX_WIDTH), dtype=bool)
    rule[480:488, 60:340] = True
    assert _ink_at(target, 0)[rule].all()


def test_a_fax_without_a_stamp_is_offered_nothing(tmp_path: Path):
    path = _fax(tmp_path / "plain-fax.pdf", 6, None)
    result = detect_watermark(DetectWatermarkParams(path=str(path)), silent_progress())
    assert not any(candidate.kind == "raster" for candidate in result.candidates)


def test_the_fax_stamp_is_found_and_previewed(marked_fax: Path):
    result = detect_watermark(DetectWatermarkParams(path=str(marked_fax)), silent_progress())
    burned = [candidate for candidate in result.candidates if candidate.kind == "raster"]
    assert len(burned) == 1
    assert burned[0].pages == 6
    assert burned[0].preview


def test_ink_the_stamp_shares_with_the_writing_is_put_back():
    page_ink = numpy.zeros((30, 30), dtype=bool)
    page_ink[10:20, 5:25] = True
    mark = numpy.zeros((30, 30), dtype=bool)
    mark[:, 12:14] = True
    cleaned = scrubbed_ink(page_ink | mark, mark)
    assert cleaned[10:20, 5:25].all()
    assert not cleaned[0:8, 12:14].any()


def test_a_speck_of_the_stamp_beside_a_letter_is_not_put_back():
    page_ink = numpy.zeros((30, 30), dtype=bool)
    page_ink[10:20, 5:10] = True
    mark = numpy.zeros((30, 30), dtype=bool)
    mark[14, 12] = True
    cleaned = scrubbed_ink(page_ink | mark, mark)
    assert cleaned[10:20, 5:10].all()
    assert not cleaned[14, 12]
