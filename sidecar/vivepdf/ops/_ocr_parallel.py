import multiprocessing
import os
from collections import deque
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass

import pymupdf
from PIL import Image, ImageFilter, ImageOps

from vivepdf.ops._docx_parallel import exit_with_parent
from vivepdf.ops._pool_watch import PoolWatch, WorkerLost
from vivepdf.rpc.errors import ErrorCode, OpError

PARALLEL_MIN_PAGES = 6
MAX_WORKERS = 8
POLL_SECONDS = 0.2
QUEUE_EXTRA = 2


@dataclass(frozen=True)
class Sheet:
    samples: bytes
    width: int
    height: int
    xres: int
    yres: int
    clean: bool


def worker_count(pages: int, cpus: int | None = None) -> int:
    if pages < PARALLEL_MIN_PAGES:
        return 1
    available = (cpus if cpus is not None else os.cpu_count() or 1) - 1
    return max(1, min(available, MAX_WORKERS, pages))


def rendered_sheet(pixmap: pymupdf.Pixmap, clean: bool) -> Sheet:
    if pixmap.n != 3 or pixmap.alpha:
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pixmap, 0)
    return Sheet(pixmap.samples, pixmap.width, pixmap.height, pixmap.xres, pixmap.yres, clean)


def _cleaned(pixmap: pymupdf.Pixmap) -> pymupdf.Pixmap:
    image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    gray = ImageOps.autocontrast(ImageOps.grayscale(image), cutoff=1)
    gray = gray.filter(ImageFilter.MedianFilter(3)).convert("RGB")
    return pymupdf.Pixmap(pymupdf.csRGB, gray.width, gray.height, gray.tobytes(), False)


def recognise(sheet: Sheet, language: str, tessdata: str) -> bytes:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, sheet.width, sheet.height, sheet.samples, False)
    if sheet.clean:
        pixmap = _cleaned(pixmap)
    pixmap.set_dpi(sheet.xres, sheet.yres)
    return pixmap.pdfocr_tobytes(compress=True, language=language, tessdata=tessdata)


def _failed(index: int, error: Exception) -> OpError:
    if isinstance(error, OpError):
        return error
    return OpError(ErrorCode.INTERNAL, f"OCR failed on page {index + 1}: {error}")


def _in_order_serial(
    indices: Iterable[int],
    render: Callable[[int], Sheet],
    language: str,
    tessdata: str,
    check_cancelled: Callable[[], None],
) -> Iterator[tuple[int, bytes]]:
    for index in indices:
        check_cancelled()
        try:
            data = recognise(render(index), language, tessdata)
        except Exception as error:  # noqa: BLE001
            raise _failed(index, error) from error
        yield index, data


def recognised_in_order(
    indices: list[int],
    render: Callable[[int], Sheet],
    language: str,
    tessdata: str,
    check_cancelled: Callable[[], None],
    workers: int,
) -> Iterator[tuple[int, bytes]]:
    if workers <= 1:
        yield from _in_order_serial(indices, render, language, tessdata, check_cancelled)
        return
    pool = multiprocessing.get_context("spawn").Pool(
        processes=workers, initializer=exit_with_parent
    )
    watch = PoolWatch(pool)
    waiting = iter(indices)
    pending: deque[tuple[int, multiprocessing.pool.AsyncResult]] = deque()
    remaining: list[int] = []
    try:

        def submit() -> None:
            index = next(waiting, None)
            if index is None:
                return
            job = pool.apply_async(recognise, (render(index), language, tessdata))
            pending.append((index, job))

        for _ in range(workers + QUEUE_EXTRA):
            submit()
        while pending:
            check_cancelled()
            index, job = pending[0]
            while not job.ready():
                check_cancelled()
                watch.check([job])
                job.wait(POLL_SECONDS)
            pending.popleft()
            try:
                data = job.get()
            except Exception as error:  # noqa: BLE001
                raise _failed(index, error) from error
            submit()
            yield index, data
    except WorkerLost:
        remaining = [index for index, _job in pending] + list(waiting)
    finally:
        pool.terminate()
        pool.join()
    yield from _in_order_serial(remaining, render, language, tessdata, check_cancelled)
