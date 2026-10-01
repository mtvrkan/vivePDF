import numpy as np
import pymupdf
import pytest

from vivepdf.ops._placement import insertion_matrix

TARGET = pymupdf.Rect(20, 30, 120, 80)


def turned_page(media: tuple, crop: tuple | None, rotation: int) -> pymupdf.Page:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    document.xref_set_key(page.xref, "MediaBox", f"[{' '.join(str(value) for value in media)}]")
    page = document[0]
    if crop is not None:
        page.set_cropbox(pymupdf.Rect(*crop) & page.mediabox)
    page.set_rotation(rotation)
    return page


def painted(page: pymupdf.Page) -> tuple[int, int, int, int] | None:
    pixmap = page.get_pixmap(dpi=72)
    grid = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
        pixmap.height, pixmap.width, pixmap.n
    )[:, :, 0]
    rows, columns = np.nonzero(grid < 50)
    if rows.size == 0:
        return None
    return (int(columns.min()), int(rows.min()), int(columns.max()) + 1, int(rows.max()) + 1)


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize("crop", [None, (50, 60, 550, 760), (0, 0, 300, 500)])
@pytest.mark.parametrize("media", [(0, 0, 600, 800), (10, 20, 610, 820), (-30, -40, 570, 760)])
def test_drawing_lands_where_the_reader_sees_it(media, crop, rotation):
    page = turned_page(media, crop, rotation)
    page.draw_rect(TARGET * insertion_matrix(page), color=(0, 0, 0), fill=(0, 0, 0))
    assert painted(page) == (20, 30, 120, 80)


def test_an_upright_page_needs_no_transform():
    page = turned_page((0, 0, 600, 800), (50, 60, 550, 760), 0)
    assert tuple(insertion_matrix(page)) == (1, 0, 0, 1, 0, 0)


def test_a_turned_page_without_a_crop_box_uses_plain_derotation():
    page = turned_page((0, 0, 600, 800), None, 90)
    assert tuple(insertion_matrix(page)) == tuple(page.derotation_matrix)
