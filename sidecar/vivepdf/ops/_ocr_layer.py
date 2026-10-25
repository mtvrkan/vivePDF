import contextlib

import numpy as np
import pymupdf

from vivepdf.ops._ocr_parallel import Sheet, recognised_in_order, rendered_sheet, worker_count
from vivepdf.ops._orientation import capped_dpi
from vivepdf.ops.ocr import HiddenFonts, _language_string, _overlay_sheet
from vivepdf.ops.tessdata import writable_tessdata_dir
from vivepdf.rpc.progress import Progress

OCR_DPI = 300
RULE_INCHES = 0.75
RULE_INK = 160


def has_text(page: pymupdf.Page) -> bool:
    return bool(page.get_text("text").strip())


def _long_runs(ink: np.ndarray, length: int) -> np.ndarray:
    sums = np.zeros((ink.shape[0], ink.shape[1] + 1), np.int32)
    np.cumsum(ink, axis=1, out=sums[:, 1:])
    starts = np.zeros((ink.shape[0], ink.shape[1] + 1), np.int32)
    starts[:, : ink.shape[1] - length + 1] = (sums[:, length:] - sums[:, :-length]) == length
    covered = np.cumsum(starts, axis=1)
    reached = covered[:, : ink.shape[1]].copy()
    reached[:, length:] -= covered[:, : ink.shape[1] - length]
    return reached > 0


def _thickened(mask: np.ndarray) -> np.ndarray:
    grown = mask.copy()
    grown[1:] |= mask[:-1]
    grown[:-1] |= mask[1:]
    grown[:, 1:] |= mask[:, :-1]
    grown[:, :-1] |= mask[:, 1:]
    return grown


Rule = tuple[pymupdf.Point, pymupdf.Point]


def _row_segments(runs: np.ndarray) -> list[tuple[int, int, int]]:
    rows = np.flatnonzero(runs.any(axis=1))
    if not len(rows):
        return []
    segments: list[tuple[int, int, int]] = []
    for group in np.split(rows, np.flatnonzero(np.diff(rows) > 1) + 1):
        middle = int(group[len(group) // 2])
        edges = np.flatnonzero(np.diff(np.concatenate(([0], runs[middle].astype(np.int8), [0]))))
        segments.extend(
            (middle, int(a), int(b)) for a, b in zip(edges[::2], edges[1::2], strict=True)
        )
    return segments


def without_rules(pixmap: pymupdf.Pixmap) -> tuple[pymupdf.Pixmap, list[Rule]]:
    length = max(1, round(pixmap.xres * RULE_INCHES))
    pixels = np.frombuffer(pixmap.samples, np.uint8).reshape(pixmap.height, pixmap.width, 3)
    ink = pixels.min(axis=2) < RULE_INK
    if min(ink.shape) < length:
        return pixmap, []
    across, down = _long_runs(ink, length), _long_runs(ink.T, length)
    rules = _thickened(across | down.T)
    if not rules.any():
        return pixmap, []
    cleared = pixels.copy()
    cleared[rules] = 255
    result = pymupdf.Pixmap(pymupdf.csRGB, pixmap.width, pixmap.height, cleared.tobytes(), False)
    result.set_dpi(pixmap.xres, pixmap.yres)
    scale = 72 / pixmap.xres
    lines = [
        (pymupdf.Point(x0 * scale, y * scale), pymupdf.Point(x1 * scale, y * scale))
        for y, x0, x1 in _row_segments(across)
    ] + [
        (pymupdf.Point(x * scale, y0 * scale), pymupdf.Point(x * scale, y1 * scale))
        for x, y0, y1 in _row_segments(down)
    ]
    return result, lines


def recognise_textless_pages(
    document: pymupdf.Document,
    indices: list[int],
    languages: list[str],
    progress: Progress,
    rules: dict[int, list[Rule]] | None = None,
) -> list[int]:
    targets = [index for index in sorted(set(indices)) if not has_text(document[index])]
    if not targets:
        return []
    language = _language_string(languages)
    tessdata = str(writable_tessdata_dir())
    fonts = HiddenFonts()

    def render(index: int) -> Sheet:
        page = document[index]
        pixmap = page.get_pixmap(
            dpi=capped_dpi(page.rect, OCR_DPI), colorspace=pymupdf.csRGB, alpha=False
        )
        if rules is not None:
            pixmap, found = without_rules(pixmap)
            matrix = page.derotation_matrix
            rules[index] = [(start * matrix, end * matrix) for start, end in found]
        return rendered_sheet(pixmap, False)

    recognised: list[int] = []
    results = recognised_in_order(
        targets, render, language, tessdata, progress.check_cancelled, worker_count(len(targets))
    )
    with contextlib.closing(results):
        for done, (index, data) in enumerate(results, start=1):
            if _overlay_sheet(document[index], data, fonts):
                recognised.append(index + 1)
            progress.report(
                done / len(targets), "progress.ocr", {"current": done, "total": len(targets)}
            )
    return recognised
