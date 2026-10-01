import base64
import io
import math
from collections.abc import Iterator
from typing import Literal

import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFilter, ImageOps
from pydantic import Field

from vivepdf.ops._image_files import eight_bit, open_picture, picture_unreadable
from vivepdf.ops._output import prepare_output, save_document
from vivepdf.ops.scan import (
    ColorMode,
    EnhanceMode,
    apply_color_mode,
    detect_color_mode,
    encode_image,
    whiten,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

DETECT_MAX_SIDE = 1200
MIN_PAPER_AREA = 0.12
MAX_PAPER_AREA = 0.95
MAX_OUTPUT_SIDE = 3500
WHOLE_FRAME_TOLERANCE = 0.015
EDGE_TRIM = 0.006
MAX_FRAMES = 500
MAX_DECODE_SIDE = 7000
MULTI_PAGE_FORMATS = frozenset({"TIFF"})
DRAFT_FORMATS = frozenset({"JPEG", "MPO"})
PAPER_SIZES = {"a4": (595.0, 842.0), "letter": (612.0, 792.0)}
EDGE_BLUR = 1.5
EDGE_FLOOR = 6.0
EDGE_NOISE_FACTOR = 4.0
EDGE_CLOSE = 5
FILL_BLOCK = 3
SIDE_SAMPLES = 60
SIDE_MARGIN = 0.1
SIDE_REACH = 3
MIN_EDGE_SUPPORT = 0.45
SIDE_OFFSET = 6
MIN_SIDE_CONTRAST = 8.0
MIN_QUAD_FILL = 0.85
SOFT_BLUR = 3.0
SOFT_WINDOW = 5
SOFT_FLOOR = 3.0
Paper = Literal["auto", "a4", "letter"]
Point = tuple[float, float]
CORNER_TOLERANCE = 0.02
MIN_CORNER_AREA = 0.01
PREVIEW_QUALITY = 80


class PhotoParams(RpcModel):
    images: list[str] = Field(min_length=1)
    output: str
    overwrite: bool = False
    auto_crop: bool = True
    whiten: bool = True
    mode: EnhanceMode = "color"
    paper: Paper = "auto"
    jpeg_quality: int = Field(default=85, ge=30, le=100)
    corners: list[list[Point] | None] | None = None
    corner_sizes: list[Point | None] | None = None
    frame_corners: list[list[list[Point] | None] | None] | None = None
    rotations: list[Literal[0, 90, 180, 270]] | None = None


class PhotoDetectParams(RpcModel):
    image: str
    frame: int = Field(default=0, ge=0)
    preview_side: int = Field(default=900, ge=200, le=2000)


class PhotoDetectResult(RpcModel):
    width: int
    height: int
    detected: bool
    corners: list[Point]
    frames: int = 1
    frame: int = 0
    preview: str
    preview_width: int
    preview_height: int


class PhotoPageResult(RpcModel):
    source: str
    cropped: bool
    width: int
    height: int


class PhotoResult(RpcModel):
    output: str
    page_count: int
    bytes: int
    pages: list[PhotoPageResult]


def otsu_threshold(values: np.ndarray) -> int:
    histogram = np.bincount(values.ravel(), minlength=256).astype(np.float64)
    total = histogram.sum()
    if total == 0:
        return 128
    cumulative = np.cumsum(histogram)
    cumulative_mean = np.cumsum(histogram * np.arange(256))
    global_mean = cumulative_mean[-1] / total
    weight_background = cumulative / total
    weight_foreground = 1 - weight_background
    valid = (weight_background > 0) & (weight_foreground > 0)
    mean_background = np.zeros(256)
    mean_background[valid] = cumulative_mean[valid] / cumulative[valid]
    between = np.zeros(256)
    between[valid] = (
        weight_background[valid]
        * weight_foreground[valid]
        * (mean_background[valid] - global_mean) ** 2
    ) / weight_foreground[valid]
    return int(np.argmax(between))


def paper_mask(image: Image.Image) -> np.ndarray:
    gray = ImageOps.grayscale(image).filter(ImageFilter.GaussianBlur(radius=2))
    values = np.asarray(gray, dtype=np.uint8)
    threshold = otsu_threshold(values)
    binary = Image.fromarray(np.where(values > threshold, 255, 0).astype(np.uint8))
    binary = binary.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(7))
    mask = np.asarray(binary) > 0
    if not mask.any():
        return mask
    ys, xs = np.nonzero(mask)
    seed = (int(np.median(xs)), int(np.median(ys)))
    if not mask[seed[1], seed[0]]:
        distances = (xs - seed[0]) ** 2 + (ys - seed[1]) ** 2
        nearest = int(np.argmin(distances))
        seed = (int(xs[nearest]), int(ys[nearest]))
    return _connected(mask, seed)


