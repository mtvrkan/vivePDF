from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.space import SpaceParams, space
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture
def written(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for number in range(4):
        page = document.new_page(width=595, height=842)
        page.insert_text(
            (72, 120),
            f"Sayfa {number + 1} govde metni burada duruyor",
            fontsize=14,
            fontname="dejavu",
            fontfile=FONT,
        )
    path = tmp_path / "written.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def pictured(tmp_path: Path) -> Path:
    document = pymupdf.open()
    generator = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 400, 400), False)
    generator.set_rect(generator.irect, (200, 120, 60))
    for _number in range(3):
        page = document.new_page(width=595, height=842)
        page.insert_image(pymupdf.Rect(40, 40, 555, 555), pixmap=generator)
    path = tmp_path / "pictured.pdf"
    document.save(path)
    document.close()
    return path


def _bytes_of(report, kind: str) -> int:
    for group in report.groups:
        if group.kind == kind:
            return group.bytes
    return 0


def test_a_written_document_is_mostly_fonts_and_page_contents(written: Path):
    report = space(SpaceParams(path=str(written)), silent_progress())
    assert _bytes_of(report, "font") > 0
    assert _bytes_of(report, "content") > 0
    assert _bytes_of(report, "image") == 0
    assert report.image_count == 0
    assert report.squeezable_share == 0.0


def test_a_document_of_pictures_says_the_pictures_are_the_weight(pictured: Path):
    report = space(SpaceParams(path=str(pictured)), silent_progress())
    assert report.image_count >= 1
    assert _bytes_of(report, "image") > _bytes_of(report, "content")
    assert report.squeezable_share > 0.5
    assert report.largest_image_bytes > 0


def test_the_groups_add_up_to_no_more_than_the_file(written: Path):
    report = space(SpaceParams(path=str(written)), silent_progress())
    measured = sum(group.bytes for group in report.groups)
    assert measured == report.stored_bytes
    assert measured <= report.total_bytes
    assert report.total_bytes == written.stat().st_size


def test_nothing_is_reported_for_a_kind_that_is_not_there(written: Path):
    report = space(SpaceParams(path=str(written)), silent_progress())
    assert all(group.bytes > 0 for group in report.groups)
    assert "attachment" not in {group.kind for group in report.groups}
