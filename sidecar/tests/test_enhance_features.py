import base64
import io
from pathlib import Path

import numpy as np
import pymupdf
import pytest
from PIL import Image, ImageDraw

from vivepdf.ops.photo import PhotoParams, from_photo
from vivepdf.ops.scan import EnhancePreviewParams, adaptive_black_white, enhance_preview
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


def _unevenly_lit_page() -> Image.Image:
    shade = np.tile(np.linspace(90, 250, 800, dtype=np.float32), (600, 1))
    image = Image.fromarray(shade.astype(np.uint8), "L")
    draw = ImageDraw.Draw(image)
    for row in range(100, 500, 60):
        draw.rectangle((60, row, 740, row + 6), fill=20)
    return image


def test_adaptive_black_white_keeps_shaded_paper_white() -> None:
    result = np.asarray(adaptive_black_white(_unevenly_lit_page()).convert("L"))
    dark_side_paper = result[20:90, 0:300]
    assert (dark_side_paper == 255).mean() > 0.95
    assert (result[102:105, 80:720] == 0).mean() > 0.95


@pytest.fixture
def scanned_pdf(tmp_path: Path) -> Path:
    picture = _unevenly_lit_page().convert("RGB")
    buffer = io.BytesIO()
    picture.save(buffer, format="PNG")
    document = pymupdf.open()
    for _ in range(2):
        page = document.new_page()
        page.insert_image(page.rect, stream=buffer.getvalue())
    path = tmp_path / "scan.pdf"
    document.save(path)
    document.close()
    return path


def test_preview_returns_before_and_after_pictures(scanned_pdf: Path) -> None:
    result = enhance_preview(
        EnhancePreviewParams(path=str(scanned_pdf), page=1, mode="bw", deskew=False),
        silent_progress(),
    )
    assert result.page_count == 2
    assert result.after_format == "png"
    before = Image.open(io.BytesIO(base64.b64decode(result.before)))
    after = Image.open(io.BytesIO(base64.b64decode(result.after)))
    assert before.size == (result.width, result.height)
    assert after.size == before.size
    assert after.mode == "1"


def test_preview_rejects_a_page_outside_the_document(scanned_pdf: Path) -> None:
    with pytest.raises(OpError) as caught:
        enhance_preview(EnhancePreviewParams(path=str(scanned_pdf), page=5), silent_progress())
    assert caught.value.data == {"reason": "page"}


def _landscape_photo(tmp_path: Path) -> Path:
    path = tmp_path / "wide.png"
    Image.new("RGB", (400, 200), (240, 240, 240)).save(path)
    return path


def test_photo_rotation_turns_the_page(tmp_path: Path) -> None:
    photo = _landscape_photo(tmp_path)
    result = from_photo(
        PhotoParams(
            images=[str(photo)],
            output=str(tmp_path / "out.pdf"),
            auto_crop=False,
            whiten=False,
            rotations=[90],
        ),
        silent_progress(),
    )
    assert (result.pages[0].width, result.pages[0].height) == (200, 400)
    with pymupdf.open(result.output) as document:
        assert document[0].rect.height > document[0].rect.width


def test_photo_rotations_must_match_the_photos(tmp_path: Path) -> None:
    photo = _landscape_photo(tmp_path)
    with pytest.raises(OpError) as caught:
        from_photo(
            PhotoParams(images=[str(photo)], output=str(tmp_path / "out.pdf"), rotations=[0, 90]),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "invalidRotations"}
