import io
import sys
import types

import numpy as np

COLOR_BGR2GRAY = 6
IMREAD_COLOR = 1
THRESH_BINARY = 0
THRESH_BINARY_INV = 1
RETR_TREE = 3
CHAIN_APPROX_SIMPLE = 2
INTER_LINEAR = 1

GRAY_WEIGHTS_BGR = (3735, 19235, 9798)
GRAY_SHIFT = 15
PNG_COMPRESS_LEVEL = 1


def imdecode(buffer, flags=IMREAD_COLOR):
    from PIL import Image

    if flags != IMREAD_COLOR:
        raise NotImplementedError(f"imdecode flags {flags}")
    try:
        with Image.open(io.BytesIO(np.asarray(buffer, dtype=np.uint8).tobytes())) as image:
            rgb = np.asarray(image.convert("RGB"))
    except (OSError, ValueError, SyntaxError):
        return None
    return np.ascontiguousarray(rgb[:, :, ::-1])


def imencode(extension, image, params=None):
    from PIL import Image

    if extension.lower() != ".png":
        raise NotImplementedError(f"imencode {extension}")
    pixels = np.ascontiguousarray(image[:, :, ::-1] if image.ndim == 3 else image)
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, "PNG", compress_level=PNG_COMPRESS_LEVEL)
    return True, np.frombuffer(buffer.getvalue(), dtype=np.uint8)


def cvtColor(source, code):
    if code != COLOR_BGR2GRAY:
        raise NotImplementedError(f"cvtColor code {code}")
    channels = source.astype(np.uint32)
    blue, green, red = GRAY_WEIGHTS_BGR
    weighted = channels[..., 0] * blue + channels[..., 1] * green + channels[..., 2] * red
    return ((weighted + (1 << (GRAY_SHIFT - 1))) >> GRAY_SHIFT).astype(np.uint8)


def threshold(source, thresh, maxval, kind):
    limit = int(np.floor(thresh))
    above = source > limit
    if kind == THRESH_BINARY:
        result = np.where(above, maxval, 0)
    elif kind == THRESH_BINARY_INV:
        result = np.where(above, 0, maxval)
    else:
        raise NotImplementedError(f"threshold type {kind}")
    return float(limit), result.astype(source.dtype)


def boundingRect(points):
    coordinates = np.asarray(points).reshape(-1, 2)
    left, top = coordinates.min(axis=0)
    right, bottom = coordinates.max(axis=0)
    return int(left), int(top), int(right - left + 1), int(bottom - top + 1)


def getRotationMatrix2D(center, angle, scale):
    radians = np.deg2rad(angle)
    alpha = np.cos(radians) * scale
    beta = np.sin(radians) * scale
    x, y = center
    return np.array(
        [
            [alpha, beta, (1 - alpha) * x - beta * y],
            [-beta, alpha, beta * x + (1 - alpha) * y],
        ],
        dtype=np.float64,
    )


def warpAffine(source, matrix, size):
    width, height = size
    forward = np.vstack([np.asarray(matrix, dtype=np.float64), [0.0, 0.0, 1.0]])
    inverse = np.linalg.inv(forward)
    columns, rows = np.meshgrid(np.arange(width, dtype=np.float64), np.arange(height))
    source_x = inverse[0, 0] * columns + inverse[0, 1] * rows + inverse[0, 2]
    source_y = inverse[1, 0] * columns + inverse[1, 1] * rows + inverse[1, 2]
    left = np.floor(source_x).astype(np.int64)
    top = np.floor(source_y).astype(np.int64)
    fraction_x = source_x - left
    fraction_y = source_y - top
    pixels = source if source.ndim == 3 else source[:, :, None]
    result = np.zeros((height, width, pixels.shape[2]), dtype=np.float64)
    source_height, source_width = pixels.shape[:2]
    for offset_y, weight_y in ((0, 1 - fraction_y), (1, fraction_y)):
        for offset_x, weight_x in ((0, 1 - fraction_x), (1, fraction_x)):
            sample_x = left + offset_x
            sample_y = top + offset_y
            inside = (
                (sample_x >= 0)
                & (sample_x < source_width)
                & (sample_y >= 0)
                & (sample_y < source_height)
            )
            values = np.zeros(result.shape, dtype=np.float64)
            values[inside] = pixels[sample_y[inside], sample_x[inside]]
            result += values * (weight_x * weight_y)[:, :, None]
    output = np.clip(np.rint(result), 0, 255).astype(source.dtype)
    return output if source.ndim == 3 else output[:, :, 0]


