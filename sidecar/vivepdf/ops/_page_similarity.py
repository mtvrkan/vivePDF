import hashlib
import re
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import pymupdf
from numpy.lib.stride_tricks import sliding_window_view

from vivepdf.rpc.progress import Progress

SIGNATURE_SIDE = 200
SIGNATURE_HAT = 5
DETAIL_SIDE = 600
DETAIL_HAT = 9
DARK_LEVEL = 200 / 255
BLANK_INK_LIMIT = 0.003
INK_FLOOR = 0.04
INK_GAIN = 2.5
MASS_TAIL = 0.005
COARSE_GRID = 12
CANDIDATES_PER_PAGE = 8
CANDIDATE_SIMILARITY = 0.8
SIMILARITY_ROWS = 256
ASPECT_TOLERANCE = 0.08
TEXT_BUCKET_LIMIT = 64
SCALE_RANGE = (0.85, 1.15)
COARSE_SCALE_STEP = 0.02
FINE_SCALE_STEP = 0.0025
SHIFT_TOLERANCE = 2
BLOCK = 20
TEXT_MATCH_LIMIT = 0.03
VISUAL_MATCH_LIMIT = 0.04
INK_CACHE_SIZE = 192
NON_WORD = re.compile(r"[\W_]+")


@dataclass(frozen=True)
class PageSignature:
    digest: str
    text: str
    scanned: bool
    vector: np.ndarray
    aspect: float


def _gray(page: pymupdf.Page, side: int) -> np.ndarray:
    rect = page.rect
    zoom = side / max(rect.width, rect.height)
    pixmap = page.get_pixmap(
        matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csGRAY, alpha=False
    )
    pixels = np.frombuffer(pixmap.samples, dtype=np.uint8)
    return pixels.reshape(pixmap.height, pixmap.width)


def _window(values: np.ndarray, size: int, reduce: Callable[..., np.ndarray]) -> np.ndarray:
    half = size // 2
    rows = np.pad(values, ((0, 0), (half, half)), mode="edge")
    rows = reduce(sliding_window_view(rows, size, axis=1), axis=-1)
    columns = np.pad(rows, ((half, half), (0, 0)), mode="edge")
    return reduce(sliding_window_view(columns, size, axis=0), axis=-1)


def _ink(gray: np.ndarray, hat: int) -> np.ndarray:
    light = gray.astype(np.float32) / 255
    closed = _window(_window(light, hat, np.max), hat, np.min)
    return np.clip((closed - light - INK_FLOOR) * INK_GAIN, 0, 1)


def _mass_span(profile: np.ndarray) -> tuple[int, int]:
    total = float(profile.sum())
    if total <= 0:
        return 0, len(profile)
    cumulative = np.cumsum(profile) / total
    start = int(np.searchsorted(cumulative, MASS_TAIL))
    end = int(np.searchsorted(cumulative, 1 - MASS_TAIL)) + 1
    return start, max(end, start + 1)


def _coarse(ink: np.ndarray) -> tuple[np.ndarray, float]:
    top, bottom = _mass_span(ink.sum(axis=1))
    left, right = _mass_span(ink.sum(axis=0))
    content = ink[top:bottom, left:right]
    height, width = content.shape
    rows = (np.arange(COARSE_GRID + 1) * height / COARSE_GRID).astype(int)
    columns = (np.arange(COARSE_GRID + 1) * width / COARSE_GRID).astype(int)
    summed = np.pad(content.cumsum(axis=0).cumsum(axis=1), ((1, 0), (1, 0)))
    cells = (
        summed[rows[1:]][:, columns[1:]]
        - summed[rows[:-1]][:, columns[1:]]
        - summed[rows[1:]][:, columns[:-1]]
        + summed[rows[:-1]][:, columns[:-1]]
    ).ravel()
    centred = cells - cells.mean()
    norm = float(np.linalg.norm(centred))
    vector = centred / norm if norm else centred
    return vector.astype(np.float32), width / max(height, 1)


def text_key(text: str) -> str:
    return NON_WORD.sub("", text.casefold())


