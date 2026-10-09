import math
from pathlib import Path

import numpy as np
import pymupdf
import pytest
from PIL import Image
from pydantic import ValidationError

from vivepdf.ops._studio_finish import shifted
from vivepdf.ops._studio_models import StudioRenderParams
from vivepdf.ops.studio import render
from vivepdf.rpc.progress import silent_progress

GREY = "#808080"
EMBOSS = [
    {"region": "outerAway", "color": "#000000", "opacity": 0.16, "blur": 0.6},
    {"region": "away", "color": "#000000", "opacity": 0.38, "blur": 0.4},
    {"region": "light", "color": "#ffffff", "opacity": 0.85, "blur": 0.4},
]
GOLD = [
    {"offset": offset, "color": colour, "opacity": 1}
    for offset, colour in zip(
        [0, 0.25, 0.45, 0.6, 0.8, 1],
        ["#8a6a1f", "#f7e08a", "#b8892b", "#fff3c4", "#a87b22", "#e9c766"],
        strict=True,
    )
]


def _render(folder: Path, items: list[dict], **extra) -> Path:
    payload = {
        "pages": [{"width": 300, "height": 300, "items": items}],
        "output": str(folder / "finish.pdf"),
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


def _rect(x: float, y: float, width: float, height: float, colour: str, **extra) -> dict:
    item = {
        "kind": "vector",
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "paths": [
            {
                "d": f"M0 0 L{width} 0 L{width} {height} L0 {height} Z",
                "fill": {"type": "solid", "color": colour},
            }
        ],
    }
    item.update(extra)
    return item


def _finished(content: dict, recipe: dict) -> dict:
    box = {key: content[key] for key in ("x", "y", "width", "height")}
    box["rotation"] = content.get("rotation", 0)
    return {**box, "kind": "finish", "recipe": recipe, "items": [{**content, "opacity": 1}]}


def _emboss(depth: float = 3, angle: float = 315, ink: bool = False) -> dict:
    radians = math.radians(angle)
    return {
        "dx": -math.sin(radians) * depth,
        "dy": math.cos(radians) * depth,
        "ink": ink,
        "layers": EMBOSS,
    }


def _ground() -> dict:
    return _rect(0, 0, 300, 300, GREY)


def test_a_blind_emboss_lights_the_top_left_edge_and_shades_the_far_side(tmp_path: Path):
    square = _rect(50, 50, 100, 100, "#ff0000")
    pixels = _pixels(_render(tmp_path, [_ground(), _finished(square, _emboss())]))

    centre = _at(pixels, 100, 100)
    assert max(abs(value - 128) for value in centre) <= 3
    assert _at(pixels, 51, 100)[0] > 180
    assert _at(pixels, 100, 51)[0] > 180
    assert _at(pixels, 148.5, 100)[0] < 105
    assert _at(pixels, 151, 100)[0] < 125
    assert _at(pixels, 48, 100)[0] >= 126


def test_the_light_stays_in_page_space_when_the_element_turns(tmp_path: Path):
    square = _rect(50, 50, 100, 100, "#ff0000", rotation=180)
    pixels = _pixels(_render(tmp_path, [_ground(), _finished(square, _emboss(angle=135))]))

    assert _at(pixels, 51, 100)[0] > 180
    assert _at(pixels, 148.5, 100)[0] < 105


def test_foil_replaces_the_ink_with_a_metal_sweep(tmp_path: Path):
    square = _rect(50, 50, 100, 100, "#0000ff")
    recipe = {
        "dx": 0.3,
        "dy": 0.3,
        "ink": False,
        "layers": [],
        "texture": {"x1": 0, "y1": 0, "x2": 100, "y2": 100, "stops": GOLD, "replace": True},
    }
    pixels = _pixels(_render(tmp_path, [_finished(square, recipe)]))

    dark, bright = _at(pixels, 53, 53), _at(pixels, 75, 75)
    assert dark[0] > dark[2] and bright[0] > bright[2]
    assert sum(bright) > sum(dark) + 150
    assert _at(pixels, 160, 160) == (255, 255, 255)


def test_text_gives_its_glyphs_as_the_finish_shape(tmp_path: Path):
    text = {
        "kind": "text",
        "x": 20,
        "y": 100,
        "width": 260,
        "height": 80,
        "runs": [{"text": "MMMM"}],
        "fontSize": 60,
        "color": "#0000ff",
    }
    recipe = {
        "dx": 0.3,
        "dy": 0.3,
        "ink": False,
        "layers": [],
        "texture": {
            "x1": 0,
            "y1": 0,
            "x2": 260,
            "y2": 80,
            "stops": [{"offset": 0, "color": "#ffcc00", "opacity": 1}],
            "replace": True,
        },
    }
    pixels = _pixels(_render(tmp_path, [_finished(text, recipe)]))

    region = pixels[100:180, 20:280].reshape(-1, 3).astype(int)
    golden = (region[:, 0] > 200) & (region[:, 1] > 150) & (region[:, 2] < 80)
    blue = (region[:, 2] > 200) & (region[:, 0] < 80)
    assert golden.sum() > 500
    assert blue.sum() == 0


def test_finish_png_export_matches_the_pdf(tmp_path: Path):
    square = _rect(50, 50, 100, 100, "#ff0000")
    output = _render(tmp_path, [_ground(), _finished(square, _emboss())], format="png", dpi=72)
    with Image.open(output) as picture:
        pixels = np.asarray(picture.convert("RGB"))

    assert _at(pixels, 51, 100)[0] > 180
    assert _at(pixels, 148.5, 100)[0] < 105


def test_a_fractional_shift_spreads_coverage_between_neighbours():
    values = np.zeros((3, 4), dtype=np.float32)
    values[1, 1] = 1

    moved = shifted(values, 1.5, -1)

    assert moved[0, 2] == pytest.approx(0.5)
    assert moved[0, 3] == pytest.approx(0.5)
    assert moved.sum() == pytest.approx(1)
    assert shifted(values, 9, 0).sum() == 0


def test_finishes_reject_nested_shadows_and_wild_offsets():
    box = {"x": 0, "y": 0, "width": 10, "height": 10}
    shadow = {
        **box,
        "kind": "shadow",
        "shadow": {"color": "#000000"},
        "items": [_rect(0, 0, 10, 10, "#000000")],
    }
    for recipe, items in (
        ({"dx": 1, "dy": 1}, [shadow]),
        ({"dx": 99, "dy": 1}, [_rect(0, 0, 10, 10, "#000000")]),
    ):
        with pytest.raises(ValidationError):
            StudioRenderParams.model_validate(
                {
                    "pages": [
                        {
                            "width": 50,
                            "height": 50,
                            "items": [{**box, "kind": "finish", "recipe": recipe, "items": items}],
                        }
                    ],
                    "output": "x.pdf",
                }
            )
