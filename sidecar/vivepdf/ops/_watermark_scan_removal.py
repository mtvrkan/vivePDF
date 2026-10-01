import io
import math
import re

import numpy
import pymupdf
from PIL import Image

from vivepdf.ops._raster import (
    coverage_of,
    dilated,
    gain_map,
    lift,
    mark_mask,
    resized,
    resized_mask,
    screened_part,
    scrubbed_ink,
    snapped,
    solid_part,
)
from vivepdf.ops.watermark_detection import (
    RASTER_MIN_COVERAGE,
    RASTER_MIN_PAGES,
    _all_bilevel,
    _frame_of,
    _is_stencil,
    _page_ink,
    _raster_background,
    _repeated_ink_of,
    _scan_pages,
)
from vivepdf.rpc.progress import Progress

RASTER_JPEG_QUALITY = 92


SHAPE_TOLERANCE = 0.03


def _stencil_inverted(document: pymupdf.Document, xref: int) -> bool:
    kind, value = document.xref_get_key(xref, "Decode")
    if kind != "array":
        return False
    numbers = re.findall(r"-?[\d.]+", value)
    return bool(numbers) and float(numbers[0]) >= 0.5


def _write_stencil(document: pymupdf.Document, xref: int, ink: numpy.ndarray) -> None:
    painted = ink if _stencil_inverted(document, xref) else ~ink
    packed = numpy.packbits(painted.astype(numpy.uint8), axis=1).tobytes()
    document.update_stream(xref, packed, compress=True)
    for key in ("DecodeParms", "JBIG2Globals", "Length1"):
        if document.xref_get_key(xref, key)[0] != "null":
            document.xref_set_key(xref, key, "null")
    document.xref_set_key(xref, "Filter", "/FlateDecode")
    document.xref_set_key(xref, "BitsPerComponent", "1")
    document.xref_set_key(xref, "Width", str(ink.shape[1]))
    document.xref_set_key(xref, "Height", str(ink.shape[0]))


def _encoded_image(
    document: pymupdf.Document, xref: int, frame: numpy.ndarray, gray: bool
) -> bytes:
    pixmap = pymupdf.Pixmap(
        pymupdf.csRGB,
        frame.shape[1],
        frame.shape[0],
        numpy.ascontiguousarray(frame).tobytes(),
        False,
    )
    if gray:
        pixmap = pymupdf.Pixmap(pymupdf.csGRAY, pixmap)
    if "DCTDecode" in (document.xref_get_key(xref, "Filter")[1] or ""):
        return pixmap.tobytes("jpeg", jpg_quality=RASTER_JPEG_QUALITY)
    return pixmap.tobytes("png")


def _bilevel_stream(ink: numpy.ndarray) -> bytes:
    picture = Image.fromarray(numpy.where(ink, 0, 255).astype(numpy.uint8), mode="L")
    buffer = io.BytesIO()
    picture.convert("1", dither=Image.Dither.NONE).save(buffer, format="png")
    return buffer.getvalue()


def _same_shape(first: tuple[int, ...], second: tuple[int, ...]) -> bool:
    ratio = (first[1] / max(1, first[0])) / (second[1] / max(1, second[0]))
    return abs(ratio - 1) <= SHAPE_TOLERANCE


def _scrub_fax(
    document: pymupdf.Document, pages: list[tuple[int, int]], progress: Progress
) -> tuple[int, int]:
    found = _repeated_ink_of(document, pages)
    if found is None:
        return 0, 0
    repeated, _native = found
    solid_left = len(pages) if coverage_of(solid_part(repeated)) >= RASTER_MIN_COVERAGE else 0
    mark = screened_part(repeated)
    if coverage_of(mark) < RASTER_MIN_COVERAGE:
        return 0, solid_left
    scrubbed = 0
    for position, (index, xref) in enumerate(pages):
        progress.check_cancelled()
        ink = _page_ink(document, xref)
        if ink is None:
            continue
        if not _same_shape(ink.shape, mark.shape):
            continue
        here = mark if ink.shape == mark.shape else resized_mask(mark, (ink.shape[1], ink.shape[0]))
        cleaned = scrubbed_ink(ink, here)
        if _is_stencil(document, xref):
            _write_stencil(document, xref, cleaned)
        else:
            document[index].replace_image(xref, stream=_bilevel_stream(cleaned))
        scrubbed += 1
        progress.report(
            position / max(1, len(pages)),
            "progress.cleaning",
            {"current": position + 1, "total": len(pages)},
        )
    return scrubbed, solid_left


def _repaint_scan(
    document: pymupdf.Document, indices: list[int], progress: Progress
) -> tuple[int, int]:
    pages = _scan_pages(document, indices)
    if len(pages) < RASTER_MIN_PAGES:
        return 0, 0
    if _all_bilevel(document, pages):
        return _scrub_fax(document, pages, progress)
    estimate = _raster_background(document, pages)
    if estimate is None:
        return 0, 0
    background, agreed, paper = estimate
    if coverage_of(mark_mask(background, agreed, paper)) < RASTER_MIN_COVERAGE:
        return 0, 0
    repainted = 0
    for position, (index, xref) in enumerate(pages):
        progress.check_cancelled()
        found = _frame_of(document, xref)
        if found is None:
            continue
        frame, gray = found
        if not _same_shape(frame.shape, background.shape):
            continue
        native = (frame.shape[1], frame.shape[0])
        spread = max(native[0] / background.shape[1], native[1] / background.shape[0])
        agreed_here = resized(agreed.astype(numpy.uint8) * 255, native) >= 128
        background_here = resized(background, native)
        gain = dilated(gain_map(background_here, agreed_here, paper), math.ceil(spread) - 1)
        mask_here = mark_mask(background_here, agreed_here, paper)
        cleaned = snapped(lift(frame, gain), mask_here, paper)
        document[index].replace_image(xref, stream=_encoded_image(document, xref, cleaned, gray))
        repainted += 1
        progress.report(
            position / max(1, len(pages)),
            "progress.cleaning",
            {"current": position + 1, "total": len(pages)},
        )
    return repainted, 0