def quad_area(quad: list[tuple[float, float]]) -> float:
    return (
        abs(
            sum(
                x0 * y1 - x1 * y0
                for (x0, y0), (x1, y1) in zip(quad, quad[1:] + quad[:1], strict=True)
            )
        )
        / 2
    )


def side_contrast(quad: list[tuple[float, float]], gray: np.ndarray) -> float:
    height, width = gray.shape
    centre_x = sum(x for x, _y in quad) / 4
    centre_y = sum(y for _x, y in quad) / 4
    contrasts: list[float] = []
    steps = np.linspace(SIDE_MARGIN, 1 - SIDE_MARGIN, SIDE_SAMPLES)
    for (x0, y0), (x1, y1) in zip(quad, quad[1:] + quad[:1], strict=True):
        length = float(np.hypot(x1 - x0, y1 - y0)) or 1.0
        normal_x, normal_y = (y1 - y0) / length, -(x1 - x0) / length
        middle_x, middle_y = (x0 + x1) / 2, (y0 + y1) / 2
        if normal_x * (middle_x - centre_x) + normal_y * (middle_y - centre_y) < 0:
            normal_x, normal_y = -normal_x, -normal_y
        inner: list[int] = []
        outer: list[int] = []
        for step in steps:
            x = x0 + (x1 - x0) * step
            y = y0 + (y1 - y0) * step
            outside_x = int(round(x + normal_x * SIDE_OFFSET))
            outside_y = int(round(y + normal_y * SIDE_OFFSET))
            inside_x = int(round(x - normal_x * SIDE_OFFSET))
            inside_y = int(round(y - normal_y * SIDE_OFFSET))
            if not (0 <= outside_x < width and 0 <= outside_y < height):
                continue
            if not (0 <= inside_x < width and 0 <= inside_y < height):
                continue
            outer.append(int(gray[outside_y, outside_x]))
            inner.append(int(gray[inside_y, inside_x]))
        if len(outer) >= SIDE_SAMPLES // 2:
            contrasts.append(abs(float(np.median(inner)) - float(np.median(outer))))
    return float(np.mean(contrasts)) if contrasts else 0.0


def edge_strength(
    image: Image.Image, blur: float = EDGE_BLUR, window: int = 3, floor: float = EDGE_FLOOR
) -> tuple[np.ndarray, float]:
    gray = ImageOps.grayscale(image).filter(ImageFilter.GaussianBlur(radius=blur))
    high = np.asarray(gray.filter(ImageFilter.MaxFilter(window)), dtype=np.int16)
    low = np.asarray(gray.filter(ImageFilter.MinFilter(window)), dtype=np.int16)
    gradient = high - low
    level = max(floor, EDGE_NOISE_FACTOR * float(np.median(gradient)))
    return gradient, level


