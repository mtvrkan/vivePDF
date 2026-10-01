import importlib.util
import io
from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops._opencv_subset import ensure_cv2

ensure_cv2()

from pdf2docx.image import ImagesExtractor as images_extractor  # noqa: E402

from vivepdf.ops._docx_progress import hide_page_text_and_images, stabilise_pdf2docx  # noqa: E402


def _pristine_hide():
    spec = importlib.util.spec_from_file_location(
        "pdf2docx.image.pristine_images_extractor", images_extractor.__file__
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.ImagesExtractor.__dict__["_hide_page_text_and_images"].__func__


ORIGINAL = _pristine_hide()


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


def _busy_page_pdf(path: Path, forms: int) -> Path:
    source = pymupdf.open()
    stamp = source.new_page(width=60, height=20)
    stamp.draw_line((0, 10), (60, 10), color=(0, 0, 1), stroke_opacity=0.5)
    stamp.insert_text((2, 15), "w", fontsize=8)
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.insert_text((72, 72), "Attention visualisation")
    page.insert_image(pymupdf.Rect(72, 90, 172, 190), stream=_png())
    for index in range(forms):
        x, y = 20 + (index % 8) * 70, 220 + (index // 8) * 22
        page.show_pdf_page(pymupdf.Rect(x, y, x + 60, y + 20), source, 0)
    document.save(path)
    document.close()
    return path


def _streams(document: pymupdf.Document, page: pymupdf.Page) -> dict[int, bytes]:
    xrefs = [xref for (xref, *_rest) in page.get_xobjects()] + page.get_contents()
    return {xref: document.xref_stream(xref) for xref in xrefs}


@pytest.mark.parametrize(("rm_text", "rm_image"), [(True, True), (True, False), (False, True)])
def test_hides_exactly_what_pdf2docx_hides(tmp_path: Path, rm_text: bool, rm_image: bool):
    source = _busy_page_pdf(tmp_path / "busy.pdf", 24)
    expected_document = pymupdf.open(source)
    expected_page = expected_document[0]
    actual_document = pymupdf.open(source)
    actual_page = actual_document[0]

    expected = ORIGINAL(expected_page, rm_text, rm_image)
    actual = hide_page_text_and_images(actual_page, rm_text, rm_image)

    assert actual == expected
    assert _streams(actual_document, actual_page) == _streams(expected_document, expected_page)
    expected_document.close()
    actual_document.close()


def test_reads_the_image_list_once_however_many_forms_the_page_holds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    source = _busy_page_pdf(tmp_path / "busy.pdf", 120)
    document = pymupdf.open(source)
    page = document[0]
    calls = []
    original_get_images = pymupdf.Page.get_images
    monkeypatch.setattr(
        pymupdf.Page,
        "get_images",
        lambda self, *args, **kwargs: calls.append(1) or original_get_images(self, *args, **kwargs),
    )

    hide_page_text_and_images(page, True, True)

    assert len(calls) == 1
    document.close()


def test_a_page_without_forms_or_images_is_left_untouched(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()

    assert hide_page_text_and_images(page, True, True) == {}
    document.close()


def test_stabilising_routes_pdf2docx_through_the_single_pass_version():
    stabilise_pdf2docx()

    installed = images_extractor.ImagesExtractor.__dict__["_hide_page_text_and_images"]

    assert installed.__func__ is hide_page_text_and_images
