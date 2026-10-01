import base64
from pathlib import Path

import numpy
import pymupdf
import pytest

from vivepdf.ops.compare import (
    CompareParams,
    PageImagesParams,
    _regions,
    compare,
    page_images,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _pdf(path: Path, pages: list[list[tuple[tuple[float, float], str]]], box=None) -> Path:
    document = pymupdf.open()
    for lines in pages:
        page = document.new_page(width=595, height=842)
        for point, text in lines:
            page.insert_text(point, text, fontsize=14)
        if box is not None:
            page.draw_rect(pymupdf.Rect(box), color=(0, 0, 0), fill=(0, 0, 0))
    document.save(path)
    document.close()
    return path


def _run(a: Path, b: Path, **options):
    return compare(CompareParams(path_a=str(a), path_b=str(b), **options), silent_progress())


def test_case_can_be_ignored(tmp_path: Path):
    a = _pdf(tmp_path / "a.pdf", [[((72, 100), "Merhaba Dunya rapor")]])
    b = _pdf(tmp_path / "b.pdf", [[((72, 100), "merhaba dunya RAPOR")]])
    assert _run(a, b, visual=False).added_words == 3
    ignored = _run(a, b, visual=False, ignore_case=True)
    assert ignored.added_words == 0
    assert ignored.removed_words == 0


def test_punctuation_can_be_ignored(tmp_path: Path):
    a = _pdf(tmp_path / "a.pdf", [[((72, 100), "Merhaba, dunya. Nasilsin?")]])
    b = _pdf(tmp_path / "b.pdf", [[((72, 100), "Merhaba dunya Nasilsin")]])
    assert _run(a, b, visual=False).added_words > 0
    assert _run(a, b, visual=False, ignore_punctuation=True).added_words == 0


def test_header_and_footer_can_be_ignored(tmp_path: Path):
    body = ((72, 300), "Ayni govde metni")
    a = _pdf(tmp_path / "a.pdf", [[body, ((280, 825), "Sayfa 1")]])
    b = _pdf(tmp_path / "b.pdf", [[body, ((280, 825), "Sayfa 9")]])
    assert _run(a, b).changed_pages == 1
    ignored = _run(a, b, ignore_margins=True)
    assert ignored.changed_pages == 0
    assert ignored.pages[0].marks_a == []


def test_changes_are_marked_where_they_are_on_each_page(tmp_path: Path):
    a = _pdf(tmp_path / "a.pdf", [[((72, 100), "Birinci satir eski")]])
    b = _pdf(
        tmp_path / "b.pdf",
        [[((72, 100), "Birinci satir yeni")]],
        box=(300, 500, 400, 600),
    )
    page = _run(a, b).pages[0]
    removed = [mark for mark in page.marks_a if mark.kind == "text"]
    added = [mark for mark in page.marks_b if mark.kind == "text"]
    assert len(removed) == 1
    assert len(added) == 1
    x0, y0, x1, y1 = added[0].box
    assert 0.1 < x0 < x1 < 0.5
    assert 0.08 < y0 < y1 < 0.14
    areas = [mark.box for mark in page.marks_b if mark.kind == "area"]
    assert any(
        box[0] <= 300 / 595 + 0.01
        and box[2] >= 400 / 595 - 0.01
        and box[1] <= 500 / 842 + 0.01
        and box[3] >= 600 / 842 - 0.01
        for box in areas
    )
    assert all(0 <= value <= 1 for mark in page.marks_a + page.marks_b for value in mark.box)


def test_marks_on_a_turned_page_use_the_unturned_page(tmp_path: Path):
    a = _pdf(tmp_path / "a.pdf", [[((72, 100), "Donmus sayfa eski")]])
    b = _pdf(tmp_path / "b.pdf", [[((72, 100), "Donmus sayfa yeni")]])
    for path in (a, b):
        document = pymupdf.open(path)
        document[0].set_rotation(90)
        document.saveIncr()
        document.close()
    page = _run(a, b, visual=False).pages[0]
    added = [mark for mark in page.marks_b if mark.kind == "text"]
    assert len(added) == 1
    assert added[0].box[1] < 0.14


def test_regions_join_touching_blocks_and_keep_apart_separate_ones():
    grid = numpy.zeros((10, 20), dtype=bool)
    grid[1:3, 1:4] = True
    grid[3:5, 3:5] = True
    grid[8, 15:18] = True
    regions = sorted(_regions(grid))
    assert regions == [(1, 1, 4, 4), (8, 15, 8, 17)]
    assert _regions(numpy.zeros((3, 3), dtype=bool)) == []


def test_page_images_are_drawn_on_one_canvas(tmp_path: Path):
    a = _pdf(tmp_path / "a.pdf", [[((72, 100), "A")]])
    document = pymupdf.open()
    document.new_page(width=300, height=300)
    small = tmp_path / "b.pdf"
    document.save(small)
    document.close()
    result = page_images(
        PageImagesParams(path_a=str(a), path_b=str(small), page_a=1, page_b=1, dpi=72),
        silent_progress(),
    )
    assert (result.width, result.height) == (595, 842)
    for image in (result.image_a, result.image_b):
        picture = pymupdf.Pixmap(base64.b64decode(image))
        assert (picture.width, picture.height) == (595, 842)
    only_a = page_images(
        PageImagesParams(path_a=str(a), path_b=str(small), page_a=1, dpi=72), silent_progress()
    )
    assert only_a.image_b is None


@pytest.mark.parametrize(("page_a", "page_b"), [(None, None), (1, 5)])
def test_page_images_refuse_missing_pages(tmp_path: Path, page_a, page_b):
    a = _pdf(tmp_path / "a.pdf", [[((72, 100), "A")]])
    with pytest.raises(OpError) as caught:
        page_images(
            PageImagesParams(path_a=str(a), path_b=str(a), page_a=page_a, page_b=page_b),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS
