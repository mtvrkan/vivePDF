from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.page_geometry import CropParams, Insets, crop_pages
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture
def boxed_pages(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for _ in range(4):
        page = document.new_page(width=595, height=842)
        page.draw_rect(pymupdf.Rect(150, 250, 445, 560), fill=(0.2, 0.4, 0.8))
    path = tmp_path / "boxed.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def edged_page(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((60, 60), "UST KENAR", fontsize=12, fontname="dejavu", fontfile=FONT)
    page.insert_text((60, 400), "ORTA ICERIK", fontsize=14, fontname="dejavu", fontfile=FONT)
    page.insert_text((60, 800), "ALT KENAR", fontsize=12, fontname="dejavu", fontfile=FONT)
    path = tmp_path / "edged.pdf"
    document.save(path)
    document.close()
    return path


def _sizes(path: Path) -> list[tuple[float, float]]:
    document = pymupdf.open(path)
    sizes = [
        (round(document[index].rect.width, 1), round(document[index].rect.height, 1))
        for index in range(document.page_count)
    ]
    document.close()
    return sizes


def _text_ignoring_the_crop(path: Path) -> str:
    document = pymupdf.open(path)
    page = document[0]
    page.set_cropbox(page.mediabox)
    text = page.get_text()
    document.close()
    return text


def test_auto_crop_finds_the_content_and_drops_the_white_margin(boxed_pages: Path, tmp_path: Path):
    target = tmp_path / "auto.pdf"
    result = crop_pages(
        CropParams(path=str(boxed_pages), output=str(target), mode="auto", auto_margin=6),
        silent_progress(),
    )
    assert result.cropped == 4
    width, height = _sizes(target)[0]
    assert 300 < width < 320
    assert 315 < height < 335


def test_auto_crop_leaves_a_blank_page_alone(tmp_path: Path):
    document = pymupdf.open()
    document.new_page(width=595, height=842)
    source = tmp_path / "blank.pdf"
    document.save(source)
    document.close()

    target = tmp_path / "blank-cropped.pdf"
    result = crop_pages(
        CropParams(path=str(source), output=str(target), mode="auto"), silent_progress()
    )
    assert result.cropped == 0
    assert _sizes(target) == [(595.0, 842.0)]


def test_cropping_odd_pages_only_leaves_the_even_ones_untouched(boxed_pages: Path, tmp_path: Path):
    target = tmp_path / "odd.pdf"
    result = crop_pages(
        CropParams(
            path=str(boxed_pages),
            output=str(target),
            side="odd",
            insets=Insets(left=40, top=40, right=40, bottom=40),
        ),
        silent_progress(),
    )
    assert result.cropped == 2
    sizes = _sizes(target)
    assert sizes[0] == (515.0, 762.0)
    assert sizes[1] == (595.0, 842.0)


def test_a_plain_crop_only_hides_the_margin(edged_page: Path, tmp_path: Path):
    target = tmp_path / "hidden.pdf"
    crop_pages(
        CropParams(
            path=str(edged_page),
            output=str(target),
            insets=Insets(top=200, bottom=200),
        ),
        silent_progress(),
    )
    assert "UST KENAR" in _text_ignoring_the_crop(target)


def test_removing_the_cropped_content_takes_the_margin_text_with_it(
    edged_page: Path, tmp_path: Path
):
    target = tmp_path / "removed.pdf"
    crop_pages(
        CropParams(
            path=str(edged_page),
            output=str(target),
            insets=Insets(top=200, bottom=200),
            remove_content=True,
        ),
        silent_progress(),
    )
    recovered = _text_ignoring_the_crop(target)
    assert "UST KENAR" not in recovered
    assert "ALT KENAR" not in recovered
    assert "ORTA ICERIK" in recovered


def test_auto_crop_keeps_the_text_of_every_rotated_page(tmp_path: Path):
    document = pymupdf.open()
    for index in range(4):
        page = document.new_page(width=595, height=842)
        page.insert_text(
            (60, 90), f"Sayfa {index + 1}", fontsize=13, fontname="dejavu", fontfile=FONT
        )
        page.set_rotation([0, 90, 180, 270][index])
    source = tmp_path / "rotated.pdf"
    document.save(source)
    document.close()

    target = tmp_path / "rotated-cropped.pdf"
    crop_pages(CropParams(path=str(source), output=str(target), mode="auto"), silent_progress())

    check = pymupdf.open(target)
    kept = [f"Sayfa {index + 1}" in check[index].get_text() for index in range(4)]
    check.close()
    assert all(kept)
