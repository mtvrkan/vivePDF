from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.page_geometry import CropParams, Insets, crop_pages
from vivepdf.rpc.progress import silent_progress


def _cropped_source(tmp_path: Path, rotation: int) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.insert_text((20, 30), "OUTSIDE", fontsize=12)
    page.insert_text((100, 130), "INSIDE", fontsize=12)
    page.insert_text((300, 400), "CENTRE", fontsize=12)
    page.draw_rect(pymupdf.Rect(90, 110, 510, 700), color=(0, 0, 0))
    page.set_cropbox(pymupdf.Rect(50, 50, 560, 760))
    page.set_rotation(rotation)
    path = tmp_path / f"cropped-{rotation}.pdf"
    document.save(path)
    document.close()
    return path


def _all_words(path: Path) -> set[str]:
    document = pymupdf.open(path)
    page = document[0]
    page.set_cropbox(page.mediabox)
    words = {word[4] for word in page.get_text("words")}
    document.close()
    return words


@pytest.mark.parametrize("rotation", [0, 90, 270])
def test_destructive_crop_keeps_what_stays_visible_on_a_cropped_page(
    tmp_path: Path, rotation: int
) -> None:
    source = _cropped_source(tmp_path, rotation)
    output = tmp_path / "out.pdf"
    crop_pages(
        CropParams(
            path=str(source),
            output=str(output),
            insets=Insets(left=30, top=30, right=30, bottom=30),
            remove_content=True,
        ),
        silent_progress(),
    )
    words = _all_words(output)
    assert "INSIDE" in words
    assert "CENTRE" in words
    assert "OUTSIDE" not in words


@pytest.mark.parametrize("rotation", [0, 90])
def test_auto_crop_on_a_cropped_page_keeps_the_content(tmp_path: Path, rotation: int) -> None:
    source = _cropped_source(tmp_path, rotation)
    output = tmp_path / "auto.pdf"
    result = crop_pages(
        CropParams(path=str(source), output=str(output), mode="auto", auto_margin=4),
        silent_progress(),
    )
    assert result.cropped == 1
    document = pymupdf.open(output)
    box = document[0].cropbox
    assert box.x0 == pytest.approx(86, abs=2)
    assert box.y0 == pytest.approx(106, abs=2)
    assert box.x1 == pytest.approx(514, abs=2)
    assert box.y1 == pytest.approx(704, abs=2)
    document.close()


def test_destructive_crop_of_a_scan_keeps_it_a_jpeg(tmp_path: Path) -> None:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 1200, 1600), False)
    pixmap.set_rect(pixmap.irect, (230, 230, 225))
    scan = pixmap.tobytes("jpeg", jpg_quality=80)
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.insert_image(page.rect, stream=scan)
    source = tmp_path / "scan.pdf"
    document.save(source)
    document.close()
    output = tmp_path / "scan-cropped.pdf"
    crop_pages(
        CropParams(
            path=str(source),
            output=str(output),
            insets=Insets(left=50, top=50, right=50, bottom=50),
            remove_content=True,
        ),
        silent_progress(),
    )
    cropped = pymupdf.open(output)
    xref = cropped[0].get_images(full=True)[0][0]
    assert cropped.xref_get_key(xref, "Filter")[1] == "/DCTDecode"
    cropped.close()
