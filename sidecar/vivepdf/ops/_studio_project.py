import hashlib
import io
import json
import re
import zipfile
import zlib
from pathlib import Path
from typing import Any

import pymupdf

from vivepdf.ops._appdata import user_data_dir
from vivepdf.ops._output import write_atomically
from vivepdf.rpc.errors import ErrorCode, OpError

PROJECT_FORMAT = "vivedesign"
PROJECT_VERSION = 1
PROJECT_EXTENSION = "vivedesign"
ASSET_PREFIX = "vivepdf-asset:"
CATALOG_KEY = "VivePDFDesign"
DESIGN_ENTRY = "design.json"
THUMBNAIL_ENTRY = "thumbnail.jpg"
MAX_DESIGN_JSON = 20 * 1024 * 1024
MAX_ASSET_BYTES = 200 * 1024 * 1024
MAX_PROJECT_BYTES = 512 * 1024 * 1024
MAX_ASSETS = 2000
MAX_THUMBNAIL = 2 * 1024 * 1024
ASSET_EXTENSIONS = frozenset(
    {"png", "jpg", "jpeg", "jfif", "gif", "bmp", "webp", "tif", "tiff", "heic", "heif", "img"}
)
ASSET_NAME = re.compile(r"^assets/([0-9a-f]{64})\.([a-z]{3,4})$")
FLATE_FILTERS = frozenset({"/FlateDecode", "[/FlateDecode]"})
JsonValue = Any


def refusal(reason: str, message: str, **data: object) -> OpError:
    return OpError(ErrorCode.INVALID_PARAMS, message, {"reason": reason, **data})


def too_large() -> OpError:
    return refusal(
        "projectTooLarge",
        "the design is too large",
        limitMb=MAX_PROJECT_BYTES // (1024 * 1024),
    )


def _not_project(name: str) -> OpError:
    return refusal("notProject", f"{name} is not a vivePDF design")


def replaced_strings(value: JsonValue, mapping: dict[str, str]) -> JsonValue:
    root: list[JsonValue] = [value]
    stack: list[tuple[JsonValue, JsonValue]] = [(root, 0)]
    while stack:
        container, key = stack.pop()
        current = container[key]
        if isinstance(current, str):
            if current in mapping:
                container[key] = mapping[current]
        elif isinstance(current, dict):
            copied = dict(current)
            container[key] = copied
            stack.extend((copied, child) for child in copied)
        elif isinstance(current, list):
            copied = list(current)
            container[key] = copied
            stack.extend((copied, index) for index in range(len(copied)))
    return root[0]


def _asset_extension(path: Path) -> str:
    extension = path.suffix.lower().lstrip(".")
    return extension if extension in ASSET_EXTENSIONS else "img"


def missing_asset(path: str) -> OpError:
    return OpError(
        ErrorCode.FILE_NOT_FOUND,
        f"image not found: {Path(path).name}",
        {"reason": "missingImage", "path": path},
    )


