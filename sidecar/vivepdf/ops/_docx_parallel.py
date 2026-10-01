import logging
import multiprocessing
import os
import queue
import threading
from collections.abc import Callable, Sequence
from typing import Any

from vivepdf.rpc.errors import ErrorCode, OpError

PARALLEL_MIN_PAGES = 16
PAGES_PER_WORKER = 8
MAX_WORKERS = 6
BATCHES_PER_WORKER = 4
POLL_SECONDS = 0.2

_converter: Any = None
_events: Any = None


def worker_count(page_total: int, cpus: int | None = None) -> int:
    if page_total < PARALLEL_MIN_PAGES:
        return 1
    available = (cpus if cpus is not None else os.cpu_count() or 1) - 1
    return max(1, min(available, MAX_WORKERS, page_total // PAGES_PER_WORKER))


def batches(indices: Sequence[int], workers: int) -> list[list[int]]:
    size = max(1, -(-len(indices) // (workers * BATCHES_PER_WORKER)))
    return [list(indices[start : start + size]) for start in range(0, len(indices), size)]


def _memoized(extract: Callable[[Any], Any]) -> Callable[[Any], Any]:
    cache: dict[int, Any] = {}

    def extract_once(fitz_doc: Any) -> Any:
        key = id(fitz_doc)
        if key not in cache:
            cache[key] = extract(fitz_doc)
        return cache[key]

    return extract_once


def _await_parent_exit(parent: Any) -> None:
    parent.join()
    os._exit(1)


def exit_with_parent() -> None:
    parent = multiprocessing.parent_process()
    if parent is None:
        return
    threading.Thread(target=_await_parent_exit, args=(parent,), daemon=True).start()


def _start_worker(path: str, password: str | None, events: Any) -> None:
    global _converter, _events
    exit_with_parent()
    from vivepdf.ops._opencv_subset import ensure_cv2

    ensure_cv2()
    from pdf2docx import Converter
    from pdf2docx.font.Fonts import Fonts

    from vivepdf.ops._docx_progress import stabilise_pdf2docx

    logging.disable(logging.CRITICAL)
    stabilise_pdf2docx()
    Fonts.extract = staticmethod(_memoized(Fonts.extract))
    _converter = Converter(path, password=password)
    _events = events


def _announce_page() -> None:
    _events.put(1)


def parse_batch(indices: list[int], settings: dict[str, Any]) -> list[Any]:
    from vivepdf.ops._docx_progress import ObservedPages

    converter = _converter
    converter.load_pages(pages=indices)
    pages = converter.pages
    pages.__class__ = ObservedPages
    pages.observer = _announce_page
    try:
        converter.parse_document(**settings)
    finally:
        pages.observer = None
    converter.parse_pages(**settings)
    return [page for page in pages if page.finalized]


class ParallelParse:
    def __init__(
        self,
        path: str,
        password: str | None,
        on_page: Callable[[], None],
        check_cancelled: Callable[[], None],
    ):
        self.path = path
        self.password = password
        self.on_page = on_page
        self.check_cancelled = check_cancelled

    def run(self, indices: Sequence[int], settings: dict[str, Any], workers: int) -> list[Any]:
        context = multiprocessing.get_context("spawn")
        events = context.Queue()
        pool = context.Pool(
            processes=workers,
            initializer=_start_worker,
            initargs=(self.path, self.password, events),
        )
        started = list(pool._pool)
        try:
            jobs = [
                pool.apply_async(parse_batch, (batch, settings))
                for batch in batches(indices, workers)
            ]
            pool.close()
            self._wait(jobs, events, started)
            parsed = [page for job in jobs for page in job.get()]
            self._drain(events)
            return parsed
        finally:
            pool.terminate()
            pool.join()
            events.close()
            events.join_thread()

    def _wait(self, jobs: list[Any], events: Any, started: Sequence[Any] = ()) -> None:
        while True:
            self.check_cancelled()
            stopped = any(process.exitcode is not None for process in started)
            if stopped and not all(job.ready() for job in jobs):
                raise OpError(
                    ErrorCode.INTERNAL,
                    "a conversion worker stopped unexpectedly",
                    {"reason": "workerCrashed"},
                )
            for job in jobs:
                if job.ready() and not job.successful():
                    job.get()
            try:
                events.get(timeout=POLL_SECONDS)
            except queue.Empty:
                if all(job.ready() for job in jobs):
                    return
                continue
            self.on_page()

    def _drain(self, events: Any) -> None:
        while True:
            try:
                events.get_nowait()
            except queue.Empty:
                return
            self.on_page()
