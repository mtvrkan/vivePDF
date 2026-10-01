import base64
import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFilter

from vivepdf.ops.photo import (
    PhotoDetectParams,
    PhotoParams,
    find_paper_quad,
    from_photo,
    ordered_corners,
    photo_detect,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

PAPER = [(300.0, 180.0), (1320.0, 240.0), (1260.0, 1080.0), (240.0, 1010.0)]


def _scene(table: tuple[int, int, int], paper: tuple[int, int, int], noise: float) -> Image.Image:
    rng = np.random.default_rng(7)
    base = np.full((1200, 1600, 3), table, dtype=np.float64) + rng.normal(0, noise, (1200, 1600, 3))
    image = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    draw = ImageDraw.Draw(image)
    draw.polygon(PAPER, fill=paper)
    for row in range(10):
        y = PAPER[0][1] + 80 + row * 55
        draw.line([(PAPER[0][0] + 90, y), (PAPER[1][0] - 110, y + 15)], fill=(30, 30, 30), width=5)
    return image.filter(ImageFilter.GaussianBlur(1))


def _worst_error(quad: list[tuple[float, float]]) -> float:
    return max(float(np.hypot(a[0] - b[0], a[1] - b[1])) for a, b in zip(quad, PAPER, strict=True))


def _saved(image: Image.Image, path: Path) -> Path:
    image.save(path, quality=92)
    return path


def test_white_paper_on_a_light_table_is_found() -> None:
    quad = find_paper_quad(_scene((226, 223, 218), (250, 250, 248), 5))
    assert quad is not None
    assert _worst_error(quad) < 25


def test_paper_on_a_dark_table_is_still_found() -> None:
    quad = find_paper_quad(_scene((70, 55, 45), (238, 235, 228), 6))
    assert quad is not None
    assert _worst_error(quad) < 10


def test_manual_corners_override_detection(tmp_path: Path) -> None:
    photo = _saved(_scene((241, 241, 239), (252, 252, 252), 3), tmp_path / "beyaz masa ş.jpg")
    shuffled = [PAPER[2], PAPER[0], PAPER[3], PAPER[1]]
    result = from_photo(
        PhotoParams(
            images=[str(photo)],
            output=str(tmp_path / "elle köşe.pdf"),
            whiten=False,
            corners=[shuffled],
        ),
        silent_progress(),
    )
    page = result.pages[0]
    assert page.cropped is True
    assert abs(page.width - 1022) < 30
    assert abs(page.height - 842) < 30


def test_a_missing_corner_set_falls_back_to_detection(tmp_path: Path) -> None:
    photo = _saved(_scene((70, 55, 45), (238, 235, 228), 6), tmp_path / "koyu.jpg")
    flat = _saved(Image.new("RGB", (500, 400), (250, 250, 250)), tmp_path / "düz.jpg")
    result = from_photo(
        PhotoParams(
            images=[str(photo), str(flat)],
            output=str(tmp_path / "karışık.pdf"),
            corners=[None, [(10, 10), (480, 20), (470, 380), (20, 390)]],
        ),
        silent_progress(),
    )
    assert [page.cropped for page in result.pages] == [True, True]
    assert result.pages[1].width < 500


@pytest.mark.parametrize(
    "corners",
    [
        [(10, 10), (400, 10), (400, 300)],
        [(10, 10), (400, 10), (400, 300), (9000, 300)],
        [(10, 10), (400, 10), (400, 300), (300, 100)],
        [(10, 10), (12, 10), (12, 12), (10, 12)],
        [(10, 10), (float("nan"), 10), (400, 300), (10, 300)],
    ],
)
def test_unusable_corners_are_refused(tmp_path: Path, corners: list[tuple[float, float]]) -> None:
    flat = _saved(Image.new("RGB", (500, 400), (250, 250, 250)), tmp_path / "flat.jpg")
    with pytest.raises(OpError) as caught:
        from_photo(
            PhotoParams(images=[str(flat)], output=str(tmp_path / "x.pdf"), corners=[corners]),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "invalidCorners"}


def test_one_corner_set_is_needed_per_photo(tmp_path: Path) -> None:
    flat = _saved(Image.new("RGB", (500, 400), (250, 250, 250)), tmp_path / "flat.jpg")
    with pytest.raises(OpError) as caught:
        from_photo(
            PhotoParams(images=[str(flat)], output=str(tmp_path / "x.pdf"), corners=[None, None]),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "invalidCorners"}


def test_corners_are_ordered_from_the_top_left_clockwise() -> None:
    assert ordered_corners([(90, 95), (5, 3), (4, 90), (100, 0)]) == [
        (5, 3),
        (100, 0),
        (90, 95),
        (4, 90),
    ]


def test_detection_returns_corners_and_a_preview(tmp_path: Path) -> None:
    photo = _saved(_scene((70, 55, 45), (238, 235, 228), 6), tmp_path / "önizleme.jpg")
    found = photo_detect(PhotoDetectParams(image=str(photo), preview_side=400), silent_progress())
    assert found.detected is True
    assert (found.width, found.height) == (1600, 1200)
    assert _worst_error(found.corners) < 10
    assert (found.preview_width, found.preview_height) == (400, 300)
    with Image.open(io.BytesIO(base64.b64decode(found.preview))) as preview:
        assert preview.size == (400, 300)


def test_detection_without_paper_offers_the_whole_frame(tmp_path: Path) -> None:
    flat = _saved(Image.new("RGB", (500, 400), (250, 250, 250)), tmp_path / "flat.jpg")
    found = photo_detect(PhotoDetectParams(image=str(flat)), silent_progress())
    assert found.detected is False
    assert found.corners == [(0.0, 0.0), (499.0, 0.0), (499.0, 399.0), (0.0, 399.0)]


def test_detection_of_an_unreadable_file_is_refused(tmp_path: Path) -> None:
    broken = tmp_path / "bozuk.jpg"
    broken.write_bytes(b"not a picture")
    with pytest.raises(OpError) as caught:
        photo_detect(PhotoDetectParams(image=str(broken)), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PARAMS


@pytest.mark.parametrize("noise", [3, 5])
def test_near_white_paper_on_a_near_white_table_is_found(noise: int) -> None:
    quad = find_paper_quad(_scene((240, 240, 238), (252, 252, 252), noise))
    assert quad is not None
    assert _worst_error(quad) < 25


def test_an_even_bright_photo_has_no_paper() -> None:
    rng = np.random.default_rng(11)
    noise = np.clip(rng.normal(240, 4, (900, 1200, 3)), 0, 255).astype(np.uint8)
    assert find_paper_quad(Image.fromarray(noise)) is None


def _tiff(tmp_path: Path, name: str, frames: int = 3) -> Path:
    pictures = [_scene((70, 55, 45), (238, 235, 228), 6) for _ in range(frames)]
    path = tmp_path / name
    pictures[0].save(path, save_all=True, append_images=pictures[1:], compression="tiff_lzw")
    return path


def test_one_corner_set_straightens_every_frame(tmp_path: Path) -> None:
    tiff = _tiff(tmp_path, "çok sayfa.tif")
    box = [(100.0, 100.0), (900.0, 100.0), (900.0, 700.0), (100.0, 700.0)]
    result = from_photo(
        PhotoParams(
            images=[str(tiff)], output=str(tmp_path / "hepsi.pdf"), whiten=False, corners=[box]
        ),
        silent_progress(),
    )
    assert [page.cropped for page in result.pages] == [True, True, True]
    assert all(abs(page.width - 800) < 10 for page in result.pages)


def test_a_frame_can_have_its_own_corners(tmp_path: Path) -> None:
    tiff = _tiff(tmp_path, "kare.tif")
    shared = [(100.0, 100.0), (900.0, 100.0), (900.0, 700.0), (100.0, 700.0)]
    second = [(0.0, 0.0), (400.0, 0.0), (400.0, 300.0), (0.0, 300.0)]
    result = from_photo(
        PhotoParams(
            images=[str(tiff)],
            output=str(tmp_path / "kare.pdf"),
            whiten=False,
            corners=[shared],
            frame_corners=[[None, second]],
        ),
        silent_progress(),
    )
    widths = [page.width for page in result.pages]
    assert abs(widths[0] - 800) < 10
    assert abs(widths[1] - 400) < 10
    assert abs(widths[2] - 800) < 10


def test_frame_corners_need_one_entry_per_photo(tmp_path: Path) -> None:
    tiff = _tiff(tmp_path, "eksik.tif", frames=2)
    with pytest.raises(OpError) as caught:
        from_photo(
            PhotoParams(images=[str(tiff)], output=str(tmp_path / "x.pdf"), frame_corners=[]),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "invalidCorners"}


def test_detection_can_look_at_any_frame(tmp_path: Path) -> None:
    tiff = _tiff(tmp_path, "çerçeve.tif")
    found = photo_detect(PhotoDetectParams(image=str(tiff), frame=2), silent_progress())
    assert (found.frames, found.frame) == (3, 2)
    assert found.detected is True
    with pytest.raises(OpError) as caught:
        photo_detect(PhotoDetectParams(image=str(tiff), frame=3), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "frameOutOfRange", "frames": 3}


def test_shared_corners_follow_the_size_of_each_frame(tmp_path: Path) -> None:
    large = _scene((70, 55, 45), (238, 235, 228), 6)
    small = large.resize((800, 600))
    path = tmp_path / "karışık.tif"
    large.save(path, save_all=True, append_images=[small], compression="tiff_lzw")
    box = [(100.0, 100.0), (900.0, 100.0), (900.0, 700.0), (100.0, 700.0)]
    result = from_photo(
        PhotoParams(
            images=[str(path)],
            output=str(tmp_path / "karışık.pdf"),
            whiten=False,
            corners=[box],
            corner_sizes=[(1600.0, 1200.0)],
        ),
        silent_progress(),
    )
    widths = [page.width for page in result.pages]
    assert abs(widths[0] - 800) < 10
    assert abs(widths[1] - 400) < 10


def test_corner_sizes_need_one_entry_per_photo(tmp_path: Path) -> None:
    tiff = _tiff(tmp_path, "boyut.tif", frames=2)
    with pytest.raises(OpError) as caught:
        from_photo(
            PhotoParams(images=[str(tiff)], output=str(tmp_path / "x.pdf"), corner_sizes=[]),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "invalidCorners"}


def test_an_animated_picture_becomes_a_single_page(tmp_path: Path) -> None:
    frames = [_scene((70, 55, 45), (238, 235, 228), 6).resize((400, 300)) for _ in range(3)]
    animated = tmp_path / "hareketli.gif"
    frames[0].save(animated, save_all=True, append_images=frames[1:], duration=100)
    result = from_photo(
        PhotoParams(images=[str(animated)], output=str(tmp_path / "gif.pdf"), auto_crop=False),
        silent_progress(),
    )
    assert result.page_count == 1
    found = photo_detect(PhotoDetectParams(image=str(animated)), silent_progress())
    assert found.frames == 1


def test_a_sixteen_bit_photo_keeps_its_greys(tmp_path: Path) -> None:
    deep = tmp_path / "derin.png"
    Image.new("I;16", (400, 300), 32000).save(deep)
    found = photo_detect(PhotoDetectParams(image=str(deep)), silent_progress())
    preview = Image.open(io.BytesIO(base64.b64decode(found.preview)))
    assert 110 < preview.convert("L").getpixel((10, 10)) < 140


def test_a_photo_beyond_the_safe_size_is_refused_with_its_own_reason(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from vivepdf.ops import _image_files

    monkeypatch.setattr(_image_files, "LARGE_PICTURE_PIXELS", 10_000)
    big = _saved(Image.new("RGB", (200, 200), (200, 200, 200)), tmp_path / "buyuk.jpg")
    with pytest.raises(OpError) as caught:
        photo_detect(PhotoDetectParams(image=str(big)), silent_progress())
    assert caught.value.data["reason"] == "pictureTooLarge"


def test_a_photo_above_the_usual_decoder_limit_still_opens(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1_000)
    big = _saved(Image.new("RGB", (200, 200), (200, 200, 200)), tmp_path / "genis.jpg")
    found = photo_detect(PhotoDetectParams(image=str(big)), silent_progress())
    assert (found.width, found.height) == (200, 200)
    assert Image.MAX_IMAGE_PIXELS == 1_000


def test_a_very_large_photo_is_decoded_at_a_workable_size(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from vivepdf.ops import photo

    monkeypatch.setattr(photo, "MAX_DECODE_SIDE", 500)
    big = _saved(Image.new("RGB", (2000, 1500), (200, 200, 200)), tmp_path / "dev.jpg")
    found = photo_detect(PhotoDetectParams(image=str(big)), silent_progress())
    assert max(found.width, found.height) == 500


def test_an_unreadable_photo_names_its_reason(tmp_path: Path) -> None:
    broken = tmp_path / "bozuk.jpg"
    broken.write_bytes(b"not a picture")
    with pytest.raises(OpError) as caught:
        from_photo(
            PhotoParams(images=[str(broken)], output=str(tmp_path / "x.pdf")), silent_progress()
        )
    assert caught.value.data["reason"] == "imageUnreadable"
