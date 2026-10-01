import mimetypes
import re
import struct
from datetime import UTC, datetime
from typing import Literal

import pymupdf

from vivepdf.ops._name_syntax import pdf_name
from vivepdf.ops._objects import set_key
from vivepdf.ops.preflight import _states_blend

Level = Literal["1b", "2b", "2u", "3b"]
DEFAULT_LEVEL: Level = "2b"
CONFORMANCE_RANK = {"b": 0, "u": 1, "a": 2}
CLAIM = re.compile(r"PDF/A-(\d)([abu]?)")
REFERENCE = re.compile(r"(\d+)\s+0\s+R")
SOFT_MASK_IN_DATA = re.compile(r"/SMaskInData\s+[1-9]")
DEVICE_SPACES = {1: "/DeviceGray", 3: "/DeviceRGB", 4: "/DeviceCMYK"}
FALLBACK_MIME = "application/octet-stream"
ICC_VERSION_2_1 = 0x02100000
ICC_HEADER_SIZE = 128
ICC_TAG_ENTRY_SIZE = 12
ICC_DESCRIPTION_TAIL = 4 + 4 + 2 + 1 + 67
ICC_CURVE_POINTS = 1024
D50_WHITE = (0.9642, 1.0, 0.8249)
D65_WHITE = (0.9504559, 1.0, 1.0890578)
SRGB_COLORANTS = (
    (b"rXYZ", (0.4360747, 0.2225045, 0.0139322)),
    (b"gXYZ", (0.3850649, 0.7168786, 0.0971045)),
    (b"bXYZ", (0.1430804, 0.0606169, 0.7141733)),
)


def part_of(level: Level) -> str:
    return level[0]


def conformance_of(level: Level) -> str:
    return level[1].upper()


def target_claim(level: Level) -> str:
    return f"PDF/A-{level}"


def claim_satisfies(claimed: str | None, level: Level) -> bool:
    match = CLAIM.fullmatch(claimed or "")
    if not match or match.group(1) != part_of(level):
        return False
    return CONFORMANCE_RANK.get(match.group(2), -1) >= CONFORMANCE_RANK[level[1]]


def read_key(document: pymupdf.Document, xref: int, key: str) -> tuple[str, str]:
    try:
        return document.xref_get_key(xref, key)
    except (RuntimeError, ValueError):
        return ("null", "null")


def _object_text(document: pymupdf.Document, xref: int) -> str:
    try:
        return document.xref_object(xref, compressed=True)
    except (RuntimeError, ValueError):
        return ""


def _references(document: pymupdf.Document, xref: int, key: str) -> list[int]:
    kind, value = read_key(document, xref, key)
    if kind == "xref":
        value = _object_text(document, int(value.split()[0]))
    elif kind != "array":
        return []
    return [
        int(reference)
        for reference in REFERENCE.findall(value)
        if 0 < int(reference) < document.xref_length()
    ]


def transparency(document: pymupdf.Document) -> tuple[int, list[int]]:
    blending = 0
    groups: list[int] = []
    for xref in range(1, document.xref_length()):
        text = _object_text(document, xref)
        if not text:
            continue
        if _states_blend(text) or SOFT_MASK_IN_DATA.search(text):
            blending += 1
        if "/Group" in text and read_key(document, xref, "Group/S")[1] == "/Transparency":
            groups.append(xref)
    return blending, groups


def remove_transparency_groups(document: pymupdf.Document) -> None:
    for xref in transparency(document)[1]:
        document.xref_set_key(xref, "Group", "null")


def jpx_images(document: pymupdf.Document) -> list[int]:
    return [
        xref
        for xref in range(1, document.xref_length())
        if document.xref_is_stream(xref) and "JPXDecode" in read_key(document, xref, "Filter")[1]
    ]


def _declared_space_kept(document: pymupdf.Document, xref: int) -> bool:
    kind, value = read_key(document, xref, "ColorSpace")
    if kind == "null":
        return False
    if kind == "xref":
        value = _object_text(document, int(value.split()[0]))
    return "/Indexed" not in value


def reencode_jpx(document: pymupdf.Document, xrefs: list[int]) -> None:
    for xref in xrefs:
        pixmap = pymupdf.Pixmap(document, xref)
        if pixmap.alpha:
            pixmap = pymupdf.Pixmap(pixmap, 0)
        device = DEVICE_SPACES.get(pixmap.n)
        if device is None:
            continue
        keep_space = _declared_space_kept(document, xref)
        for key in ("Filter", "DecodeParms", "Decode", "SMaskInData"):
            document.xref_set_key(xref, key, "null")
        document.xref_set_key(xref, "BitsPerComponent", "8")
        document.xref_set_key(xref, "Width", str(pixmap.width))
        document.xref_set_key(xref, "Height", str(pixmap.height))
        if not keep_space:
            document.xref_set_key(xref, "ColorSpace", device)
        document.update_stream(xref, pixmap.samples, compress=True)


