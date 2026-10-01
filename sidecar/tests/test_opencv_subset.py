import io
import re
import sys
import zipfile
from pathlib import Path

import numpy as np
import pymupdf
import pytest
from PIL import Image

from vivepdf.ops import _opencv_subset as subset
from vivepdf.ops.convert import DocxParams, to_docx
from vivepdf.rpc.progress import silent_progress

cv2 = pytest.importorskip("cv2")


def _random_masks(count: int):
    rng = np.random.default_rng(7)
    for trial in range(count):
        height, width = (int(value) for value in rng.integers(1, 36, 2))
        if trial % 3 == 0:
            yield (rng.random((height, width)) < rng.uniform(0.1, 0.9)).astype(np.uint8) * 255
            continue
        mask = np.zeros((height, width), np.uint8)
        for _ in range(int(rng.integers(1, 7))):
            top, left = int(rng.integers(0, height)), int(rng.integers(0, width))
            bottom = min(height, top + int(rng.integers(3, 20)))
            right = min(width, left + int(rng.integers(3, 20)))
            mask[top:bottom, left:right] = 255
            if trial % 3 == 2:
                mask[top + 1 : bottom - 1, left + 1 : right - 1] = 0
                if bottom - top > 4 and right - left > 4:
                    mask[top + 2 : bottom - 2, left + 2 : right - 2] = 255
        yield mask


def _signature(module, mask):
    contours, hierarchy = module.findContours(mask, module.RETR_TREE, module.CHAIN_APPROX_SIMPLE)
    boxes = [module.boundingRect(contour) for contour in contours]
    return boxes, None if hierarchy is None else hierarchy.tolist()


def test_contour_tree_matches_opencv_box_for_box() -> None:
    for mask in _random_masks(600):
        assert _signature(subset, mask) == _signature(cv2, mask)


def test_contour_tree_of_an_empty_image_is_empty() -> None:
    empty = np.zeros((5, 7), np.uint8)
    assert subset.findContours(empty, subset.RETR_TREE, subset.CHAIN_APPROX_SIMPLE) == ((), None)


def test_grey_conversion_matches_opencv_for_every_colour() -> None:
    blue, green, red = np.meshgrid(
        np.arange(256), np.arange(256), np.arange(0, 256, 5), indexing="ij"
    )
    pixels = np.stack([blue, green, red], -1).astype(np.uint8).reshape(256, -1, 3)
    assert np.array_equal(
        subset.cvtColor(pixels, subset.COLOR_BGR2GRAY), cv2.cvtColor(pixels, cv2.COLOR_BGR2GRAY)
    )


def test_threshold_and_decode_match_opencv() -> None:
    rng = np.random.default_rng(3)
    pixels = rng.integers(0, 256, (40, 60, 3), dtype=np.uint8)
    grey = cv2.cvtColor(pixels, cv2.COLOR_BGR2GRAY)
    expected = cv2.threshold(grey, 253, 255, cv2.THRESH_BINARY_INV)
    actual = subset.threshold(grey, 253, 255, subset.THRESH_BINARY_INV)
    assert actual[0] == expected[0]
    assert np.array_equal(actual[1], expected[1])
    _, png = cv2.imencode(".png", pixels)
    assert np.array_equal(subset.imdecode(png, subset.IMREAD_COLOR), pixels)
    assert subset.imdecode(np.frombuffer(b"not an image", np.uint8), subset.IMREAD_COLOR) is None
    _, encoded = subset.imencode(".png", pixels)
    assert np.array_equal(cv2.imdecode(encoded, cv2.IMREAD_COLOR), pixels)


