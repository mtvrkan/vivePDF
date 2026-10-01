import re

import pymupdf

from vivepdf.rpc.progress import Progress

CANCEL_STRIDE = 200
REFERENCE = re.compile(r"(\d+)\s+\d+\s+R")
JPEG_START = b"\xff\xd8"
START_OF_SCAN = 0xDA
END_OF_IMAGE = 0xD9
STANDALONE_MARKERS = {0x01, *range(0xD0, 0xD8)}
METADATA_SEGMENTS = {0xE1, 0xED, 0xFE}
UNREADABLE = (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase)


def _key(document: pymupdf.Document, xref: int, key: str) -> tuple[str, str]:
    try:
        return document.xref_get_key(xref, key)
    except UNREADABLE:
        return "null", "null"


def _file_name(document: pymupdf.Document, spec: int) -> str:
    for key in ("UF", "F"):
        kind, value = _key(document, spec, key)
        if kind == "string" and value:
            return value
    return f"#{spec}"


def associated_file_holders(document: pymupdf.Document) -> list[int]:
    return [
        xref
        for xref in range(1, document.xref_length())
        if _key(document, xref, "AF")[0] in ("array", "xref", "dict")
    ]


def associated_file_names(document: pymupdf.Document, known: list[str]) -> list[str]:
    names: list[str] = []
    seen: set[int] = set()
    for holder in associated_file_holders(document):
        kind, value = _key(document, holder, "AF")
        if kind == "xref":
            value = document.xref_object(int(value.split()[0]), compressed=True)
        for found in REFERENCE.findall(value):
            spec = int(found)
            if spec in seen or not 0 < spec < document.xref_length():
                continue
            seen.add(spec)
            if _key(document, spec, "EF")[0] == "null":
                continue
            name = _file_name(document, spec)
            if name not in known and name not in names:
                names.append(name)
    return names


def remove_associated_files(document: pymupdf.Document) -> None:
    for holder in associated_file_holders(document):
        document.xref_set_key(holder, "AF", "null")
    catalog = document.pdf_catalog()
    if _key(document, catalog, "Collection")[0] != "null":
        document.xref_set_key(catalog, "Collection", "null")


def stripped_jpeg(data: bytes) -> bytes | None:
    if not data.startswith(JPEG_START):
        return None
    kept = bytearray(JPEG_START)
    position = len(JPEG_START)
    removed = False
    while position + 1 < len(data):
        if data[position] != 0xFF:
            return None
        marker = data[position + 1]
        if marker == 0xFF:
            position += 1
            continue
        if marker in (START_OF_SCAN, END_OF_IMAGE):
            kept += data[position:]
            return bytes(kept) if removed else None
        if marker in STANDALONE_MARKERS:
            kept += data[position : position + 2]
            position += 2
            continue
        if position + 4 > len(data):
            return None
        end = position + 2 + int.from_bytes(data[position + 2 : position + 4], "big")
        if end > len(data) or end < position + 4:
            return None
        if marker in METADATA_SEGMENTS:
            removed = True
        else:
            kept += data[position:end]
        position = end
    return None


def _jpeg_stream(document: pymupdf.Document, xref: int) -> bytes | None:
    if _key(document, xref, "Subtype")[1] != "/Image":
        return None
    if _key(document, xref, "Filter")[1] != "/DCTDecode":
        return None
    try:
        return document.xref_stream_raw(xref)
    except UNREADABLE:
        return None


def image_metadata_holders(
    document: pymupdf.Document, progress: Progress | None = None
) -> list[int]:
    holders: list[int] = []
    for xref in range(1, document.xref_length()):
        if progress is not None and xref % CANCEL_STRIDE == 0:
            progress.check_cancelled()
        data = _jpeg_stream(document, xref)
        if data and stripped_jpeg(data) is not None:
            holders.append(xref)
    return holders


def remove_image_metadata(document: pymupdf.Document, progress: Progress) -> None:
    for xref in image_metadata_holders(document, progress):
        data = _jpeg_stream(document, xref)
        cleaned = stripped_jpeg(data) if data else None
        if cleaned is None:
            continue
        parameters = _key(document, xref, "DecodeParms")
        document.update_stream(xref, cleaned, compress=False)
        document.xref_set_key(xref, "Filter", "/DCTDecode")
        if parameters[0] != "null":
            document.xref_set_key(xref, "DecodeParms", parameters[1])
