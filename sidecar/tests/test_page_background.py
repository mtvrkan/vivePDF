import threading
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.page_background import BackgroundParams, page_background
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress

CREAM = "#fff3c4"
CREAM_RGB = (255, 243, 196)
MINT = "#d9f2e6"
MINT_RGB = (217, 242, 230)


def _text_page(document: pymupdf.Document) -> pymupdf.Page:
    page = document.new_page(width=300, height=200)
    page.insert_text((30, 60), "Arka plan", fontsize=18)
    page.draw_rect(pymupdf.Rect(30, 90, 120, 150), color=(0, 0, 0.6), fill=(0, 0, 0.6))
    return page


@pytest.fixture
def plain_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    _text_page(document)
    _text_page(document).set_rotation(90)
    cropped = _text_page(document)
    cropped.set_cropbox(pymupdf.Rect(40, 30, 280, 190))
    _text_page(document).draw_rect(pymupdf.Rect(0, 0, 300, 200), color=None, fill=(1, 1, 1))
    target = tmp_path / "sayfalar.pdf"
    document.save(target)
    return target


def _corner_colours(page: pymupdf.Page) -> list[tuple[int, int, int]]:
    pixmap = page.get_pixmap(dpi=36, alpha=False)
    corners = [
        (1, 1),
        (pixmap.width - 2, 1),
        (1, pixmap.height - 2),
        (pixmap.width - 2, pixmap.height - 2),
    ]
    return [tuple(pixmap.pixel(x, y)) for x, y in corners]


def _close(colour: tuple[int, int, int], wanted: tuple[int, int, int]) -> bool:
    return all(abs(a - b) <= 3 for a, b in zip(colour, wanted, strict=True))


def test_colour_fills_every_visible_page_under_the_content(plain_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "renkli.pdf"

    result = page_background(
        BackgroundParams(path=str(plain_pdf), output=str(output), color=CREAM, pages="1-3"),
        silent_progress(),
    )

    assert result.applied == 3
    assert result.hidden_pages == []
    with pymupdf.open(output) as document:
        for page in list(document)[:3]:
            assert all(_close(colour, CREAM_RGB) for colour in _corner_colours(page))
            assert "Arka plan" in page.get_text()
            assert page.get_text("words")[0][4] == "Arka"
        assert all(_close(colour, (255, 255, 255)) for colour in _corner_colours(document[3]))
        assert (
            b"/Artifact <</Type /Background /VivePDFRole /PageBackground>> BDC"
            in document[0].read_contents()
        )


def test_dark_content_stays_on_top_of_the_colour(plain_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "renkli.pdf"

    page_background(
        BackgroundParams(path=str(plain_pdf), output=str(output), color=CREAM, pages="1"),
        silent_progress(),
    )

    with pymupdf.open(output) as document:
        pixmap = document[0].get_pixmap(dpi=72, alpha=False)
        assert _close(tuple(pixmap.pixel(75, 120)), (0, 0, 153))


def test_a_page_covered_by_its_own_white_fill_is_reported(plain_pdf: Path, tmp_path: Path) -> None:
    result = page_background(
        BackgroundParams(path=str(plain_pdf), output=str(tmp_path / "renkli.pdf"), color=CREAM),
        silent_progress(),
    )

    assert result.applied == 4
    assert result.hidden_pages == [4]


def test_applying_again_replaces_the_earlier_colour(plain_pdf: Path, tmp_path: Path) -> None:
    first = tmp_path / "krem.pdf"
    second = tmp_path / "nane.pdf"
    page_background(
        BackgroundParams(path=str(plain_pdf), output=str(first), color=CREAM, pages="1"),
        silent_progress(),
    )

    page_background(
        BackgroundParams(path=str(first), output=str(second), color=MINT, pages="1"),
        silent_progress(),
    )

    with pymupdf.open(second) as document:
        contents = document[0].read_contents()
        assert contents.count(b"/VivePDFRole /PageBackground") == 1
        assert all(_close(colour, MINT_RGB) for colour in _corner_colours(document[0]))


def test_remove_takes_off_only_the_added_colour(plain_pdf: Path, tmp_path: Path) -> None:
    coloured = tmp_path / "krem.pdf"
    cleared = tmp_path / "temiz.pdf"
    page_background(
        BackgroundParams(path=str(plain_pdf), output=str(coloured), color=CREAM),
        silent_progress(),
    )

    page_background(
        BackgroundParams(path=str(coloured), output=str(cleared), remove=True), silent_progress()
    )

    with pymupdf.open(cleared) as document:
        assert all(_close(colour, (255, 255, 255)) for colour in _corner_colours(document[0]))
        assert "Arka plan" in document[0].get_text()
        assert b"PageBackground" not in document[0].read_contents()


def test_remove_without_an_added_colour_is_refused(plain_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "temiz.pdf"

    with pytest.raises(OpError) as caught:
        page_background(
            BackgroundParams(path=str(plain_pdf), output=str(output), remove=True),
            silent_progress(),
        )

    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data["reason"] == "noBackground"
    assert not output.exists()


def test_a_bad_colour_is_refused(plain_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as caught:
        page_background(
            BackgroundParams(path=str(plain_pdf), output=str(tmp_path / "x.pdf"), color="krem"),
            silent_progress(),
        )

    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_cancelling_writes_nothing(plain_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "renkli.pdf"
    cancel = threading.Event()
    cancel.set()

    with pytest.raises(OpError) as caught:
        page_background(
            BackgroundParams(path=str(plain_pdf), output=str(output), color=CREAM),
            Progress(lambda *_: None, cancel),
        )

    assert caught.value.code == ErrorCode.CANCELLED
    assert not output.exists()
