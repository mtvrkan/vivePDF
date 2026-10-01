from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.watermark_detection import DetectWatermarkParams, detect_watermark
from vivepdf.ops.watermark_removal import RemoveWatermarkParams, remove_watermark
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def marked_pdf(tmp_path: Path) -> Path:
    logo = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 60))
    logo.set_rect(logo.irect, (12, 140, 230))
    logo_png = tmp_path / "logo.png"
    logo.save(logo_png)
    document = pymupdf.open()
    for index in range(6):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 120), f"Gövde metni sayfa {index + 1}", fontsize=11)
        page.insert_text(
            (150, 500),
            "TASLAK",
            fontsize=60,
            color=(0.85, 0.85, 0.85),
            morph=(pymupdf.Point(300, 480), pymupdf.Matrix(45)),
        )
        page.insert_image(pymupdf.Rect(480, 40, 540, 100), filename=str(logo_png))
    path = tmp_path / "marked.pdf"
    document.save(path)
    document.close()
    return path


def test_detect_finds_the_rotated_text_and_the_repeated_image(marked_pdf: Path) -> None:
    result = detect_watermark(DetectWatermarkParams(path=str(marked_pdf)), silent_progress())
    assert result.pages_scanned == 6 and result.page_count == 6
    texts = [item for item in result.candidates if item.kind == "text"]
    images = [item for item in result.candidates if item.kind == "image"]
    assert any(item.text == "TASLAK" and item.pages == 6 and item.rotated for item in texts)
    assert len(images) == 1
    assert images[0].pages == 6 and images[0].preview and images[0].digest
    assert not any(item.text and "Gövde" in item.text for item in texts)


def test_detect_reports_watermark_annotations(sample_pdf: Path, tmp_path: Path) -> None:
    stamped = tmp_path / "stamped.pdf"
    with pymupdf.open(sample_pdf) as document:
        for index in range(2):
            document[index].add_stamp_annot(pymupdf.Rect(60, 60, 220, 110), stamp=0)
        document.save(stamped)
    result = detect_watermark(DetectWatermarkParams(path=str(stamped)), silent_progress())
    stamps = [item for item in result.candidates if item.kind == "stampAnnotation"]
    assert stamps and stamps[0].pages == 2 and not stamps[0].confident
    assert not [item for item in result.candidates if item.kind == "annotation"]


def test_detect_finds_nothing_in_a_plain_document(sample_pdf: Path) -> None:
    result = detect_watermark(DetectWatermarkParams(path=str(sample_pdf)), silent_progress())
    assert result.candidates == []


def test_remove_uses_the_detected_text_and_image(marked_pdf: Path, tmp_path: Path) -> None:
    found = detect_watermark(DetectWatermarkParams(path=str(marked_pdf)), silent_progress())
    texts = [item.text for item in found.candidates if item.kind == "text" and item.text]
    digests = [item.digest for item in found.candidates if item.kind == "image" and item.digest]
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(marked_pdf),
            output=str(tmp_path / "clean.pdf"),
            texts=texts,
            image_digests=digests,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert result.removed_text >= 6 and result.removed_images >= 6
    with pymupdf.open(result.output) as document:
        assert "TASLAK" not in document[0].get_text()
        assert "Gövde metni sayfa 1" in document[0].get_text()
        assert all(image[2] <= 1 and image[3] <= 1 for image in document[0].get_images())


def test_remove_still_refuses_an_empty_selection(sample_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as error:
        remove_watermark(
            RemoveWatermarkParams(
                path=str(sample_pdf),
                output=str(tmp_path / "clean.pdf"),
                annotations=False,
                repeated_images=False,
            ),
            silent_progress(),
        )
    assert error.value.code == ErrorCode.INVALID_PARAMS


def test_detect_scans_every_page_for_annotations(tmp_path: Path) -> None:
    document = pymupdf.open()
    for _ in range(90):
        document.new_page(width=595, height=842)
    document[88].add_stamp_annot(pymupdf.Rect(60, 60, 220, 110), stamp=0)
    path = tmp_path / "sparse.pdf"
    document.save(path)
    document.close()
    result = detect_watermark(DetectWatermarkParams(path=str(path)), silent_progress())
    assert result.pages_scanned < result.page_count
    assert [item.pages for item in result.candidates if item.kind == "stampAnnotation"] == [1]