def _coarse(passable: np.ndarray) -> np.ndarray:
    height, width = passable.shape
    rows = -(-height // FILL_BLOCK)
    columns = -(-width // FILL_BLOCK)
    padded = np.zeros((rows * FILL_BLOCK, columns * FILL_BLOCK), dtype=bool)
    padded[:height, :width] = passable
    return padded.reshape(rows, FILL_BLOCK, columns, FILL_BLOCK).all(axis=(1, 3))


def _fill(passable: np.ndarray, seed: tuple[int, int]) -> np.ndarray:
    canvas = Image.fromarray(np.where(passable, 255, 0).astype(np.uint8)).copy()
    ImageDraw.floodfill(canvas, seed, 128)
    return np.asarray(canvas) == 128


def _expanded(coarse: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    grown = np.repeat(np.repeat(coarse, FILL_BLOCK, axis=0), FILL_BLOCK, axis=1)
    return grown[: shape[0], : shape[1]]


def _connected(passable: np.ndarray, seed: tuple[int, int]) -> np.ndarray:
    coarse = _coarse(passable)
    column, row = seed[0] // FILL_BLOCK, seed[1] // FILL_BLOCK
    if not coarse[row, column]:
        candidates = np.argwhere(coarse)
        if not len(candidates):
            return _fill(passable, seed)
        nearest = int(np.argmin(((candidates - (row, column)) ** 2).sum(axis=1)))
        row, column = (int(value) for value in candidates[nearest])
    reached = _expanded(_fill(coarse, (column, row)), passable.shape)
    grown = Image.fromarray(np.where(reached, 255, 0).astype(np.uint8)).filter(
        ImageFilter.MaxFilter(FILL_BLOCK * 2 + 1)
    )
    return (np.asarray(grown) > 0) & passable


def _reached_from_border(blocked: np.ndarray) -> np.ndarray:
    free = np.pad(_coarse(~blocked), 1, constant_values=True)
    reached = _fill(free, (0, 0))[1:-1, 1:-1]
    return _expanded(reached, blocked.shape)


def edge_paper_mask(gradient: np.ndarray, level: float) -> np.ndarray:
    edges = Image.fromarray(np.where(gradient > level, 255, 0).astype(np.uint8))
    closed = np.asarray(edges.filter(ImageFilter.MaxFilter(EDGE_CLOSE))) > 0
    inside = Image.fromarray(np.where(_reached_from_border(closed), 0, 255).astype(np.uint8))
    return np.asarray(inside.filter(ImageFilter.MinFilter(EDGE_CLOSE))) > 0


def _mask_quad(mask: np.ndarray) -> list[tuple[float, float]] | None:
    if not mask.size:
        return None
    coverage = mask.sum() / mask.size
    if coverage < MIN_PAPER_AREA or coverage > MAX_PAPER_AREA:
        return None
    ys, xs = np.nonzero(mask)
    points = np.stack([xs, ys], axis=1).astype(np.float64)
    sums = points.sum(axis=1)
    diffs = points[:, 0] - points[:, 1]
    corners = [
        points[np.argmin(sums)],
        points[np.argmax(diffs)],
        points[np.argmax(sums)],
        points[np.argmin(diffs)],
    ]
    return [(float(x), float(y)) for x, y in corners]


def edge_support(quad: list[tuple[float, float]], gradient: np.ndarray, level: float) -> float:
    height, width = gradient.shape
    strong = gradient > level
    hits = 0
    total = 0
    steps = np.linspace(SIDE_MARGIN, 1 - SIDE_MARGIN, SIDE_SAMPLES)
    for (x0, y0), (x1, y1) in zip(quad, quad[1:] + quad[:1], strict=True):
        for step in steps:
            x = int(round(x0 + (x1 - x0) * step))
            y = int(round(y0 + (y1 - y0) * step))
            window = strong[
                max(0, y - SIDE_REACH) : min(height, y + SIDE_REACH + 1),
                max(0, x - SIDE_REACH) : min(width, x + SIDE_REACH + 1),
            ]
            total += 1
            hits += bool(window.any())
    return hits / total if total else 0.0


def find_paper_quad(image: Image.Image) -> list[tuple[float, float]] | None:
    scale = min(1.0, DETECT_MAX_SIDE / max(image.size))
    small = (
        image.resize((max(1, int(image.width * scale)), max(1, int(image.height * scale))))
        if scale < 1
        else image
    )
    gradient, level = edge_strength(small)
    soft_gradient, soft_level = edge_strength(small, SOFT_BLUR, SOFT_WINDOW, SOFT_FLOOR)
    gray = np.asarray(ImageOps.grayscale(small), dtype=np.uint8)
    best: tuple[float, list[tuple[float, float]]] | None = None
    for mask, strength, strength_level in (
        (paper_mask(small), gradient, level),
        (edge_paper_mask(gradient, level), gradient, level),
        (edge_paper_mask(soft_gradient, soft_level), soft_gradient, soft_level),
    ):
        candidate = _checked_quad(mask, scale, image)
        if candidate is None:
            continue
        scaled = [(x * scale, y * scale) for x, y in candidate]
        if mask.sum() < MIN_QUAD_FILL * quad_area(scaled):
            continue
        if side_contrast(scaled, gray) < MIN_SIDE_CONTRAST:
            continue
        support = edge_support(scaled, strength, strength_level)
        if support >= MIN_EDGE_SUPPORT and (best is None or support > best[0]):
            best = (support, candidate)
    return best[1] if best else None


def _checked_quad(
    mask: np.ndarray, scale: float, image: Image.Image
) -> list[tuple[float, float]] | None:
    corners = _mask_quad(mask)
    if corners is None:
        return None
    quad = [(x / scale, y / scale) for x, y in corners]
    if _whole_frame(quad, image.size):
        return None
    width_top = np.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1])
    height_left = np.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1])
    if width_top < image.width * 0.2 or height_left < image.height * 0.2:
        return None
    return quad