def object_streams(document: pymupdf.Document) -> int:
    return sum(
        1
        for xref in range(1, document.xref_length())
        if read_key(document, xref, "Type")[1] in ("/ObjStm", "/XRef")
    )


def optional_content(document: pymupdf.Document) -> tuple[int, bool]:
    catalog = document.pdf_catalog()
    if read_key(document, catalog, "OCProperties")[0] == "null":
        return 0, False
    hidden = bool(_references(document, catalog, "OCProperties/D/OFF")) or (
        read_key(document, catalog, "OCProperties/D/BaseState")[1] == "/OFF"
    )
    return 1, hidden


def remove_optional_content(document: pymupdf.Document) -> None:
    document.xref_set_key(document.pdf_catalog(), "OCProperties", "null")
    for xref in range(1, document.xref_length()):
        if read_key(document, xref, "OC")[0] != "null":
            document.xref_set_key(xref, "OC", "null")


def _pdf_date(moment: datetime) -> str:
    return pymupdf.get_pdf_str(moment.strftime("D:%Y%m%d%H%M%SZ"))


def _mime(name: str) -> str:
    guessed = mimetypes.guess_type(name)[0] or FALLBACK_MIME
    return guessed if guessed.isascii() else FALLBACK_MIME


def _filespecs(document: pymupdf.Document) -> list[int]:
    return [
        xref
        for xref in range(1, document.xref_length())
        if read_key(document, xref, "EF/F")[0] == "xref"
    ]


def _name_tree_specs(document: pymupdf.Document) -> list[int]:
    return [
        xref
        for xref in _references(document, document.pdf_catalog(), "Names/EmbeddedFiles/Names")
        if read_key(document, xref, "EF/F")[0] == "xref"
    ]


def _inline_annotation_specs(document: pymupdf.Document) -> list[int]:
    found: list[int] = []
    for page in document:
        for xref, kind, _name in page.annot_xrefs():
            if (
                kind == pymupdf.PDF_ANNOT_FILE_ATTACHMENT
                and read_key(document, xref, "FS")[0] == "dict"
            ):
                found.append(xref)
    return found


def _spec_complete(document: pymupdf.Document, spec: int) -> bool:
    stream = int(read_key(document, spec, "EF/F")[1].split()[0])
    return all(
        read_key(document, spec, key)[0] != "null" for key in ("F", "UF", "AFRelationship")
    ) and (read_key(document, stream, "Subtype")[0] != "null")


def attachment_problems(document: pymupdf.Document) -> int:
    associated = set(_references(document, document.pdf_catalog(), "AF"))
    broken = sum(
        1
        for spec in _filespecs(document)
        if spec not in associated or not _spec_complete(document, spec)
    )
    inline_tree = max(0, document.embfile_count() - len(_name_tree_specs(document)))
    return broken + inline_tree + len(_inline_annotation_specs(document))


def _embedded_stream(document: pymupdf.Document, data: bytes, name: str, info: dict) -> int:
    stream = document.get_new_xref()
    created = pymupdf.get_pdf_str(info.get("creationDate") or "")
    modified = pymupdf.get_pdf_str(info.get("modDate") or "")
    params = f"/Size {len(data)}"
    if info.get("creationDate"):
        params += f" /CreationDate {created}"
    if info.get("modDate"):
        params += f" /ModDate {modified}"
    document.update_object(
        stream,
        f"<< /Type /EmbeddedFile /Subtype {pdf_name(_mime(name))} /Params << {params} >> >>",
    )
    document.update_stream(stream, data, compress=True)
    return stream


def _rebuild_name_tree(document: pymupdf.Document) -> None:
    entries: list[tuple[str, int]] = []
    for index in range(document.embfile_count()):
        info = document.embfile_info(index)
        data = document.embfile_get(index)
        name = info.get("ufilename") or info.get("filename") or info.get("name") or "attachment"
        stream = _embedded_stream(document, data, name, info)
        spec = document.get_new_xref()
        description = info.get("description") or ""
        document.update_object(
            spec,
            f"<< /Type /Filespec /F {pymupdf.get_pdf_str(name)} /UF {pymupdf.get_pdf_str(name)}"
            + (f" /Desc {pymupdf.get_pdf_str(description)}" if description else "")
            + f" /AFRelationship /Unspecified /EF << /F {stream} 0 R /UF {stream} 0 R >> >>",
        )
        entries.append((info.get("name") or name, spec))
    entries.sort(key=lambda entry: entry[0])
    names = " ".join(f"{pymupdf.get_pdf_str(key)} {spec} 0 R" for key, spec in entries)
    document.xref_set_key(document.pdf_catalog(), "Names/EmbeddedFiles", f"<< /Names [{names}] >>")


