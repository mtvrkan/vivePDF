from pathlib import Path

import pymupdf

from vivepdf.ops.image_extraction import ExtractImagesParams, ExtractImagesResult, extract_images
from vivepdf.rpc.progress import silent_progress

SIDECAR = Path(__file__).resolve().parent.parent
FONT = str(SIDECAR / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf")
AREA = pymupdf.Rect(72, 72, 272, 272)


def _picture(shade: int, side: int = 400) -> pymupdf.Pixmap:
    picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, side, side), 0)
    picture.clear_with(shade)
    return picture


def _clip(page: pymupdf.Page, area: pymupdf.Rect) -> None:
    height = page.mediabox.height
    xref = page.get_contents()[0]
    stream = page.parent.xref_stream(xref)
    box = f"{area.x0:g} {height - area.y1:g} {area.width:g} {area.height:g} re W n\n"
    page.parent.update_stream(xref, b"q " + box.encode() + stream + b"\nQ")


def _extract(
    document: pymupdf.Document, tmp_path: Path, as_seen: bool = True
) -> tuple[ExtractImagesResult, list[pymupdf.Pixmap]]:
    source = tmp_path / "görünen.pdf"
    document.save(source)
    document.close()
    result = extract_images(
        ExtractImagesParams(path=str(source), output_dir=str(tmp_path / "çıkan"), as_seen=as_seen),
        silent_progress(),
    )
    return result, [pymupdf.Pixmap(path) for path in result.outputs]


