import numpy as np

ROWS_PER_CHUNK = 512


def _containment(outer: np.ndarray, inner: np.ndarray) -> np.ndarray:
    blocks = []
    for start in range(0, len(outer), ROWS_PER_CHUNK):
        rows = outer[start : start + ROWS_PER_CHUNK, None, :]
        blocks.append(
            (inner[None, :, 0] >= rows[:, :, 0])
            & (inner[None, :, 1] >= rows[:, :, 1])
            & (inner[None, :, 2] <= rows[:, :, 2])
            & (inner[None, :, 3] <= rows[:, :, 3])
        )
    return np.concatenate(blocks) if blocks else np.zeros((0, len(inner)), dtype=bool)


def _boxes(contours, indices, min_w: float, min_h: float) -> list[tuple[int, int, int, int]]:
    import cv2 as cv

    found = []
    for index in indices:
        x, y, w, h = cv.boundingRect(contours[index])
        if w < min_w or h < min_h:
            continue
        found.append((x, y, x + w, y + h))
    return found


def _nested_level_1(boxes: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    if not boxes:
        return []
    array = np.asarray(boxes, dtype=np.int64)
    holds = _containment(array, array)
    return [boxes[inner] for _outer, inner in np.argwhere(holds & ~holds.T)]


def _outside(candidates: list[tuple[int, int, int, int]], holders: list) -> list:
    if not candidates or not holders:
        return candidates
    held = np.zeros(len(candidates), dtype=bool)
    inner = np.asarray(candidates, dtype=np.int64)
    outer = np.asarray(sorted(set(holders)), dtype=np.int64)
    for start in range(0, len(outer), ROWS_PER_CHUNK):
        held |= _containment(outer[start : start + ROWS_PER_CHUNK], inner).any(axis=0)
    return [box for box, inside in zip(candidates, held, strict=True) if not inside]


def inner_contours(img_binary: np.ndarray, bbox: tuple, min_w: float, min_h: float) -> list:
    import cv2 as cv

    x0, y0, x1, y1 = bbox
    region = np.zeros(img_binary.shape, dtype=np.uint8)
    region[y0:y1, x0:x1] = img_binary[y0:y1, x0:x1]
    contours, hierarchy = cv.findContours(region, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE)
    level_0 = np.where(hierarchy[0, :, 3] == -1)[0]
    level_1 = np.where(np.isin(hierarchy[0, :, 3], level_0))[0]
    level_2 = np.where(np.isin(hierarchy[0, :, 3], level_1))[0]
    nested = _nested_level_1(_boxes(contours, level_1, min_w, min_h))
    return nested + _outside(_boxes(contours, level_2, min_w, min_h), nested)
