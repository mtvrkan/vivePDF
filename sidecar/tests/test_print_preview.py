import base64
import io
from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops.printing import PrintPreviewParams, preview
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

RED, GREEN, BLUE = (1, 0, 0), (0, 1, 0), (0, 0, 1)


def _write(path: Path, colours: list[tuple[float, float, float]], width=200, height=300) -> str:
    document = pymupdf.open()
    for colour in colours:
        page = document.new_page(width=width, height=height)
        page.draw_rect(page.rect, color=colour, fill=colour)
    document.save(path)
    document.close()
    return str(path)


def _image(encoded: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB")


def _close(pixel: tuple[int, ...], expected: tuple[int, int, int]) -> bool:
    return all(abs(a - b) <= 40 for a, b in zip(pixel, expected, strict=True))


def test_preview_shows_the_requested_sheet_on_a4_paper(tmp_path: Path):
    path = _write(tmp_path / "three.pdf", [RED, GREEN, BLUE])

    result = preview(PrintPreviewParams(path=path, width=420, sheet=1), silent_progress())

    assert (result.sheet, result.sheets, result.pages) == (1, 3, [2])
    assert result.width == 420 and result.height == round(420 * 841.89 / 595.28)
    image = _image(result.image)
    assert image.size == (result.width, result.height)
    assert _close(image.getpixel((210, result.height // 2)), (0, 255, 0))
    assert _close(image.getpixel((2, 2)), (255, 255, 255))


def test_preview_follows_range_subset_reverse_and_pages_per_sheet(tmp_path: Path):
    path = _write(tmp_path / "five.pdf", [RED, GREEN, BLUE, RED, GREEN])

    result = preview(
        PrintPreviewParams(path=path, pages="1-5", subset="odd", reverse=True, pages_per_sheet=2),
        silent_progress(),
    )

    assert result.sheets == 2
    assert result.pages == [5]
    letter = preview(PrintPreviewParams(path=path, paper="letter", width=612), silent_progress())
    assert letter.height == 792
    gray = _image(preview(PrintPreviewParams(path=path, grayscale=True), silent_progress()).image)
    centre = gray.getpixel((gray.width // 2, gray.height // 2))
    assert centre[0] == centre[1] == centre[2]


def test_preview_clamps_a_sheet_past_the_end(tmp_path: Path):
    path = _write(tmp_path / "two.pdf", [RED, BLUE])

    result = preview(PrintPreviewParams(path=path, sheet=9), silent_progress())

    assert (result.sheet, result.pages) == (1, [2])


def test_preview_without_markup_leaves_the_file_untouched(tmp_path: Path):
    source = tmp_path / "marked.pdf"
    document = pymupdf.open()
    page = document.new_page(width=200, height=300)
    page.add_rect_annot(pymupdf.Rect(0, 0, 200, 300)).update()
    document.save(source)
    document.close()

    result = preview(PrintPreviewParams(path=str(source), annotations=False), silent_progress())

    image = _image(result.image)
    assert _close(image.getpixel((image.width // 2, image.height // 2)), (255, 255, 255))
    with pymupdf.open(source) as reopened:
        assert len(list(reopened[0].annots())) == 1


def test_preview_refuses_an_empty_selection(tmp_path: Path):
    path = _write(tmp_path / "one.pdf", [RED])

    with pytest.raises(OpError) as caught:
        preview(PrintPreviewParams(path=path, subset="even"), silent_progress())

    assert caught.value.data == {"reason": "empty"}