def test_a_cropped_picture_keeps_only_its_visible_part(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(AREA, pixmap=_picture(120))
    _clip(page, pymupdf.Rect(72, 72, 172, 172))

    result, pictures = _extract(document, tmp_path)

    assert [Path(path).name for path in result.outputs] == ["görünen-1-01.png"]
    assert (pictures[0].width, pictures[0].height) == (200, 200)
    assert pictures[0].pixel(100, 100) == (120, 120, 120)


def test_the_original_mode_still_saves_the_whole_stored_picture(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(AREA, pixmap=_picture(120))
    _clip(page, pymupdf.Rect(72, 72, 172, 172))

    _result, pictures = _extract(document, tmp_path, as_seen=False)

    assert (pictures[0].width, pictures[0].height) == (400, 400)


def test_tiles_that_touch_are_saved_as_one_picture(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(pymupdf.Rect(72, 72, 172, 172), pixmap=_picture(40, 200))
    page.insert_image(pymupdf.Rect(172, 72, 272, 172), pixmap=_picture(200, 200))

    result, pictures = _extract(document, tmp_path)

    assert result.count == 1
    assert (pictures[0].width, pictures[0].height) == (400, 200)
    assert pictures[0].pixel(100, 100) == (40, 40, 40)
    assert pictures[0].pixel(300, 100) == (200, 200, 200)


def test_a_slide_background_is_skipped_but_a_full_page_photo_is_kept(tmp_path: Path) -> None:
    document = pymupdf.open()
    slide = document.new_page(width=720, height=540)
    slide.insert_image(slide.rect, pixmap=_picture(230, 100))
    slide.insert_text((72, 100), "Slayt başlığı", fontname="dejavu", fontfile=FONT)
    photo = document.new_page(width=720, height=540)
    photo.insert_image(photo.rect, pixmap=_picture(90, 100))

    result, _pictures = _extract(document, tmp_path)

    assert [Path(path).name for path in result.outputs] == ["görünen-2-01.png"]
    assert result.skipped == 1


def test_a_photo_stays_a_jpeg_and_a_turned_page_gives_the_upright_shape(
    tmp_path: Path,
) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(AREA, stream=_picture(150).tobytes("jpg"))
    _clip(page, pymupdf.Rect(72, 72, 272, 172))
    page.set_rotation(90)

    result, pictures = _extract(document, tmp_path)

    assert result.outputs[0].endswith(".jpg")
    assert (pictures[0].width, pictures[0].height) == (200, 400)


def test_a_logo_on_a_slide_background_is_saved_without_the_background(tmp_path: Path) -> None:
    document = pymupdf.open()
    slide = document.new_page(width=720, height=540)
    slide.insert_image(slide.rect, pixmap=_picture(230, 100))
    slide.insert_image(pymupdf.Rect(480, 46, 580, 146), pixmap=_picture(30, 200))
    slide.insert_text((72, 100), "Slayt başlığı", fontname="dejavu", fontfile=FONT)

    result, pictures = _extract(document, tmp_path)

    assert result.count == 1
    assert result.skipped == 1
    assert (pictures[0].width, pictures[0].height) == (200, 200)


def test_a_logo_over_the_corner_of_a_photo_stays_a_picture_of_its_own(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=720, height=540)
    page.insert_image(pymupdf.Rect(10, 105, 710, 475), pixmap=_picture(150, 200))
    page.insert_image(pymupdf.Rect(4, 463, 56, 515), pixmap=_picture(30, 100))

    result, _pictures = _extract(document, tmp_path)

    assert result.count == 2


def test_a_repeated_logo_under_different_page_content_is_saved_once(tmp_path: Path) -> None:
    document = pymupdf.open()
    for number in range(3):
        page = document.new_page(width=720, height=540)
        page.insert_image(pymupdf.Rect(4, 463, 56, 515), pixmap=_picture(30, 100))
        page.draw_line((0, 470 + number * 10), (720, 470 + number * 10), color=(1, 0, 0))

    result, _pictures = _extract(document, tmp_path)

    assert result.count == 1


def test_a_full_page_picture_under_a_photo_is_left_out(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=720, height=540)
    page.insert_image(page.rect, pixmap=_picture(230, 100))
    page.insert_image(pymupdf.Rect(60, 87, 666, 423), pixmap=_picture(90, 300))

    result, pictures = _extract(document, tmp_path)

    assert result.count == 1
    assert result.skipped == 1
    assert pictures[0].width < 720


def test_two_photos_touching_at_a_corner_stay_two_pictures(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=720, height=540)
    page.insert_image(pymupdf.Rect(10, 40, 330, 300), pixmap=_picture(60, 320))
    page.insert_image(pymupdf.Rect(300, 300, 700, 520), pixmap=_picture(180, 400))

    result, _pictures = _extract(document, tmp_path)

    assert result.count == 2


def test_two_photos_meeting_along_a_short_stretch_stay_two_pictures(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=720, height=540)
    page.insert_image(pymupdf.Rect(40, 40, 240, 240), pixmap=_picture(60, 200))
    page.insert_image(pymupdf.Rect(240, 180, 440, 380), pixmap=_picture(180, 200))

    result, _pictures = _extract(document, tmp_path)

    assert result.count == 2


def test_slices_of_one_picture_at_the_same_scale_are_saved_as_one(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=720, height=540)
    page.insert_image(pymupdf.Rect(100, 240, 140, 340), pixmap=_slice(60, 40, 100))
    page.insert_image(pymupdf.Rect(140, 220, 180, 340), pixmap=_slice(120, 40, 120))
    page.insert_image(pymupdf.Rect(180, 180, 600, 340), pixmap=_slice(200, 420, 160))

    result, pictures = _extract(document, tmp_path)

    assert result.count == 1
    assert pictures[0].width >= 500


def test_overlapping_pieces_of_a_drawing_are_saved_as_one(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=720, height=540)
    page.insert_image(pymupdf.Rect(300, 100, 420, 220), pixmap=_picture(60, 240))
    page.insert_image(pymupdf.Rect(380, 200, 470, 300), pixmap=_picture(180, 200))

    result, _pictures = _extract(document, tmp_path)

    assert result.count == 1


def _slice(shade: int, width: int, height: int) -> pymupdf.Pixmap:
    picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, width, height), 0)
    picture.clear_with(shade)
    return picture