def _row_runs(row: np.ndarray, value: bool) -> tuple[np.ndarray, np.ndarray]:
    padded = np.concatenate(([False], row == value, [False])).astype(np.int8)
    edges = np.flatnonzero(np.diff(padded))
    return edges[0::2], edges[1::2]


class _Runs:
    def __init__(self, mask: np.ndarray, value: bool, diagonal: bool):
        self.rows: list[int] = []
        self.starts: list[int] = []
        self.ends: list[int] = []
        self.first_run_in_row: list[int] = []
        self.parent: list[int] = []
        reach = 1 if diagonal else 0
        previous: tuple[int, int] = (0, 0)
        for y in range(mask.shape[0]):
            starts, ends = _row_runs(mask[y], value)
            first = len(self.starts)
            self.first_run_in_row.append(first)
            for start, end in zip(starts.tolist(), ends.tolist(), strict=True):
                index = len(self.starts)
                self.rows.append(y)
                self.starts.append(start)
                self.ends.append(end)
                self.parent.append(index)
            self._link(previous, (first, len(self.starts)), reach)
            previous = (first, len(self.starts))
        self.first_run_in_row.append(len(self.starts))

    def _find(self, index: int) -> int:
        parent = self.parent
        root = index
        while parent[root] != root:
            root = parent[root]
        while parent[index] != root:
            parent[index], index = root, parent[index]
        return root

    def _union(self, first: int, second: int) -> None:
        first_root, second_root = self._find(first), self._find(second)
        if first_root != second_root:
            low, high = sorted((first_root, second_root))
            self.parent[high] = low

    def _link(self, above: tuple[int, int], below: tuple[int, int], reach: int) -> None:
        upper, upper_end = above
        lower, lower_end = below
        while upper < upper_end and lower < lower_end:
            if (
                self.starts[upper] < self.ends[lower] + reach
                and self.starts[lower] < self.ends[upper] + reach
            ):
                self._union(upper, lower)
            if self.ends[upper] < self.ends[lower]:
                upper += 1
            else:
                lower += 1

    def labels(self) -> list[int]:
        return [self._find(index) for index in range(len(self.starts))]

    def run_at(self, y: int, x: int) -> int:
        for index in range(self.first_run_in_row[y], self.first_run_in_row[y + 1]):
            if self.starts[index] <= x < self.ends[index]:
                return index
        raise ValueError("no run covers the pixel")


def _regions(runs: _Runs) -> dict[int, list[int]]:
    regions: dict[int, list[int]] = {}
    for index, root in enumerate(runs.labels()):
        region = regions.get(root)
        y, start, end = runs.rows[index], runs.starts[index], runs.ends[index]
        if region is None:
            regions[root] = [start, y, end - 1, y, y, start]
            continue
        region[0] = min(region[0], start)
        region[2] = max(region[2], end - 1)
        region[3] = y
    return regions


