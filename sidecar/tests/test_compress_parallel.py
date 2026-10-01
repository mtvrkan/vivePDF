import io
import sys
import time
from pathlib import Path

import pymupdf
import pytest
from PIL import Image, ImageDraw

from vivepdf.ops import _image_parallel
from vivepdf.ops import compress as compress_module
from vivepdf.ops._image_parallel import BatchResult, NewObject, UnsafeMerge
from vivepdf.ops.compress import CompressParams, compress
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

PAGES = 40


def scanned_pages(target: Path, pages: int = PAGES) -> Path:
    document = pymupdf.open()
    for index in range(pages):
        image = Image.new("RGB", (1240, 1754), (240, 238, 230))
        draw = ImageDraw.Draw(image)
        for line in range(24):
            draw.rectangle(
                (120, 120 + line * 60, 900 + index * 5, 140 + line * 60), fill=(20, 20, 30)
            )
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=95)
        page = document.new_page(width=595, height=842)
        page.insert_image(page.rect, stream=buffer.getvalue())
        if index % 5 == 0:
            page.insert_text((72, 72), f"Sayfa {index + 1}", fontsize=12)
    document.save(target)
    document.close()
    return target


def objects(path: Path) -> list[tuple[str, bytes]]:
    with pymupdf.open(path) as document:
        return [
            (
                document.xref_object(xref, compressed=True),
                document.xref_stream_raw(xref) if document.xref_is_stream(xref) else b"",
            )
            for xref in range(1, document.xref_length())
            if document.xref_get_key(xref, "Type") != ("name", "/XRef")
        ]


def rendered(path: Path) -> list[bytes]:
    with pymupdf.open(path) as document:
        return [page.get_pixmap(dpi=24).samples for page in document]


@pytest.fixture
def scan(tmp_path: Path) -> Path:
    return scanned_pages(tmp_path / "tarama.pdf")


def run(source: Path, target: Path) -> int:
    return compress(
        CompressParams(path=str(source), output=str(target), overwrite=True), silent_progress()
    ).bytes_after


def test_parallel_rewrite_matches_the_serial_result(scan: Path, tmp_path: Path, monkeypatch):
    merges: list[int] = []
    original = _image_parallel.merge

    def counted(document, results):
        merges.append(len(results))
        original(document, results)

    monkeypatch.setattr(_image_parallel, "merge", counted)
    monkeypatch.setattr(_image_parallel, "worker_count", lambda *_args: 1)
    run(scan, tmp_path / "seri.pdf")
    monkeypatch.setattr(_image_parallel, "worker_count", lambda *_args: 2)
    parallel = run(scan, tmp_path / "paralel.pdf")
    assert merges == [-(-PAGES // compress_module.IMAGE_BATCH_PAGES)]
    assert objects(tmp_path / "paralel.pdf") == objects(tmp_path / "seri.pdf")
    assert rendered(tmp_path / "paralel.pdf") == rendered(tmp_path / "seri.pdf")
    assert parallel < scan.stat().st_size


def test_an_unsafe_merge_falls_back_to_the_serial_rewrite(scan: Path, tmp_path: Path, monkeypatch):
    monkeypatch.setattr(_image_parallel, "worker_count", lambda *_args: 1)
    run(scan, tmp_path / "seri.pdf")

    def refuse(_document, _results):
        raise UnsafeMerge("objects outside the batch changed")

    monkeypatch.setattr(_image_parallel, "worker_count", lambda *_args: 2)
    monkeypatch.setattr(_image_parallel, "merge", refuse)
    run(scan, tmp_path / "yedek.pdf")
    assert objects(tmp_path / "yedek.pdf") == objects(tmp_path / "seri.pdf")


def test_workers_that_die_on_start_fall_back_to_the_serial_rewrite(
    scan: Path, tmp_path: Path, monkeypatch
):
    monkeypatch.setattr(_image_parallel, "worker_count", lambda *_args: 1)
    run(scan, tmp_path / "seri.pdf")
    monkeypatch.setattr(_image_parallel, "worker_count", lambda *_args: 2)
    monkeypatch.setattr(_image_parallel, "_start_worker", sys.exit)
    started = time.monotonic()
    run(scan, tmp_path / "yedek.pdf")
    assert time.monotonic() - started < 120
    assert objects(tmp_path / "yedek.pdf") == objects(tmp_path / "seri.pdf")


def test_cancelling_stops_the_workers_and_removes_the_snapshot(scan: Path, tmp_path, monkeypatch):
    folders: list[Path] = []
    original = _image_parallel.write_snapshot

    def remembered(document, folder):
        folders.append(folder)
        return original(document, folder)

    def cancelled() -> None:
        if folders:
            raise OpError(ErrorCode.CANCELLED, "cancelled")

    monkeypatch.setattr(_image_parallel, "write_snapshot", remembered)
    with pymupdf.open(scan) as document:
        rewrite = _image_parallel.ParallelRewrite(lambda _done: None, cancelled)
        with pytest.raises(OpError) as caught:
            rewrite.run(document, [[document.page_xref(0)]], {"dpi_threshold": 100}, 2)
    assert caught.value.code == ErrorCode.CANCELLED
    assert folders and not folders[0].exists()


def test_worker_count_stays_serial_for_short_documents():
    assert _image_parallel.worker_count(10, 8, cpus=16) == 1
    assert _image_parallel.worker_count(490, 8, cpus=16) == _image_parallel.MAX_WORKERS
    assert _image_parallel.worker_count(490, 8, cpus=2) == 1
    assert _image_parallel.worker_count(40, 8, cpus=16) == 5


def test_renumbered_moves_only_new_references():
    body = b"<</Contents 30 0 R/Resources<</XObject<</Im1 29 0 R/Im2 4 0 R>>>>/Rotate 0>>"
    moved = _image_parallel.renumbered(body, 26, {29: 101, 30: 102})
    assert (
        moved == b"<</Contents 102 0 R/Resources<</XObject<</Im1 101 0 R/Im2 4 0 R>>>>/Rotate 0>>"
    )
    with pytest.raises(UnsafeMerge):
        _image_parallel.renumbered(b"<</SMask 40 0 R>>", 26, {29: 101})


def test_validate_rejects_foreign_changes_dangling_references_and_double_pages():
    with pytest.raises(UnsafeMerge):
        _image_parallel.validate([BatchResult(limit=10, foreign=[3])])
    dangling = BatchResult(limit=10, pages={5: b"<</Contents 12 0 R>>"})
    with pytest.raises(UnsafeMerge):
        _image_parallel.validate([dangling])
    first = BatchResult(
        limit=10, pages={5: b"<</Contents 10 0 R>>"}, objects=[NewObject(10, b"<<>>", b"q")]
    )
    second = BatchResult(limit=10, pages={5: b"<<>>"})
    with pytest.raises(UnsafeMerge):
        _image_parallel.validate([first, second])
    _image_parallel.validate([first])
