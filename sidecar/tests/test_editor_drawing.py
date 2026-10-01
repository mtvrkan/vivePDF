from pathlib import Path

import numpy as np
import pymupdf
import pytest

from vivepdf.ops._svg import drawing_pdf
from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

FORMULA = (Path(__file__).parent / "fixtures" / "svg" / "formula.svg").read_text(encoding="utf-8")
CORNERS = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50">'
    '<rect x="0" y="0" width="40" height="20" fill="#ff0000"/>'
    '<rect x="160" y="30" width="40" height="20" fill="#0000ff"/>'
    "</svg>"
)
BOX = (40.0, 60.0, 240.0, 110.0)


def _pdf(tmp_path: Path, rotation: int = 0, offset_crop: bool = False) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    if offset_crop:
        page.set_cropbox(pymupdf.Rect(30, 20, 380, 290))
    page.set_rotation(rotation)
    path = tmp_path / f"sayfa-{rotation}-{int(offset_crop)}.pdf"
    document.save(path)
    document.close()
    return path


def _place(source: Path, target: Path, svg: str, box=BOX, opacity: float = 1.0) -> int:
    x0, y0, x1, y1 = box
    result = apply(
        EditorApplyParams(
            path=str(source),
            output=str(target),
            objects=[
                {
                    "kind": "drawing",
                    "page": 1,
                    "x0": x0,
                    "y0": y0,
                    "x1": x1,
                    "y1": y1,
                    "svg": svg,
                    "opacity": opacity,
                }
            ],
        ),
        silent_progress(),
    )
    return result.applied


def _visible_pixels(path: Path, zoom: float = 2.0) -> np.ndarray:
    with pymupdf.open(path) as document:
        pixmap = document[0].get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
        return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
            pixmap.height, pixmap.width, pixmap.n
        )


def _centre(mask: np.ndarray, zoom: float = 2.0) -> tuple[float, float]:
    rows, columns = np.nonzero(mask)
    assert rows.size > 0
    return columns.mean() / zoom, rows.mean() / zoom


def test_a_formula_is_drawn_as_vector_paths_without_pictures_or_fonts(tmp_path: Path):
    target = tmp_path / "formül.pdf"
    assert _place(_pdf(tmp_path), target, FORMULA) == 1
    with pymupdf.open(target) as document:
        page = document[0]
        assert page.get_images() == []
        assert page.get_fonts() == []
        drawings = page.get_drawings()
        assert len(drawings) > 5
        covered = pymupdf.Rect()
        for drawing in drawings:
            covered |= drawing["rect"]
        assert (pymupdf.Rect(BOX) + (-1, -1, 1, 1)).contains(covered)
        assert covered.width > pymupdf.Rect(BOX).width * 0.9
        strokes = [drawing for drawing in drawings if "s" in drawing["type"]]
        assert not any(drawing.get("width") == 0 for drawing in strokes)
        assert any((drawing.get("width") or 0) > 0 for drawing in strokes)


def test_the_drawing_keeps_its_proportions_inside_a_taller_box(tmp_path: Path):
    target = tmp_path / "tall.pdf"
    _place(_pdf(tmp_path), target, CORNERS, box=(40, 40, 240, 240))
    pixels = _visible_pixels(target)
    red = (pixels[..., 0] > 200) & (pixels[..., 1] < 80) & (pixels[..., 2] < 80)
    blue = (pixels[..., 2] > 200) & (pixels[..., 0] < 80) & (pixels[..., 1] < 80)
    rows = np.nonzero(red | blue)[0]
    assert (rows.max() - rows.min()) / 2.0 == pytest.approx(50, abs=2)


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize("offset_crop", [False, True])
def test_a_formula_lands_upright_where_it_was_placed_on_turned_pages(
    tmp_path: Path, rotation: int, offset_crop: bool
):
    target = tmp_path / "turned.pdf"
    _place(_pdf(tmp_path, rotation, offset_crop), target, CORNERS)
    pixels = _visible_pixels(target)
    red = (pixels[..., 0] > 200) & (pixels[..., 1] < 80) & (pixels[..., 2] < 80)
    blue = (pixels[..., 2] > 200) & (pixels[..., 0] < 80) & (pixels[..., 1] < 80)
    red_x, red_y = _centre(red)
    blue_x, blue_y = _centre(blue)
    x0, y0, x1, y1 = BOX
    assert red_x == pytest.approx(x0 + 20, abs=2)
    assert red_y == pytest.approx(y0 + 10, abs=2)
    assert blue_x == pytest.approx(x1 - 20, abs=2)
    assert blue_y == pytest.approx(y1 - 10, abs=2)


def test_opacity_makes_the_formula_translucent(tmp_path: Path):
    solid, faded = tmp_path / "solid.pdf", tmp_path / "faded.pdf"
    source = _pdf(tmp_path)
    _place(source, solid, CORNERS)
    _place(source, faded, CORNERS, opacity=0.4)
    solid_pixels, faded_pixels = _visible_pixels(solid), _visible_pixels(faded)
    x, y = int((BOX[0] + 20) * 2), int((BOX[1] + 10) * 2)
    assert solid_pixels[y, x, 1] < 30
    assert 120 < faded_pixels[y, x, 1] < 180


def test_scripts_and_outside_references_never_reach_the_page(tmp_path: Path):
    hostile = CORNERS.replace(
        "</svg>",
        '<script>alert(1)</script><image href="file:///C:/Windows/win.ini" width="9" height="9"/>'
        "</svg>",
    )
    drawing = drawing_pdf(hostile.encode(), "formula")
    try:
        assert drawing.page_count == 1
        assert drawing[0].get_images() == []
    finally:
        drawing.close()


@pytest.mark.parametrize(
    ("svg", "reason"),
    [
        ("<svg", "notSvg"),
        ("<svg/>", "notSvg"),
        ("<html/>", "notSvg"),
        ('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>', "svgDoctype"),
        ('<svg xmlns="http://www.w3.org/2000/svg" width="2ex"><rect/></svg>', "notSvg"),
    ],
)
def test_a_broken_drawing_is_refused_before_anything_is_written(
    tmp_path: Path, svg: str, reason: str
):
    target = tmp_path / "never.pdf"
    with pytest.raises(OpError) as caught:
        _place(_pdf(tmp_path), target, svg)
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data["reason"] == reason
    assert not target.exists()