def page_signature(page: pymupdf.Page, scanned: bool) -> PageSignature | None:
    gray = _gray(page, SIGNATURE_SIDE)
    text = " ".join(page.get_text("text").split())
    if not text and float((gray < DARK_LEVEL * 255).mean()) < BLANK_INK_LIMIT:
        return None
    digest = hashlib.blake2b(digest_size=16)
    digest.update(f"{gray.shape[1]}x{gray.shape[0]}:".encode())
    digest.update(gray.tobytes())
    digest.update(text.encode("utf-8", "replace"))
    vector, aspect = _coarse(_ink(gray, SIGNATURE_HAT))
    return PageSignature(digest.hexdigest(), text_key(text), scanned, vector, aspect)


def page_ink(page: pymupdf.Page) -> np.ndarray:
    return (_ink(_gray(page, DETAIL_SIDE), DETAIL_HAT) * 255).astype(np.uint8)


def _correlate(fixed: np.ndarray, moving: np.ndarray, scale: float) -> tuple[float, int]:
    stretched = np.interp(
        np.arange(int(len(moving) * scale)) / scale, np.arange(len(moving)), moving
    )
    centred = stretched - stretched.mean()
    centred /= float(np.linalg.norm(centred)) or 1.0
    size = len(fixed) + len(centred)
    correlation = np.fft.irfft(np.fft.rfft(fixed, size) * np.conj(np.fft.rfft(centred, size)), size)
    peak = int(np.argmax(correlation))
    return float(correlation[peak]), peak if peak < size // 2 else peak - size


def _best_scale(
    fixed: np.ndarray, moving: np.ndarray, scales: np.ndarray
) -> tuple[float, float, int]:
    best = (-np.inf, 1.0, 0)
    for scale in scales:
        score, shift = _correlate(fixed, moving, float(scale))
        if score > best[0]:
            best = (score, float(scale), shift)
    return best


def _align(reference: np.ndarray, moving: np.ndarray) -> tuple[float, int]:
    fixed = reference - reference.mean()
    fixed /= float(np.linalg.norm(fixed)) or 1.0
    low, high = SCALE_RANGE
    _, rough, _ = _best_scale(fixed, moving, np.arange(low, high + 1e-9, COARSE_SCALE_STEP))
    fine = np.arange(rough - COARSE_SCALE_STEP, rough + COARSE_SCALE_STEP + 1e-9, FINE_SCALE_STEP)
    _, scale, shift = _best_scale(fixed, moving, fine)
    return scale, shift


def _warp(
    image: np.ndarray,
    vertical: tuple[float, int],
    horizontal: tuple[float, int],
    shape: tuple[int, int],
) -> np.ndarray:
    rows = (np.arange(shape[0]) - vertical[1]) / vertical[0]
    columns = (np.arange(shape[1]) - horizontal[1]) / horizontal[0]
    picked_rows = np.clip(np.round(rows).astype(int), 0, image.shape[0] - 1)
    picked_columns = np.clip(np.round(columns).astype(int), 0, image.shape[1] - 1)
    warped = image[picked_rows][:, picked_columns]
    warped[(rows < 0) | (rows > image.shape[0] - 1)] = 0
    warped[:, (columns < 0) | (columns > image.shape[1] - 1)] = 0
    return warped


def _unmatched(source: np.ndarray, target: np.ndarray) -> np.ndarray:
    span = 2 * SHIFT_TOLERANCE + 1
    above = source - _window(target, span, np.max)
    below = _window(target, span, np.min) - source
    return np.maximum(np.maximum(above, below), 0)


