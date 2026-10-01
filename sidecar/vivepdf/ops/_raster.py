import math

import numpy
from PIL import Image

AGREEMENT_TOLERANCE = 12
AGREEMENT_SLOPE = 0.16
AGREEMENT_SHARE = 0.75
WHITE_PERCENTILE = 98.0
MARK_CONTRAST = 10
MARK_FLOOR_SHARE = 0.45
MAX_GAIN = 2.6
SNAP_DISTANCE = 8
INK_LEVEL = 128
BRIDGE_REACH = 2
SOLID_CORE = 1
SOLID_GUARD = 4

Frame = numpy.ndarray


def resized(frame: Frame, size: tuple[int, int]) -> Frame:
    if (frame.shape[1], frame.shape[0]) == size:
        return frame
    return numpy.asarray(Image.fromarray(frame).resize(size, Image.Resampling.BILINEAR))


def working_size(width: int, height: int, longest: int) -> tuple[int, int]:
    side = max(width, height)
    if side <= longest:
        return (width, height)
    scale = longest / side
    return (max(1, round(width * scale)), max(1, round(height * scale)))


def background_of(stack: Frame) -> tuple[Frame, Frame, Frame]:
    middle = stack.shape[0] // 2
    background = numpy.partition(stack, middle, axis=0)[middle]
    paper = paper_level(background)
    reference = background.astype(numpy.int16)
    tolerance = AGREEMENT_TOLERANCE + (paper - reference).clip(0) * AGREEMENT_SLOPE
    close = numpy.zeros(background.shape, dtype=numpy.uint16)
    for frame in stack:
        close += numpy.abs(frame.astype(numpy.int16) - reference) <= tolerance
    wanted = math.ceil(AGREEMENT_SHARE * stack.shape[0])
    return background, close >= wanted, paper


def dilated(gain: Frame, radius: int) -> Frame:
    if radius < 1:
        return gain
    height, width = gain.shape[:2]
    padded = numpy.pad(gain, ((radius, radius), (radius, radius), (0, 0)), mode="edge")
    widest = gain.copy()
    for row in range(2 * radius + 1):
        for column in range(2 * radius + 1):
            numpy.maximum(widest, padded[row : row + height, column : column + width], out=widest)
    return widest


def paper_level(background: Frame) -> Frame:
    flat = background.reshape(-1, background.shape[-1])
    levels = numpy.percentile(flat, WHITE_PERCENTILE, axis=0)
    return numpy.maximum(levels, 1.0).astype(numpy.float32)


def mark_mask(background: Frame, agreed: Frame, paper: Frame) -> Frame:
    floor = paper * MARK_FLOOR_SHARE
    darker = background.astype(numpy.float32) <= paper - MARK_CONTRAST
    above_floor = background.astype(numpy.float32) >= floor
    return (agreed & darker & above_floor).any(axis=-1)


def gain_map(background: Frame, agreed: Frame, paper: Frame) -> Frame:
    levels = numpy.maximum(background.astype(numpy.float32), 1.0)
    gain = numpy.clip(paper / levels, 1.0, MAX_GAIN)
    gain[~agreed] = 1.0
    gain[levels < paper * MARK_FLOOR_SHARE] = 1.0
    return gain.astype(numpy.float32)


def lift(frame: Frame, gain: Frame) -> Frame:
    return numpy.clip(frame.astype(numpy.float32) * gain, 0, 255).astype(numpy.uint8)


def snapped(frame: Frame, mask: Frame, paper: Frame) -> Frame:
    near = frame.astype(numpy.int16) >= paper - SNAP_DISTANCE
    flat = numpy.broadcast_to(paper.astype(numpy.uint8), frame.shape)
    return numpy.where(mask[..., None] & near, flat, frame)


def isolated_mark(background: Frame, mask: Frame, paper: Frame) -> Frame:
    picture = numpy.broadcast_to(paper.astype(numpy.uint8), background.shape).copy()
    picture[mask] = background[mask]
    return picture


def coverage_of(mask: Frame) -> float:
    return float(mask.mean())


def ink_of(frame: Frame) -> Frame:
    return (frame.min(axis=-1) if frame.ndim == 3 else frame) < INK_LEVEL


def repeated_ink(counted: Frame, pages: int) -> Frame:
    return counted >= math.ceil(AGREEMENT_SHARE * pages)


def _shifted(mask: Frame, rows: int, columns: int) -> Frame:
    height, width = mask.shape
    moved = numpy.zeros_like(mask)
    moved[max(0, rows) : height - max(0, -rows), max(0, columns) : width - max(0, -columns)] = mask[
        max(0, -rows) : height - max(0, rows), max(0, -columns) : width - max(0, columns)
    ]
    return moved


def _reaches(mask: Frame, rows: int, columns: int, distance: int) -> Frame:
    found = numpy.zeros_like(mask)
    for step in range(1, distance + 1):
        found |= _shifted(mask, rows * step, columns * step)
    return found


def grown(mask: Frame, radius: int) -> Frame:
    spread = mask.copy()
    for rows in range(-radius, radius + 1):
        for columns in range(-radius, radius + 1):
            spread |= _shifted(mask, rows, columns)
    return spread


def shrunk(mask: Frame, radius: int) -> Frame:
    core = mask.copy()
    for rows in range(-radius, radius + 1):
        for columns in range(-radius, radius + 1):
            core &= _shifted(mask, rows, columns)
    return core


def screened_part(mark: Frame) -> Frame:
    return mark & ~grown(shrunk(mark, SOLID_CORE), SOLID_GUARD)


def solid_part(mark: Frame) -> Frame:
    return mark & ~screened_part(mark)


def scrubbed_ink(page_ink: Frame, mark: Frame) -> Frame:
    cleaned = page_ink & ~mark
    from_left = _reaches(cleaned, 0, 1, BRIDGE_REACH)
    from_right = _reaches(cleaned, 0, -1, BRIDGE_REACH)
    from_above = _reaches(cleaned, 1, 0, BRIDGE_REACH)
    from_below = _reaches(cleaned, -1, 0, BRIDGE_REACH)
    bridged = (from_left & from_right) | (from_above & from_below)
    return cleaned | (page_ink & mark & bridged)


def ink_picture(mark: Frame) -> Frame:
    return numpy.where(mark[..., None], 0, 255).astype(numpy.uint8).repeat(3, axis=-1)


def resized_mask(mask: Frame, size: tuple[int, int]) -> Frame:
    if (mask.shape[1], mask.shape[0]) == size:
        return mask
    picture = Image.fromarray(numpy.where(mask, 255, 0).astype(numpy.uint8), mode="L")
    return numpy.asarray(picture.resize(size, Image.Resampling.BILINEAR)) >= 128
