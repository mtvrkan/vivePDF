from pathlib import Path

import numpy as np
import pymupdf
import pytest
from PIL import Image
from pydantic import ValidationError

from vivepdf.ops._studio_models import StudioRenderParams
from vivepdf.ops.studio import render
from vivepdf.rpc.progress import silent_progress

WHITE = (255, 255, 255)
RED = (255, 0, 0)


def _render(folder: Path, items: list[dict], **extra) -> Path:
    payload = {
        "pages": [{"width": 300, "height": 300, "items": items}],
        "output": str(folder / "shapes.pdf"),
        "overwrite": True,
    }
    payload.update(extra)
    return Path(render(StudioRenderParams.model_validate(payload), silent_progress()).output)


def _pixels(path: Path) -> np.ndarray:
    with pymupdf.open(path) as document:
        pixmap = document[0].get_pixmap(alpha=False)
        return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)


def _at(pixels: np.ndarray, x: float, y: float) -> tuple[int, int, int]:
    return tuple(int(value) for value in pixels[int(y), int(x)])


def _close(
    actual: tuple[int, int, int], expected: tuple[int, int, int], tolerance: int = 6
) -> bool:
    return all(abs(a - b) <= tolerance for a, b in zip(actual, expected, strict=True))


def _vector(x: float, y: float, width: float, height: float, d: str | None = None, **extra) -> dict:
    item = {
        "kind": "vector",
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "paths": [
            {
                "d": d or f"M0 0 L{width} 0 L{width} {height} L0 {height} Z",
                "fill": {"type": "solid", "color": "#ff0000"},
            }
        ],
    }
    item.update(extra)
    return item


def _shadowed(content: dict, **shadow) -> list[dict]:
    box = {key: content[key] for key in ("x", "y", "width", "height")}
    box["rotation"] = content.get("rotation", 0)
    box["opacity"] = content.get("opacity", 1)
    values = {"color": "#000000", "opacity": 1, "x": 10, "y": 10, "blur": 0}
    values.update(shadow)
    return [
        {**box, "kind": "shadow", "shadow": values, "items": [{**content, "opacity": 1}]},
        content,
    ]


def test_a_sharp_shadow_sits_under_the_shape_at_its_offset(tmp_path: Path):
    pixels = _pixels(_render(tmp_path, _shadowed(_vector(50, 50, 100, 100))))

    assert _at(pixels, 100, 100) == RED
    assert _close(_at(pixels, 155, 155), (0, 0, 0))
    assert _close(_at(pixels, 155, 55), WHITE)
    assert _close(_at(pixels, 45, 155), WHITE)


def test_a_blurred_shadow_fades_across_its_edge(tmp_path: Path):
    pixels = _pixels(_render(tmp_path, _shadowed(_vector(50, 50, 100, 100), x=0, y=30, blur=20)))

    inside = _at(pixels, 100, 175)[0]
    edge = _at(pixels, 100, 180)[0]
    outside = _at(pixels, 100, 200)[0]
    far = _at(pixels, 100, 215)[0]
    assert inside < edge < outside < far
    assert 100 <= edge <= 155
    assert far >= 245


def test_the_shadow_offset_stays_in_page_space_when_the_shape_turns(tmp_path: Path):
    pixels = _pixels(
        _render(tmp_path, _shadowed(_vector(100, 50, 100, 40, rotation=90), x=20, y=0))
    )

    assert _at(pixels, 150, 70) == RED
    assert _close(_at(pixels, 175, 70), (0, 0, 0))
    assert _close(_at(pixels, 125, 70), WHITE)


def test_a_see_through_shape_hides_its_own_shadow(tmp_path: Path):
    content = _vector(50, 50, 100, 100, opacity=0.5)
    pixels = _pixels(_render(tmp_path, _shadowed(content)))

    assert _close(_at(pixels, 70, 70), (255, 128, 128))
    assert _close(_at(pixels, 140, 140), (255, 128, 128))
    assert _close(_at(pixels, 155, 155), (128, 128, 128))


def test_pictures_and_qr_codes_cast_shadows(tmp_path: Path):
    picture = tmp_path / "blue.png"
    Image.new("RGB", (40, 40), (0, 0, 255)).save(picture)
    image = {"kind": "image", "x": 20, "y": 20, "width": 80, "height": 80, "path": str(picture)}
    code = {"kind": "qr", "x": 160, "y": 160, "width": 80, "height": 80, "value": "vivePDF"}
    pixels = _pixels(_render(tmp_path, [*_shadowed(image, color="#00ff00"), *_shadowed(code)]))

    assert _close(_at(pixels, 60, 60), (0, 0, 255))
    assert _close(_at(pixels, 105, 105), (0, 255, 0))
    assert _close(_at(pixels, 245, 245), (0, 0, 0))


def test_shadow_png_export_matches_the_pdf(tmp_path: Path):
    output = _render(tmp_path, _shadowed(_vector(50, 50, 100, 100), blur=8), format="png", dpi=72)
    with Image.open(output) as picture:
        pixels = np.asarray(picture.convert("RGB"))

    assert _at(pixels, 100, 100) == RED
    assert _at(pixels, 158, 100)[0] < 200
    assert _at(pixels, 175, 100)[0] > 240


def test_shadows_reject_text_and_bad_blur():
    text = {"kind": "text", "x": 0, "y": 0, "width": 10, "height": 10, "runs": [{"text": "a"}]}
    box = {"x": 0, "y": 0, "width": 10, "height": 10}
    with pytest.raises(ValidationError):
        StudioRenderParams.model_validate(
            {
                "pages": [
                    {
                        "width": 50,
                        "height": 50,
                        "items": [
                            {
                                **box,
                                "kind": "shadow",
                                "shadow": {"color": "#000000"},
                                "items": [text],
                            }
                        ],
                    }
                ]
            }
        )
    with pytest.raises(ValidationError):
        StudioRenderParams.model_validate(
            {
                "pages": [
                    {"width": 50, "height": 50, "items": _shadowed(_vector(0, 0, 10, 10), blur=-1)}
                ]
            }
        )


def test_arrowheads_are_drawn_as_vector_paths(tmp_path: Path):
    stroke = {"color": "#0000ff", "width": 4}
    line = {
        "kind": "vector",
        "x": 20,
        "y": 140,
        "width": 260,
        "height": 20,
        "paths": [
            {"d": "M8.4 10 L251.6 10", "stroke": stroke},
            {"d": "M0 10 L14 3 L10.5 10 L14 17 Z", "fill": {"type": "solid", "color": "#0000ff"}},
            {"d": "M260 10 L246 3 L246 17 Z", "fill": {"type": "solid", "color": "#0000ff"}},
        ],
    }
    pixels = _pixels(_render(tmp_path, [line]))

    assert _at(pixels, 150, 150) == (0, 0, 255)
    assert _at(pixels, 277, 150) == (0, 0, 255)
    assert _at(pixels, 268, 145) == (0, 0, 255)
    assert _at(pixels, 268, 141) == WHITE
    assert _at(pixels, 24, 150) == (0, 0, 255)


def test_each_corner_keeps_its_own_radius(tmp_path: Path):
    d = "M40 0 L100 0 L100 100 L0 100 L0 40 C0 17.909 17.909 0 40 0 Z"
    pixels = _pixels(_render(tmp_path, [_vector(100, 100, 100, 100, d=d)]))

    assert _at(pixels, 103, 103) == WHITE
    assert _at(pixels, 197, 103) == RED
    assert _at(pixels, 197, 197) == RED
    assert _at(pixels, 103, 197) == RED
    assert _at(pixels, 130, 130) == RED
