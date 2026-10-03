from pathlib import Path

import numpy as np
import pymupdf
import pytest
import zxingcpp
from PIL import Image
from pydantic import ValidationError

from vivepdf.ops._studio_models import StudioRenderParams
from vivepdf.ops.studio import render
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

WHITE = (255, 255, 255)


def _render(folder: Path, items: list[dict], **extra) -> Path:
    payload = {
        "pages": [{"width": 300, "height": 300, "items": items}],
        "output": str(folder / "design.pdf"),
        "overwrite": True,
    }
    payload.update(extra)
    result = render(StudioRenderParams.model_validate(payload), silent_progress())
    return Path(result.output)


def _pixels(path: Path, page: int = 0) -> np.ndarray:
    with pymupdf.open(path) as document:
        pixmap = document[page].get_pixmap(alpha=False)
        return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)


def _at(pixels: np.ndarray, x: float, y: float) -> tuple[int, int, int]:
    return tuple(int(value) for value in pixels[int(y), int(x)])


def _ink(pixels: np.ndarray) -> tuple[int, int, int, int]:
    rows, columns = np.where(pixels.min(axis=2) < 200)
    return int(columns.min()), int(rows.min()), int(columns.max()), int(rows.max())


def _rect(x: float, y: float, width: float, height: float, **extra) -> dict:
    item = {
        "kind": "vector",
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "paths": [
            {
                "d": f"M0 0 L{width} 0 L{width} {height} L0 {height} Z",
                "fill": {"type": "solid", "color": "#ff0000"},
            }
        ],
    }
    item.update(extra)
    return item


def _text(text: str, **extra) -> dict:
    item = {
        "kind": "text",
        "x": 20,
        "y": 20,
        "width": 260,
        "height": 120,
        "runs": [{"text": text}],
        "fontSize": 20,
    }
    item.update(extra)
    return item


def _words(path: Path, page: int = 0) -> list[tuple]:
    with pymupdf.open(path) as document:
        return document[page].get_text("words")


def test_a_solid_shape_is_drawn_in_its_box(tmp_path: Path):
    pixels = _pixels(_render(tmp_path, [_rect(50, 60, 100, 40)]))

    assert _at(pixels, 100, 80) == (255, 0, 0)
    assert _at(pixels, 45, 80) == WHITE
    assert _at(pixels, 100, 105) == WHITE


def test_gradients_are_real_shadings_not_black(tmp_path: Path):
    linear = _rect(0, 0, 200, 50)
    linear["paths"][0]["fill"] = {
        "type": "linear",
        "x1": 0,
        "y1": 0,
        "x2": 200,
        "y2": 0,
        "stops": [{"offset": 0, "color": "#ff0000"}, {"offset": 1, "color": "#0000ff"}],
    }
    radial = _rect(0, 100, 100, 100)
    radial["paths"][0]["fill"] = {
        "type": "radial",
        "cx": 50,
        "cy": 50,
        "r": 50,
        "stops": [
            {"offset": 0.2, "color": "#00ff00"},
            {"offset": 0.5, "color": "#ffff00"},
            {"offset": 1, "color": "#000000"},
        ],
    }
    pixels = _pixels(_render(tmp_path, [linear, radial]))

    left, right = _at(pixels, 3, 25), _at(pixels, 197, 25)
    assert left[0] > 230 and left[2] < 25
    assert right[2] > 230 and right[0] < 25
    assert _at(pixels, 50, 150) == (0, 255, 0)
    assert _at(pixels, 50, 175)[0] > 150


def test_strokes_and_dashes_are_not_clipped_by_the_box(tmp_path: Path):
    item = _rect(100, 100, 100, 100)
    item["paths"][0]["stroke"] = {"color": "#0000ff", "width": 10}
    dashed = _rect(20, 250, 260, 20)
    dashed["paths"][0] = {
        "d": "M0 10 L260 10",
        "stroke": {"color": "#000000", "width": 4, "dash": [20, 20]},
    }
    pixels = _pixels(_render(tmp_path, [item, dashed]))

    assert _at(pixels, 97, 150) == (0, 0, 255)
    assert _at(pixels, 150, 203) == (0, 0, 255)
    assert _at(pixels, 30, 260) == (0, 0, 0)
    assert _at(pixels, 50, 260) == WHITE


