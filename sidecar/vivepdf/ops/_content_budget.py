import re
import threading
import zlib
from collections import OrderedDict
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pymupdf

from vivepdf.ops._codec_headers import jbig2_bytes, jpeg_bytes, jpx_bytes
from vivepdf.ops._passwords import authenticate_password
from vivepdf.rpc.errors import ErrorCode, OpError

PATH_KEYS = (
    ("path", "password"),
    ("pathA", "passwordA"),
    ("pathB", "passwordB"),
    ("sourcePath", None),
    ("templatePath", None),
)
LIST_KEYS = ("paths",)
ENTRY_LIST_KEYS = ("inputs", "sources")
SMALL_STREAM_BYTES = 8 * 1024
RATIO_LIMIT = 100
RATIO_BYTES = 16 * 1024 * 1024
HARD_BYTES = 128 * 1024 * 1024
CHUNK_BYTES = 1024 * 1024
HEADER_BYTES = 1024
CACHE_SIZE = 64
PAGE_WALK_FACTOR = 4
IMAGE_BYTES = 1024 * 1024 * 1024
IMAGE_RATIO_LIMIT = 1000
IMAGE_CODECS = ("/DCT", "/JPX", "/JBIG2", "/CCITT", "/CCF")
GRAY_SPACES = frozenset({"/DeviceGray", "/G", "/CalGray"})
CMYK_SPACES = frozenset({"/DeviceCMYK", "/CMYK"})
UNCHECKED_TYPES = frozenset({"/EmbeddedFile", "/Metadata", "/ObjStm", "/XRef"})
FLATE_FILTERS = frozenset({"/FlateDecode", "[/FlateDecode]", "/Fl", "[/Fl]"})
REFERENCE = re.compile(r"(\d+)\s+\d+\s+R")
IMAGE_SUBTYPE = re.compile(r"/Subtype\s*/Image(?![A-Za-z0-9])")
DIRECT_LENGTH = re.compile(r"/Length\s+(\d+)(?!\s+\d+\s+R)(?![\d.])")
FLATE_WINDOW_BITS = 15
LZW_MIN_BITS = 9
CODEC_HEADERS = {
    "DCTDecode": jpeg_bytes,
    "DCT": jpeg_bytes,
    "JPXDecode": jpx_bytes,
    "JBIG2Decode": jbig2_bytes,
}
INFLATE = frozenset({"FlateDecode", "Fl"})
UNCOMPRESS_LZW = frozenset({"LZWDecode", "LZW"})
PREDICTED = INFLATE | UNCOMPRESS_LZW
RUN_LENGTH = frozenset({"RunLengthDecode", "RL"})
ASCII_HEX = frozenset({"ASCIIHexDecode", "AHx"})
ASCII_85 = frozenset({"ASCII85Decode", "A85"})

_verdicts: OrderedDict[tuple[str, int, int], bool] = OrderedDict()
_lock = threading.Lock()


def _inputs(raw_params: dict[str, Any]) -> list[tuple[str, str | None]]:
    found: list[tuple[str, str | None]] = []
    for path_key, password_key in PATH_KEYS:
        value = raw_params.get(path_key)
        if isinstance(value, str):
            password = raw_params.get(password_key) if password_key else None
            found.append((value, password if isinstance(password, str) else None))
    for key in LIST_KEYS:
        values = raw_params.get(key)
        if isinstance(values, list):
            found.extend((value, None) for value in values if isinstance(value, str))
    for key in ENTRY_LIST_KEYS:
        entries = raw_params.get(key)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if isinstance(entry, dict) and isinstance(entry.get("path"), str):
                password = entry.get("password")
                found.append((entry["path"], password if isinstance(password, str) else None))
    return found


def _looks_like_pdf(path: Path) -> bool:
    if path.suffix.lower() == ".pdf":
        return True
    try:
        with path.open("rb") as handle:
            return b"%PDF-" in handle.read(HEADER_BYTES)
    except OSError:
        return False


def _decoded_size(raw: bytes) -> int | None:
    inflater = zlib.decompressobj()
    total = 0
    pending = raw
    try:
        while pending and total <= HARD_BYTES:
            total += len(inflater.decompress(pending, CHUNK_BYTES))
            pending = inflater.unconsumed_tail
            if total > RATIO_BYTES and total >= RATIO_LIMIT * len(raw):
                return total
    except zlib.error:
        return None
    return total


