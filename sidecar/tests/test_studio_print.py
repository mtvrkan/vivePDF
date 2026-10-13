from pathlib import Path

import numpy as np
import pymupdf
import pytest
from PIL import Image
from pydantic import ValidationError

from vivepdf.ops._studio_models import StudioPrintOptions, StudioRenderParams
from vivepdf.ops._studio_print import sheet_layout
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


def _named(colour: str) -> list[dict]:
    return [
        _rect(0, 0, 240, 150, colour),
        {
            "kind": "text",
            "x": 10,
            "y": 10,
            "width": 100,
            "height": 30,
            "runs": [{"text": "{Name}", "color": "#000000"}],
            "fontSize": 14,
        },
    ]


def _impose(folder: Path, pages: list[list[dict]], rows: list[dict], sheet: str = "a4") -> Path:
    payload = {
        "pages": [{"width": 240, "height": 150, "items": items} for items in pages],
        "rows": rows,
        "output": str(folder / "sheet.pdf"),
        "overwrite": True,
        "printReady": {"bleed": BLEED, "marks": True, "plates": "spot", "sheet": sheet},
    }
    return Path(render(StudioRenderParams.model_validate(payload), silent_progress()).output)


def _word_at(page: pymupdf.Page, word: str) -> tuple[float, float]:
    found = next(item for item in page.get_text("words") if item[4] == word)
    return found[0], found[1]


def test_an_a4_sheet_repeats_one_card_in_every_slot_with_marks_on_the_outside(tmp_path: Path):
    size, trims, columns = sheet_layout(StudioPrintOptions(bleed=BLEED, sheet="a4"), 240, 150)
    path = _impose(tmp_path, [_named("#ff0000")], [])
    with pymupdf.open(path) as document:
        count = document.page_count
        words = [item[4] for item in document[0].get_text("words")]

    assert size == (841.89, 595.28)
    assert (len(trims), columns) == (9, 3)
    assert trims[1].x0 - trims[0].x1 == pytest.approx(2 * BLEED)
    assert count == 1
    assert words.count("{Name}") == 9


def test_data_rows_fill_the_slots_and_backs_are_mirrored_for_duplex(tmp_path: Path):
    rows = [{"Name": name} for name in ("Ada", "Bob", "Cy")]
    path = _impose(tmp_path, [_named("#ffffff"), _named("#eeeeee")], rows)
    with pymupdf.open(path) as document:
        front, back = document[0], document[1]
        count = document.page_count
        ada_front, bob_front = _word_at(front, "Ada"), _word_at(front, "Bob")
        ada_back, bob_back = _word_at(back, "Ada"), _word_at(back, "Bob")

    assert count == 2
    assert bob_front[0] > ada_front[0]
    assert ada_back[0] > bob_back[0]
    assert ada_back[1] == pytest.approx(ada_front[1])
    assert ada_back[0] + ada_front[0] == pytest.approx(bob_back[0] + bob_front[0], abs=1)


def test_more_rows_than_slots_start_a_new_sheet(tmp_path: Path):
    rows = [{"Name": f"N{index}"} for index in range(10)]
    with pymupdf.open(_impose(tmp_path, [_named("#ffffff")], rows)) as document:
        count = document.page_count
        last = [item[4] for item in document[1].get_text("words")]

    assert count == 2
    assert last == ["N9"]


def test_a_card_too_big_for_the_sheet_keeps_its_own_page():
    options = StudioPrintOptions(bleed=BLEED, sheet="a4")

    size, trims, columns = sheet_layout(options, 800, 700)

    assert (len(trims), columns) == (1, 1)
    assert size == (800 + 2 * AREA, 700 + 2 * AREA)


def test_pictures_at_the_trim_edge_take_their_bleed_from_beyond_the_shown_area(tmp_path: Path):
    stripes = np.zeros((100, 300, 3), dtype=np.uint8)
    stripes[:, :100] = (0, 255, 0)
    stripes[:, 100:200] = (255, 0, 0)
    stripes[:, 200:] = (0, 0, 255)
    source = tmp_path / "stripes.png"
    Image.fromarray(stripes).save(source)
    edges = {"left": BLEED, "top": 0, "right": 0, "bottom": 0}
    common = {"kind": "image", "path": str(source), "x": -BLEED, "height": 50, "bleed": edges}
    cropped = {**common, "y": 10, "width": 60 + BLEED, "fit": "stretch"}
    cropped["crop"] = {"x": 1 / 3, "y": 0, "width": 1 / 3, "height": 1}
    covered = {**common, "y": 80, "width": 50 + BLEED, "fit": "cover"}

    with pymupdf.open(_render(tmp_path, [cropped, covered])) as document:
        pixels = _pixels(document[0])

    assert _at(pixels, AREA + 4, AREA + 35)[0] > 200
    assert _at(pixels, AREA - BLEED + 2, AREA + 35)[1] > 200
    assert _at(pixels, AREA + 4, AREA + 105)[0] > 200
    assert _at(pixels, AREA - BLEED + 2, AREA + 105)[1] > 200


def test_a_picture_without_pixels_beyond_its_frame_mirrors_its_edge_into_the_bleed(
    tmp_path: Path,
):
    halves = np.zeros((100, 200, 3), dtype=np.uint8)
    halves[:, :20] = (0, 255, 0)
    halves[:, 20:] = (255, 0, 0)
    source = tmp_path / "halves.png"
    Image.fromarray(halves).save(source)
    edges = {"left": BLEED, "top": 0, "right": 0, "bottom": 0}
    item = {
        "kind": "image",
        "path": str(source),
        "x": -BLEED,
        "y": 10,
        "width": 100 + BLEED,
        "height": 50,
        "fit": "stretch",
        "bleed": edges,
    }

    with pymupdf.open(_render(tmp_path, [item])) as document:
        pixels = _pixels(document[0])

    assert _at(pixels, AREA + 4, AREA + 35)[1] > 200
    assert _at(pixels, AREA - BLEED + 2, AREA + 35)[1] > 200
    assert _at(pixels, AREA + 14, AREA + 35)[0] > 200
