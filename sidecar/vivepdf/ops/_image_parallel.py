import multiprocessing
import os
import re
import shutil
import tempfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pymupdf

from vivepdf.ops._docx_parallel import exit_with_parent
from vivepdf.ops._pool_watch import PoolWatch

PARALLEL_MIN_PAGES = 32
MAX_WORKERS = 8
POLL_SECONDS = 0.2
REFERENCE = re.compile(rb"(?<![\d.])(\d+) 0 R\b")
SNAPSHOT_NAME = "snapshot.pdf"

_snapshot: str | None = None
_expected_length = 0


class UnsafeMerge(Exception):
    pass


@dataclass
class NewObject:
    xref: int
    body: bytes
    stream: bytes | None


@dataclass
class BatchResult:
    limit: int
    pages: dict[int, bytes] = field(default_factory=dict)
    objects: list[NewObject] = field(default_factory=list)
    foreign: list[int] = field(default_factory=list)


def worker_count(page_total: int, batch_pages: int, cpus: int | None = None) -> int:
    if page_total < PARALLEL_MIN_PAGES:
        return 1
    available = (cpus if cpus is not None else os.cpu_count() or 1) - 1
    batch_total = -(-page_total // batch_pages)
    return max(1, min(available, MAX_WORKERS, batch_total))


def _start_worker(snapshot: str, expected_length: int) -> None:
    global _snapshot, _expected_length
    exit_with_parent()
    _snapshot = snapshot
    _expected_length = expected_length


def _object_body(document: pymupdf.Document, xref: int) -> bytes:
    return document.xref_object(xref, compressed=True).encode("latin-1")


def rewrite_batch(page_xrefs: list[int], options: dict[str, Any]) -> BatchResult:
    if _snapshot is None:
        raise UnsafeMerge("worker has no snapshot")
    with pymupdf.open(_snapshot) as document:
        if document.xref_length() != _expected_length:
            raise UnsafeMerge("snapshot numbering differs")
        catalog = document.pdf_catalog()
        kind, original = document.xref_get_key(catalog, "Pages")
        if kind != "xref":
            raise UnsafeMerge("page tree root is not indirect")
        holder = document.get_new_xref()
        document.update_object(holder, "<<>>")
        limit = document.xref_length()
        before = {xref: _object_body(document, xref) for xref in range(1, limit)}
        kids = " ".join(f"{xref} 0 R" for xref in page_xrefs)
        document.update_object(holder, f"<</Type/Pages/Kids[{kids}]/Count {len(page_xrefs)}>>")
        document.xref_set_key(catalog, "Pages", f"{holder} 0 R")
        try:
            document.rewrite_images(**options)
        finally:
            document.xref_set_key(catalog, "Pages", original)
        result = BatchResult(limit=limit)
        wanted = set(page_xrefs)
        for xref in range(1, limit):
            if xref == holder:
                continue
            body = _object_body(document, xref)
            if body == before[xref]:
                continue
            if xref in wanted:
                result.pages[xref] = body
            else:
                result.foreign.append(xref)
        for xref in range(limit, document.xref_length()):
            stream = document.xref_stream_raw(xref) if document.xref_is_stream(xref) else None
            result.objects.append(NewObject(xref, _object_body(document, xref), stream))
        return result


def renumbered(body: bytes, limit: int, mapping: dict[int, int]) -> bytes:
    def replace(match: re.Match[bytes]) -> bytes:
        number = int(match.group(1))
        if number < limit:
            return match.group(0)
        if number not in mapping:
            raise UnsafeMerge(f"reference to unknown new object {number}")
        return b"%d 0 R" % mapping[number]

    return REFERENCE.sub(replace, body)


def _attach_stream(document: pymupdf.Document, xref: int, stream: bytes) -> None:
    pdf = pymupdf._as_pdf_document(document)
    target = pymupdf.mupdf.pdf_new_indirect(pdf, xref, 0)
    buffer = pymupdf.mupdf.fz_new_buffer_from_copied_data(stream)
    pymupdf.mupdf.pdf_update_stream(pdf, target, buffer, 1)


def validate(results: Sequence[BatchResult]) -> None:
    claimed: set[int] = set()
    for result in results:
        if result.foreign:
            raise UnsafeMerge(f"objects outside the batch changed: {result.foreign[:5]}")
        if claimed & result.pages.keys():
            raise UnsafeMerge("a page was rewritten twice")
        claimed |= result.pages.keys()
        known = {item.xref for item in result.objects}
        bodies = [item.body for item in result.objects] + list(result.pages.values())
        for body in bodies:
            for match in REFERENCE.finditer(body):
                number = int(match.group(1))
                if number >= result.limit and number not in known:
                    raise UnsafeMerge(f"reference to unknown new object {number}")


def merge(document: pymupdf.Document, results: Sequence[BatchResult]) -> None:
    validate(results)
    for result in results:
        mapping = {item.xref: document.get_new_xref() for item in result.objects}
        for item in result.objects:
            document.update_object(
                mapping[item.xref], renumbered(item.body, result.limit, mapping).decode("latin-1")
            )
            if item.stream is not None:
                _attach_stream(document, mapping[item.xref], item.stream)
        for xref, body in result.pages.items():
            document.update_object(xref, renumbered(body, result.limit, mapping).decode("latin-1"))


def write_snapshot(document: pymupdf.Document, folder: Path) -> Path:
    target = folder / SNAPSHOT_NAME
    document.save(
        target,
        garbage=0,
        clean=False,
        deflate=False,
        encryption=pymupdf.PDF_ENCRYPT_NONE,
    )
    return target


class ParallelRewrite:
    def __init__(
        self,
        on_batch: Callable[[int], None],
        check_cancelled: Callable[[], None],
    ) -> None:
        self.on_batch = on_batch
        self.check_cancelled = check_cancelled

    def run(
        self,
        document: pymupdf.Document,
        batches: Sequence[list[int]],
        options: dict[str, Any],
        workers: int,
    ) -> None:
        folder = Path(tempfile.mkdtemp(prefix="vivepdf-images-"))
        try:
            snapshot = write_snapshot(document, folder)
            self.check_cancelled()
            length = document.xref_length()
            results = self._collect(str(snapshot), length, batches, options, workers)
            merge(document, results)
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    def _collect(
        self,
        snapshot: str,
        expected_length: int,
        batches: Sequence[list[int]],
        options: dict[str, Any],
        workers: int,
    ) -> list[BatchResult]:
        context = multiprocessing.get_context("spawn")
        pool = context.Pool(
            processes=workers,
            initializer=_start_worker,
            initargs=(snapshot, expected_length),
        )
        watch = PoolWatch(pool)
        try:
            jobs = [pool.apply_async(rewrite_batch, (batch, options)) for batch in batches]
            pool.close()
            finished: set[int] = set()
            while len(finished) < len(jobs):
                self.check_cancelled()
                watch.check(jobs)
                for index, job in enumerate(jobs):
                    if index in finished or not job.ready():
                        continue
                    job.get()
                    finished.add(index)
                    self.on_batch(len(finished))
                pending = [job for index, job in enumerate(jobs) if index not in finished]
                if pending:
                    pending[0].wait(POLL_SECONDS)
            return [job.get() for job in jobs]
        finally:
            pool.terminate()
            pool.join()
