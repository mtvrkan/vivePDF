from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.page_geometry import ResizeParams, resize_pages
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture
def mixed(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for width, height in [(595, 842), (842, 595), (420, 595)]:
        page = document.new_page(width=width, height=height)
        page.draw_rect(pymupdf.Rect(0, 0, width, height), color=(0, 0, 0))
        page.insert_text(
            (30, 40), f"{int(width)}x{int(height)}", fontsize=12, fontname="dejavu", fontfile=FONT
        )
    path = tmp_path / "mixed.pdf"
    document.save(path)
    document.close()
    return path


def _sizes(path: Path) -> list[tuple[float, float]]:
    document = pymupdf.open(path)
    sizes = [
        (round(document[index].rect.width), round(document[index].rect.height))
        for index in range(document.page_count)
    ]
    document.close()
    return sizes


def _drawn_box(path: Path, index: int) -> pymupdf.Rect:
    document = pymupdf.open(path)
    rect = pymupdf.Rect()
    for item in document[index].get_drawings():
        rect |= item["rect"]
    document.close()
    return rect


def test_fit_keeps_the_shape_and_leaves_a_band(mixed: Path, tmp_path: Path):
    target = tmp_path / "fit.pdf"
    resize_pages(
        ResizeParams(
            path=str(mixed), output=str(target), preset="a4", mode="fit", auto_rotate=False
        ),
        silent_progress(),
    )
    drawn = _drawn_box(target, 2)
    ratio = drawn.width / drawn.height
    assert abs(ratio - 420 / 595) < 0.02
    assert drawn.width < 595


def test_stretch_fills_the_page_and_changes_the_shape(mixed: Path, tmp_path: Path):
    target = tmp_path / "stretch.pdf"
    resize_pages(
        ResizeParams(
            path=str(mixed), output=str(target), preset="a4", mode="stretch", auto_rotate=False
        ),
        silent_progress(),
    )
    drawn = _drawn_box(target, 2)
    assert abs(drawn.width - 595) < 2
    assert abs(drawn.height - 842) < 2


def test_fill_covers_the_page_and_overflows(mixed: Path, tmp_path: Path):
    target = tmp_path / "fill.pdf"
    resize_pages(
        ResizeParams(
            path=str(mixed), output=str(target), preset="a4", mode="fill", auto_rotate=False
        ),
        silent_progress(),
    )
    drawn = _drawn_box(target, 1)
    assert drawn.width >= 595 - 1
    assert drawn.height >= 842 - 1


def test_box_only_changes_the_page_size_and_not_the_content(mixed: Path, tmp_path: Path):
    target = tmp_path / "box.pdf"
    resize_pages(
        ResizeParams(
            path=str(mixed), output=str(target), preset="a4", mode="box", auto_rotate=False
        ),
        silent_progress(),
    )
    assert _sizes(target) == [(595, 842), (595, 842), (595, 842)]
    drawn = _drawn_box(target, 2)
    assert abs(drawn.width - 420) < 2


def test_a_margin_pulls_the_content_in(mixed: Path, tmp_path: Path):
    plain = tmp_path / "plain.pdf"
    inset = tmp_path / "inset.pdf"
    resize_pages(
        ResizeParams(path=str(mixed), output=str(plain), preset="a4", auto_rotate=False),
        silent_progress(),
    )
    resize_pages(
        ResizeParams(path=str(mixed), output=str(inset), preset="a4", margin=40, auto_rotate=False),
        silent_progress(),
    )
    assert _drawn_box(inset, 0).width < _drawn_box(plain, 0).width


def test_a_margin_that_swallows_the_page_is_refused(mixed: Path, tmp_path: Path):
    with pytest.raises(OpError):
        resize_pages(
            ResizeParams(
                path=str(mixed), output=str(tmp_path / "gone.pdf"), width=60, height=60, margin=40
            ),
            silent_progress(),
        )


def test_matching_the_largest_page_unifies_a_mixed_document(mixed: Path, tmp_path: Path):
    target = tmp_path / "unified.pdf"
    resize_pages(
        ResizeParams(path=str(mixed), output=str(target), match_largest=True, auto_rotate=False),
        silent_progress(),
    )
    assert _sizes(target) == [(595, 842), (595, 842), (595, 842)]


def test_auto_rotate_keeps_a_landscape_page_landscape(mixed: Path, tmp_path: Path):
    target = tmp_path / "rotated.pdf"
    resize_pages(
        ResizeParams(path=str(mixed), output=str(target), preset="a4", auto_rotate=True),
        silent_progress(),
    )
    assert _sizes(target)[1] == (842, 595)
