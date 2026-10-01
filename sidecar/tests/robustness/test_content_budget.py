import importlib
import io
import os
import struct
import time
import zlib
from pathlib import Path

import pymupdf
import pytest
import robustness_corpus
from PIL import Image

from vivepdf.ops import _content_budget
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress
from vivepdf.rpc.registry import get_operation
from vivepdf.rpc.server import run_operation

pytestmark = pytest.mark.robustness

importlib.import_module("vivepdf.rpc.loader").load_all()


@pytest.fixture(autouse=True)
def _fresh_verdicts():
    _content_budget._verdicts.clear()
    yield
    _content_budget._verdicts.clear()


def _bomb(folder: Path) -> Path:
    target = folder / "bomba.pdf"
    target.write_bytes(robustness_corpus.decompression_bomb())
    return target


def _pristine(folder: Path) -> Path:
    variant = next(
        item for item in robustness_corpus.build_variants() if item.name == "valid_rich_base"
    )
    target = folder / variant.file_name
    target.write_bytes(variant.build())
    return target


def _rotate(path: Path, output: Path):
    operation = get_operation("pages.rotate")
    params = {"path": str(path), "output": str(output), "degrees": 90}
    return run_operation(operation, params, silent_progress(), "pages.rotate")


def test_a_decompression_bomb_is_refused_before_mupdf_stalls(tmp_path: Path):
    output = tmp_path / "cikti.pdf"
    started = time.perf_counter()
    with pytest.raises(OpError) as caught:
        _rotate(_bomb(tmp_path), output)
    assert time.perf_counter() - started < 5
    assert caught.value.code == ErrorCode.INVALID_PDF
    assert caught.value.data == {"reason": "documentTooLarge"}
    assert not output.exists()


def test_a_bomb_among_several_inputs_is_found(tmp_path: Path):
    bomb = _bomb(tmp_path)
    pristine = _pristine(tmp_path)
    with pytest.raises(OpError) as caught:
        _content_budget.check_content_budget(
            {"inputs": [{"path": str(pristine)}, {"path": str(bomb)}]}
        )
    assert caught.value.data == {"reason": "documentTooLarge"}
    with pytest.raises(OpError):
        _content_budget.check_content_budget({"pathA": str(pristine), "pathB": str(bomb)})


def test_an_ordinary_document_passes_and_is_checked_once(tmp_path: Path, monkeypatch):
    pristine = _pristine(tmp_path)
    calls: list[Path] = []
    original = _content_budget._holds_bomb

    def counting(path: Path, password):
        calls.append(path)
        return original(path, password)

    monkeypatch.setattr(_content_budget, "_holds_bomb", counting)
    result = _rotate(pristine, tmp_path / "cikti.pdf")
    assert result.page_count >= 1
    _content_budget.check_content_budget({"path": str(pristine)})
    assert len(calls) == 1
    stamp = pristine.stat().st_mtime_ns + 5_000_000_000
    os.utime(pristine, ns=(stamp, stamp))
    _content_budget.check_content_budget({"path": str(pristine)})
    assert len(calls) == 2


def test_a_large_stream_that_barely_compresses_is_not_a_bomb():
    noise = os.urandom(17 * 1024 * 1024)
    assert _content_budget._decoded_size(zlib.compress(noise, 1)) == len(noise)
    packed = zlib.compress(noise, 1)
    assert not (len(noise) >= _content_budget.RATIO_LIMIT * len(packed))