def _whole_frame(quad: list[tuple[float, float]], size: tuple[int, int]) -> bool:
    width, height = size
    frame = [(0.0, 0.0), (width - 1.0, 0.0), (width - 1.0, height - 1.0), (0.0, height - 1.0)]
    reach_x = width * WHOLE_FRAME_TOLERANCE
    reach_y = height * WHOLE_FRAME_TOLERANCE
    return all(
        abs(x - fx) <= reach_x and abs(y - fy) <= reach_y
        for (x, y), (fx, fy) in zip(quad, frame, strict=True)
    )


def _trimmed(image: Image.Image) -> Image.Image:
    inset_x = int(image.width * EDGE_TRIM)
    inset_y = int(image.height * EDGE_TRIM)
    if not inset_x or not inset_y:
        return image
    return image.crop((inset_x, inset_y, image.width - inset_x, image.height - inset_y))


def _perspective_coefficients(
    source: list[tuple[float, float]], target: list[tuple[float, float]]
) -> list[float]:
    matrix = []
    for (sx, sy), (tx, ty) in zip(source, target, strict=True):
        matrix.append([tx, ty, 1, 0, 0, 0, -sx * tx, -sx * ty])
        matrix.append([0, 0, 0, tx, ty, 1, -sy * tx, -sy * ty])
    a = np.array(matrix, dtype=np.float64)
    b = np.array([coordinate for point in source for coordinate in point], dtype=np.float64)
    return [float(value) for value in np.linalg.solve(a, b)]


def straighten(image: Image.Image, quad: list[tuple[float, float]]) -> Image.Image:
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = quad
    width = int(max(np.hypot(x1 - x0, y1 - y0), np.hypot(x2 - x3, y2 - y3)))
    height = int(max(np.hypot(x3 - x0, y3 - y0), np.hypot(x2 - x1, y2 - y1)))
    width = max(1, min(width, MAX_OUTPUT_SIDE))
    height = max(1, min(height, MAX_OUTPUT_SIDE))
    target = [(0.0, 0.0), (float(width), 0.0), (float(width), float(height)), (0.0, float(height))]
    coefficients = _perspective_coefficients(quad, target)
    straight = image.transform(
        (width, height), Image.Transform.PERSPECTIVE, coefficients, Image.Resampling.BICUBIC
    )
    return _trimmed(straight)


def _frame_count(opened: Image.Image) -> int:
    if (opened.format or "") not in MULTI_PAGE_FORMATS:
        return 1
    return max(1, min(int(getattr(opened, "n_frames", 1)), MAX_FRAMES))


