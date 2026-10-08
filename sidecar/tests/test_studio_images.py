import base64
import io
from pathlib import Path

import numpy as np
import pymupdf
import pytest
from PIL import Image
from pydantic import ValidationError

from vivepdf.ops._studio_models import StudioRenderParams, StudioSaveImageParams
from vivepdf.ops.studio import render
from vivepdf.ops.studio_images import save_image
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

ARABIC = "".join(map(chr, (0x0633, 0x0627, 0x0631, 0x0629)))
BLUE = {"type": "solid", "color": "#0000ff"}
RED = {"type": "solid", "color": "#ff0000"}


@pytest.fixture(autouse=True)
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    folder = tmp_path / "data"
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(folder))
    return folder


def _pixels(folder: Path, items: list[dict]) -> np.ndarray:
    payload = {
        "pages": [{"width": 300, "height": 300, "items": items}],
        "output": str(folder / "flip.pdf"),
        "overwrite": True,
    }
    output = render(StudioRenderParams.model_validate(payload), silent_progress()).output
    with pymupdf.open(output) as document:
        pixmap = document[0].get_pixmap(alpha=False)
        return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)


def _blue(pixels: np.ndarray) -> tuple[float, float]:
    rows, columns = np.where((pixels[:, :, 2] > 200) & (pixels[:, :, 0] < 60))
    return float(columns.mean()), float(rows.mean())


def _ink(pixels: np.ndarray) -> tuple[int, int, int, int]:
    rows, columns = np.where(pixels.min(axis=2) < 160)
    return int(columns.min()), int(rows.min()), int(columns.max()), int(rows.max())


def _marked_bar(**extra) -> dict:
    item = {
        "kind": "vector",
        "x": 100,
        "y": 140,
        "width": 100,
        "height": 20,
        "paths": [
            {"d": "M0 0 L100 0 L100 20 L0 20 Z", "fill": RED},
            {"d": "M0 0 L10 0 L10 20 L0 20 Z", "fill": BLUE},
        ],
    }
    item.update(extra)
    return item


def _picture(folder: Path, name: str = "photo.png") -> Path:
    array = np.zeros((40, 80, 3), dtype=np.uint8)
    array[:, :40] = (255, 0, 0)
    array[:, 40:] = (0, 0, 255)
    target = folder / name
    Image.fromarray(array).save(target)
    return target


def test_a_flipped_drawing_mirrors_inside_its_own_box(tmp_path: Path):
    plain = _blue(_pixels(tmp_path, [_marked_bar()]))
    across = _blue(_pixels(tmp_path, [_marked_bar(flipX=True)]))
    upside = _pixels(tmp_path, [_marked_bar(flipY=True, paths=[_marked_bar()["paths"][0]])])

    assert plain[0] == pytest.approx(105, abs=1)
    assert across[0] == pytest.approx(195, abs=1)
    assert across[1] == pytest.approx(150, abs=1)
    assert tuple(upside[150, 150]) == (255, 0, 0)


def test_flipping_happens_in_the_rotated_frame_like_css(tmp_path: Path):
    turned = _blue(_pixels(tmp_path, [_marked_bar(rotation=90)]))
    turned_and_flipped = _blue(_pixels(tmp_path, [_marked_bar(rotation=90, flipX=True)]))

    assert turned == pytest.approx((150, 105), abs=1)
    assert turned_and_flipped == pytest.approx((150, 195), abs=1)


def test_flipped_images_qr_codes_and_svgs_are_exact_mirrors(tmp_path: Path):
    picture = _picture(tmp_path)
    image = {"kind": "image", "x": 100, "y": 100, "width": 100, "height": 50, "path": str(picture)}
    qr = {"kind": "qr", "x": 100, "y": 100, "width": 100, "height": 100, "value": "vivePDF"}
    svg = {
        "kind": "svg",
        "x": 100,
        "y": 100,
        "width": 100,
        "height": 100,
        "svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
        '<path d="M0 0 L10 0 L0 10 Z" fill="#000000"/></svg>',
    }

    image_left = _pixels(tmp_path, [{**image, "flipX": True}])[125, 110]
    for item, flips, mirrored in (
        (qr, {"flipX": True}, np.fliplr),
        (svg, {"flipY": True}, np.flipud),
    ):
        plain = _pixels(tmp_path, [item])[100:200, 100:200].min(axis=2) < 128
        flipped = _pixels(tmp_path, [{**item, **flips}])[100:200, 100:200].min(axis=2) < 128
        assert np.mean(mirrored(plain) == flipped) > 0.97
        assert np.mean(plain == flipped) < 0.97

    assert image_left[2] > 200 and image_left[0] < 60


