import math
import multiprocessing
import os
from collections import deque
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

import pymupdf

from vivepdf.ops._docx_parallel import exit_with_parent
from vivepdf.ops._passwords import authenticate_password
from vivepdf.ops._pool_watch import PoolWatch, WorkerLost
from vivepdf.rpc.failures import document_failure

MAX_IMAGE_SIDE = {"png": 65000, "jpg": 65500, "webp": 16383, "tiff": 65000}
MAX_PAGE_PIXELS = 150_000_000
PARALLEL_MIN_PAGES = 12
PAGES_PER_WORKER = 4
MAX_WORKERS = 6
QUEUE_EXTRA = 2
POLL_SECONDS = 0.2
TIFF_COMPRESSION = "tiff_lzw"

_document: pymupdf.Document | None = None
_opening_error = ""


@dataclass(frozen=True)
class RenderSettings:
    format: str
    dpi: int
    quality: int
    alpha: bool
    gray: bool


def page_dpi(rect: pymupdf.Rect, dpi: int, image_format: str) -> int:
    width = max(1.0, rect.width * dpi / 72)
    height = max(1.0, rect.height * dpi / 72)
    scale = min(
        math.sqrt(MAX_PAGE_PIXELS / (width * height)),
        (MAX_IMAGE_SIDE[image_format] - 2) / max(width, height),
    )
    return dpi if scale >= 1 else max(1, math.floor(dpi * scale))


def page_pixmap(page: pymupdf.Page, dpi: int, settings: RenderSettings) -> pymupdf.Pixmap:
    colorspace = pymupdf.csGRAY if settings.gray else pymupdf.csRGB
    return page.get_pixmap(dpi=dpi, alpha=settings.alpha, colorspace=colorspace)


def save_pixmap(pixmap: pymupdf.Pixmap, target: Path, settings: RenderSettings, dpi: int) -> None:
    if settings.format == "webp":
        pixmap.pil_save(str(target), format="WEBP", quality=settings.quality)
    elif settings.format == "tiff":
        pixmap.pil_save(str(target), format="TIFF", compression=TIFF_COMPRESSION, dpi=(dpi, dpi))
    elif settings.format == "jpg":
        pixmap.save(str(target), output="jpg", jpg_quality=settings.quality)
    else:
        pixmap.save(str(target), output="png")


def render_page_file(
    document: pymupdf.Document, index: int, target: Path, settings: RenderSettings
) -> bool:
    page = document[index]
    dpi = page_dpi(page.rect, settings.dpi, settings.format)
    save_pixmap(page_pixmap(page, dpi, settings), target, settings, dpi)
    return dpi != settings.dpi


def render_workers(pages: int, cpus: int | None = None) -> int:
    if pages < PARALLEL_MIN_PAGES:
        return 1
    available = (cpus if cpus is not None else os.cpu_count() or 1) - 1
    return max(1, min(available, MAX_WORKERS, pages // PAGES_PER_WORKER))


def _start_worker(path: str, password: str | None) -> None:
    global _document, _opening_error
    exit_with_parent()
    try:
        _document = pymupdf.open(path)
        if _document.needs_pass and not authenticate_password(_document, password or ""):
            _opening_error = "the worker could not unlock the document"
    except Exception as error:  # noqa: BLE001
        _opening_error = str(error)


def _render_job(index: int, target: str, settings: RenderSettings) -> bool:
    if _document is None or _opening_error:
        raise RuntimeError(_opening_error or "worker has no document")
    try:
        return render_page_file(_document, index, Path(target), settings)
    except OSError:
        raise
    except Exception as error:  # noqa: BLE001
        raise RuntimeError(str(error)) from None


@dataclass(frozen=True)
class RenderSource:
    document: pymupdf.Document
    path: str
    password: str | None


def rendered_in_order(
    source: RenderSource,
    jobs: list[tuple[int, Path]],
    settings: RenderSettings,
    check_cancelled: Callable[[], None],
    workers: int,
) -> Iterator[tuple[int, bool]]:
    if workers <= 1:
        for index, target in jobs:
            check_cancelled()
            yield index, render_page_file(source.document, index, target, settings)
        return
    pool = multiprocessing.get_context("spawn").Pool(
        processes=workers, initializer=_start_worker, initargs=(source.path, source.password)
    )
    watch = PoolWatch(pool)
    waiting = iter(jobs)
    pending: deque[tuple[int, Path, multiprocessing.pool.AsyncResult]] = deque()
    remaining: list[tuple[int, Path]] = []
    try:

        def submit() -> None:
            job = next(waiting, None)
            if job is None:
                return
            index, target = job
            rendering = pool.apply_async(_render_job, (index, str(target), settings))
            pending.append((index, target, rendering))

        for _ in range(workers + QUEUE_EXTRA):
            submit()
        while pending:
            index, _target, job = pending[0]
            while not job.ready():
                check_cancelled()
                watch.check([job])
                job.wait(POLL_SECONDS)
            pending.popleft()
            try:
                reduced = job.get()
            except RuntimeError as error:
                raise (document_failure(error) or error) from error
            submit()
            yield index, reduced
    except WorkerLost:
        remaining = [(index, target) for index, target, _job in pending] + list(waiting)
    finally:
        pool.terminate()
        pool.join()
    yield from rendered_in_order(source, remaining, settings, check_cancelled, 1)
