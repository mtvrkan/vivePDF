from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops.cover import CoverParams, add_cover
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

STYLES = ["classic", "band", "frame", "minimal"]


@pytest.fixture
def report(tmp_path: Path) -> Path:
    path = tmp_path / "report.pdf"
    with pymupdf.open() as document:
        for number in range(3):
            page = document.new_page(width=420, height=595)
            page.insert_text((50, 80), f"Body page {number + 1}")
        document.set_toc([[1, "Chapter", 2]])
        document.save(path)
    return path


def _params(report: Path, tmp_path: Path, **fields) -> CoverParams:
    values = {
        "path": str(report),
        "output": str(tmp_path / "covered.pdf"),
        "title": "Yapay Zekâ ve Eğitim",
        "subtitle": "Dönem ödevi",
        "author": "Ayşe Demir",
        "organisation": "Ankara Üniversitesi",
        "date": "3 Ekim 2026",
        "details": "Öğrenci No: 2026001",
    }
    values.update(fields)
    return CoverParams(**values)


@pytest.mark.parametrize("style", STYLES)
def test_every_style_puts_the_texts_on_a_new_first_page_of_the_same_size(
    tmp_path: Path, report: Path, style: str
):
    result = add_cover(_params(report, tmp_path, style=style), silent_progress())

    with pymupdf.open(result.output) as document:
        assert document.page_count == 4
        assert document[0].rect == pymupdf.Rect(0, 0, 420, 595)
        text = document[0].get_text()
        for expected in ("Yapay Zekâ ve Eğitim", "Ayşe Demir", "Ankara Üniversitesi", "2026001"):
            assert expected in text
        assert "Body page 1" in document[1].get_text()
        assert document.get_toc() == [[1, "Chapter", 3]]


def test_photo_cover_fills_the_top_with_the_cropped_picture(tmp_path: Path, report: Path):
    picture = tmp_path / "photo.png"
    Image.new("RGB", (1600, 400), (30, 120, 200)).save(picture)

    result = add_cover(
        _params(report, tmp_path, style="photo", image=str(picture)), silent_progress()
    )

    with pymupdf.open(result.output) as document:
        images = document[0].get_image_info()
        assert len(images) == 1
        box = pymupdf.Rect(images[0]["bbox"])
        assert box.width == pytest.approx(420, abs=1)
        assert box.height == pytest.approx(595 * 0.56, abs=1)


def test_replacing_the_first_page_keeps_the_page_count(tmp_path: Path, report: Path):
    result = add_cover(_params(report, tmp_path, replace_first=True), silent_progress())

    with pymupdf.open(result.output) as document:
        assert document.page_count == 3
        assert "Body page 2" in document[1].get_text()


def test_missing_title_or_photo_are_reported(tmp_path: Path, report: Path):
    with pytest.raises(OpError) as untitled:
        add_cover(_params(report, tmp_path, title="  "), silent_progress())
    assert untitled.value.data["reason"] == "noTitle"
    with pytest.raises(OpError) as no_photo:
        add_cover(_params(report, tmp_path, style="photo"), silent_progress())
    assert no_photo.value.data["reason"] == "noCoverImage"
    with pytest.raises(OpError) as missing_logo:
        add_cover(_params(report, tmp_path, logo=str(tmp_path / "nope.png")), silent_progress())
    assert missing_logo.value.code == ErrorCode.FILE_NOT_FOUND
    assert not (tmp_path / "covered.pdf").exists()
