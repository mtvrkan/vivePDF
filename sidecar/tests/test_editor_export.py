import base64
import io
from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError

from vivepdf.ops.editor_export import DrawingImageParams, drawing_image, pixel_size
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

CORNERS = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50">'
    '<rect x="0" y="0" width="40" height="20" fill="#ff0000"/>'
    '<rect x="160" y="30" width="40" height="20" fill="#0000ff"/>'
    "</svg>"
)
SIZED = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40">'
    '<script>alert(1)</script><text x="4" y="20">Şişli</text></svg>'
)


def _export(**fields: object):
    return drawing_image(DrawingImageParams(**fields), silent_progress())


def test_png_is_drawn_at_the_placed_size_times_the_scale_with_a_clear_background():
    result = _export(svg=CORNERS, width=150, height=60, scale=2)

    image = Image.open(io.BytesIO(base64.b64decode(result.png_base64 or "")))
    assert (result.width, result.height) == (400, 160)
    assert image.size == (400, 160)
    assert image.mode == "RGBA"
    assert image.getpixel((10, 10))[:3] == (255, 0, 0)
    assert image.getpixel((390, 150))[:3] == (0, 0, 255)
    assert image.getpixel((200, 80))[3] == 0
    assert result.output is None


def test_png_is_written_to_the_output_with_its_extension(tmp_path: Path):
    result = _export(svg=CORNERS, width=150, height=60, scale=1, output=str(tmp_path / "çizim"))

    assert result.output == str(tmp_path / "çizim.png")
    assert result.png_base64 is None
    assert Image.open(result.output).size == (200, 80)
    assert result.bytes == Path(result.output).stat().st_size


def test_svg_keeps_the_placed_size_and_drops_scripts(tmp_path: Path):
    result = _export(svg=SIZED, width=75, height=60, format="svg", output=str(tmp_path / "a.svg"))

    text = Path(result.output or "").read_text(encoding="utf-8")
    assert 'width="75pt"' in text
    assert 'height="60pt"' in text
    assert 'viewBox="0 0 100 40"' in text
    assert 'preserveAspectRatio="none"' in text
    assert "Şişli" in text
    assert "script" not in text


def test_huge_scales_are_capped_to_a_safe_pixel_count():
    width, height = pixel_size(14_400, 14_400, 8)

    assert max(width, height) <= 12_000
    assert width * height <= 80_000_000


def test_an_existing_file_is_not_replaced_without_overwrite(tmp_path: Path):
    target = tmp_path / "a.png"
    target.write_bytes(b"old")

    with pytest.raises(OpError) as caught:
        _export(svg=CORNERS, width=10, height=10, output=str(target))

    assert caught.value.code is ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"exists": True, "path": str(target)}
    assert target.read_bytes() == b"old"


def test_broken_svg_and_svg_without_output_are_refused():
    with pytest.raises(OpError) as caught:
        _export(svg="<svg", width=10, height=10)
    assert caught.value.code is ErrorCode.INVALID_PARAMS

    with pytest.raises(ValidationError):
        DrawingImageParams(svg=CORNERS, width=10, height=10, format="svg")