def test_rotation_turns_clockwise_around_the_centre(tmp_path: Path):
    bar = _rect(100, 140, 100, 20, rotation=90)
    pixels = _pixels(_render(tmp_path, [bar]))
    left, top, right, bottom = _ink(pixels)
    assert abs(left - 140) <= 1 and abs(right - 159) <= 1
    assert abs(top - 100) <= 1 and abs(bottom - 199) <= 1

    tilted = _rect(100, 140, 100, 20, rotation=30)
    tilted["paths"][0]["fill"] = {"type": "solid", "color": "#000000"}
    tilted["paths"].append(
        {"d": "M90 0 L100 0 L100 20 L90 20 Z", "fill": {"type": "solid", "color": "#0000ff"}}
    )
    pixels = _pixels(_render(tmp_path, [tilted]))
    rows, columns = np.where((pixels[:, :, 2] > 200) & (pixels[:, :, 0] < 50))
    assert rows.mean() > 160 and columns.mean() > 180


def test_paths_with_curves_and_relative_commands_draw(tmp_path: Path):
    circle = _rect(100, 100, 100, 100)
    circle["paths"][0]["d"] = (
        "M50 0 C77.6 0 100 22.4 100 50 C100 77.6 77.6 100 50 100 "
        "C22.4 100 0 77.6 0 50 Q0 0 50 0 Z m10 40 h20 v20 h-20 z"
    )
    circle["paths"][0]["evenOdd"] = True
    pixels = _pixels(_render(tmp_path, [circle]))

    assert _at(pixels, 150, 120) == (255, 0, 0)
    assert _at(pixels, 170, 150) == WHITE
    assert _at(pixels, 102, 102) == WHITE


def test_text_aligns_inside_its_box(tmp_path: Path):
    output = _render(
        tmp_path,
        [
            _text("Left", y=20, height=30),
            _text("Center", y=60, height=30, align="center"),
            _text("Right", y=100, height=30, align="right"),
        ],
    )
    words = {word[4]: word for word in _words(output)}

    assert abs(words["Left"][0] - 20) < 1.5
    assert abs((words["Center"][0] + words["Center"][2]) / 2 - 150) < 1.5
    assert abs(words["Right"][2] - 280) < 1.5


def test_text_wraps_justifies_and_keeps_hard_breaks(tmp_path: Path):
    output = _render(
        tmp_path,
        [_text("one two three four five six seven eight\nnine", width=150, align="justify")],
    )
    words = _words(output)
    lines: dict[int, list[tuple]] = {}
    for word in words:
        lines.setdefault(word[6], []).append(word)

    assert len(lines) >= 3
    first = lines[min(lines)]
    assert abs(first[-1][2] - 170) < 1.5
    last = lines[max(lines)]
    assert [word[4] for word in last] == ["nine"]


def test_vertical_alignment_and_line_height_follow_css(tmp_path: Path):
    output = _render(tmp_path, [_text("Middle", verticalAlign="middle")])
    with pymupdf.open(output) as document:
        span = document[0].get_text("dict")["blocks"][0]["lines"][0]["spans"][0]
        font = pymupdf.Font(fontbuffer=document.extract_font(document[0].get_fonts()[0][0])[3])
    baseline = span["origin"][1]
    line_box = 20 * 1.2
    expected = (
        20
        + (120 - line_box) / 2
        + (line_box - (font.ascender - font.descender) * 20) / 2
        + font.ascender * 20
    )
    assert abs(baseline - expected) < 0.5


