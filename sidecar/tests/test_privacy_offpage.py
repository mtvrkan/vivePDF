from pathlib import Path

import pymupdf

from vivepdf.ops._offpage import TEXT_FLAGS
from vivepdf.ops.privacy import InspectParams, inspect
from vivepdf.ops.privacy_sanitize import SanitizeParams, sanitize
from vivepdf.rpc.progress import silent_progress


def _picture(shade: int, size: int = 20) -> pymupdf.Pixmap:
    picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, size, size), 0)
    picture.clear_with(shade)
    return picture


def _all_text(path: Path) -> str:
    with pymupdf.open(path) as document:
        return "".join(
            page.get_text("text", flags=TEXT_FLAGS, clip=pymupdf.INFINITE_RECT())
            for page in document
        )


def _cropped(tmp_path: Path, rotation: int = 0) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.draw_rect(page.rect, color=None, fill=(0.95, 0.95, 1))
    page.insert_text((50, 100), "VISIBLE")
    page.insert_text((450, 100), "RIGHTSIDE")
    page.insert_text((50, 700), "CROPPEDAWAY")
    page.insert_text((50, 850), "BEYONDMEDIA")
    page.insert_image(pymupdf.Rect(400, 600, 500, 700), pixmap=_picture(90))
    page.set_cropbox(pymupdf.Rect(20, 30, 580, 400))
    page.set_rotation(rotation)
    path = tmp_path / f"cropped-{rotation}.pdf"
    document.save(path)
    document.close()
    return path


def _clean(source: Path, tmp_path: Path, **options: bool) -> Path:
    result = sanitize(
        SanitizeParams(path=str(source), output=str(tmp_path / f"clean-{source.name}"), **options),
        silent_progress(),
    )
    return Path(result.output)


def test_cropped_text_and_pictures_are_found_and_removed(tmp_path: Path) -> None:
    source = _cropped(tmp_path)
    assert inspect(InspectParams(path=str(source)), silent_progress()).off_page_content == 3
    output = _clean(source, tmp_path, off_page=True)
    after = inspect(InspectParams(path=str(output)), silent_progress())
    assert after.off_page_content == 0
    text = _all_text(output)
    assert "CROPPEDAWAY" not in text
    assert "BEYONDMEDIA" not in text
    assert "VISIBLE" in text
    assert "RIGHTSIDE" in text


def test_a_turned_page_keeps_what_its_crop_box_shows(tmp_path: Path) -> None:
    output = _clean(_cropped(tmp_path, 90), tmp_path, off_page=True)
    text = _all_text(output)
    assert "RIGHTSIDE" in text
    assert "VISIBLE" in text
    assert "CROPPEDAWAY" not in text


def test_the_removal_is_reported_as_verified(tmp_path: Path) -> None:
    source = _cropped(tmp_path)
    result = sanitize(
        SanitizeParams(path=str(source), output=str(tmp_path / "out.pdf"), off_page=True),
        silent_progress(),
    )
    assert result.removed["offPage"] == 3


def test_content_stays_when_not_asked(tmp_path: Path) -> None:
    output = _clean(_cropped(tmp_path), tmp_path)
    assert "CROPPEDAWAY" in _all_text(output)
    assert inspect(InspectParams(path=str(output)), silent_progress()).off_page_content == 3


def test_bleed_and_pictures_shown_elsewhere_are_not_counted(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.insert_image(pymupdf.Rect(-9, -9, 609, 809), pixmap=_picture(200, 40))
    shared = _picture(60)
    page.insert_image(pymupdf.Rect(100, 100, 200, 200), pixmap=shared)
    page.insert_image(pymupdf.Rect(100, 900, 200, 1000), pixmap=shared)
    page.insert_text((72, 72), "Body")
    path = tmp_path / "bleed.pdf"
    document.save(path)
    document.close()
    assert inspect(InspectParams(path=str(path)), silent_progress()).off_page_content == 0
