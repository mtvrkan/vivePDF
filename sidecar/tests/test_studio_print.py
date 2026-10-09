from pathlib import Path

import numpy as np
import pymupdf
import pytest
from PIL import Image
from pydantic import ValidationError

from vivepdf.ops._studio_models import StudioRenderParams
from vivepdf.ops.studio import render
from vivepdf.rpc.progress import silent_progress

BLEED = 8.5
AREA = BLEED + 14 + 8
WHITE = (255, 255, 255)
FOIL_RECIPE = {
    "dx": 0.3,
    "dy": 0.3,
    "ink": False,
    "layers": [],
    "texture": {
        "x1": 0,
        "y1": 0,
        "x2": 60,
        "y2": 40,
        "stops": [{"offset": 0, "color": "#ffcc00", "opacity": 1}],
        "replace": True,
    },
}


def _rect(x: float, y: float, width: float, height: float, colour: str) -> dict:
    return {
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


def _foil(x: float, y: float) -> dict:
    shape = _rect(x, y, 60, 40, "#0000ff")
    return {
        "kind": "finish",
        "x": x,
        "y": y,
        "width": 60,
        "height": 40,
        "recipe": FOIL_RECIPE,
        "items": [shape],
        "plate": "foil",
    }


def _render(folder: Path, items: list[dict], **press) -> Path:
    options = {"bleed": BLEED, "marks": True, "plates": "spot", "corner": 0}
    options.update(press)
    payload = {
        "pages": [{"width": 240, "height": 150, "items": items}],
        "output": str(folder / "card.pdf"),
        "overwrite": True,
        "printReady": options,
    }
    return Path(render(StudioRenderParams.model_validate(payload), silent_progress()).output)


def _pixels(page: pymupdf.Page) -> np.ndarray:
    pixmap = page.get_pixmap(alpha=False)
    return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)


def _at(pixels: np.ndarray, x: float, y: float) -> tuple[int, int, int]:
    return tuple(int(value) for value in pixels[int(y), int(x)])


def _objects(document: pymupdf.Document) -> str:
    text = "".join(document.xref_object(xref) for xref in range(1, document.xref_length()))
    return "".join(text.split())


def test_a_print_sheet_sets_trim_and_bleed_boxes_and_draws_crop_marks(tmp_path: Path):
    with pymupdf.open(_render(tmp_path, [_rect(0, 0, 240, 150, "#ff0000")])) as document:
        page = document[0]
        pixels = _pixels(page)

        assert page.rect == pymupdf.Rect(0, 0, 240 + 2 * AREA, 150 + 2 * AREA)
        assert page.trimbox == pymupdf.Rect(AREA, AREA, AREA + 240, AREA + 150)
        assert page.bleedbox == pymupdf.Rect(
            AREA - BLEED, AREA - BLEED, AREA + 240 + BLEED, AREA + 150 + BLEED
        )
        assert "/Separation/All" in _objects(document)
        assert _at(pixels, AREA - BLEED - 8, AREA)[0] < 235
        assert _at(pixels, AREA - BLEED - 8, AREA + 20) == WHITE


def test_artwork_runs_into_the_bleed_and_is_cut_at_its_edge(tmp_path: Path):
    background = _rect(-BLEED, -BLEED, 240 + 2 * BLEED, 150 + 2 * BLEED, "#ff0000")
    wider = _rect(-40, 60, 80, 20, "#00ff00")
    with pymupdf.open(_render(tmp_path, [background, wider])) as document:
        pixels = _pixels(document[0])

    assert _at(pixels, AREA - BLEED + 2, AREA + 20) == (255, 0, 0)
    assert _at(pixels, AREA - BLEED + 2, AREA + 70) == (0, 255, 0)
    assert _at(pixels, AREA - BLEED - 3, AREA + 70) == WHITE


def test_spot_plates_overprint_in_named_layers_and_leave_the_simulation_out(tmp_path: Path):
    with pymupdf.open(_render(tmp_path, [_foil(40, 40)], corner=10)) as document:
        names = sorted(info["name"] for info in document.get_ocgs().values())
        objects = _objects(document)
        document.set_layer(-1, on=[], off=list(document.get_ocgs()))
        with pymupdf.open("pdf", document.tobytes()) as reopened:
            hidden = _pixels(reopened[0])

    assert names == ["DieCut", "Foil"]
    assert "/Separation/Foil" in objects
    assert "/Separation/DieCut" in objects
    assert "/OPtrue" in objects
    assert _at(hidden, AREA + 70, AREA + 60) == WHITE


def test_separate_plate_pages_follow_the_artwork_in_black(tmp_path: Path):
    path = _render(tmp_path, [_foil(40, 40)], plates="pages", corner=10)
    with pymupdf.open(path) as document:
        art, foil, die = (_pixels(page) for page in document)
        count = document.page_count
        ocgs = document.get_ocgs()
        label = document[1].get_text()

    assert count == 3
    assert not ocgs
    assert "Foil · 1" in label
    assert _at(art, AREA + 70, AREA + 60) == WHITE
    assert _at(foil, AREA + 70, AREA + 60) == (0, 0, 0)
    assert _at(foil, AREA + 120, AREA + 60) == WHITE
    assert _at(die, AREA + 120, AREA)[0] < 128


def test_without_plates_the_finish_is_simulated_on_the_artwork(tmp_path: Path):
    path = _render(tmp_path, [_foil(40, 40)], plates="none", marks=False)
    with pymupdf.open(path) as document:
        pixels = _pixels(document[0])
        count = document.page_count
        size = document[0].rect

    assert count == 1
    assert size == pymupdf.Rect(0, 0, 240 + 2 * BLEED, 150 + 2 * BLEED)
    red, green, blue = _at(pixels, BLEED + 70, BLEED + 60)
    assert red > 200 and green > 150 and blue < 80


def test_print_options_are_ignored_for_pictures_and_bounded(tmp_path: Path):
    payload = {
        "pages": [{"width": 240, "height": 150, "items": [_rect(0, 0, 240, 150, "#ff0000")]}],
        "output": str(tmp_path / "card.png"),
        "overwrite": True,
        "format": "png",
        "dpi": 72,
        "printReady": {"bleed": BLEED},
    }
    render(StudioRenderParams.model_validate(payload), silent_progress())
    with Image.open(tmp_path / "card.png") as picture:
        size = picture.size

    assert size == (240, 150)
    with pytest.raises(ValidationError):
        StudioRenderParams.model_validate({**payload, "printReady": {"bleed": 100}})