def _streamed_size(document: pymupdf.Document, xref: int, raw_length: int) -> int:
    pdf = pymupdf._as_pdf_document(document)
    stream = pymupdf.mupdf.pdf_open_stream_number(pdf, xref)
    total = 0
    while total <= HARD_BYTES:
        read = pymupdf.mupdf.fz_skip(stream, CHUNK_BYTES)
        if not read:
            break
        total += read
        if total > RATIO_BYTES and total >= RATIO_LIMIT * raw_length:
            break
    return total


def _integer(document: pymupdf.Document, xref: int, key: str) -> int:
    kind, value = document.xref_get_key(xref, key)
    return int(value) if kind == "int" else 0


class _StreamSource:
    def __init__(self, stream: Any) -> None:
        self.stream = stream

    def read(self, count: int) -> bytes:
        mupdf = pymupdf.mupdf
        window = mupdf.fz_open_null_filter(self.stream, count, mupdf.fz_tell(self.stream))
        return mupdf.fz_buffer_extract_copy(mupdf.fz_read_all(window, count))

    def skip(self, count: int) -> int:
        return pymupdf.mupdf.fz_skip(self.stream, count)


def _parameter(parameters: Any, key: str, default: int) -> int:
    mupdf = pymupdf.mupdf
    if parameters is None or not mupdf.pdf_is_dict(parameters):
        return default
    value = mupdf.pdf_dict_gets(parameters, key)
    return mupdf.pdf_to_int(value) if mupdf.pdf_is_int(value) else default


def _decoder(name: str, chain: Any, parameters: Any) -> Any:
    mupdf = pymupdf.mupdf
    if name in INFLATE:
        chain = mupdf.fz_open_flated(chain, FLATE_WINDOW_BITS)
    elif name in UNCOMPRESS_LZW:
        early = _parameter(parameters, "EarlyChange", 1)
        chain = mupdf.fz_open_lzwd(chain, early, LZW_MIN_BITS, 0, 0)
    elif name in RUN_LENGTH:
        chain = mupdf.fz_open_rld(chain)
    elif name in ASCII_HEX:
        chain = mupdf.fz_open_ahxd(chain)
    elif name in ASCII_85:
        chain = mupdf.fz_open_a85d(chain)
    else:
        return None
    predictor = _parameter(parameters, "Predictor", 1) if name in PREDICTED else 1
    if predictor > 1:
        chain = mupdf.fz_open_predict(
            chain,
            predictor,
            _parameter(parameters, "Columns", 1),
            _parameter(parameters, "Colors", 1),
            _parameter(parameters, "BitsPerComponent", 8),
        )
    return chain


def _filter_chain(stream_object: Any) -> list[tuple[str, Any]]:
    mupdf = pymupdf.mupdf
    filters = mupdf.pdf_dict_gets(stream_object, "Filter")
    parameters = mupdf.pdf_dict_gets(stream_object, "DecodeParms")
    if mupdf.pdf_is_name(filters):
        return [(mupdf.pdf_to_name(filters), parameters)]
    if not mupdf.pdf_is_array(filters):
        return []
    listed = mupdf.pdf_is_array(parameters)
    return [
        (
            mupdf.pdf_to_name(mupdf.pdf_array_get(filters, index)),
            mupdf.pdf_array_get(parameters, index) if listed else None,
        )
        for index in range(mupdf.pdf_array_len(filters))
    ]


def _codec_bytes(document: pymupdf.Document, xref: int) -> int:
    mupdf = pymupdf.mupdf
    try:
        pdf = pymupdf._as_pdf_document(document)
        chain = _filter_chain(mupdf.pdf_load_object(pdf, xref))
        if not chain or chain[-1][0] not in CODEC_HEADERS:
            return 0
        stream = mupdf.pdf_open_raw_stream_number(pdf, xref)
        for name, parameters in chain[:-1]:
            stream = _decoder(name, stream, parameters)
            if stream is None:
                return 0
        return CODEC_HEADERS[chain[-1][0]](_StreamSource(stream))
    except Exception:  # noqa: BLE001
        return 0


