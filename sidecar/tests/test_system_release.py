import threading
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import _document
from vivepdf.ops._document import open_document
from vivepdf.ops.system import ReleaseParams, release
from vivepdf.rpc.progress import silent_progress


def _clear_cache() -> None:
    with _document._cache_lock:
        for entry in _document._cache.values():
            if not entry.document.is_closed:
                entry.document.close()
        _document._cache.clear()


@pytest.fixture(autouse=True)
def clear_cache():
    _clear_cache()
    yield
    _clear_cache()


def _pdf(path: Path) -> Path:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), path.stem)
    document.save(path)
    document.close()
    return path


def _cache(*paths: Path) -> None:
    for path in paths:
        with open_document(str(path), mutable=False):
            pass


def test_releasing_a_closed_document_forgets_only_that_one(tmp_path: Path) -> None:
    first, second = _pdf(tmp_path / "first.pdf"), _pdf(tmp_path / "second.pdf")
    _cache(first, second)

    result = release(ReleaseParams(path=str(first)), silent_progress())

    assert result.released == 1
    assert [Path(key[0]).name for key in _document._cache] == ["second.pdf"]


def test_releasing_without_a_path_empties_the_cache(tmp_path: Path) -> None:
    _cache(_pdf(tmp_path / "first.pdf"), _pdf(tmp_path / "second.pdf"))

    result = release(ReleaseParams(), silent_progress())

    assert result.released == 2
    assert len(_document._cache) == 0


def test_releasing_a_document_that_was_never_read_does_nothing(tmp_path: Path) -> None:
    _cache(_pdf(tmp_path / "kept.pdf"))

    result = release(ReleaseParams(path=str(tmp_path / "other.pdf")), silent_progress())

    assert result.released == 0
    assert len(_document._cache) == 1


def test_a_document_in_use_is_closed_only_after_the_reader_is_done(tmp_path: Path) -> None:
    path = _pdf(tmp_path / "busy.pdf")
    reading = threading.Event()
    finish = threading.Event()
    seen: list[int] = []

    def reader() -> None:
        with open_document(str(path), mutable=False) as document:
            reading.set()
            finish.wait(5)
            seen.append(document.page_count)

    thread = threading.Thread(target=reader)
    thread.start()
    reading.wait(5)
    releaser = threading.Thread(
        target=release, args=(ReleaseParams(path=str(path)), silent_progress())
    )
    releaser.start()
    releaser.join(0.2)
    still_waiting = releaser.is_alive()
    finish.set()
    thread.join(5)
    releaser.join(5)

    assert still_waiting
    assert seen == [1]
    assert len(_document._cache) == 0