def _decoded_frame(opened: Image.Image, position: int) -> Image.Image:
    opened.seek(position)
    width, height = opened.size
    factor = MAX_DECODE_SIDE / max(width, height, 1)
    if position == 0 and factor < 1 and (opened.format or "") in DRAFT_FORMATS:
        opened.draft("RGB", (max(1, int(width * factor)), max(1, int(height * factor))))
    picture = ImageOps.exif_transpose(eight_bit(opened)).convert("RGB")
    if max(picture.size) > MAX_DECODE_SIDE:
        picture.thumbnail((MAX_DECODE_SIDE, MAX_DECODE_SIDE), Image.Resampling.LANCZOS)
    return picture


def iter_photos(path: str) -> Iterator[Image.Image]:
    try:
        with open_picture(path) as opened:
            for position in range(_frame_count(opened)):
                yield _decoded_frame(opened, position)
    except (OSError, ValueError, EOFError) as error:
        raise picture_unreadable(path) from error


def load_photo_frame(path: str, frame: int) -> tuple[Image.Image, int]:
    try:
        with open_picture(path) as opened:
            count = _frame_count(opened)
            if frame >= count:
                raise OpError(
                    ErrorCode.INVALID_PARAMS,
                    f"photo has {count} frames",
                    {"reason": "frameOutOfRange", "frames": count},
                )
            return _decoded_frame(opened, frame), count
    except (OSError, ValueError, EOFError) as error:
        raise picture_unreadable(path) from error


def _invalid_corners(message: str) -> OpError:
    return OpError(ErrorCode.INVALID_PARAMS, message, {"reason": "invalidCorners"})


def ordered_corners(points: list[Point]) -> list[Point]:
    centre_x = sum(x for x, _y in points) / len(points)
    centre_y = sum(y for _x, y in points) / len(points)
    around = sorted(points, key=lambda point: math.atan2(point[1] - centre_y, point[0] - centre_x))
    start = min(range(len(around)), key=lambda index: around[index][0] + around[index][1])
    return around[start:] + around[:start]


def manual_quad(points: list[Point], size: tuple[int, int]) -> list[Point]:
    width, height = size
    if len(points) != 4:
        raise _invalid_corners("four corners are needed")
    reach_x = width * CORNER_TOLERANCE
    reach_y = height * CORNER_TOLERANCE
    clamped: list[Point] = []
    for x, y in points:
        if not (math.isfinite(x) and math.isfinite(y)):
            raise _invalid_corners("corner is not a number")
        if not (-reach_x <= x <= width + reach_x and -reach_y <= y <= height + reach_y):
            raise _invalid_corners("corner lies outside the photo")
        clamped.append((min(max(x, 0.0), width - 1.0), min(max(y, 0.0), height - 1.0)))
    quad = ordered_corners(clamped)
    turns = [
        (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
        for (ax, ay), (bx, by), (cx, cy) in zip(
            quad, quad[1:] + quad[:1], quad[2:] + quad[:2], strict=True
        )
    ]
    if not (all(turn > 0 for turn in turns) or all(turn < 0 for turn in turns)):
        raise _invalid_corners("corners do not form a convex shape")
    if quad_area(quad) < MIN_CORNER_AREA * width * height:
        raise _invalid_corners("corners enclose too small an area")
    return quad


def process_photo(
    image: Image.Image, params: PhotoParams, corners: list[Point] | None = None
) -> tuple[Image.Image, bool, ColorMode]:
    cropped = False
    if corners is not None:
        image = straighten(image, manual_quad(corners, image.size))
        cropped = True
    elif params.auto_crop:
        quad = find_paper_quad(image)
        if quad is not None:
            image = straighten(image, quad)
            cropped = True
    if params.whiten:
        image = whiten(image)
    mode = detect_color_mode(image) if params.mode == "auto" else params.mode
    return apply_color_mode(image, mode), cropped, mode


@op("scan.from_photo", PhotoParams)
def from_photo(params: PhotoParams, progress: Progress) -> PhotoResult:
    if params.rotations is not None and len(params.rotations) != len(params.images):
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "one rotation per photo is needed",
            {"reason": "invalidRotations"},
        )
    for given in (params.corners, params.corner_sizes, params.frame_corners):
        if given is not None and len(given) != len(params.images):
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "one corner set per photo is needed",
                {"reason": "invalidCorners"},
            )
    target = prepare_output(params.output, params.images, params.overwrite)
    document = pymupdf.open()
    pages: list[PhotoPageResult] = []
    try:
        for index, source in enumerate(params.images):
            progress.check_cancelled()
            progress.report(
                index / len(params.images),
                "progress.straightening",
                {"current": index + 1, "total": len(params.images)},
            )
            for frame_index, frame in enumerate(iter_photos(source)):
                progress.check_cancelled()
                image, cropped, mode = process_photo(
                    frame, params, _manual_corners(params, index, frame_index, frame.size)
                )
                turn = params.rotations[index] if params.rotations is not None else 0
                if turn:
                    image = image.rotate(-turn, expand=True)
                data = encode_image(image, mode, params.jpeg_quality)
                if params.paper == "auto":
                    page_width = 595.0
                    page_height = page_width * image.height / image.width
                else:
                    page_width, page_height = PAPER_SIZES[params.paper]
                    if image.width > image.height:
                        page_width, page_height = page_height, page_width
                page = document.new_page(width=page_width, height=page_height)
                page.insert_image(page.rect, stream=data, keep_proportion=True)
                pages.append(
                    PhotoPageResult(
                        source=source, cropped=cropped, width=image.width, height=image.height
                    )
                )
        progress.report(0.95, "progress.saving")
        saved = save_document(document, target)
        return PhotoResult(
            output=saved.output, page_count=saved.page_count, bytes=saved.bytes, pages=pages
        )
    finally:
        document.close()