def test_a_highly_compressed_stream_is_measured_without_decoding_it_all():
    packed = zlib.compress(b"0 0 m 1 1 l S\n" * (40 * 1024 * 1024 // 14), 9)
    decoded = _content_budget._decoded_size(packed)
    assert decoded is not None
    assert _content_budget.RATIO_BYTES < decoded < 40 * 1024 * 1024


def _bomb_stream() -> bytes:
    compressor = zlib.compressobj(9)
    chunk = b"0 0 m 1 1 l S\n" * 4096
    return b"".join(compressor.compress(chunk) for _ in range(1500)) + compressor.flush()


def _raw_stream(document: pymupdf.Document, header: str, data: bytes, filters: str) -> int:
    xref = document.get_new_xref()
    document.update_object(xref, header)
    document.update_stream(xref, data, compress=0)
    if filters:
        document.xref_set_key(xref, "Filter", filters)
    return xref


def _form(document: pymupdf.Document, content: bytes, child: int) -> int:
    resources = f"/Resources<</XObject<</Fx {child} 0 R>>>>"
    xref = document.get_new_xref()
    document.update_object(xref, f"<</Type/XObject/Subtype/Form/BBox[0 0 10 10]{resources}>>")
    document.update_stream(xref, content, compress=0)
    return xref


def _save(document: pymupdf.Document, target: Path) -> Path:
    document.save(target, garbage=0, deflate=False)
    document.close()
    return target


def test_a_bomb_behind_a_non_flate_filter_chain_is_refused(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    hexed = _bomb_stream().hex().encode("ascii") + b">"
    content = _raw_stream(document, "<<>>", hexed, "[/ASCIIHexDecode/FlateDecode]")
    document.xref_set_key(page.xref, "Contents", f"{content} 0 R")
    target = _save(document, tmp_path / "onaltilik.pdf")
    with pytest.raises(OpError) as caught:
        _content_budget.check_content_budget({"path": str(target)})
    assert caught.value.data == {"reason": "documentTooLarge"}


def test_a_bomb_inside_a_nested_form_is_found_by_the_page_walk(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    bomb = _raw_stream(
        document, "<</Type/XObject/Subtype/Form/BBox[0 0 10 10]>>", _bomb_stream(), "/FlateDecode"
    )
    outer = _form(document, b"/Fx Do", _form(document, b"/Fx Do", bomb))
    document.xref_set_key(page.xref, "Resources", f"<</XObject<</Fx {outer} 0 R>>>>")
    for _ in range(40):
        _raw_stream(document, "<<>>", b"q Q", "")
    target = _save(document, tmp_path / "icice.pdf")
    with pymupdf.open(target) as check:
        assert check.page_count * _content_budget.PAGE_WALK_FACTOR < check.xref_length()
    with pytest.raises(OpError) as caught:
        _content_budget.check_content_budget({"path": str(target)})
    assert caught.value.data == {"reason": "documentTooLarge"}


def test_an_image_declaring_a_giant_pixel_buffer_is_refused(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    header = (
        "<</Type/XObject/Subtype/Image/Width 100000/Height 100000"
        "/ColorSpace/DeviceRGB/BitsPerComponent 8>>"
    )
    image = _raw_stream(document, header, zlib.compress(b"\xff" * 30000, 9), "/FlateDecode")
    document.xref_set_key(page.xref, "Resources", f"<</XObject<</Im0 {image} 0 R>>>>")
    target = _save(document, tmp_path / "resim.pdf")
    with pytest.raises(OpError) as caught:
        _content_budget.check_content_budget({"path": str(target)})
    assert caught.value.data == {"reason": "documentTooLarge"}


def test_ordinary_images_and_plain_streams_pass(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 2000, 2000), 0)
    pixmap.clear_with(255)
    page.insert_image(page.rect, pixmap=pixmap)
    page.insert_text((72, 72), "düz metin", fontsize=12)
    target = tmp_path / "olagan.pdf"
    document.save(target)
    document.close()
    _content_budget.check_content_budget({"path": str(target)})


def _jpeg(width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (40, 90, 160)).save(buffer, format="JPEG", quality=30)
    return buffer.getvalue()


def _lying_jpeg(width: int, height: int) -> bytes:
    data = bytearray(_jpeg(8, 8))
    frame = data.index(b"\xff\xc0")
    data[frame + 5 : frame + 9] = struct.pack(">HH", height, width)
    return bytes(data)


def _lying_codestream(width: int, height: int) -> bytes:
    size = struct.pack(">HHIIIIIIIIH", 47, 0, width, height, 0, 0, width, height, 0, 0, 3)
    return b"\xff\x4f\xff\x51" + size + b"\x07\x01\x01" * 3 + b"\xff\xd9"


def _lying_jbig2(width: int, height: int) -> bytes:
    page = struct.pack(">IIIIBH", width, height, 0, 0, 0, 0)
    return struct.pack(">IBBBI", 0, 48, 0, 1, len(page)) + page


def _small_image(
    tmp_path: Path, name: str, data: bytes, filters: str, parameters: str = ""
) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    header = (
        "<</Type/XObject/Subtype/Image/Width 10/Height 10/ColorSpace/DeviceRGB/BitsPerComponent 8>>"
    )
    image = _raw_stream(document, header, data, filters)
    if parameters:
        document.xref_set_key(image, "DecodeParms", parameters)
    document.xref_set_key(page.xref, "Resources", f"<</XObject<</Im0 {image} 0 R>>>>")
    return _save(document, tmp_path / name)


@pytest.mark.parametrize(
    ("name", "data", "filters"),
    [
        ("jpeg.pdf", _lying_jpeg(60000, 60000), "/DCTDecode"),
        ("jpx.pdf", _lying_codestream(100000, 100000), "/JPXDecode"),
        ("jbig2.pdf", _lying_jbig2(400000, 400000), "/JBIG2Decode"),
        ("sarili.pdf", zlib.compress(_lying_codestream(90000, 90000)), "[/Fl/JPXDecode]"),
        ("onaltilik.pdf", _lying_jpeg(60000, 60000).hex().encode() + b">", "[/AHx/DCT]"),
    ],
    ids=["jpeg", "jpx", "jbig2", "flate-jpx", "hex-jpeg"],
)
def test_a_codec_header_hiding_a_giant_picture_is_refused(
    tmp_path: Path, name: str, data: bytes, filters: str
):
    target = _small_image(tmp_path, name, data, filters)
    with pytest.raises(OpError) as caught:
        _content_budget.check_content_budget({"path": str(target)})
    assert caught.value.data == {"reason": "documentTooLarge"}


def test_real_jpeg_and_jpx_pictures_pass(tmp_path: Path):
    buffer = io.BytesIO()
    Image.new("RGB", (1200, 900), (10, 120, 60)).save(buffer, format="JPEG2000")
    document = pymupdf.open()
    page = document.new_page()
    page.insert_image(pymupdf.Rect(0, 0, 300, 200), stream=_jpeg(3000, 2000))
    page.insert_image(pymupdf.Rect(0, 300, 300, 500), stream=buffer.getvalue())
    target = tmp_path / "gercek.pdf"
    document.save(target)
    document.close()
    with pymupdf.open(target) as check:
        filters = {check.xref_get_key(xref, "Filter")[1] for xref, *_ in check[0].get_images()}
    assert filters == {"/DCTDecode", "/JPXDecode"}
    _content_budget.check_content_budget({"path": str(target)})


def _run_length(data: bytes) -> bytes:
    chunks = [data[index : index + 128] for index in range(0, len(data), 128)]
    return b"".join(bytes([len(chunk) - 1]) + chunk for chunk in chunks) + bytes([128])


def _lzw(data: bytes) -> bytes:
    table = {bytes([value]): value for value in range(256)}
    codes = [256]
    current = b""
    for value in data:
        candidate = current + bytes([value])
        if candidate in table:
            current = candidate
            continue
        codes.append(table[current])
        table[candidate] = len(table) + 2
        current = bytes([value])
    codes += [table[current], 257]
    bits = "".join(format(code, "09b") for code in codes)
    bits += "0" * (-len(bits) % 8)
    return int(bits, 2).to_bytes(len(bits) // 8, "big")


def _png_up_rows(data: bytes, columns: int) -> bytes:
    padded = data + b"\x00" * (-len(data) % columns)
    rows = [padded[index : index + columns] for index in range(0, len(padded), columns)]
    return zlib.compress(b"".join(b"\x00" + row for row in rows))


def _striped_jbig2(width: int, end_row: int) -> bytes:
    page = struct.pack(">IIIIBH", width, 0xFFFFFFFF, 0, 0, 0, 0x8000 | 128)
    stripe = struct.pack(">I", end_row)
    return (
        struct.pack(">IBBBI", 0, 48, 0, 1, len(page))
        + page
        + struct.pack(">IBBBI", 1, 50, 0, 1, len(stripe))
        + stripe
    )


@pytest.mark.parametrize(
    ("data", "filters", "parameters"),
    [
        (_lzw(_lying_codestream(90000, 90000)), "[/LZWDecode/JPXDecode]", ""),
        (_run_length(_lying_jpeg(60000, 60000)), "[/RL/DCTDecode]", ""),
        (
            _png_up_rows(_lying_codestream(90000, 90000), 7),
            "[/FlateDecode/JPXDecode]",
            "[<</Predictor 12/Columns 7>>null]",
        ),
        (_striped_jbig2(400000, 3000000), "/JBIG2Decode", ""),
    ],
    ids=["lzw-jpx", "run-length-jpeg", "predicted-jpx", "striped-jbig2"],
)
def test_codec_headers_behind_every_standard_prefilter_are_refused(
    tmp_path: Path, data: bytes, filters: str, parameters: str
):
    target = _small_image(tmp_path, "zincir.pdf", data, filters, parameters)
    with pytest.raises(OpError) as caught:
        _content_budget.check_content_budget({"path": str(target)})
    assert caught.value.data == {"reason": "documentTooLarge"}


@pytest.mark.parametrize(
    ("filters", "parameters"),
    [
        ("[/Crypt/DCTDecode]", ""),
        ("[/FlateDecode/DCTDecode]", "[<</Predictor 12/Columns 4>>null]"),
        ("/FlateDecode", ""),
    ],
    ids=["unknown-prefilter", "broken-predicted-data", "no-codec"],
)
def test_unreadable_or_codec_free_chains_measure_nothing(
    tmp_path: Path, filters: str, parameters: str
):
    target = _small_image(tmp_path, "okunamaz.pdf", b"\x00" * 16, filters, parameters)
    with pymupdf.open(target) as document:
        xref = document[0].get_images()[0][0]
        assert _content_budget._codec_bytes(document, xref) == 0
    _content_budget.check_content_budget({"path": str(target)})