def mismatch(first: np.ndarray, second: np.ndarray) -> float:
    reference = first.astype(np.float32) / 255
    moving = second.astype(np.float32) / 255
    vertical = _align(reference.sum(axis=1), moving.sum(axis=1))
    horizontal = _align(reference.sum(axis=0), moving.sum(axis=0))
    warped = _warp(moving, vertical, horizontal, reference.shape)
    difference = np.maximum(_unmatched(reference, warped), _unmatched(warped, reference))
    rows = difference.shape[0] // BLOCK * BLOCK
    columns = difference.shape[1] // BLOCK * BLOCK
    if rows == 0 or columns == 0:
        return float(difference.mean())
    blocks = difference[:rows, :columns].reshape(rows // BLOCK, BLOCK, columns // BLOCK, BLOCK)
    return float(blocks.mean(axis=(1, 3)).max())


class _InkCache:
    def __init__(self, load: Callable[[int], np.ndarray]):
        self._load = load
        self._items: OrderedDict[int, np.ndarray] = OrderedDict()

    def get(self, index: int) -> np.ndarray:
        found = self._items.get(index)
        if found is not None:
            self._items.move_to_end(index)
            return found
        loaded = self._load(index)
        self._items[index] = loaded
        if len(self._items) > INK_CACHE_SIZE:
            self._items.popitem(last=False)
        return loaded


def _textual(first: PageSignature, second: PageSignature) -> bool:
    return bool(first.text and second.text and not first.scanned and not second.scanned)


def _comparable(first: PageSignature, second: PageSignature) -> bool:
    if abs(first.aspect / second.aspect - 1) > ASPECT_TOLERANCE:
        return False
    return not _textual(first, second) or first.text == second.text


def _candidate_pairs(signatures: list[PageSignature | None]) -> list[tuple[int, int]]:
    present = [index for index, signature in enumerate(signatures) if signature is not None]
    pairs: set[tuple[int, int]] = set()
    if len(present) < 2:
        return []
    vectors = np.stack([signatures[index].vector for index in present])
    keep = min(CANDIDATES_PER_PAGE, len(present) - 1)
    for start in range(0, len(present), SIMILARITY_ROWS):
        similarity = vectors[start : start + SIMILARITY_ROWS] @ vectors.T
        for offset, row in enumerate(similarity):
            row[start + offset] = -np.inf
            for column in np.argpartition(-row, keep - 1)[:keep]:
                if row[column] >= CANDIDATE_SIMILARITY:
                    first, second = present[start + offset], present[int(column)]
                    pairs.add((min(first, second), max(first, second)))
    buckets: dict[str, list[int]] = {}
    for index in present:
        signature = signatures[index]
        if signature.text and not signature.scanned:
            buckets.setdefault(signature.text, []).append(index)
    for members in buckets.values():
        for position, first in enumerate(members[:TEXT_BUCKET_LIMIT]):
            for second in members[position + 1 : TEXT_BUCKET_LIMIT]:
                pairs.add((first, second))
    return sorted(pairs)


def duplicate_groups(
    signatures: list[PageSignature | None],
    load_ink: Callable[[int], np.ndarray],
    progress: Progress,
) -> list[int | None]:
    parent = list(range(len(signatures)))

    def root(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def join(first: int, second: int) -> None:
        parent[root(second)] = root(first)

    by_digest: dict[str, int] = {}
    for index, signature in enumerate(signatures):
        if signature is None:
            continue
        seen = by_digest.setdefault(signature.digest, index)
        if seen != index:
            join(seen, index)

    inks = _InkCache(load_ink)
    pairs = _candidate_pairs(signatures)
    for position, (first, second) in enumerate(pairs):
        progress.check_cancelled()
        if position % 25 == 0:
            progress.report(
                position / len(pairs),
                "progress.comparing",
                {"current": position, "total": len(pairs)},
            )
        if root(first) == root(second):
            continue
        left, right = signatures[first], signatures[second]
        if left is None or right is None or not _comparable(left, right):
            continue
        limit = TEXT_MATCH_LIMIT if _textual(left, right) else VISUAL_MATCH_LIMIT
        if mismatch(inks.get(first), inks.get(second)) <= limit:
            join(first, second)

    sizes: dict[int, int] = {}
    for index, signature in enumerate(signatures):
        if signature is not None:
            sizes[root(index)] = sizes.get(root(index), 0) + 1
    labels: dict[int, int] = {}
    groups: list[int | None] = []
    for index, signature in enumerate(signatures):
        group = root(index)
        if signature is None or sizes.get(group, 0) < 2:
            groups.append(None)
            continue
        groups.append(labels.setdefault(group, len(labels)))
    return groups