def test_measured_segments_are_placed_exactly(tmp_path: Path):
    item = _text(
        "ignored",
        rotation=0,
        segments=[
            {"text": "Exact", "x": 10, "y": 30, "size": 18, "color": "#123456"},
            {"text": "place", "x": 80.5, "y": 30, "size": 18, "bold": True},
        ],
    )
    with pymupdf.open(_render(tmp_path, [item])) as document:
        spans = [
            span
            for block in document[0].get_text("dict")["blocks"]
            for line in block["lines"]
            for span in line["spans"]
        ]
    origins = {span["text"]: span["origin"] for span in spans}
    assert origins["Exact"] == pytest.approx((30, 50), abs=0.01)
    assert origins["place"] == pytest.approx((100.5, 50), abs=0.01)
    assert spans[0]["color"] == 0x123456


def test_rotated_text_runs_along_the_turned_box(tmp_path: Path):
    output = _render(tmp_path, [_text("Rotated", rotation=90, x=50, y=100, width=200, height=40)])
    with pymupdf.open(output) as document:
        line = document[0].get_text("dict")["blocks"][0]["lines"][0]
    assert line["dir"] == pytest.approx((0, 1), abs=1e-3)


def test_synthetic_italic_slants_forward_and_underline_is_drawn(tmp_path: Path):
    output = _render(
        tmp_path,
        [
            _text(
                "I",
                x=100,
                y=50,
                width=100,
                height=200,
                fontSize=150,
                runs=[{"text": "I", "italic": True, "underline": True}],
            )
        ],
    )
    pixels = _pixels(output)
    top = np.where(pixels[90].min(axis=1) < 128)[0]
    bottom = np.where(pixels[180].min(axis=1) < 128)[0]
    assert top.mean() > bottom.mean() + 10
    with pymupdf.open(output) as document:
        assert any(
            item[0] == "l" for drawing in document[0].get_drawings() for item in drawing["items"]
        )


def _span(words: list[tuple]) -> float:
    return words[-1][2] - words[0][0]


def test_letter_spacing_widens_the_word(tmp_path: Path):
    plain = _words(_render(tmp_path, [_text("spaced")]))
    wide = _words(_render(tmp_path, [_text("spaced", letterSpacing=5)]))

    assert _span(wide) - _span(plain) == pytest.approx(25, abs=1.5)


def test_rows_fill_placeholders_numbers_and_turkish_uppercase(tmp_path: Path):
    output = _render(
        tmp_path,
        [_text("{name} #{n} {date}", uppercase=True)],
        rows=[{"name": "istanbul"}, {"name": "ılgaz"}],
        date="03.10.2026",
        language="tr",
    )
    with pymupdf.open(output) as document:
        texts = [page.get_text().strip() for page in document]
    assert texts == ["İSTANBUL #1 03.10.2026", "ILGAZ #2 03.10.2026"]


def test_shrink_to_fit_keeps_long_text_inside_the_box(tmp_path: Path):
    output = _render(
        tmp_path,
        [
            _text(
                "A long recipient name that cannot fit at full size",
                width=120,
                height=30,
                fontSize=30,
                shrinkToFit=True,
            )
        ],
    )
    with pymupdf.open(output) as document:
        blocks = document[0].get_text("dict")["blocks"]
    sizes = {span["size"] for block in blocks for line in block["lines"] for span in line["spans"]}
    assert max(sizes) < 30
    bottom = max(block["bbox"][3] for block in blocks)
    assert bottom <= 20 + 30 + 2


def test_images_cover_crop_mask_and_turn(tmp_path: Path):
    picture = tmp_path / "photo.png"
    array = np.zeros((100, 200, 3), dtype=np.uint8)
    array[:, :100] = (255, 0, 0)
    array[:, 100:] = (0, 0, 255)
    Image.fromarray(array).save(picture)
    item = {
        "kind": "image",
        "x": 50,
        "y": 50,
        "width": 100,
        "height": 100,
        "path": str(picture),
        "mask": "circle",
    }
    pixels = _pixels(_render(tmp_path, [item]))
    assert _at(pixels, 75, 100)[0] > 200
    assert _at(pixels, 125, 100)[2] > 200
    assert _at(pixels, 53, 53) == WHITE

    cropped = {**item, "mask": "none", "crop": {"x": 0.5, "y": 0, "width": 0.5, "height": 1}}
    pixels = _pixels(_render(tmp_path, [cropped]))
    assert _at(pixels, 60, 100)[2] > 200

    turned = {**item, "mask": "none", "fit": "stretch", "rotation": 90}
    pixels = _pixels(_render(tmp_path, [turned]))
    assert _at(pixels, 100, 60)[0] > 200
    assert _at(pixels, 100, 140)[2] > 200


