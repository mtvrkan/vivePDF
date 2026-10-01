import io
from pathlib import Path

import pymupdf
import pytest
from PIL import Image, ImageDraw

from vivepdf.ops.scan import EnhanceParams, enhance
from vivepdf.rpc.progress import silent_progress

NOTE_RECT = pymupdf.Rect(100, 120, 220, 170)
LINK_RECT = pymupdf.Rect(300, 600, 420, 640)


def _scan_with_marks(path: Path, rotation: int) -> Path:
    image = Image.new("RGB", (1200, 1600), (236, 232, 224))
    draw = ImageDraw.Draw(image)
    draw.rectangle((140, 160, 700, 200), fill=(20, 20, 20))
    draw.rectangle((140, 1300, 400, 1500), fill=(20, 20, 20))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=buffer.getvalue())
    page.set_rotation(rotation)
    note = page.add_rect_annot(NOTE_RECT * page.derotation_matrix)
    note.set_colors(stroke=(1, 0, 0))
    note.set_info(content="Kontrol edildi — ş ğ ü")
    note.update()
    page.insert_link(
        {
            "kind": pymupdf.LINK_URI,
            "from": LINK_RECT * page.derotation_matrix,
            "uri": "https://example.org/tarama",
        }
    )
    document.save(path)
    document.close()
    return path


def _enhanced(source: Path, tmp_path: Path) -> Path:
    result = enhance(
        EnhanceParams(
            path=str(source),
            output=str(tmp_path / "temiz çıktı.pdf"),
            dpi=100,
            deskew=False,
            mode="gray",
        ),
        silent_progress(),
    )
    assert result.enhanced_pages == 1
    return Path(result.output)


@pytest.mark.parametrize("rotation", [0, 90, 270])
def test_annotations_and_links_survive_enhancement(tmp_path: Path, rotation: int) -> None:
    source = _scan_with_marks(tmp_path / f"tarama {rotation}.pdf", rotation)
    output = _enhanced(source, tmp_path)
    with pymupdf.open(output) as document:
        page = document[0]
        assert page.get_images()
        annots = list(page.annots())
        assert len(annots) == 1
        assert annots[0].type[1] == "Square"
        assert annots[0].info["content"] == "Kontrol edildi — ş ğ ü"
        seen = annots[0].rect * page.rotation_matrix
        assert abs(seen.x0 - NOTE_RECT.x0) < 2 and abs(seen.y1 - NOTE_RECT.y1) < 2
        links = page.get_links()
        assert len(links) == 1
        assert links[0]["uri"] == "https://example.org/tarama"
    with pymupdf.open(source) as original:
        expected = pymupdf.Rect(original[0].get_links()[0]["from"])
    assert pymupdf.Rect(links[0]["from"]) == expected


@pytest.mark.parametrize("rotation", [0, 90])
def test_the_rebuilt_page_looks_like_the_original(tmp_path: Path, rotation: int) -> None:
    source = _scan_with_marks(tmp_path / "görünüm.pdf", rotation)
    output = _enhanced(source, tmp_path)
    with pymupdf.open(source) as original, pymupdf.open(output) as rebuilt:
        assert rebuilt[0].rect == original[0].rect
        before = original[0].get_pixmap(dpi=20, colorspace=pymupdf.csGRAY, annots=False)
        after = rebuilt[0].get_pixmap(dpi=20, colorspace=pymupdf.csGRAY, annots=False)
    assert (before.width, before.height) == (after.width, after.height)
    drift = sum(abs(a - b) for a, b in zip(before.samples, after.samples, strict=True))
    assert drift / len(before.samples) < 25


def test_annotations_are_not_baked_into_the_picture(tmp_path: Path) -> None:
    source = _scan_with_marks(tmp_path / "çift.pdf", 0)
    output = _enhanced(source, tmp_path)
    with pymupdf.open(output) as document:
        plain = document[0].get_pixmap(
            dpi=72, colorspace=pymupdf.csRGB, annots=False, clip=pymupdf.Rect(100, 140, 101, 150)
        )
    red, green, blue = plain.pixel(0, 0)
    assert not (red > 150 and green < 100 and blue < 100)