def test_flipped_text_mirrors_its_glyphs_inside_the_box(tmp_path: Path):
    text = {
        "kind": "text",
        "x": 20,
        "y": 20,
        "width": 260,
        "height": 120,
        "runs": [{"text": "Hello"}],
        "fontSize": 28,
    }

    left, top, right, bottom = _ink(_pixels(tmp_path, [text]))
    mirrored = _ink(_pixels(tmp_path, [{**text, "flipX": True}]))
    upside = _ink(_pixels(tmp_path, [{**text, "flipY": True}]))

    assert left < 30 and mirrored[2] > 270
    assert mirrored[2] - mirrored[0] == pytest.approx(right - left, abs=2)
    assert top < 40 and upside[3] > 120


def test_flipped_shaped_text_moves_to_the_mirrored_side(tmp_path: Path):
    text = {
        "kind": "text",
        "x": 20,
        "y": 20,
        "width": 260,
        "height": 80,
        "runs": [{"text": ARABIC}],
        "fontSize": 24,
    }

    plain = _ink(_pixels(tmp_path, [text]))
    mirrored = _ink(_pixels(tmp_path, [{**text, "flipX": True}]))

    assert plain[0] < 50 and mirrored[2] > 250
    assert mirrored[2] - mirrored[0] == pytest.approx(plain[2] - plain[0], abs=2)


def test_a_flipped_shape_casts_a_mirrored_shadow_at_the_same_page_offset(tmp_path: Path):
    wedge = {
        "kind": "vector",
        "x": 100,
        "y": 100,
        "width": 100,
        "height": 100,
        "flipX": True,
        "paths": [{"d": "M0 0 L100 0 L0 100 Z", "fill": BLUE}],
    }
    shadow = {"color": "#ff0000", "opacity": 1, "x": 30, "y": 30, "blur": 0}
    box = {key: wedge[key] for key in ("x", "y", "width", "height", "flipX")}
    items = [{**box, "kind": "shadow", "shadow": shadow, "items": [wedge]}, wedge]

    pixels = _pixels(tmp_path, items)

    assert tuple(pixels[105, 195]) == (0, 0, 255)
    assert tuple(pixels[195, 105]) == (255, 255, 255)
    assert tuple(pixels[130, 170]) == (0, 0, 255)
    assert tuple(pixels[150, 220]) == (255, 0, 0)
    assert tuple(pixels[205, 215]) == (255, 0, 0)
    assert tuple(pixels[200, 140]) == (255, 255, 255)


def _css_grayscale(rgb: tuple[int, int, int]) -> float:
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def test_image_filters_match_the_canvas_colour_matrix(tmp_path: Path):
    picture = _picture(tmp_path)
    grey = [0.2126, 0.7152, 0.0722, 0] * 3
    faded = [0.5, 0, 0, 0.25, 0, 0.5, 0, 0.25, 0, 0, 0.5, 0.25]
    image = {"kind": "image", "x": 100, "y": 100, "width": 80, "height": 40, "path": str(picture)}

    greyed = _pixels(tmp_path, [{**image, "filter": grey}])
    softened = _pixels(tmp_path, [{**image, "filter": faded}])

    expected_red = _css_grayscale((255, 0, 0))
    assert np.abs(greyed[120, 110].astype(float) - expected_red).max() <= 4
    assert np.abs(greyed[120, 170].astype(float) - _css_grayscale((0, 0, 255))).max() <= 4
    assert np.abs(softened[120, 110].astype(float) - (191.25, 63.75, 63.75)).max() <= 4


