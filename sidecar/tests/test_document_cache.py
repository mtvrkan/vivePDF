import threading
import time
from pathlib import Path

import pytest

from vivepdf.ops import _document
from vivepdf.ops._document import CachedDocument, forget_document, open_document
from vivepdf.rpc.errors import OpError


@pytest.fixture(autouse=True)
def clear_cache():
    yield
    with _document._cache_lock:
        for entry in _document._cache.values():
            if not entry.document.is_closed:
                entry.document.close()
        _document._cache.clear()


def test_mutable_open_returns_fresh_document_each_time(sample_pdf: Path) -> None:
    with open_document(str(sample_pdf), mutable=True) as first:
        first_id = id(first)
    with open_document(str(sample_pdf), mutable=True) as second:
        assert id(second) != first_id


def test_immutable_open_reuses_cached_document(sample_pdf: Path) -> None:
    with open_document(str(sample_pdf), mutable=False) as first:
        assert isinstance(first, CachedDocument)
        first_page_count = first.page_count
    with open_document(str(sample_pdf), mutable=False) as second:
        assert second.page_count == first_page_count
    assert len(_document._cache) == 1


def test_cache_invalidates_on_file_change(sample_pdf: Path) -> None:
    with open_document(str(sample_pdf), mutable=False):
        pass
    time.sleep(0.01)
    with open_document(str(sample_pdf), mutable=True) as document:
        document.new_page(width=200, height=200)
        temporary = sample_pdf.with_suffix(".rewritten.pdf")
        document.save(temporary)
    forget_document(str(sample_pdf))
    temporary.replace(sample_pdf)
    with open_document(str(sample_pdf), mutable=False) as reopened:
        assert reopened.page_count == 4


def test_forget_document_evicts_entry(sample_pdf: Path) -> None:
    with open_document(str(sample_pdf), mutable=False):
        pass
    assert len(_document._cache) == 1
    forget_document(str(sample_pdf))
    assert len(_document._cache) == 0


def test_mutable_open_gives_private_copy_not_shared_with_cache(sample_pdf: Path) -> None:
    with open_document(str(sample_pdf), mutable=False) as cached:
        cached_pages_before = cached.page_count
    with open_document(str(sample_pdf), mutable=True) as private_copy:
        private_copy.new_page(width=100, height=100)
        assert private_copy.page_count == cached_pages_before + 1
    with open_document(str(sample_pdf), mutable=False) as still_cached:
        assert still_cached.page_count == cached_pages_before


def test_concurrent_reads_do_not_share_document_across_threads(sample_pdf: Path) -> None:
    entered = threading.Event()
    release = threading.Event()
    overlap = threading.Event()

    def hold_document() -> None:
        with open_document(str(sample_pdf), mutable=False):
            entered.set()
            release.wait(timeout=2)

    holder = threading.Thread(target=hold_document)
    holder.start()
    entered.wait(timeout=2)

    def try_enter() -> None:
        with open_document(str(sample_pdf), mutable=False):
            pass
        overlap.set()

    waiter = threading.Thread(target=try_enter)
    waiter.start()
    waiter.join(timeout=0.2)
    assert not overlap.is_set()

    release.set()
    holder.join(timeout=2)
    waiter.join(timeout=2)
    assert overlap.is_set()


def test_cached_document_does_not_lock_the_file_on_disk(sample_pdf: Path) -> None:
    with open_document(str(sample_pdf), mutable=False) as document:
        assert document.page_count > 0
    moved = sample_pdf.with_name("moved.pdf")
    sample_pdf.rename(moved)
    assert moved.is_file()
    moved.rename(sample_pdf)


def _twin(sample_pdf: Path) -> Path:
    twin = sample_pdf.with_name("twin.pdf")
    twin.write_bytes(sample_pdf.read_bytes())
    return twin


def test_older_documents_leave_the_cache_once_it_holds_more_bytes_than_allowed(
    sample_pdf: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    twin = _twin(sample_pdf)
    monkeypatch.setattr(_document, "CACHE_MAX_BYTES", sample_pdf.stat().st_size + 1)

    with open_document(str(sample_pdf), mutable=False):
        pass
    with open_document(str(twin), mutable=False):
        pass

    assert [Path(path).name for path, _password in _document._cache] == ["twin.pdf"]


def test_one_document_larger_than_the_budget_is_still_cached(
    sample_pdf: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(_document, "CACHE_MAX_BYTES", 1)

    with open_document(str(sample_pdf), mutable=False):
        pass

    assert len(_document._cache) == 1


def test_a_document_still_in_use_is_not_closed_to_make_room(
    sample_pdf: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    twin = _twin(sample_pdf)
    monkeypatch.setattr(_document, "CACHE_MAX_BYTES", 1)

    with open_document(str(sample_pdf), mutable=False) as held:
        with open_document(str(twin), mutable=False):
            pass
        pages = held.page_count

    assert pages > 0
    assert len(_document._cache) == 2


def test_a_slow_first_open_does_not_hold_up_another_cached_document(
    sample_pdf: Path, tmp_path: Path, monkeypatch
) -> None:
    other = tmp_path / "other.pdf"
    other.write_bytes(sample_pdf.read_bytes())
    with open_document(str(sample_pdf), mutable=False):
        pass
    real_open = _document._open_fresh
    opening = threading.Event()
    release = threading.Event()

    def slow_open(file_path, *args, **kwargs):
        if Path(file_path).name == "other.pdf":
            opening.set()
            release.wait(5)
        return real_open(file_path, *args, **kwargs)

    monkeypatch.setattr(_document, "_open_fresh", slow_open)
    worker = threading.Thread(target=lambda: open_document(str(other), mutable=False).close())
    worker.start()
    assert opening.wait(5)
    started = time.monotonic()
    with open_document(str(sample_pdf), mutable=False) as cached:
        assert cached.page_count > 0
    waited = time.monotonic() - started
    release.set()
    worker.join(5)

    assert waited < 1
    assert len(_document._cache) == 2


def test_two_threads_opening_the_same_new_document_share_one_open(
    sample_pdf: Path, monkeypatch
) -> None:
    real_open = _document._open_fresh
    calls = []

    def counted_open(*args, **kwargs):
        calls.append(1)
        time.sleep(0.05)
        return real_open(*args, **kwargs)

    monkeypatch.setattr(_document, "_open_fresh", counted_open)
    threads = [
        threading.Thread(target=lambda: open_document(str(sample_pdf), mutable=False).close())
        for _ in range(3)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(5)

    assert len(calls) == 1
    assert len(_document._cache) == 1


def test_a_failed_open_leaves_no_entry_behind(tmp_path: Path) -> None:
    broken = tmp_path / "broken.pdf"
    broken.write_bytes(b"not a pdf at all")

    with pytest.raises(OpError):
        open_document(str(broken), mutable=False)

    assert len(_document._cache) == 0
    assert _document._opening == {}
