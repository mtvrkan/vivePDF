import io
from dataclasses import dataclass
from pathlib import Path

import pymupdf

from vivepdf.ops._image_files import eight_bit, open_picture, picture_too_large, picture_unreadable
from vivepdf.rpc.errors import OpError

EXIF_ORIENTATION = 0x0112
EXIF_ROTATIONS = {3: 180, 6: 270, 8: 90}
NATIVE_IMAGE_FORMATS = {"JPEG", "MPO", "PNG", "BMP", "GIF", "TIFF", "PPM", "JPEG2000"}
MULTI_FRAME_FORMATS = {"TIFF"}
LOSSY_FORMATS = {"JPEG", "MPO", "WEBP", "HEIF", "AVIF"}
PIL_KEPT_MODES = {"1", "L", "LA", "P", "RGB", "RGBA"}
REENCODED_JPEG_QUALITY = 92
COMPRESSED_PHOTO_DPI = 200
COMPRESSED_JPEG_QUALITY = 80
DOWNSAMPLE_MARGIN = 1.25
PHOTO_COLOR_COUNT = 4096
COLOR_SAMPLE_SIDE = 1024
PHOTO_MODES = {"RGB", "L"}
JPEG_FORMATS = {"JPEG", "MPO"}
WEBP_SIGNATURE = b"WEBP"
WEBP_LOSSLESS_CHUNK = b"VP8L"
WEBP_LOSSY_CHUNK = b"VP8 "
WEBP_FRAME_CHUNK = b"ANMF"
WEBP_FRAME_HEADER = 16
DECODE_PIXEL_LIMIT = 150_000_000
DEFAULT_IMAGE_DPI = 96.0
PLAUSIBLE_DPI = (36.0, 2400.0)


@dataclass(slots=True)
class ImageFrame:
    width: int
    height: int
    filename: str | None = None
    stream: bytes | None = None
    rotate: int = 0
    dpi: float = DEFAULT_IMAGE_DPI


def _image_dpi(info: dict) -> float:
    value = info.get("dpi")
    try:
        horizontal = float(value[0]) if isinstance(value, tuple) else float(value)
    except (TypeError, ValueError, IndexError):
        return DEFAULT_IMAGE_DPI
    low, high = PLAUSIBLE_DPI
    return horizontal if low <= horizontal <= high else DEFAULT_IMAGE_DPI


def lossless_webp(image: Path) -> bool:
    try:
        with image.open("rb") as handle:
            header = handle.read(12)
            if len(header) < 12 or header[8:12] != WEBP_SIGNATURE:
                return False
            while len(chunk := handle.read(8)) == 8:
                name, size = chunk[:4], int.from_bytes(chunk[4:], "little")
                if name in (WEBP_LOSSLESS_CHUNK, WEBP_LOSSY_CHUNK):
                    return name == WEBP_LOSSLESS_CHUNK
                if name == WEBP_FRAME_CHUNK:
                    handle.seek(WEBP_FRAME_HEADER, 1)
                    continue
                handle.seek(size + size % 2, 1)
    except OSError:
        return False
    return False


def _lossy_source(image: Path, source_format: str) -> bool:
    if source_format == "WEBP":
        return not lossless_webp(image)
    return source_format in LOSSY_FORMATS


def _usable_mode(picture):
    picture = eight_bit(picture)
    if picture.mode not in PIL_KEPT_MODES:
        picture = picture.convert("RGBA" if "A" in picture.getbands() else "RGB")
    return picture


def _encoded_frame(picture, lossy: bool, dpi: float) -> ImageFrame:
    picture = _usable_mode(picture)
    buffer = io.BytesIO()
    if picture.mode in PHOTO_MODES and lossy:
        picture.save(buffer, format="JPEG", quality=REENCODED_JPEG_QUALITY)
    else:
        picture.save(buffer, format="PNG")
    return ImageFrame(picture.width, picture.height, stream=buffer.getvalue(), dpi=dpi)


def _native_frame(image: Path) -> ImageFrame:
    try:
        pixmap = pymupdf.Pixmap(str(image))
    except Exception as error:  # noqa: BLE001
        raise picture_unreadable(image) from error
    dpi = float(pixmap.xres) if pixmap.xres else DEFAULT_IMAGE_DPI
    low, high = PLAUSIBLE_DPI
    return ImageFrame(
        pixmap.width,
        pixmap.height,
        filename=str(image),
        dpi=dpi if low <= dpi <= high else DEFAULT_IMAGE_DPI,
    )