@pytest.mark.parametrize("angle", [90, 180, 270, 30])
def test_rotation_stays_within_one_level_of_opencv(angle: int) -> None:
    rng = np.random.default_rng(angle)
    pixels = rng.integers(0, 256, (31, 47, 3), dtype=np.uint8)
    height, width = pixels.shape[:2]
    centre = (width // 2, height // 2)
    expected_matrix = cv2.getRotationMatrix2D(centre, angle, 1.0)
    matrix = subset.getRotationMatrix2D(centre, angle, 1.0)
    assert np.allclose(matrix, expected_matrix, atol=1e-12)
    cos, sin = abs(matrix[0, 0]), abs(matrix[0, 1])
    size = (int(height * sin + width * cos), int(height * cos + width * sin))
    for target in (matrix, expected_matrix):
        target[0, 2] += size[0] / 2 - centre[0]
        target[1, 2] += size[1] / 2 - centre[1]
    expected = cv2.warpAffine(pixels, expected_matrix, size).astype(int)
    actual = subset.warpAffine(pixels, matrix, size).astype(int)
    assert actual.shape == expected.shape
    assert np.abs(actual - expected).max() <= 1


def test_debug_windows_are_refused() -> None:
    with pytest.raises(NotImplementedError):
        subset.build_module().imshow("x", np.zeros((1, 1), np.uint8))


def test_ensure_installs_the_subset_only_when_opencv_is_missing(monkeypatch) -> None:
    subset.ensure_cv2()
    assert sys.modules["cv2"] is cv2
    monkeypatch.setitem(sys.modules, "cv2", None)
    subset.ensure_cv2()
    assert sys.modules["cv2"].__version__ == "subset"


def _vector_document(path: Path) -> Path:
    document = pymupdf.open()
    rng = np.random.default_rng(5)
    streams = []
    for size in ((60, 90, 3), (45, 70, 3)):
        buffer = io.BytesIO()
        Image.fromarray(rng.integers(0, 256, size, dtype=np.uint8)).save(buffer, "PNG")
        streams.append(buffer.getvalue())
    for rotation in (0, 90, 180, 270):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 72), f"Döndürülmüş sayfa {rotation}", fontsize=14)
        page.insert_image(pymupdf.Rect(72, 100, 252, 220), stream=streams[0])
        page.insert_image(pymupdf.Rect(300, 100, 420, 280), stream=streams[1], rotate=90)
        page.draw_circle((150, 400), 60, color=(0, 0, 1), fill=(0.8, 0.9, 1))
        page.draw_line((300, 350), (500, 480), color=(1, 0, 0), width=2)
        for x in (72, 222, 372, 522):
            page.draw_line((x, 520), (x, 700))
        for y in (520, 580, 640, 700):
            page.draw_line((72, y), (522, y))
        page.draw_line((80, 530), (210, 570), color=(0, 0.6, 0))
        page.insert_text((230, 550), "hücre", fontsize=11)
        page.set_rotation(rotation)
    document.save(path)
    document.close()
    return path


def _docx_content(path: Path) -> tuple[str, list[np.ndarray]]:
    with zipfile.ZipFile(path) as archive:
        body = re.sub(r'r:(id|embed)="rId\d+"', "", archive.read("word/document.xml").decode())
        media = [
            np.asarray(Image.open(io.BytesIO(archive.read(name))).convert("RGB")).astype(int)
            for name in sorted(archive.namelist())
            if name.startswith("word/media/")
        ]
    return body, media


def test_word_conversion_is_the_same_with_the_subset(tmp_path: Path, monkeypatch) -> None:
    import pdf2docx.common.algorithm as algorithm

    source = _vector_document(tmp_path / "vektör çizim.pdf")
    real = to_docx(
        DocxParams(path=str(source), output=str(tmp_path / "real.docx")), silent_progress()
    )
    module = subset.build_module()
    monkeypatch.setitem(sys.modules, "cv2", module)
    monkeypatch.setattr(algorithm, "cv", module)
    lite = to_docx(
        DocxParams(path=str(source), output=str(tmp_path / "lite.docx")), silent_progress()
    )
    real_body, real_media = _docx_content(Path(real.output))
    lite_body, lite_media = _docx_content(Path(lite.output))
    assert lite_body == real_body
    assert len(lite_media) == len(real_media)
    for expected, actual in zip(real_media, lite_media, strict=True):
        assert actual.shape == expected.shape
        assert np.abs(actual - expected).max() <= 1
