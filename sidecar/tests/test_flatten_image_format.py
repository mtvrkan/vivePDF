from pathlib import Path

import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops.flatten import FlattenParams, flatten
from vivepdf.ops.header_footer import HeaderFooterParams, header_footer
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def photo_page(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for step in range(0, 595, 7):
        page.draw_rect(
            pymupdf.Rect(step, 0, step + 7, 842),
            color=None,
            fill=((step % 255) / 255, ((step * 3) % 255) / 255, ((step * 7) % 255) / 255),
        )
    page.insert_text((60, 400), "Fotoğraf sayfası", fontsize=24)
    path = tmp_path / "fotoğraf.pdf"
    document.save(path)
    document.close()
    return path


def _image_filters(path: Path) -> list[str]:
    document = pymupdf.open(path)
    filters = [
        document.xref_get_key(xref, "Filter")[1]
        for page in document
        for xref, *_rest in page.get_images(full=True)
    ]
    document.close()
    return filters


def _flatten(source: Path, target: Path, **options) -> Path:
    flatten(
        FlattenParams(path=str(source), output=str(target), rasterize=True, dpi=100, **options),
        silent_progress(),
    )
    return target


@pytest.fixture
def noisy_photo(tmp_path: Path) -> Path:
    import random

    generator = random.Random(7)
    width, height = 300, 420
    samples = bytes(
        max(
            0,
            min(
                255,
                (x * 180 // width + y * 60 // height + channel * 40) + generator.randrange(-12, 13),
            ),
        )
        for y in range(height)
        for x in range(width)
        for channel in range(3)
    )
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, width, height, samples, False)
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(page.rect, pixmap=pixmap)
    path = tmp_path / "gürültü.pdf"
    document.save(path)
    document.close()
    return path


def test_photographic_pages_become_jpeg_by_default(noisy_photo: Path, tmp_path: Path):
    target = _flatten(noisy_photo, tmp_path / "auto.pdf")
    assert _image_filters(target) == ["/DCTDecode"]


def test_jpeg_can_be_forced(photo_page: Path, tmp_path: Path):
    target = _flatten(photo_page, tmp_path / "jpeg.pdf", image_format="jpeg")
    assert _image_filters(target) == ["/DCTDecode"]


def test_lossless_pages_can_still_be_chosen(photo_page: Path, tmp_path: Path):
    target = _flatten(photo_page, tmp_path / "png.pdf", image_format="png")
    assert _image_filters(target) == ["/FlateDecode"]


def test_lower_jpeg_quality_gives_a_smaller_file(photo_page: Path, tmp_path: Path):
    high = _flatten(photo_page, tmp_path / "high.pdf", image_format="jpeg", jpeg_quality=95)
    low = _flatten(photo_page, tmp_path / "low.pdf", image_format="jpeg", jpeg_quality=40)
    assert low.stat().st_size < high.stat().st_size


def test_jpeg_quality_outside_range_is_refused(photo_page: Path, tmp_path: Path):
    with pytest.raises(ValidationError):
        FlattenParams(path=str(photo_page), output=str(tmp_path / "x.pdf"), jpeg_quality=10)


def _spans(path: Path) -> list[tuple[str, pymupdf.Rect]]:
    document = pymupdf.open(path)
    found = [
        (span["text"], pymupdf.Rect(span["bbox"]))
        for block in document[0].get_text("dict")["blocks"]
        for line in block.get("lines", [])
        for span in line["spans"]
    ]
    document.close()
    return found


@pytest.fixture
def blank(tmp_path: Path) -> Path:
    document = pymupdf.open()
    document.new_page(width=595, height=842)
    path = tmp_path / "boş.pdf"
    document.save(path)
    document.close()
    return path


def test_a_multi_line_footer_stays_inside_the_bottom_margin(blank: Path, tmp_path: Path):
    result = header_footer(
        HeaderFooterParams(
            path=str(blank),
            output=str(tmp_path / "footer.pdf"),
            footer_right="Uzun birinci satır metni\nİki\nÜç",
            margin=28,
        ),
        silent_progress(),
    )
    spans = dict(_spans(Path(result.output)))
    assert set(spans) == {"Uzun birinci satır metni", "İki", "Üç"}
    assert max(rect.y1 for rect in spans.values()) <= 842 - 28 + 3
    assert spans["Uzun birinci satır metni"].y0 < spans["İki"].y0 < spans["Üç"].y0
    for rect in spans.values():
        assert rect.x1 == pytest.approx(595 - 28, abs=1.5)


def test_a_multi_line_header_is_aligned_per_line(blank: Path, tmp_path: Path):
    result = header_footer(
        HeaderFooterParams(
            path=str(blank),
            output=str(tmp_path / "header.pdf"),
            header_center="Kısa\nÇok daha uzun ikinci satır\n",
            margin=28,
        ),
        silent_progress(),
    )
    spans = dict(_spans(Path(result.output)))
    assert set(spans) == {"Kısa", "Çok daha uzun ikinci satır"}
    for rect in spans.values():
        assert (rect.x0 + rect.x1) / 2 == pytest.approx(595 / 2, abs=1.5)
    assert min(rect.y0 for rect in spans.values()) >= 28 - 3


@pytest.fixture
def text_page(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for line in range(40):
        page.insert_text((60, 60 + line * 18), "Metin satırı " * 6, fontsize=11)
    path = tmp_path / "metin.pdf"
    document.save(path)
    document.close()
    return path


def test_auto_keeps_a_text_page_lossless_when_that_is_smaller(text_page: Path, tmp_path: Path):
    auto = _flatten(text_page, tmp_path / "auto.pdf", image_format="auto")
    jpeg = _flatten(text_page, tmp_path / "jpeg.pdf", image_format="jpeg")
    assert _image_filters(auto) == ["/FlateDecode"]
    assert auto.stat().st_size <= jpeg.stat().st_size
