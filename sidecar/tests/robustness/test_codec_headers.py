import io
import struct

import pytest
from PIL import Image

from vivepdf.ops._codec_headers import jbig2_bytes, jpeg_bytes, jpx_bytes


class MemorySource:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.position = 0

    def read(self, count: int) -> bytes:
        chunk = self.data[self.position : self.position + count]
        self.position += len(chunk)
        return chunk

    def skip(self, count: int) -> int:
        skipped = min(count, len(self.data) - self.position)
        self.position += skipped
        return skipped


def _encoded(image: Image.Image, **options) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, **options)
    return buffer.getvalue()


def _jpeg(width: int, height: int, mode: str = "RGB") -> bytes:
    return _encoded(Image.new(mode, (width, height)), format="JPEG", quality=30)


def _resized_jpeg(width: int, height: int) -> bytes:
    data = bytearray(_jpeg(8, 8))
    frame = data.index(b"\xff\xc0")
    data[frame + 5 : frame + 9] = struct.pack(">HH", height, width)
    return bytes(data)


def _codestream(width: int, height: int, components: int = 3) -> bytes:
    size = struct.pack(
        ">HHIIIIIIIIH", 38 + 3 * components, 0, width, height, 0, 0, width, height, 0, 0, components
    )
    return b"\xff\x4f\xff\x51" + size + b"\x07\x01\x01" * components


def _jbig2_segment(number: int, kind: int, data: bytes) -> bytes:
    return struct.pack(">IBBBI", number, kind, 0, 1, len(data)) + data


def _page_information(width: int, height: int) -> bytes:
    return _jbig2_segment(0, 48, struct.pack(">IIIIBH", width, height, 0, 0, 0, 0))


def test_jpeg_frame_size_is_read_from_the_header():
    assert jpeg_bytes(MemorySource(_jpeg(800, 600))) == 800 * 600 * 3
    assert jpeg_bytes(MemorySource(_jpeg(40, 30, "L"))) == 40 * 30


def test_jpeg_header_behind_padding_and_stray_bytes_is_still_found():
    data = _resized_jpeg(60000, 50000)
    padding = b"\xff\xe1" + struct.pack(">H", 65000) + b"\x00" * 64998
    patched = data[:2] + padding * 3 + b"\x00\x13\x37" + data[2:]
    assert jpeg_bytes(MemorySource(patched)) == 60000 * 50000 * 3


@pytest.mark.parametrize("data", [b"", b"not a jpeg", b"\xff\xd8\xff\xda\x00\x08"])
def test_jpeg_without_a_frame_header_measures_nothing(data: bytes):
    assert jpeg_bytes(MemorySource(data)) == 0


def test_a_truncated_jpeg_header_is_reported():
    with pytest.raises(EOFError):
        jpeg_bytes(MemorySource(b"\xff\xd8\xff\xe0\x00"))


def test_jpx_size_is_read_from_a_raw_codestream_and_a_boxed_file():
    image = Image.new("RGB", (64, 48))
    boxed = _encoded(image, format="JPEG2000")
    raw = _encoded(image, format="JPEG2000", no_jp2=True)
    assert jpx_bytes(MemorySource(boxed)) == 64 * 48 * 3
    assert jpx_bytes(MemorySource(raw)) == 64 * 48 * 3
    assert jpx_bytes(MemorySource(_codestream(100000, 90000))) == 100000 * 90000 * 3


def test_jpx_boxes_with_an_extended_length_are_skipped():
    filler = struct.pack(">I4sQ", 1, b"xml ", 16 + 5) + b"<a/>\n"
    signature = b"\x00\x00\x00\x0cjP  \r\n\x87\n"
    codestream = _codestream(5000, 4000, 1)
    boxed = signature + filler + struct.pack(">I4s", 8 + len(codestream), b"jp2c") + codestream
    assert jpx_bytes(MemorySource(boxed)) == 5000 * 4000


def test_jpx_with_a_broken_box_measures_nothing():
    assert jpx_bytes(MemorySource(b"\x00\x00\x00\x04abcd")) == 0
    with pytest.raises(EOFError):
        jpx_bytes(MemorySource(b"\x00\x00"))


def test_jbig2_page_size_is_read_after_earlier_segments():
    symbols = _jbig2_segment(0, 0, b"\x00" * 40)
    page = struct.pack(">IBBBI", 1, 48, 0, 1, 19) + struct.pack(">IIIIBH", 90000, 80000, 0, 0, 0, 0)
    assert jbig2_bytes(MemorySource(_page_information(2480, 3508))) == 310 * 3508
    assert jbig2_bytes(MemorySource(symbols + page)) == 11250 * 80000


def test_jbig2_page_with_unknown_height_or_open_length_measures_nothing():
    assert jbig2_bytes(MemorySource(_page_information(2480, 0xFFFFFFFF))) == 0
    region = struct.pack(">IBBBI", 0, 38, 0, 1, 0xFFFFFFFF)
    assert jbig2_bytes(MemorySource(region)) == 0


def _striped_page(width: int, stripe: int) -> bytes:
    information = struct.pack(">IIIIBH", width, 0xFFFFFFFF, 0, 0, 0, 0x8000 | stripe)
    return _jbig2_segment(0, 48, information)


def _region(number: int, top: int, height: int) -> bytes:
    info = struct.pack(">IIIIB", 800, height, 0, top, 0) + b"\x00"
    return _jbig2_segment(number, 38, info)


def _open_region(number: int, top: int, mmr: bool, rows: int) -> bytes:
    end = b"\x00\x00" if mmr else b"\xff\xac"
    header = struct.pack(">IBBBI", number, 38, 0, 1, 0xFFFFFFFF)
    info = struct.pack(">IIIIB", 800, 0xFFFFFFFF, 0, top, 0) + bytes([1 if mmr else 0])
    return header + info + b"\x12\x34" * 40000 + end + struct.pack(">I", rows)


def test_a_striped_jbig2_page_grows_with_its_stripes_and_regions():
    page = _striped_page(8000, 256)
    stripe = _jbig2_segment(1, 50, struct.pack(">I", 4999))
    assert jbig2_bytes(MemorySource(page)) == 1000 * 256
    assert jbig2_bytes(MemorySource(page + stripe)) == 1000 * 5000
    assert jbig2_bytes(MemorySource(page + stripe + _region(2, 9000, 700))) == 1000 * 9700


@pytest.mark.parametrize("mmr", [False, True], ids=["arithmetic", "mmr"])
def test_a_region_of_unknown_length_is_measured_by_its_trailing_row_count(mmr: bool):
    data = _striped_page(8000, 16) + _open_region(1, 100, mmr, 60000)
    stripe = _jbig2_segment(2, 50, struct.pack(">I", 70000))
    assert jbig2_bytes(MemorySource(data)) == 1000 * 60100
    assert jbig2_bytes(MemorySource(data + stripe)) == 1000 * 70001


def test_a_region_whose_end_marker_never_comes_keeps_the_rows_seen_so_far():
    data = _striped_page(8000, 16) + _jbig2_segment(1, 50, struct.pack(">I", 99))
    header = struct.pack(">IBBBI", 2, 38, 0, 1, 0xFFFFFFFF)
    info = struct.pack(">IIIIB", 800, 0xFFFFFFFF, 0, 0, 0) + b"\x00"
    assert jbig2_bytes(MemorySource(data + header + info + b"\x12" * 1000)) == 1000 * 100