def _manual_corners(
    params: PhotoParams, image: int, frame: int, size: tuple[int, int]
) -> list[Point] | None:
    if params.frame_corners is not None:
        per_frame = params.frame_corners[image]
        if per_frame is not None and frame < len(per_frame) and per_frame[frame] is not None:
            return per_frame[frame]
    shared = params.corners[image] if params.corners is not None else None
    drawn_on = params.corner_sizes[image] if params.corner_sizes is not None else None
    if shared is None or drawn_on is None:
        return shared
    return scaled_corners(shared, drawn_on, size)


def scaled_corners(corners: list[Point], drawn_on: Point, size: tuple[int, int]) -> list[Point]:
    drawn_width, drawn_height = drawn_on
    if drawn_width <= 0 or drawn_height <= 0:
        return corners
    if (drawn_width, drawn_height) == (float(size[0]), float(size[1])):
        return corners
    return [(x / drawn_width * size[0], y / drawn_height * size[1]) for x, y in corners]


def _preview(image: Image.Image, side: int) -> tuple[str, int, int]:
    preview = image.copy()
    preview.thumbnail((side, side))
    buffer = io.BytesIO()
    preview.save(buffer, format="JPEG", quality=PREVIEW_QUALITY)
    return base64.b64encode(buffer.getvalue()).decode("ascii"), preview.width, preview.height


@op("scan.photo_detect", PhotoDetectParams)
def photo_detect(params: PhotoDetectParams, progress: Progress) -> PhotoDetectResult:
    progress.report(0.1, "progress.straightening", {"current": 1, "total": 1})
    image, frame_count = load_photo_frame(params.image, params.frame)
    quad = find_paper_quad(image)
    corners = quad or [
        (0.0, 0.0),
        (image.width - 1.0, 0.0),
        (image.width - 1.0, image.height - 1.0),
        (0.0, image.height - 1.0),
    ]
    preview, preview_width, preview_height = _preview(image, params.preview_side)
    return PhotoDetectResult(
        width=image.width,
        height=image.height,
        detected=quad is not None,
        corners=[(round(x, 1), round(y, 1)) for x, y in corners],
        frames=frame_count,
        frame=params.frame,
        preview=preview,
        preview_width=preview_width,
        preview_height=preview_height,
    )
