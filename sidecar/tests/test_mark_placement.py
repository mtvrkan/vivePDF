from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._watermark_image import MARK_LONG_SIDE, mark_pixmap
from vivepdf.ops._watermark_style import WatermarkParams, WatermarkPreviewParams, WatermarkStyle
from vivepdf.ops.security_watermark import watermark, watermark_preview
from vivepdf.ops.stamp import StampParams, StampPreviewParams, stamp, stamp_preview
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

BLUE = (0, 0, 255)


def _blue_page(tmp_path: Path, rotation: int = 0) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    page.draw_rect(page.rect, color=None, fill=(0, 0, 1))
    page.set_rotation(rotation)
    path = tmp_path / "blue.pdf"
    document.save(path)
    return path


def _template(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=200, height=200)
    page.draw_rect(pymupdf.Rect(90, 90, 110, 110), color=None, fill=(1, 0, 0))
    path = tmp_path / "template.pdf"
    document.save(path)
    return path


def _pixel(page: pymupdf.Page, point: pymupdf.Point) -> tuple[int, ...]:
    pixmap = page.get_pixmap(dpi=72)
    return tuple(pixmap.pixel(int(point.x), int(point.y)))


def _text_box(page: pymupdf.Page) -> pymupdf.Rect:
    box = pymupdf.Rect()
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            box |= pymupdf.Rect(line["bbox"])
    return box


def test_a_pdf_template_leaves_no_white_box(tmp_path: Path) -> None:
    source = _blue_page(tmp_path)
    result = watermark(
        WatermarkParams(
            path=str(source),
            output=str(tmp_path / "marked.pdf"),
            kind="pdf",
            template_path=str(_template(tmp_path)),
            opacity=1,
            scale=0.6,
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as marked:
        page = marked[0]
        assert _pixel(page, pymupdf.Point(200, 150))[:3] != BLUE
        assert _pixel(page, pymupdf.Point(150, 100)) == BLUE


def test_a_large_picture_is_scaled_down_and_faded(tmp_path: Path) -> None:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 6400, 40), False)
    pixmap.set_rect(pixmap.irect, (200, 100, 0))
    image = tmp_path / "wide.png"
    pixmap.save(image)
    mark = mark_pixmap(WatermarkStyle(kind="image", image_path=str(image), opacity=0.5))
    assert mark is not None
    assert max(mark.width, mark.height) <= MARK_LONG_SIDE
    assert mark.pixel(10, 5) == (100, 50, 0, 128)


@pytest.mark.parametrize("position", ["center", "top-right", "bottom-left"])
def test_an_extreme_offset_keeps_the_watermark_on_the_page(tmp_path: Path, position: str) -> None:
    source = _blue_page(tmp_path)
    result = watermark(
        WatermarkParams(
            path=str(source),
            output=str(tmp_path / "marked.pdf"),
            text="DRAFT",
            rotation=0,
            font_size=40,
            position=position,
            offset_x=100,
            offset_y=-100,
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as marked:
        box = _text_box(marked[0])
        assert not box.is_empty
        assert box in marked[0].rect + (-8, -8, 8, 8)


def test_a_shifted_tile_still_covers_the_whole_page(tmp_path: Path) -> None:
    source = _blue_page(tmp_path)
    result = watermark(
        WatermarkParams(
            path=str(source),
            output=str(tmp_path / "marked.pdf"),
            text="X",
            rotation=0,
            font_size=20,
            position="tile",
            offset_x=-100,
            offset_y=-100,
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as marked:
        page = marked[0]
        words = page.get_text("words")
        assert any(word[1] < page.rect.height / 3 for word in words)
        assert any(word[3] > page.rect.height * 2 / 3 for word in words)


def test_the_range_error_names_its_reason(sample_pdf: Path) -> None:
    with pytest.raises(OpError) as error:
        parse_page_ranges("1-99", 3)
    assert error.value.data["reason"] == "badRange"


@pytest.mark.parametrize(
    ("pages", "side", "problem"),
    [("99", "all", "badRange"), ("1", "even", "noPagesSelected"), ("2", "all", "")],
)
def test_the_preview_says_why_it_fell_back(
    sample_pdf: Path, pages: str, side: str, problem: str
) -> None:
    for preview, params in (
        (watermark_preview, WatermarkPreviewParams),
        (stamp_preview, StampPreviewParams),
    ):
        result = preview(
            params(path=str(sample_pdf), text="GİZLİ", pages=pages, side=side, width=200),
            silent_progress(),
        )
        assert result.pages_problem == problem


def test_a_stamp_is_marked_as_a_watermark_artifact(sample_pdf: Path, tmp_path: Path) -> None:
    result = stamp(
        StampParams(path=str(sample_pdf), output=str(tmp_path / "stamped.pdf"), text="ONAY"),
        silent_progress(),
    )
    assert result.stamped == 3
    with pymupdf.open(result.output) as stamped:
        content = stamped[0].read_contents()
    assert b"/Artifact <</Type/Pagination/Subtype/Watermark>> BDC" in content


@pytest.mark.parametrize("rotation", [0, 90, 270])
def test_an_offset_stamp_stays_on_the_page(tmp_path: Path, rotation: int) -> None:
    source = _blue_page(tmp_path, rotation)
    result = stamp(
        StampParams(
            path=str(source),
            output=str(tmp_path / "stamped.pdf"),
            text="APPROVED",
            rotation=0,
            position="top-right",
            offset_x=100,
            offset_y=-100,
        ),
        silent_progress(),
    )
    assert result.stamped == 1
    with pymupdf.open(result.output) as stamped:
        page = stamped[0]
        assert "APPROVED" in page.get_text()
        box = _text_box(page) * page.rotation_matrix
        assert box in page.rect + (-2, -2, 2, 2)