def load_frames(image: Path) -> list[ImageFrame]:
    from PIL import ImageOps

    try:
        with open_picture(image) as picture:
            source_format = picture.format or ""
            dpi = _image_dpi(picture.info)
            orientation = picture.getexif().get(EXIF_ORIENTATION, 1)
            frame_count = (
                getattr(picture, "n_frames", 1) if source_format in MULTI_FRAME_FORMATS else 1
            )
            animated = source_format == "GIF" and getattr(picture, "is_animated", False)
            if (
                source_format in NATIVE_IMAGE_FORMATS
                and frame_count == 1
                and not animated
                and orientation
                in (
                    1,
                    3,
                    6,
                    8,
                )
            ):
                width, height = picture.size
                rotate = EXIF_ROTATIONS.get(orientation, 0)
                if rotate in (90, 270):
                    width, height = height, width
                return [ImageFrame(width, height, filename=str(image), rotate=rotate, dpi=dpi)]
            if picture.width * picture.height > DECODE_PIXEL_LIMIT:
                raise picture_too_large(image, picture.width, picture.height)
            if frame_count > 1:
                frames = []
                for position in range(frame_count):
                    picture.seek(position)
                    frames.append(
                        _encoded_frame(
                            picture.copy(),
                            _lossy_source(image, source_format),
                            _image_dpi(picture.info),
                        )
                    )
                return frames
            return [
                _encoded_frame(
                    ImageOps.exif_transpose(picture), _lossy_source(image, source_format), dpi
                )
            ]
    except OpError:
        raise
    except Exception:  # noqa: BLE001
        return [_native_frame(image)]


def _many_colors(picture) -> bool:
    sample = picture.copy()
    sample.thumbnail((COLOR_SAMPLE_SIDE, COLOR_SAMPLE_SIDE), resample=0)
    return sample.getcolors(PHOTO_COLOR_COUNT) is None


def _photo_bytes(picture, source: Path | None, needed: tuple[float, float]):
    from PIL import Image, ImageOps

    source_format = picture.format or ""
    wanted = (
        max(1, round(needed[0] * COMPRESSED_PHOTO_DPI / 72)),
        max(1, round(needed[1] * COMPRESSED_PHOTO_DPI / 72)),
    )
    if source_format in JPEG_FORMATS:
        picture.draft(picture.mode, wanted)
    if picture.width * picture.height > DECODE_PIXEL_LIMIT:
        return None
    picture = _usable_mode(ImageOps.exif_transpose(picture))
    if picture.mode not in PHOTO_MODES:
        return None
    lossy = source is not None and _lossy_source(source, source_format)
    if not lossy and not _many_colors(picture):
        return None
    shrink = picture.width > wanted[0] * DOWNSAMPLE_MARGIN
    if not shrink and source_format in JPEG_FORMATS:
        return None
    if shrink:
        height = max(1, round(picture.height * wanted[0] / picture.width))
        picture = picture.resize((wanted[0], height), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    picture.save(buffer, format="JPEG", quality=COMPRESSED_JPEG_QUALITY, optimize=True)
    return picture.size, buffer.getvalue()


def _frame_picture(frame: ImageFrame, source: Path | None):
    from PIL import Image

    if source is not None:
        return open_picture(source)
    return Image.open(io.BytesIO(frame.stream or b""))


def compressed_frame(
    frame: ImageFrame, source: Path | None, needed: tuple[float, float]
) -> ImageFrame:
    try:
        with _frame_picture(frame, source) as picture:
            result = _photo_bytes(picture, source, needed)
    except Exception:  # noqa: BLE001
        return frame
    if result is None:
        return frame
    (width, height), stream = result
    current = source.stat().st_size if source is not None else len(frame.stream or b"")
    if len(stream) >= current:
        return frame
    return ImageFrame(width, height, stream=stream, dpi=frame.dpi * width / frame.width)


def frame_box(page: pymupdf.Page, margin: float) -> pymupdf.Rect:
    box = page.rect + (margin, margin, -margin, -margin)
    return page.rect if box.is_empty else box


def shown_size(box: pymupdf.Rect, frame: ImageFrame, fit: str) -> tuple[float, float]:
    ratios = (box.width / frame.width, box.height / frame.height)
    scale = max(ratios) if fit == "fill" else min(ratios)
    return frame.width * scale, frame.height * scale


def _insert_frame(page: pymupdf.Page, box: pymupdf.Rect, frame: ImageFrame) -> None:
    page.insert_image(
        box,
        filename=frame.filename,
        stream=frame.stream,
        rotate=frame.rotate,
        keep_proportion=True,
    )


def place_frame(page: pymupdf.Page, frame: ImageFrame, margin: float, fit: str) -> None:
    box = frame_box(page, margin)
    if fit != "fill":
        _insert_frame(page, box, frame)
        return
    width, height = shown_size(box, frame, fit)
    left, top = (box.width - width) / 2, (box.height - height) / 2
    with pymupdf.open() as holder:
        canvas = holder.new_page(width=box.width, height=box.height)
        _insert_frame(canvas, pymupdf.Rect(left, top, left + width, top + height), frame)
        page.show_pdf_page(box, holder, 0)
