import numpy as np
import pytest

from vivepdf.ops._opencv_subset import ensure_cv2

ensure_cv2()

from pdf2docx.common.algorithm import inner_contours as original_inner_contours  # noqa: E402
from pdf2docx.image import ImagesExtractor as images_extractor  # noqa: E402

from vivepdf.ops._docx_contours import inner_contours  # noqa: E402
from vivepdf.ops._docx_progress import stabilise_pdf2docx  # noqa: E402


def _framed_cells(seed: int) -> np.ndarray:
    generator = np.random.default_rng(seed)
    image = np.zeros((400, 600), dtype=np.uint8)
    for _ in range(60):
        x, y = int(generator.integers(0, 560)), int(generator.integers(0, 360))
        w, h = int(generator.integers(4, 120)), int(generator.integers(4, 120))
        image[y : y + h, x : x + w] = 255
        if w > 8 and h > 8:
            image[y + 2 : y + h - 2, x + 2 : x + w - 2] = 0
    return image


@pytest.mark.parametrize("seed", range(12))
def test_matches_pdf2docx_on_nested_frames(seed: int) -> None:
    image = _framed_cells(seed)
    for bbox in [(0, 0, 600, 400), (50, 40, 400, 300)]:
        for minimum in (1, 5, 20):
            assert inner_contours(image, bbox, minimum, minimum) == original_inner_contours(
                image, bbox, minimum, minimum
            )


def test_keeps_repeated_boxes_from_duplicate_frames() -> None:
    image = np.zeros((200, 200), dtype=np.uint8)
    image[10:190, 10:190] = 255
    image[12:188, 12:188] = 0
    image[20:180, 20:180] = 255
    image[22:178, 22:178] = 0
    image[40:80, 40:80] = 255
    image[42:78, 42:78] = 0
    expected = original_inner_contours(image, (0, 0, 200, 200), 1, 1)
    assert inner_contours(image, (0, 0, 200, 200), 1, 1) == expected
    assert expected


def test_blank_region_has_no_inner_contours() -> None:
    image = np.zeros((100, 100), dtype=np.uint8)
    image[5:95, 5:95] = 255
    assert inner_contours(image, (0, 0, 100, 100), 1, 1) == []


def test_stabilise_swaps_in_the_fast_version() -> None:
    stabilise_pdf2docx()
    assert images_extractor.inner_contours is inner_contours