def _tree(mask: np.ndarray) -> tuple[list[dict], list[int]]:
    width = mask.shape[1]
    foreground = _Runs(mask, True, diagonal=True)
    background = _Runs(mask, False, diagonal=False)
    foreground_roots = foreground.labels()
    background_roots = background.labels()
    outside = background_roots[0]
    nodes: list[dict] = []
    holes: dict[int, int] = {}
    shapes: dict[int, int] = {}
    for root, (left, top, right, bottom, first_y, first_x) in _regions(background).items():
        if root == outside:
            continue
        holes[root] = len(nodes)
        nodes.append(
            {
                "box": (left - 2, top - 2, right, bottom),
                "key": first_y * width + first_x - 1,
                "hole": True,
                "enclosing": foreground_roots[foreground.run_at(first_y, first_x - 1)],
                "children": [],
            }
        )
    for root, (left, top, right, bottom, first_y, first_x) in _regions(foreground).items():
        shapes[root] = len(nodes)
        nodes.append(
            {
                "box": (left - 1, top - 1, right - 1, bottom - 1),
                "key": first_y * width + first_x,
                "hole": False,
                "enclosing": background_roots[background.run_at(first_y, first_x - 1)],
                "children": [],
            }
        )
    top_level: list[int] = []
    for index, node in enumerate(nodes):
        if node["hole"]:
            parent = shapes[node["enclosing"]]
        elif node["enclosing"] == outside:
            parent = -1
        else:
            parent = holes[node["enclosing"]]
        node["parent"] = parent
        (top_level if parent == -1 else nodes[parent]["children"]).append(index)
    return nodes, top_level


def _preorder(nodes: list[dict], top_level: list[int]) -> list[int]:
    def newest_first(siblings: list[int]) -> list[int]:
        return sorted(siblings, key=lambda item: nodes[item]["key"], reverse=True)

    order: list[int] = []
    stack = list(reversed(newest_first(top_level)))
    while stack:
        index = stack.pop()
        order.append(index)
        stack.extend(reversed(newest_first(nodes[index]["children"])))
    return order


def findContours(image, mode, method):
    if mode != RETR_TREE:
        raise NotImplementedError(f"findContours mode {mode}")
    nodes, top_level = _tree(np.pad(np.asarray(image) != 0, 1))
    order = _preorder(nodes, top_level)
    if not order:
        return (), None
    position = {index: rank for rank, index in enumerate(order)}
    contours = []
    hierarchy = np.full((1, len(order), 4), -1, dtype=np.int32)
    for rank, index in enumerate(order):
        node = nodes[index]
        left, top, right, bottom = node["box"]
        contours.append(np.array([[[left, top]], [[right, bottom]]], dtype=np.int32))
        siblings = top_level if node["parent"] == -1 else nodes[node["parent"]]["children"]
        ranked = sorted(position[item] for item in siblings)
        place = ranked.index(rank)
        hierarchy[0, rank, 0] = ranked[place + 1] if place + 1 < len(ranked) else -1
        hierarchy[0, rank, 1] = ranked[place - 1] if place > 0 else -1
        children = sorted(position[item] for item in node["children"])
        hierarchy[0, rank, 2] = children[0] if children else -1
        hierarchy[0, rank, 3] = position[node["parent"]] if node["parent"] != -1 else -1
    return tuple(contours), hierarchy


def _unsupported(name: str):
    def fail(*_args, **_kwargs):
        raise NotImplementedError(f"cv2.{name} is not available in this build")

    return fail


def build_module() -> types.ModuleType:
    module = types.ModuleType("cv2")
    for name in (
        "COLOR_BGR2GRAY",
        "IMREAD_COLOR",
        "THRESH_BINARY",
        "THRESH_BINARY_INV",
        "RETR_TREE",
        "CHAIN_APPROX_SIMPLE",
        "INTER_LINEAR",
        "imdecode",
        "imencode",
        "cvtColor",
        "threshold",
        "boundingRect",
        "getRotationMatrix2D",
        "warpAffine",
        "findContours",
    ):
        setattr(module, name, globals()[name])
    for name in ("imshow", "waitKey", "rectangle", "destroyAllWindows"):
        setattr(module, name, _unsupported(name))
    module.__version__ = "subset"
    return module


def ensure_cv2() -> None:
    if sys.modules.get("cv2") is not None:
        return
    try:
        import cv2  # noqa: F401
    except ImportError:
        sys.modules["cv2"] = build_module()