def _image_is_bomb(document: pymupdf.Document, xref: int) -> bool:
    if document.xref_get_key(xref, "ImageMask")[1] == "true":
        components, bits = 1, 1
    else:
        space = document.xref_get_key(xref, "ColorSpace")[1]
        components = 1 if space in GRAY_SPACES else 4 if space in CMYK_SPACES else 3
        bits = _integer(document, xref, "BitsPerComponent") or 8
    width = _integer(document, xref, "Width")
    height = _integer(document, xref, "Height")
    decoded = max(width * height * components * bits // 8, _codec_bytes(document, xref))
    if decoded <= IMAGE_BYTES:
        return False
    raw = document.xref_stream_raw(xref) or b""
    return decoded >= IMAGE_RATIO_LIMIT * max(len(raw), 1)


def _is_ratio_bomb(decoded: int, raw_length: int) -> bool:
    return decoded > HARD_BYTES or (decoded > RATIO_BYTES and decoded >= RATIO_LIMIT * raw_length)


def _stream_is_bomb(document: pymupdf.Document, xref: int) -> bool:
    header = document.xref_object(xref, compressed=True)
    if IMAGE_SUBTYPE.search(header):
        return _image_is_bomb(document, xref)
    length = DIRECT_LENGTH.search(header)
    if length and int(length.group(1)) < SMALL_STREAM_BYTES:
        return False
    if document.xref_get_key(xref, "Type")[1] in UNCHECKED_TYPES:
        return False
    filters = document.xref_get_key(xref, "Filter")[1].replace(" ", "")
    if filters in ("", "null") or any(codec in filters for codec in IMAGE_CODECS):
        return False
    raw = document.xref_stream_raw(xref)
    if not raw or len(raw) < SMALL_STREAM_BYTES:
        return False
    if filters not in FLATE_FILTERS:
        return _is_ratio_bomb(_streamed_size(document, xref, len(raw)), len(raw))
    decoded = _decoded_size(raw)
    if decoded is None:
        return False
    return _is_ratio_bomb(decoded, len(raw))


def _references(value: str) -> list[int]:
    return [int(match) for match in REFERENCE.findall(value)]


def _xobjects(document: pymupdf.Document, owner: int) -> list[int]:
    kind, forms = document.xref_get_key(owner, "Resources/XObject")
    if kind == "xref":
        forms = document.xref_object(_references(forms)[0], compressed=True)
        kind = "dict"
    return _references(forms) if kind == "dict" else []


def _drawn_streams(document: pymupdf.Document, index: int) -> tuple[list[int], list[int]]:
    try:
        page_xref = document.page_xref(index)
        kind, contents = document.xref_get_key(page_xref, "Contents")
        drawn = _references(contents) if kind in ("xref", "array") else []
        return drawn, _xobjects(document, page_xref)
    except Exception:  # noqa: BLE001
        return [], []


def _nested_streams(document: pymupdf.Document, xref: int) -> list[int]:
    try:
        if document.xref_get_key(xref, "Subtype")[1] != "/Form":
            return []
        return _xobjects(document, xref)
    except Exception:  # noqa: BLE001
        return []


def _candidate_streams(document: pymupdf.Document) -> Iterator[int]:
    count = document.xref_length()
    try:
        pages = document.page_count
    except Exception:  # noqa: BLE001
        pages = count
    if pages * PAGE_WALK_FACTOR >= count:
        yield from range(1, count)
        return
    seen: set[int] = set()
    for index in range(pages):
        contents, pending = _drawn_streams(document, index)
        for xref in contents:
            if xref not in seen:
                seen.add(xref)
                yield xref
        while pending:
            xref = pending.pop()
            if xref in seen:
                continue
            seen.add(xref)
            yield xref
            pending.extend(_nested_streams(document, xref))


def _is_bomb(document: pymupdf.Document, xref: int) -> bool:
    try:
        return document.xref_is_stream(xref) and _stream_is_bomb(document, xref)
    except Exception:  # noqa: BLE001
        return False


def _holds_bomb(path: Path, password: str | None) -> bool | None:
    try:
        document = pymupdf.open(path)
    except Exception:  # noqa: BLE001
        return False
    try:
        if not document.is_pdf:
            return False
        if document.needs_pass and not authenticate_password(document, password):
            return None
        return any(_is_bomb(document, xref) for xref in _candidate_streams(document))
    except Exception:  # noqa: BLE001
        return False
    finally:
        document.close()


def _verdict(path: Path, password: str | None) -> bool:
    try:
        status = path.stat()
    except OSError:
        return False
    key = (str(path.resolve()), status.st_mtime_ns, status.st_size)
    with _lock:
        if key in _verdicts:
            _verdicts.move_to_end(key)
            return _verdicts[key]
    if not _looks_like_pdf(path):
        return False
    verdict = _holds_bomb(path, password)
    if verdict is None:
        return False
    with _lock:
        _verdicts[key] = verdict
        while len(_verdicts) > CACHE_SIZE:
            _verdicts.popitem(last=False)
    return verdict


def check_content_budget(raw_params: dict[str, Any]) -> None:
    for value, password in _inputs(raw_params):
        path = Path(value)
        if not path.is_file():
            continue
        if _verdict(path, password):
            raise OpError(
                ErrorCode.INVALID_PDF,
                f"{path.name} holds a page too large to process",
                {"reason": "documentTooLarge"},
            )