def test_filters_keep_transparency(tmp_path: Path):
    array = np.zeros((20, 20, 4), dtype=np.uint8)
    array[:, :10] = (255, 0, 0, 255)
    target = tmp_path / "clear.png"
    Image.fromarray(array, mode="RGBA").save(target)
    item = {
        "kind": "image",
        "x": 100,
        "y": 100,
        "width": 100,
        "height": 100,
        "path": str(target),
        "filter": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    }

    pixels = _pixels(tmp_path, [item])

    assert tuple(pixels[150, 120]) == (0, 0, 0)
    assert tuple(pixels[150, 180]) == (255, 255, 255)


def test_a_filter_needs_twelve_bounded_numbers(tmp_path: Path):
    image = {"kind": "image", "x": 0, "y": 0, "width": 10, "height": 10, "path": "a.png"}
    with pytest.raises(ValidationError):
        StudioRenderParams.model_validate(
            {"pages": [{"width": 50, "height": 50, "items": [{**image, "filter": [1, 0, 0]}]}]}
        )
    with pytest.raises(ValidationError):
        StudioRenderParams.model_validate(
            {"pages": [{"width": 50, "height": 50, "items": [{**image, "filter": [99] * 12}]}]}
        )


def _encoded(image: Image.Image, format_name: str) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format=format_name)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def test_pasted_images_are_saved_once_in_the_data_folder(data_dir: Path):
    data = _encoded(Image.new("RGB", (30, 20), (10, 200, 30)), "PNG")

    first = save_image(StudioSaveImageParams(data=data), silent_progress())
    again = save_image(StudioSaveImageParams(data=data), silent_progress())

    saved = Path(first.path)
    assert saved.parent == data_dir / "studio-images"
    assert saved.suffix == ".png" and saved.is_file()
    assert (first.width, first.height) == (30, 20)
    assert again.path == first.path
    assert len(list(saved.parent.iterdir())) == 1


def test_pasted_jpeg_keeps_its_format_and_upright_size():
    picture = Image.new("RGB", (40, 10), (200, 10, 10))
    exif = picture.getexif()
    exif[0x0112] = 6
    buffer = io.BytesIO()
    picture.save(buffer, format="JPEG", exif=exif)
    data = base64.b64encode(buffer.getvalue()).decode("ascii")

    result = save_image(StudioSaveImageParams(data=data), silent_progress())

    assert result.path.endswith(".jpg")
    assert (result.width, result.height) == (10, 40)


@pytest.mark.parametrize(
    ("data", "reason"),
    [
        ("not base64!", "imageUnreadable"),
        (base64.b64encode(b"plain text, not a picture").decode("ascii"), "imageUnreadable"),
        (_encoded(Image.new("RGB", (16, 16)), "ICO"), "imageUnreadable"),
    ],
)
def test_pasted_data_that_is_not_a_supported_image_is_refused(data: str, reason: str):
    with pytest.raises(OpError) as raised:
        save_image(StudioSaveImageParams(data=data), silent_progress())

    assert raised.value.data["reason"] == reason


def test_an_image_file_is_saved_under_the_same_name_as_its_pasted_data(tmp_path: Path):
    data = _encoded(Image.new("RGB", (24, 12), (30, 60, 220)), "PNG")
    source = tmp_path / "picture.png"
    source.write_bytes(base64.b64decode(data))

    copied = save_image(StudioSaveImageParams(path=str(source)), silent_progress())
    pasted = save_image(StudioSaveImageParams(data=data), silent_progress())

    assert copied.path == pasted.path
    assert copied.path.endswith(".png")
    assert (copied.width, copied.height) == (24, 12)


def test_a_missing_image_file_is_reported(tmp_path: Path):
    with pytest.raises(OpError) as raised:
        save_image(StudioSaveImageParams(path=str(tmp_path / "gone.png")), silent_progress())

    assert raised.value.code == ErrorCode.FILE_NOT_FOUND


def test_a_file_that_is_not_an_image_is_refused(tmp_path: Path):
    source = tmp_path / "notes.png"
    source.write_text("plain text, not a picture", encoding="utf-8")

    with pytest.raises(OpError) as raised:
        save_image(StudioSaveImageParams(path=str(source)), silent_progress())

    assert raised.value.data["reason"] == "imageUnreadable"


@pytest.mark.parametrize("payload", [{}, {"data": "aGVsbG8=", "path": "picture.png"}])
def test_save_image_needs_exactly_one_source(payload: dict):
    with pytest.raises(ValidationError):
        StudioSaveImageParams.model_validate(payload)
