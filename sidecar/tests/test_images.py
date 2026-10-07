import base64
import io
from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops.images import ImageAtParams, ImageSaveParams, image_at, image_save
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


def _jpeg_bytes() -> bytes:
    image = Image.new("RGB", (80, 50), (20, 120, 220))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


@pytest.fixture
def image_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    page.insert_image(pymupdf.Rect(100, 50, 260, 150), stream=_jpeg_bytes())
    page.insert_text((20, 280), "caption")
    rotated = document.new_page(width=400, height=300)
    rotated.insert_image(pymupdf.Rect(100, 50, 260, 150), stream=_jpeg_bytes())
    rotated.set_rotation(90)
    path = tmp_path / "images.pdf"
    document.save(path)
    document.close()
    return path


def test_image_at_returns_png_and_original_format(image_pdf: Path):
    result = image_at(ImageAtParams(path=str(image_pdf), page=1, x=180, y=100), silent_progress())
    assert result.found is True
    assert result.ext == "jpg"
    assert result.width == 80 and result.height == 50
    assert result.rect == [100.0, 50.0, 260.0, 150.0]
    decoded = base64.b64decode(result.png_base64 or "")
    assert decoded[:8] == b"\x89PNG\r\n\x1a\n"


def test_image_at_misses_outside_and_honours_rotation(image_pdf: Path):
    miss = image_at(ImageAtParams(path=str(image_pdf), page=1, x=20, y=280), silent_progress())
    assert miss.found is False
    document = pymupdf.open(image_pdf)
    visible = pymupdf.Rect(100, 50, 260, 150) * document[1].rotation_matrix
    document.close()
    visible.normalize()
    hit = image_at(
        ImageAtParams(
            path=str(image_pdf),
            page=2,
            x=(visible.x0 + visible.x1) / 2,
            y=(visible.y0 + visible.y1) / 2,
        ),
        silent_progress(),
    )
    assert hit.found is True


def test_image_save_writes_original_bytes_and_refuses_overwrite(image_pdf: Path, tmp_path: Path):
    output = tmp_path / "picture.jpg"
    result = image_save(
        ImageSaveParams(path=str(image_pdf), page=1, x=180, y=100, output=str(output)),
        silent_progress(),
    )
    assert Path(result.output) == output
    assert output.read_bytes()[:3] == b"\xff\xd8\xff"
    with pytest.raises(OpError):
        image_save(
            ImageSaveParams(path=str(image_pdf), page=1, x=180, y=100, output=str(output)),
            silent_progress(),
        )
    png = tmp_path / "picture.png"
    converted = image_save(
        ImageSaveParams(path=str(image_pdf), page=1, x=180, y=100, output=str(png)),
        silent_progress(),
    )
    assert converted.ext == "png"
    assert png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    with pytest.raises(OpError):
        image_save(
            ImageSaveParams(
                path=str(image_pdf), page=1, x=20, y=280, output=str(tmp_path / "none.png")
            ),
            silent_progress(),
        )


@pytest.fixture
def backdrop_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    slide = document.new_page(width=400, height=300)
    slide.insert_image(slide.rect, stream=_jpeg_bytes(), keep_proportion=False)
    slide.insert_image(
        pymupdf.Rect(250, 150, 350, 250), stream=_jpeg_bytes(), keep_proportion=False
    )
    slide.insert_text((30, 60), "Bilgisayar tarihi", fontsize=20)
    scan = document.new_page(width=400, height=300)
    scan.insert_image(scan.rect, stream=_jpeg_bytes(), keep_proportion=False)
    scan.insert_text((30, 60), "Bilgisayar tarihi", fontsize=20, render_mode=3)
    photo = document.new_page(width=400, height=300)
    photo.insert_image(photo.rect, stream=_jpeg_bytes(), keep_proportion=False)
    path = tmp_path / "backdrop.pdf"
    document.save(path)
    document.close()
    return path


def test_image_at_skips_a_page_backdrop_under_visible_text(backdrop_pdf: Path):
    on_text = image_at(ImageAtParams(path=str(backdrop_pdf), page=1, x=60, y=55), silent_progress())
    on_picture = image_at(
        ImageAtParams(path=str(backdrop_pdf), page=1, x=300, y=200), silent_progress()
    )

    assert on_text.found is False
    assert on_picture.found is True
    assert on_picture.rect == [250.0, 150.0, 350.0, 250.0]


def test_image_at_keeps_a_full_page_scan_or_photo(backdrop_pdf: Path):
    scan = image_at(ImageAtParams(path=str(backdrop_pdf), page=2, x=60, y=55), silent_progress())
    photo = image_at(ImageAtParams(path=str(backdrop_pdf), page=3, x=60, y=55), silent_progress())

    assert scan.found is True
    assert photo.found is True


def test_image_save_refuses_a_page_backdrop(backdrop_pdf: Path, tmp_path: Path):
    with pytest.raises(OpError) as raised:
        image_save(
            ImageSaveParams(
                path=str(backdrop_pdf), page=1, x=60, y=55, output=str(tmp_path / "bg.jpg")
            ),
            silent_progress(),
        )

    assert raised.value.data == {"reason": "noImage"}