def _lift_annotation_specs(document: pymupdf.Document) -> None:
    for annotation in _inline_annotation_specs(document):
        spec = document.get_new_xref()
        document.update_object(spec, read_key(document, annotation, "FS")[1])
        document.xref_set_key(annotation, "FS", f"{spec} 0 R")


def _complete_spec(document: pymupdf.Document, spec: int, now: datetime) -> None:
    names = [read_key(document, spec, key) for key in ("UF", "F")]
    name = next((value for kind, value in names if kind == "string" and value), "attachment")
    for key in ("F", "UF"):
        if read_key(document, spec, key)[0] == "null":
            document.xref_set_key(spec, key, pymupdf.get_pdf_str(name))
    if read_key(document, spec, "AFRelationship")[0] == "null":
        document.xref_set_key(spec, "AFRelationship", "/Unspecified")
    stream = int(read_key(document, spec, "EF/F")[1].split()[0])
    if read_key(document, stream, "Subtype")[0] == "null":
        document.xref_set_key(stream, "Subtype", pdf_name(_mime(name)))
    if read_key(document, stream, "Params/ModDate")[0] == "null":
        set_key(document, stream, ["Params", "ModDate"], _pdf_date(now))


def associate_attachments(document: pymupdf.Document) -> None:
    if document.embfile_count() > len(_name_tree_specs(document)):
        _rebuild_name_tree(document)
    _lift_annotation_specs(document)
    now = datetime.now(UTC).replace(microsecond=0)
    catalog = document.pdf_catalog()
    specs = _filespecs(document)
    for spec in specs:
        _complete_spec(document, spec, now)
    existing = _references(document, catalog, "AF")
    merged = existing + [spec for spec in specs if spec not in existing]
    if merged:
        document.xref_set_key(catalog, "AF", "[" + " ".join(f"{xref} 0 R" for xref in merged) + "]")


def _s15(value: float) -> bytes:
    return struct.pack(">i", round(value * 65536))


def _xyz_tag(values: tuple[float, float, float]) -> bytes:
    return b"XYZ " + bytes(4) + b"".join(_s15(value) for value in values)


def _srgb_decode(value: float) -> float:
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def _curve_tag() -> bytes:
    points = (
        struct.pack(">H", round(_srgb_decode(index / (ICC_CURVE_POINTS - 1)) * 65535))
        for index in range(ICC_CURVE_POINTS)
    )
    return b"curv" + bytes(4) + struct.pack(">I", ICC_CURVE_POINTS) + b"".join(points)


def _description_tag(text: str) -> bytes:
    encoded = text.encode("ascii") + b"\0"
    return (
        b"desc" + bytes(4) + struct.pack(">I", len(encoded)) + encoded + bytes(ICC_DESCRIPTION_TAIL)
    )


def _text_tag(text: str) -> bytes:
    return b"text" + bytes(4) + text.encode("ascii") + b"\0"


def _padded(data: bytes) -> bytes:
    return data + bytes(-len(data) % 4)


def srgb_profile_v2(description: str) -> bytes:
    curve = _curve_tag()
    tags = [
        (b"desc", _description_tag(description)),
        (b"cprt", _text_tag("No copyright, use freely")),
        (b"wtpt", _xyz_tag(D65_WHITE)),
        *((signature, _xyz_tag(values)) for signature, values in SRGB_COLORANTS),
        (b"rTRC", curve),
        (b"gTRC", curve),
        (b"bTRC", curve),
    ]
    start = ICC_HEADER_SIZE + 4 + ICC_TAG_ENTRY_SIZE * len(tags)
    body = b""
    placed: dict[bytes, int] = {}
    table = struct.pack(">I", len(tags))
    for signature, data in tags:
        if data not in placed:
            placed[data] = start + len(body)
            body += _padded(data)
        table += signature + struct.pack(">II", placed[data], len(data))
    size = start + len(body)
    header = (
        struct.pack(">I4sI4s4s4s", size, bytes(4), ICC_VERSION_2_1, b"mntr", b"RGB ", b"XYZ ")
        + struct.pack(">6H", 2026, 1, 1, 0, 0, 0)
        + b"acsp"
        + bytes(4 + 4 + 4 + 4 + 8 + 4)
        + b"".join(_s15(value) for value in D50_WHITE)
    )
    header += bytes(ICC_HEADER_SIZE - len(header))
    return header + table + body