def test_qr_codes_are_vector_and_take_row_values(tmp_path: Path):
    item = {
        "kind": "qr",
        "x": 50,
        "y": 50,
        "width": 200,
        "height": 200,
        "value": "https://x.test/{id}",
    }
    output = _render(tmp_path, [item], rows=[{"id": "a1"}, {"id": "b2"}])
    with pymupdf.open(output) as document:
        assert not document[0].get_images()
        decoded = []
        for page in document:
            pixmap = page.get_pixmap(dpi=150)
            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            decoded.append(zxingcpp.read_barcodes(image)[0].text)
    assert decoded == ["https://x.test/a1", "https://x.test/b2"]


def test_svg_items_are_drawn(tmp_path: Path):
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">'
        '<rect width="100" height="50" fill="#00ff00"/></svg>'
    )
    pixels = _pixels(
        _render(tmp_path, [{"kind": "svg", "x": 0, "y": 0, "width": 100, "height": 50, "svg": svg}])
    )
    assert _at(pixels, 50, 25) == (0, 255, 0)


def test_many_rows_embed_the_font_once(tmp_path: Path):
    rows = [{"name": f"Person {index}"} for index in range(60)]
    output = _render(tmp_path, [_text("{name}"), _rect(10, 200, 50, 50)], rows=rows)
    with pymupdf.open(output) as document:
        assert document.page_count == 60
        fonts = {font[0] for page in document for font in page.get_fonts()}
    assert len(fonts) == 1
    assert output.stat().st_size < 200_000


def test_missing_image_is_reported(tmp_path: Path):
    item = {
        "kind": "image",
        "x": 0,
        "y": 0,
        "width": 10,
        "height": 10,
        "path": str(tmp_path / "nope.png"),
    }
    with pytest.raises(OpError) as caught:
        _render(tmp_path, [item])
    assert caught.value.code == ErrorCode.FILE_NOT_FOUND
    assert caught.value.data["reason"] == "missingImage"


def test_bad_path_data_is_refused(tmp_path: Path):
    item = _rect(0, 0, 10, 10)
    item["paths"][0]["d"] = "L 1 2 3"
    with pytest.raises(OpError) as caught:
        _render(tmp_path, [item])
    assert caught.value.data["reason"] == "badPath"


def test_too_many_output_pages_are_refused(tmp_path: Path):
    pages = [{"width": 100, "height": 100, "items": []} for _ in range(5)]
    with pytest.raises(OpError) as caught:
        _render(tmp_path, [], pages=pages, rows=[{"a": str(index)} for index in range(4001)])
    assert caught.value.data["reason"] == "tooManyPages"


def test_existing_output_needs_overwrite(tmp_path: Path):
    _render(tmp_path, [])
    with pytest.raises(OpError) as caught:
        _render(tmp_path, [], overwrite=False)
    assert caught.value.data["exists"] is True


def test_invalid_colours_fail_validation(tmp_path: Path):
    item = _rect(0, 0, 10, 10)
    item["paths"][0]["fill"]["color"] = "red"
    with pytest.raises(ValidationError):
        _render(tmp_path, [item])


def test_vector_view_box_scales_paths_and_strokes(tmp_path: Path):
    item = _rect(50, 50, 200, 100, viewWidth=20, viewHeight=10)
    item["paths"][0]["d"] = "M0 0 L10 0 L10 10 L0 10 Z"
    item["paths"][0]["stroke"] = {"color": "#0000ff", "width": 1}

    pixels = _pixels(_render(tmp_path, [item]))

    assert _at(pixels, 100, 100) == (255, 0, 0)
    assert _at(pixels, 200, 100) == WHITE
    assert _at(pixels, 46, 100) == (0, 0, 255)
