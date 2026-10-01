import struct
from typing import Protocol

MAX_SEGMENTS = 256
JPEG_SCAN_LIMIT = 64 * 1024
JPEG_START = b"\xff\xd8"
JPEG_FRAME_MARKERS = frozenset(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}
JPEG_BARE_MARKERS = frozenset({0x01, *range(0xD0, 0xD8)})
JPEG_SCAN_START = 0xDA
JPEG_END = 0xD9
J2K_START = b"\xff\x4f\xff\x51"
JP2_CODESTREAM = b"jp2c"
JBIG2_PAGE_INFORMATION = 48
JBIG2_END_OF_STRIPE = 50
JBIG2_REGIONS = frozenset({4, 6, 7, 20, 22, 23, 36, 38, 39, 40, 42, 43})
JBIG2_UNKNOWN_LENGTH = 0xFFFFFFFF
JBIG2_LONG_REFERENCE = 7
JBIG2_INVALID_REFERENCES = frozenset({5, 6})
JBIG2_MAX_SEGMENTS = 4096
JBIG2_ARITHMETIC_END = b"\xff\xac"
JBIG2_MMR_END = b"\x00\x00"
SEARCH_CHUNK = 64 * 1024


class ByteSource(Protocol):
    def read(self, count: int) -> bytes: ...

    def skip(self, count: int) -> int: ...


def _exact(source: ByteSource, count: int) -> bytes:
    data = source.read(count)
    if len(data) < count:
        raise EOFError
    return data


def _skip(source: ByteSource, count: int) -> None:
    if count < 0 or (count and source.skip(count) < count):
        raise EOFError


class _Buffered:
    def __init__(self, source: ByteSource) -> None:
        self.source = source
        self.pending = b""

    def read(self, count: int) -> bytes:
        if len(self.pending) < count:
            self.pending += self.source.read(count - len(self.pending))
        data, self.pending = self.pending[:count], self.pending[count:]
        return data

    def skip(self, count: int) -> int:
        taken = min(count, len(self.pending))
        self.pending = self.pending[taken:]
        return taken + (self.source.skip(count - taken) if count > taken else 0)

    def find(self, marker: bytes) -> bool:
        while True:
            index = self.pending.find(marker)
            if index >= 0:
                self.pending = self.pending[index + len(marker) :]
                return True
            self.pending = self.pending[len(self.pending) - len(marker) + 1 :]
            chunk = self.source.read(SEARCH_CHUNK)
            if not chunk:
                return False
            self.pending += chunk


def _jpeg_marker(source: ByteSource) -> int:
    scanned = 0
    while scanned < JPEG_SCAN_LIMIT:
        scanned += 1
        if _exact(source, 1)[0] != 0xFF:
            continue
        marker = 0xFF
        while marker == 0xFF and scanned < JPEG_SCAN_LIMIT:
            scanned += 1
            marker = _exact(source, 1)[0]
        if marker not in (0x00, 0xFF):
            return marker
    raise EOFError


def jpeg_bytes(source: ByteSource) -> int:
    if source.read(len(JPEG_START)) != JPEG_START:
        return 0
    for _ in range(MAX_SEGMENTS):
        marker = _jpeg_marker(source)
        if marker in JPEG_FRAME_MARKERS:
            _length, _precision, height, width, components = struct.unpack(
                ">HBHHB", _exact(source, 8)
            )
            return width * height * components
        if marker in JPEG_BARE_MARKERS:
            continue
        if marker in (JPEG_SCAN_START, JPEG_END):
            return 0
        (length,) = struct.unpack(">H", _exact(source, 2))
        if length < 2:
            return 0
        _skip(source, length - 2)
    return 0


def _size_segment_bytes(source: ByteSource) -> int:
    fields = struct.unpack(">HHIIIIIIIIH", _exact(source, 38))
    width, height, left, top, components = fields[2], fields[3], fields[4], fields[5], fields[10]
    return max(width - left, 0) * max(height - top, 0) * components


def jpx_bytes(source: ByteSource) -> int:
    head = _exact(source, 4)
    if head == J2K_START:
        return _size_segment_bytes(source)
    length = int.from_bytes(head, "big")
    for _ in range(MAX_SEGMENTS):
        kind = _exact(source, 4)
        header = 8
        if length == 1:
            length = int.from_bytes(_exact(source, 8), "big")
            header = 16
        if kind == JP2_CODESTREAM:
            return _size_segment_bytes(source) if _exact(source, 4) == J2K_START else 0
        if length < header:
            return 0
        _skip(source, length - header)
        length = int.from_bytes(_exact(source, 4), "big")
    return 0


def _jbig2_segment_header(stream: _Buffered) -> tuple[int, int]:
    number, flags, referred = struct.unpack(">IBB", _exact(stream, 6))
    count = referred >> 5
    if count in JBIG2_INVALID_REFERENCES:
        raise EOFError
    if count == JBIG2_LONG_REFERENCE:
        count = int.from_bytes(bytes([referred]) + _exact(stream, 3), "big") & 0x1FFFFFFF
        _skip(stream, (count + 8) // 8)
    reference_size = 1 if number <= 256 else 2 if number <= 65536 else 4
    _skip(stream, count * reference_size + (4 if flags & 0x40 else 1))
    (length,) = struct.unpack(">I", _exact(stream, 4))
    return flags & 0x3F, length


def _jbig2_region_bottom(stream: _Buffered, length: int) -> int | None:
    _width, height, _left, top = struct.unpack(">IIII", _exact(stream, 16))
    if length != JBIG2_UNKNOWN_LENGTH:
        _skip(stream, length - 16)
        return 0 if height == JBIG2_UNKNOWN_LENGTH else top + height
    _region_flags, generic_flags = _exact(stream, 2)
    if not stream.find(JBIG2_MMR_END if generic_flags & 1 else JBIG2_ARITHMETIC_END):
        return None
    (rows,) = struct.unpack(">I", _exact(stream, 4))
    return top + rows


def jbig2_bytes(source: ByteSource) -> int:
    stream = _Buffered(source)
    width = rows = 0
    try:
        for _ in range(JBIG2_MAX_SEGMENTS):
            kind, length = _jbig2_segment_header(stream)
            if kind == JBIG2_PAGE_INFORMATION and not width:
                information = _exact(stream, 19)
                width, height = struct.unpack(">II", information[:8])
                if height != JBIG2_UNKNOWN_LENGTH:
                    return (width + 7) // 8 * height
                rows = int.from_bytes(information[17:19], "big") & 0x7FFF
                _skip(stream, length - 19)
            elif width and kind == JBIG2_END_OF_STRIPE:
                (end,) = struct.unpack(">I", _exact(stream, 4))
                rows = max(rows, end + 1)
                _skip(stream, length - 4)
            elif width and kind in JBIG2_REGIONS:
                bottom = _jbig2_region_bottom(stream, length)
                if bottom is None:
                    break
                rows = max(rows, bottom)
            elif length == JBIG2_UNKNOWN_LENGTH:
                break
            else:
                _skip(stream, length)
    except EOFError:
        pass
    return (width + 7) // 8 * rows
