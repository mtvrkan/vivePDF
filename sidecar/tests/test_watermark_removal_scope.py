import math
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.watermark_removal import RemoveWatermarkParams, remove_watermark
from vivepdf.rpc.progress import silent_progress

WIDTH, HEIGHT = 595, 842
FONTS = ("helv", "tiro")


@pytest.fixture
def logo_png(tmp_path: Path) -> Path:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 100), False)
    pixmap.set_rect(pixmap.irect, (0, 120, 60))
    path = tmp_path / "logo.png"
    pixmap.save(path)
    return path


def _body(page: pymupdf.Page, sentence: str) -> None:
    for row in range(12):
        page.insert_text((72, 120 + row * 18), f"{sentence} line {row}.", fontsize=11)


def _diagonal(page: pymupdf.Page, text: str, size: float = 60) -> None:
    angle = math.radians(45)
    start = pymupdf.Point(150, 560)
    direction = pymupdf.Point(math.cos(angle), -math.sin(angle))
    x = 0.0
    for position, letter in enumerate(text):
        point = start + direction * x
        font = FONTS[position % 2]
        page.insert_text(
            point,
            letter,
            fontsize=size,
            fontname=font,
            color=(0.7, 0.7, 0.7),
            morph=(point, pymupdf.Matrix(45)),
        )
        x += pymupdf.get_text_length(letter, fontsize=size, fontname=font)


def _text(path: str) -> str:
    with pymupdf.open(path) as document:
        return "\n".join(page.get_text() for page in document)


def test_the_same_word_in_the_body_is_kept(tmp_path: Path) -> None:
    document = pymupdf.open()
    for _ in range(3):
        page = document.new_page(width=WIDTH, height=HEIGHT)
        _body(page, "This agreement is confidential")
        page.insert_text(
            (150, 600),
            "CONFIDENTIAL",
            fontsize=64,
            color=(0.8, 0.8, 0.8),
            morph=(pymupdf.Point(150, 600), pymupdf.Matrix(45)),
        )
    source = tmp_path / "marked.pdf"
    document.save(source)
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source),
            output=str(tmp_path / "clean.pdf"),
            texts=["CONFIDENTIAL"],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    text = _text(result.output)
    assert "CONFIDENTIAL" not in text
    assert text.count("This agreement is confidential") == 36
    assert result.removed_text == 3


def test_a_watermark_drawn_letter_by_letter_goes_and_the_body_stays(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=WIDTH, height=HEIGHT)
    _body(page, "Ordinary body text under the mark")
    _diagonal(page, "DRAFT")
    source = tmp_path / "letters.pdf"
    document.save(source)
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source),
            output=str(tmp_path / "clean.pdf"),
            texts=["DRAFT"],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    text = _text(result.output)
    assert not any(letter in text for letter in "DRF")
    assert text.count("Ordinary body text under the mark") == 12


def test_a_plain_heading_in_the_body_text_size_is_not_a_mark(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=WIDTH, height=HEIGHT)
    _body(page, "Terms that stay confidential between us")
    source = tmp_path / "plain.pdf"
    document.save(source)
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source),
            output=str(tmp_path / "clean.pdf"),
            texts=["confidential"],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert result.removed_text == 0
    assert _text(result.output).count("confidential") == 12


def test_a_shared_picture_stays_on_pages_outside_the_range(tmp_path: Path, logo_png: Path) -> None:
    document = pymupdf.open()
    mark = pymupdf.Rect(150, 300, 450, 600)
    xref = 0
    for _ in range(5):
        page = document.new_page(width=WIDTH, height=HEIGHT)
        page.insert_text((72, 72), "Body")
        if xref:
            page.insert_image(mark, xref=xref)
        else:
            xref = page.insert_image(mark, filename=str(logo_png))
    source = tmp_path / "logo.pdf"
    document.save(source)
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source), output=str(tmp_path / "clean.pdf"), annotations=False, pages="1-3"
        ),
        silent_progress(),
    )
    assert result.removed_images == 3
    with pymupdf.open(result.output) as cleaned:
        drawn = [bool(cleaned[index].get_image_info()) for index in range(5)]
    assert drawn == [False, False, False, True, True]


def test_the_whole_document_still_replaces_the_shared_picture(
    tmp_path: Path, logo_png: Path
) -> None:
    document = pymupdf.open()
    mark = pymupdf.Rect(150, 300, 450, 600)
    xref = 0
    for _ in range(4):
        page = document.new_page(width=WIDTH, height=HEIGHT)
        if xref:
            page.insert_image(mark, xref=xref)
        else:
            xref = page.insert_image(mark, filename=str(logo_png))
    source = tmp_path / "logo.pdf"
    document.save(source)
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source), output=str(tmp_path / "clean.pdf"), annotations=False
        ),
        silent_progress(),
    )
    assert result.removed_images == 4
    with pymupdf.open(result.output) as cleaned:
        for page in cleaned:
            pixmap = page.get_pixmap(clip=mark)
            assert pixmap.samples.count(255) == len(pixmap.samples)
