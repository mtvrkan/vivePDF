import threading
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import compress as compress_module
from vivepdf.ops._dedupe import merge_duplicate_streams, rewrite_references
from vivepdf.ops._output import DEDUPLICATE_OBJECT_LIMIT
from vivepdf.ops.compress import CompressParams, compress
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress


def _cancelled_progress() -> Progress:
    event = threading.Event()
    event.set()
    return Progress(lambda _value, _message, _detail: None, event)


def test_references_inside_strings_and_names_stay_untouched():
    text = "<</A 5 0 R/B[15 0 R 5 0 R]/T(see 5 0 R \\) 5 0 R)/H<35>/C<</D 5 0 R>>>>"
    assert rewrite_references(text, {5: 3}) == (
        "<</A 3 0 R/B[15 0 R 3 0 R]/T(see 5 0 R \\) 5 0 R)/H<35>/C<</D 3 0 R>>>>"
    )


def _masked_pixmap(shade: int) -> pymupdf.Pixmap:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 32, 32), 1)
    pixmap.set_rect(pixmap.irect, (shade, 90, 200, 128))
    return pixmap


def _repeated_images(path: Path, pages: int) -> Path:
    document = pymupdf.open()
    for index in range(pages):
        single = pymupdf.open()
        page = single.new_page(width=200, height=200)
        page.insert_image(pymupdf.Rect(20, 20, 180, 180), pixmap=_masked_pixmap(index % 2 * 120))
        page.insert_text((20, 195), f"Sayfa {index + 1}")
        document.insert_pdf(single)
        single.close()
    document.save(path, garbage=0)
    document.close()
    return path


def _image_streams(document: pymupdf.Document) -> int:
    return sum(
        1
        for xref in range(1, document.xref_length())
        if document.xref_get_key(xref, "Subtype")[1] == "/Image"
    )


def _renders(document: pymupdf.Document) -> list[bytes]:
    return [page.get_pixmap(dpi=36).samples for page in document]


def test_duplicate_images_and_masks_merge_without_changing_pixels(tmp_path: Path):
    source = _repeated_images(tmp_path / "tekrar.pdf", 6)
    with pymupdf.open(source) as original:
        expected = _renders(original)
        assert _image_streams(original) == 12
    with pymupdf.open(source) as document:
        merged = merge_duplicate_streams(document, silent_progress())
        assert merged >= 9
        data = document.tobytes(garbage=2)
    with pymupdf.open(stream=data, filetype="pdf") as result:
        assert _image_streams(result) == 3
        assert _renders(result) == expected


def test_merging_stops_when_cancelled(tmp_path: Path):
    source = _repeated_images(tmp_path / "tekrar.pdf", 2)
    with pymupdf.open(source) as document, pytest.raises(OpError) as caught:
        merge_duplicate_streams(document, _cancelled_progress())
    assert caught.value.code == ErrorCode.CANCELLED


def test_large_documents_compress_with_the_fast_dedupe(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(compress_module, "DEDUPLICATE_OBJECT_LIMIT", 10)
    source = _repeated_images(tmp_path / "buyuk.pdf", 6)
    saved: list[dict] = []
    original_tobytes = pymupdf.Document.tobytes

    def spy(self, *args, **options):
        saved.append(options)
        return original_tobytes(self, *args, **options)

    monkeypatch.setattr(pymupdf.Document, "tobytes", spy)
    output = tmp_path / "kucuk.pdf"
    result = compress(
        CompressParams(path=str(source), output=str(output), profile="light"), silent_progress()
    )
    assert saved[0]["garbage"] == 2 and not saved[0]["clean"]
    assert result.bytes_after < result.bytes_before
    with pymupdf.open(source) as original, pymupdf.open(output) as written:
        assert _image_streams(written) == 3
        assert _renders(written) == _renders(original)


def test_small_documents_keep_the_full_deduplicating_save():
    assert DEDUPLICATE_OBJECT_LIMIT >= 1000
    assert compress_module.SAVE_OPTIONS["garbage"] == 4
    assert compress_module.SAVE_OPTIONS["clean"] is True
