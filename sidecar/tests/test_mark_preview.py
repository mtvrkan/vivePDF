import base64
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._watermark_style import WatermarkPreviewParams
from vivepdf.ops.security_watermark import watermark_preview
from vivepdf.ops.stamp import StampPreviewParams, stamp_preview
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _pixels(image: str) -> pymupdf.Pixmap:
    return pymupdf.Pixmap(base64.b64decode(image))


def test_watermark_preview_renders_the_first_selected_page(sample_pdf: Path) -> None:
    before = sample_pdf.read_bytes()
    result = watermark_preview(
        WatermarkPreviewParams(path=str(sample_pdf), text="GİZLİ", pages="2-3", width=300),
        silent_progress(),
    )
    assert result.page == 2 and result.page_count == 3
    pixmap = _pixels(result.image)
    assert pixmap.width == result.width == 300
    assert sample_pdf.read_bytes() == before


def test_watermark_preview_draws_something(sample_pdf: Path) -> None:
    plain = watermark_preview(
        WatermarkPreviewParams(path=str(sample_pdf), text=".", opacity=0.02, width=200),
        silent_progress(),
    )
    marked = watermark_preview(
        WatermarkPreviewParams(path=str(sample_pdf), text="GİZLİ", opacity=1, width=200),
        silent_progress(),
    )
    assert plain.image != marked.image


def test_watermark_preview_falls_back_when_the_range_is_unusable(sample_pdf: Path) -> None:
    result = watermark_preview(
        WatermarkPreviewParams(path=str(sample_pdf), text="GİZLİ", pages="99", width=200),
        silent_progress(),
    )
    assert result.page == 1


def test_watermark_preview_rejects_empty_text(sample_pdf: Path) -> None:
    with pytest.raises(OpError) as error:
        watermark_preview(
            WatermarkPreviewParams(path=str(sample_pdf), text="   "), silent_progress()
        )
    assert error.value.code == ErrorCode.INVALID_PARAMS


def test_stamp_preview_renders_the_first_selected_page(sample_pdf: Path) -> None:
    before = sample_pdf.read_bytes()
    result = stamp_preview(
        StampPreviewParams(path=str(sample_pdf), text="ONAYLANDI", pages="3", width=240),
        silent_progress(),
    )
    assert result.page == 3 and result.page_count == 3
    assert _pixels(result.image).width == result.width == 240
    assert sample_pdf.read_bytes() == before


def test_stamp_preview_reflects_the_position(sample_pdf: Path) -> None:
    top = stamp_preview(
        StampPreviewParams(path=str(sample_pdf), text="ONAYLANDI", position="top-right"),
        silent_progress(),
    )
    bottom = stamp_preview(
        StampPreviewParams(path=str(sample_pdf), text="ONAYLANDI", position="bottom-left"),
        silent_progress(),
    )
    assert top.image != bottom.image


def test_stamp_preview_needs_a_readable_document(broken_pdf: Path) -> None:
    with pytest.raises(OpError) as error:
        stamp_preview(StampPreviewParams(path=str(broken_pdf), text="X"), silent_progress())
    assert error.value.code == ErrorCode.INVALID_PDF
