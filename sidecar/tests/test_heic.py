import io
import shutil
from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops._image_files import image_file_bytes, image_file_pixmap, pillow_only
from vivepdf.ops._watermark_style import WatermarkParams
from vivepdf.ops.convert_images import ImagesToPdfParams, images_to_pdf
from vivepdf.ops.pages import AssemblePage, AssembleParams, AssembleSource, assemble
from vivepdf.ops.photo import iter_photos
from vivepdf.ops.security_watermark import watermark
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

SAMPLE = Path(__file__).resolve().parent / "data" / "sample.heic"
RED = (220, 30, 30)
BLUE = (30, 60, 220)


def _close(actual: tuple[int, ...], expected: tuple[int, int, int], tolerance: int = 40) -> bool:
    return all(abs(a - b) <= tolerance for a, b in zip(actual[:3], expected, strict=True))


def _colour_at(path: Path, x: float, y: float) -> tuple[int, ...]:
    with pymupdf.open(path) as document:
        page = document[0]
        pixmap = page.get_pixmap(dpi=72)
        return pixmap.pixel(int(x * pixmap.width), int(y * pixmap.height))


@pytest.fixture
def heic(tmp_path: Path) -> Path:
    target = tmp_path / "IMG_0001.HEIC"
    shutil.copyfile(SAMPLE, target)
    return target


@pytest.fixture
def blank_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    document.new_page(width=595, height=842)
    path = tmp_path / "blank.pdf"
    document.save(path)
    document.close()
    return path


def test_heic_is_decoded_through_pillow_and_other_formats_are_left_to_mupdf(
    heic: Path, tmp_path: Path
) -> None:
    png = tmp_path / "plain.png"
    Image.new("RGB", (4, 4), RED).save(png)
    assert pillow_only(heic) is True
    assert pillow_only(png) is False
    with Image.open(io.BytesIO(image_file_bytes(heic))) as decoded:
        assert decoded.format == "JPEG"
        assert decoded.size == (80, 40)
    assert image_file_bytes(png) == png.read_bytes()
    assert (image_file_pixmap(heic).width, image_file_pixmap(heic).height) == (80, 40)


def test_images_to_pdf_accepts_heic_files_and_folders(heic: Path, tmp_path: Path) -> None:
    result = images_to_pdf(
        ImagesToPdfParams(
            folders=[str(heic.parent)], output=str(tmp_path / "album.pdf"), page_size="image"
        ),
        silent_progress(),
    )
    assert result.page_count == 1
    with pymupdf.open(result.output) as document:
        assert document[0].rect.width > document[0].rect.height
    assert _close(_colour_at(Path(result.output), 0.2, 0.5), RED)
    assert _close(_colour_at(Path(result.output), 0.8, 0.5), BLUE)


def test_images_to_pdf_refuses_a_broken_heic(tmp_path: Path) -> None:
    broken = tmp_path / "broken.heic"
    broken.write_bytes(b"not a picture at all")
    with pytest.raises(OpError) as raised:
        images_to_pdf(
            ImagesToPdfParams(images=[str(broken)], output=str(tmp_path / "out.pdf")),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.INVALID_PARAMS


def test_assemble_places_a_heic_page(heic: Path, blank_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "assembled.pdf"
    assemble(
        AssembleParams(
            sources=[AssembleSource(id="main", path=str(blank_pdf))],
            output=str(output),
            pages=[AssemblePage(kind="image", path=str(heic))],
        ),
        silent_progress(),
    )
    with pymupdf.open(output) as document:
        assert len(document[0].get_images()) == 1
    assert _close(_colour_at(output, 0.2, 0.5), RED)


def test_image_watermark_accepts_heic(heic: Path, blank_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "marked.pdf"
    watermark(
        WatermarkParams(
            path=str(blank_pdf), output=str(output), kind="image", image_path=str(heic)
        ),
        silent_progress(),
    )
    with pymupdf.open(output) as document:
        assert document[0].get_images()


def test_photo_tool_reads_heic(heic: Path) -> None:
    frames = list(iter_photos(str(heic)))
    assert len(frames) == 1
    assert frames[0].size == (80, 40)
    assert _close(frames[0].getpixel((10, 20)), RED)
