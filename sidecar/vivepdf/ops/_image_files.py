import contextlib
import io
import threading
import warnings
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pi_heif
import pymupdf
from PIL import Image, ImageOps

from vivepdf.rpc.errors import ErrorCode, OpError

pi_heif.register_heif_opener()

HEIF_EXTENSIONS = frozenset({"heic", "heif", "hif"})
PILLOW_ONLY_FORMATS = frozenset({"HEIF"})
DECODED_JPEG_QUALITY = 92
LARGE_PICTURE_PIXELS = 300_000_000
HIGH_DEPTH_MODES = frozenset({"I;16", "I;16L", "I;16B", "I;16N", "I"})
SIXTEEN_BIT_SCALE = 257
EXIF_ORIENTATION = 0x0112
SIDEWAYS_ORIENTATIONS = frozenset({5, 6, 7, 8})
_pixel_limit_lock = threading.Lock()


def picture_unreadable(path: str | Path) -> OpError:
    return OpError(
        ErrorCode.INVALID_PARAMS,
        f"cannot read image: {Path(path).name}",
        {"reason": "imageUnreadable", "path": str(path)},
    )


def picture_too_large(path: str | Path, width: int = 0, height: int = 0) -> OpError:
    data: dict[str, object] = {"reason": "pictureTooLarge", "path": str(path)}
    if width and height:
        data.update(width=width, height=height)
    return OpError(ErrorCode.INVALID_PARAMS, f"image is too large: {Path(path).name}", data)


@contextlib.contextmanager
def open_picture(path: str | Path) -> Iterator[Image.Image]:
    with _pixel_limit_lock:
        saved = Image.MAX_IMAGE_PIXELS
        Image.MAX_IMAGE_PIXELS = LARGE_PICTURE_PIXELS // 2
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", Image.DecompressionBombWarning)
                opened = Image.open(path)
        except Image.DecompressionBombError as error:
            raise picture_too_large(path) from error
        finally:
            Image.MAX_IMAGE_PIXELS = saved
    with opened:
        yield opened


def eight_bit(image: Image.Image) -> Image.Image:
    if image.mode not in HIGH_DEPTH_MODES:
        return image
    values = np.asarray(image, dtype=np.int64)
    if values.size and int(values.max()) > 255:
        values = values // SIXTEEN_BIT_SCALE
    return Image.fromarray(np.clip(values, 0, 255).astype(np.uint8))


def pillow_only(path: str | Path) -> bool:
    try:
        with Image.open(path) as opened:
            return (opened.format or "") in PILLOW_ONLY_FORMATS
    except (OSError, ValueError, Image.DecompressionBombError):
        return Path(path).suffix.lower().lstrip(".") in HEIF_EXTENSIONS


def exif_orientation(image: Image.Image) -> int:
    try:
        return int(image.getexif().get(EXIF_ORIENTATION, 1) or 1)
    except Exception:  # noqa: BLE001
        return 1


def _needs_decoding(path: str | Path) -> bool:
    try:
        with Image.open(path) as opened:
            return (opened.format or "") in PILLOW_ONLY_FORMATS or exif_orientation(opened) != 1
    except (OSError, ValueError, Image.DecompressionBombError):
        return Path(path).suffix.lower().lstrip(".") in HEIF_EXTENSIONS


def decoded_image_bytes(path: str | Path) -> bytes:
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened)
        buffer = io.BytesIO()
        if "A" in image.getbands():
            image.convert("RGBA").save(buffer, format="PNG")
        else:
            image.convert("RGB").save(buffer, format="JPEG", quality=DECODED_JPEG_QUALITY)
    return buffer.getvalue()


def image_file_pixmap(path: str | Path) -> pymupdf.Pixmap:
    if pillow_only(path):
        return pymupdf.Pixmap(decoded_image_bytes(path))
    return pymupdf.Pixmap(str(path))


def image_file_bytes(path: str | Path) -> bytes:
    if pillow_only(path):
        return decoded_image_bytes(path)
    return Path(path).read_bytes()


def insert_image_file(page: pymupdf.Page, rect: pymupdf.Rect, path: str | Path, **options) -> None:
    if _needs_decoding(path):
        page.insert_image(rect, stream=decoded_image_bytes(path), **options)
        return
    page.insert_image(rect, filename=str(path), **options)