def build_archive(design: dict[str, JsonValue], assets: list[str], thumbnail: bytes) -> bytes:
    mapping: dict[str, str] = {}
    files: dict[str, bytes] = {}
    total = 0
    for path in dict.fromkeys(assets):
        source = Path(path)
        if not source.is_file():
            raise missing_asset(path)
        size = source.stat().st_size
        total += size
        if size > MAX_ASSET_BYTES or total > MAX_PROJECT_BYTES:
            raise too_large()
        data = source.read_bytes()
        name = f"assets/{hashlib.sha256(data).hexdigest()}.{_asset_extension(source)}"
        mapping[path] = ASSET_PREFIX + name
        files[name] = data
    payload = json.dumps(
        {
            "format": PROJECT_FORMAT,
            "version": PROJECT_VERSION,
            "design": replaced_strings(design, mapping),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(payload) > MAX_DESIGN_JSON:
        raise too_large()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(DESIGN_ENTRY, payload)
        if thumbnail:
            archive.writestr(THUMBNAIL_ENTRY, thumbnail, compress_type=zipfile.ZIP_STORED)
        for name, data in files.items():
            archive.writestr(name, data, compress_type=zipfile.ZIP_STORED)
    return buffer.getvalue()


def _bounded(archive: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes:
    if info.file_size > limit:
        raise too_large()
    with archive.open(info) as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise too_large()
    return data


def _design_of(archive: zipfile.ZipFile, name: str) -> dict[str, JsonValue]:
    try:
        info = archive.getinfo(DESIGN_ENTRY)
    except KeyError as error:
        raise _not_project(name) from error
    try:
        document = json.loads(_bounded(archive, info, MAX_DESIGN_JSON).decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError) as error:
        raise _not_project(name) from error
    if not isinstance(document, dict) or document.get("format") != PROJECT_FORMAT:
        raise _not_project(name)
    version, design = document.get("version"), document.get("design")
    if not isinstance(version, int) or not isinstance(design, dict):
        raise _not_project(name)
    if version > PROJECT_VERSION:
        raise refusal("newerProject", f"{name} was made by a newer vivePDF")
    return design


def _extract_assets(archive: zipfile.ZipFile) -> dict[str, str]:
    directory = user_data_dir() / "studio-assets"
    directory.mkdir(parents=True, exist_ok=True)
    mapping: dict[str, str] = {}
    total = 0
    for info in archive.infolist():
        match = ASSET_NAME.match(info.filename)
        if match is None or match[2] not in ASSET_EXTENSIONS:
            continue
        total += info.file_size
        if total > MAX_PROJECT_BYTES:
            raise too_large()
        target = directory / f"{match[1]}.{match[2]}"
        mapping[ASSET_PREFIX + info.filename] = str(target)
        if target.is_file() and target.stat().st_size == info.file_size:
            continue
        data = _bounded(archive, info, MAX_ASSET_BYTES)
        if hashlib.sha256(data).hexdigest() != match[1]:
            continue
        write_atomically(target, lambda path, payload=data: path.write_bytes(payload))
    return mapping


def read_archive(source: Path | bytes, name: str) -> tuple[dict[str, JsonValue], bytes]:
    try:
        archive = zipfile.ZipFile(source if isinstance(source, Path) else io.BytesIO(source))
    except (zipfile.BadZipFile, OSError) as error:
        raise _not_project(name) from error
    with archive:
        if len(archive.infolist()) > MAX_ASSETS + 2:
            raise too_large()
        design = _design_of(archive, name)
        mapping = _extract_assets(archive)
        thumbnail = b""
        if THUMBNAIL_ENTRY in archive.namelist():
            thumbnail = _bounded(archive, archive.getinfo(THUMBNAIL_ENTRY), MAX_THUMBNAIL)
    return replaced_strings(design, mapping), thumbnail


def embed_archive(document: pymupdf.Document, archive: bytes) -> None:
    xref = document.get_new_xref()
    document.update_object(xref, f"<< /Type /{CATALOG_KEY} /Version {PROJECT_VERSION} >>")
    document.update_stream(xref, archive, new=1, compress=0)
    document.xref_set_key(document.pdf_catalog(), CATALOG_KEY, f"{xref} 0 R")


def embedded_archive(document: pymupdf.Document) -> bytes | None:
    catalog = document.pdf_catalog()
    if catalog <= 0:
        return None
    kind, value = document.xref_get_key(catalog, CATALOG_KEY)
    if kind != "xref":
        return None
    xref = int(value.split()[0])
    if xref <= 0 or xref >= document.xref_length() or not document.xref_is_stream(xref):
        return None
    raw = document.xref_stream_raw(xref)
    if raw is None:
        return None
    filter_kind, filter_value = document.xref_get_key(xref, "Filter")
    if filter_kind == "null":
        return raw
    if filter_value.replace(" ", "") not in FLATE_FILTERS:
        return None
    inflater = zlib.decompressobj()
    try:
        data = inflater.decompress(raw, MAX_PROJECT_BYTES + 1)
    except zlib.error:
        return None
    if len(data) > MAX_PROJECT_BYTES or inflater.unconsumed_tail:
        raise too_large()
    return data
