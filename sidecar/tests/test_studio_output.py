from pathlib import Path

import numpy as np
import pymupdf
import pytest
from PIL import Image
from pydantic import ValidationError

from vivepdf.ops._studio_models import StudioRenderParams
from vivepdf.ops.studio import render
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

SQUARE = "M0 0 L200 0 L200 200 L0 200 Z"


def _render(folder: Path, items: list[dict], **extra) -> StudioRenderParams:
    payload = {
        "pages": [{"width": 300, "height": 300, "items": items}],
        "output": str(folder / "design.pdf"),
        "overwrite": True,
    }
    payload.update(extra)
    return render(StudioRenderParams.model_validate(payload), silent_progress())


def _pixels(path: str) -> np.ndarray:
    with pymupdf.open(path) as document:
        pixmap = document[0].get_pixmap(alpha=False)
        return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)


def _near(pixels: np.ndarray, x: int, y: int, expected: tuple[int, int, int]) -> bool:
    return all(
        abs(int(value) - want) <= 2 for value, want in zip(pixels[y, x], expected, strict=True)
    )


def _framed(**extra) -> dict:
    item = {
        "kind": "vector",
        "x": 50,
        "y": 50,
        "width": 200,
        "height": 200,
        "paths": [
            {
                "d": SQUARE,
                "fill": {"type": "solid", "color": "#ff0000"},
                "stroke": {"color": "#0000ff", "width": 40},
            }
        ],
    }
    item.update(extra)
    return item


def test_a_see_through_shape_fades_as_one_group_like_the_canvas(tmp_path: Path):
    pixels = _pixels(_render(tmp_path, [_framed(opacity=0.5)]).output)

    assert _near(pixels, 55, 150, (128, 128, 255))
    assert _near(pixels, 35, 150, (128, 128, 255))
    assert _near(pixels, 150, 150, (255, 128, 128))


def test_a_see_through_path_with_fill_and_stroke_is_grouped_too(tmp_path: Path):
    item = _framed()
    item["paths"][0]["opacity"] = 0.5

    pixels = _pixels(_render(tmp_path, [item]).output)

    assert _near(pixels, 55, 150, (128, 128, 255))
    assert _near(pixels, 150, 150, (255, 128, 128))


def test_see_through_svg_and_qr_items_fade_as_one_group(tmp_path: Path):
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
        '<rect width="100" height="100" fill="#ff0000"/>'
        '<rect x="50" width="50" height="100" fill="#0000ff"/></svg>'
    )
    red = {
        "kind": "vector",
        "x": 0,
        "y": 150,
        "width": 300,
        "height": 150,
        "paths": [
            {"d": "M0 0 L300 0 L300 150 L0 150 Z", "fill": {"type": "solid", "color": "#ff0000"}}
        ],
    }
    items = [
        {"kind": "svg", "x": 0, "y": 0, "width": 100, "height": 100, "svg": svg, "opacity": 0.5},
        red,
        {
            "kind": "qr",
            "x": 150,
            "y": 150,
            "width": 150,
            "height": 150,
            "value": "vive",
            "opacity": 0.5,
        },
    ]

    pixels = _pixels(_render(tmp_path, items).output)

    assert _near(pixels, 25, 50, (255, 128, 128))
    assert _near(pixels, 75, 50, (128, 128, 255))
    qr = pixels[150:300, 150:300].reshape(-1, 3).astype(int)
    grouped_dark = np.all(np.abs(qr - (128, 0, 0)) <= 2, axis=1).sum()
    stacked_dark = np.all(np.abs(qr - (128, 64, 64)) <= 2, axis=1).sum()
    assert grouped_dark > 1000
    assert stacked_dark == 0


def test_transparent_png_keeps_empty_areas_see_through(tmp_path: Path):
    shape = {
        **_framed(),
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "paths": [
            {"d": "M0 0 L100 0 L100 100 L0 100 Z", "fill": {"type": "solid", "color": "#ff0000"}}
        ],
    }

    result = _render(
        tmp_path, [shape], output=str(tmp_path / "card.png"), format="png", dpi=72, transparent=True
    )

    with Image.open(result.output) as picture:
        assert picture.mode == "RGBA"
        assert picture.getpixel((50, 50)) == (255, 0, 0, 255)
        assert picture.getpixel((200, 200))[3] == 0


def test_transparency_is_ignored_for_jpeg_and_quality_shrinks_the_file(tmp_path: Path):
    noisy = {
        "kind": "vector",
        "x": 0,
        "y": 0,
        "width": 300,
        "height": 300,
        "paths": [
            {
                "d": "M0 0 L300 0 L300 300 L0 300 Z",
                "fill": {
                    "type": "radial",
                    "cx": 150,
                    "cy": 150,
                    "r": 40,
                    "stops": [
                        {"offset": 0, "color": "#ff0000"},
                        {"offset": 0.5, "color": "#00ff00"},
                        {"offset": 1, "color": "#0000ff"},
                    ],
                },
            }
        ],
    }
    sizes = {}
    for quality in (20, 95):
        result = _render(
            tmp_path,
            [noisy],
            output=str(tmp_path / f"q{quality}.jpg"),
            format="jpg",
            dpi=150,
            quality=quality,
            transparent=True,
        )
        sizes[quality] = result.bytes
        with Image.open(result.output) as picture:
            assert picture.mode == "RGB"
    assert sizes[20] < sizes[95]


def test_pictures_are_named_after_the_chosen_page_numbers(tmp_path: Path):
    pages = [{"width": 72, "height": 36, "items": []}] * 2
    params = StudioRenderParams.model_validate(
        {
            "pages": pages,
            "output": str(tmp_path / "card.png"),
            "format": "png",
            "pageNumbers": [2, 5],
        }
    )

    result = render(params, silent_progress())

    assert [Path(path).name for path in result.outputs] == ["card-2.png", "card-5.png"]


def test_page_numbers_must_match_the_pages(tmp_path: Path):
    params = StudioRenderParams.model_validate(
        {
            "pages": [{"width": 72, "height": 36}],
            "output": str(tmp_path / "a.png"),
            "format": "png",
            "pageNumbers": [1, 2],
        }
    )

    with pytest.raises(OpError) as caught:
        render(params, silent_progress())

    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "badPageNumbers"}


@pytest.mark.parametrize(
    "extra",
    [{"quality": 5}, {"quality": 101}, {"pageNumbers": [0]}, {"transparent": "maybe"}],
)
def test_out_of_range_output_options_fail_validation(tmp_path: Path, extra: dict):
    payload = {"pages": [{"width": 72, "height": 36}], "output": str(tmp_path / "a.png")}
    with pytest.raises(ValidationError):
        StudioRenderParams.model_validate({**payload, **extra})
