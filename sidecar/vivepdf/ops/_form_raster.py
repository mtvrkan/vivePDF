import numpy as np
import pymupdf

from vivepdf.ops._form_detect_params import (
    ABOVE_INK_SHARE,
    COLOUR_SPREAD,
    CORNER_REACH,
    ENCLOSED_DEPTH,
    FAINT_LEVEL,
    INK_LEVEL,
    MAX_LINE_THICKNESS,
    PAPER_COLOUR,
    PAPER_WHITE,
    RASTER_DPI,
    RING,
    TOUCH_DEPTH,
    WHITE_INK,
    DetectParams,
)


def _ink_runs(ink: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    padded = np.zeros((ink.shape[0], ink.shape[1] + 2), dtype=np.int8)
    padded[:, 1:-1] = ink
    steps = np.diff(padded, axis=1)
    rows, starts = np.nonzero(steps == 1)
    _end_rows, ends = np.nonzero(steps == -1)
    return rows, starts, ends


def _group_runs(rows: np.ndarray, starts: np.ndarray, ends: np.ndarray) -> list[list[int]]:
    groups: list[list[int]] = []
    open_groups: list[list[int]] = []
    for row, start, end in zip(rows.tolist(), starts.tolist(), ends.tolist(), strict=True):
        match = None
        for group in open_groups:
            overlap = min(end, group[2]) - max(start, group[1])
            if row - group[3] <= 1 and overlap >= 0.8 * min(end - start, group[2] - group[1]):
                match = group
                break
        if match is None:
            match = [row, start, end, row]
            groups.append(match)
            open_groups.append(match)
        else:
            match[1] = min(match[1], start)
            match[2] = max(match[2], end)
            match[3] = row
        open_groups = [group for group in open_groups if row - group[3] <= 1]
    return [group for group in groups if group[3] - group[0] + 1 <= MAX_LINE_THICKNESS]


def _paper_like(pixmap: pymupdf.Pixmap) -> bool:
    pixels = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.stride)[
        :, : pixmap.width * 3
    ]
    colour = pixels.reshape(pixmap.height, pixmap.width, 3).astype(np.int16)
    white = (colour.min(axis=2) >= WHITE_INK).mean()
    colourful = ((colour.max(axis=2) - colour.min(axis=2)) >= COLOUR_SPREAD).mean()
    return white >= PAPER_WHITE and colourful <= PAPER_COLOUR


def _box_top(ink: np.ndarray, inner: slice, line_top: int, reach: int) -> int:
    limit = max(0, line_top - reach)
    for row in range(line_top - 2, limit - 1, -1):
        if ink[row, inner].mean() > 0.5:
            return row + 1
    return limit


def _free_underline(
    ink: np.ndarray, faint: np.ndarray, x0: int, x1: int, bottom: int, band: int
) -> bool:
    inner = slice(x0 + 3, max(x0 + 4, x1 - 3))
    line_top = bottom
    while line_top > 0 and ink[line_top - 1, x0:x1].mean() > 0.5:
        line_top -= 1
    rise = slice(max(0, line_top - max(TOUCH_DEPTH, band // 2)), line_top)
    boxed = all(
        faint[rise, max(0, end - CORNER_REACH) : end + CORNER_REACH].any(axis=1).mean() > 0.4
        for end in (x0, x1)
    )
    reach = band * ENCLOSED_DEPTH if boxed else band
    ceiling = _box_top(ink, inner, line_top, reach) if boxed else max(0, line_top - reach)
    above = ink[ceiling : max(0, line_top - 1), inner]
    if above.size and above.any(axis=0).mean() > ABOVE_INK_SHARE:
        return False
    stems = faint[
        max(0, line_top - TOUCH_DEPTH) : line_top, x0 + CORNER_REACH : max(x0, x1 - CORNER_REACH)
    ]
    if stems.shape[0] == TOUCH_DEPTH and stems.all(axis=0).any():
        return False
    depth = slice(bottom + 1, bottom + 1 + max(TOUCH_DEPTH, band // 2))
    for end in (x0, x1):
        corner = faint[depth, max(0, end - CORNER_REACH) : end + CORNER_REACH]
        if corner.size and corner.any(axis=1).mean() > 0.4:
            return False
    return True


def _blank_inside(ink: np.ndarray, top: int, bottom: int, x0: int, x1: int) -> bool:
    inner = ink[top + 2 : bottom - 1, x0 + 2 : x1 - 1]
    if inner.size and inner.mean() >= 0.05:
        return False
    ring = [
        ink[max(0, top - RING) : max(0, top - 1), x0:x1],
        ink[bottom + 2 : bottom + RING + 1, x0:x1],
        ink[top:bottom, max(0, x0 - RING) : max(0, x0 - 1)],
    ]
    return all(part.size == 0 or part.mean() < 0.05 for part in ring)


def _raster_candidates(page: pymupdf.Page, params: DetectParams) -> list[tuple[str, pymupdf.Rect]]:
    scale = RASTER_DPI / 72
    colour = page.get_pixmap(
        matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB, alpha=False
    )
    if not _paper_like(colour):
        return []
    pixmap = pymupdf.Pixmap(pymupdf.csGRAY, colour)
    gray = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.stride)
    ink = (gray[:, : pixmap.width] < INK_LEVEL).astype(np.int8)
    faint = gray[:, : pixmap.width] < FAINT_LEVEL
    band = int(params.field_height * scale)
    rows, starts, ends = _ink_runs(ink)
    lengths = ends - starts
    derotate = page.derotation_matrix
    candidates: list[tuple[str, pymupdf.Rect]] = []
    long_runs = lengths >= params.min_line_width * scale
    for _top, x0, x1, bottom in _group_runs(rows[long_runs], starts[long_runs], ends[long_runs]):
        if not _free_underline(ink, faint, x0, x1, bottom, band):
            continue
        base = (bottom + 1) / scale
        rect = pymupdf.Rect(x0 / scale, base - params.field_height, x1 / scale, base + 1)
        candidates.append(("text", rect * derotate))
    short_runs = (lengths >= params.box_min * scale * 0.8) & (
        lengths <= params.box_max * scale * 1.2
    )
    edges = _group_runs(rows[short_runs], starts[short_runs], ends[short_runs])
    edges.sort(key=lambda edge: (edge[1], edge[0]))
    for index, upper in enumerate(edges):
        width = upper[2] - upper[1]
        for lower in edges[index + 1 :]:
            if lower[1] - upper[1] > 2:
                break
            gap = lower[0] - upper[0]
            if abs(lower[2] - upper[2]) > 2 or gap <= 0 or abs(gap - width) > 0.25 * width:
                continue
            band = ink[upper[0] : lower[0] + 1]
            left = band[:, max(0, upper[1] - 1) : upper[1] + 3].any(axis=1).mean()
            right = band[:, max(0, upper[2] - 3) : upper[2] + 1].any(axis=1).mean()
            if left < 0.8 or right < 0.8:
                continue
            if not _blank_inside(ink, upper[0], lower[3], upper[1], upper[2]):
                break
            rect = pymupdf.Rect(
                upper[1] / scale, upper[0] / scale, upper[2] / scale, (lower[3] + 1) / scale
            )
            candidates.append(("checkbox", rect * derotate))
            break
    return candidates
