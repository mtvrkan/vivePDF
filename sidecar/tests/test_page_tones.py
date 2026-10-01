from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.page_tones import PageTonesParams, page_tones
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _picture(red: int, green: int, blue: int, noise: bool = False) -> bytes:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), False)
    pixmap.set_rect(pixmap.irect, (red, green, blue))
    if noise:
        for x in range(0, 40, 4):
            pixmap.set_rect(pymupdf.IRect(x, 10, x + 1, 30), (0, 0, 0))
    return pixmap.tobytes("png")


def _save(document: pymupdf.Document, path: Path) -> Path:
    document.save(path)
    document.close()
    return path


def _tones(path: Path, **extra: str) -> list:
    return page_tones(PageTonesParams(path=str(path), **extra), silent_progress()).pages


def test_a_colourful_picture_on_a_white_page_is_reported_where_it_sits(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.insert_text((72, 72), "Cover page")
    page.insert_image(pymupdf.Rect(150, 200, 450, 400), stream=_picture(220, 40, 90))
    source = _save(document, tmp_path / "cover.pdf")

    [tone] = _tones(source)

    assert tone.dark is False
    [area] = tone.pictures
    assert (area.x, area.y, area.width, area.height) == pytest.approx((0.25, 0.25, 0.5, 0.25))


def test_a_page_that_is_already_dark_is_marked_dark_and_lists_no_pictures(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.draw_rect(page.rect, color=None, fill=(0.1, 0.05, 0.1))
    page.insert_image(pymupdf.Rect(150, 200, 450, 400), stream=_picture(220, 40, 90))
    page.insert_text((72, 72), "Dark cover", color=(1, 1, 1))
    source = _save(document, tmp_path / "dark.pdf")

    [tone] = _tones(source)

    assert tone.dark is True
    assert tone.pictures == []


def test_a_scanned_text_page_and_a_tiny_picture_are_left_to_the_inversion(tmp_path: Path) -> None:
    document = pymupdf.open()
    scan = document.new_page(width=600, height=800)
    scan.insert_image(scan.rect, stream=_picture(250, 250, 248, noise=True))
    tiny = document.new_page(width=600, height=800)
    tiny.insert_image(pymupdf.Rect(10, 10, 40, 40), stream=_picture(220, 40, 90))
    source = _save(document, tmp_path / "scan.pdf")

    tones = _tones(source)

    assert [tone.pictures for tone in tones] == [[], []]
    assert [tone.dark for tone in tones] == [False, False]


def test_pictures_on_a_turned_page_with_an_offset_crop_box_use_the_unturned_crop_box(
    tmp_path: Path,
) -> None:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.insert_image(pymupdf.Rect(100, 100, 300, 240), stream=_picture(30, 120, 220))
    page.set_cropbox(pymupdf.Rect(50, 60, 550, 760))
    page.set_rotation(90)
    source = _save(document, tmp_path / "turned.pdf")

    [tone] = _tones(source)

    [area] = tone.pictures
    assert (area.x, area.y, area.width, area.height) == pytest.approx((0.1, 40 / 700, 0.4, 0.2))


def test_only_the_asked_pages_are_measured(tmp_path: Path) -> None:
    document = pymupdf.open()
    for _index in range(4):
        document.new_page()
    source = _save(document, tmp_path / "four.pdf")

    assert [tone.page for tone in _tones(source, pages="2,4")] == [2, 4]


def test_a_missing_file_is_reported(tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        _tones(tmp_path / "nope.pdf")

    assert raised.value.code == ErrorCode.FILE_NOT_FOUND


def test_a_locked_file_needs_its_password(encrypted_pdf: Path) -> None:
    with pytest.raises(OpError) as raised:
        _tones(encrypted_pdf)

    assert raised.value.code == ErrorCode.NEEDS_PASSWORD
    assert len(_tones(encrypted_pdf, password="secret")) == 3
