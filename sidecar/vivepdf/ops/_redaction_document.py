import re

import pymupdf

from vivepdf.ops._marked_content import decode_text, scrub_marked_content
from vivepdf.ops._redaction import Scrubber, _scrub_string_key

METADATA_KEYS = ("title", "author", "subject", "keywords", "creator", "producer")
STANDARD_INFO_KEYS = frozenset(
    {
        "Title",
        "Author",
        "Subject",
        "Keywords",
        "Creator",
        "Producer",
        "CreationDate",
        "ModDate",
        "Trapped",
    }
)
STRUCTURE_TEXT_KEYS = ("Alt", "ActualText", "E", "T")
PROPERTY_TEXT_KEYS = ("Alt", "ActualText")
UTF16_MARK = b"\xfe\xff"
LABEL_KEYS = (b"/P",)
OBJECT_REFERENCE = re.compile(r"(\d+)\s+\d+\s+R\b")
ACTION_TRIGGERS = (
    "E",
    "X",
    "D",
    "U",
    "Fo",
    "Bl",
    "PO",
    "PC",
    "PV",
    "PI",
    "O",
    "C",
    "K",
    "F",
    "V",
    "WC",
    "WS",
    "DS",
    "WP",
    "DP",
)
SCRIPT_PATHS = ("JS", "A/JS", "OpenAction/JS", *(f"AA/{trigger}/JS" for trigger in ACTION_TRIGGERS))


def scrub_document(document: pymupdf.Document, scrub: Scrubber) -> int:
    count = 0
    metadata = document.metadata or {}
    changed = {
        key: scrub(str(metadata.get(key) or ""))
        for key in METADATA_KEYS
        if scrub(str(metadata.get(key) or "")) != str(metadata.get(key) or "")
    }
    if changed:
        kept = {key: str(metadata.get(key) or "") for key in METADATA_KEYS}
        for key in ("creationDate", "modDate"):
            if metadata.get(key):
                kept[key] = str(metadata[key])
        document.set_metadata({**kept, **changed})
        count += len(changed)
    xml = document.get_xml_metadata()
    if xml and scrub(xml) != xml:
        document.del_xml_metadata()
        count += 1
    for position, entry in enumerate(document.get_toc(simple=True)):
        title = str(entry[1])
        cleaned_title = scrub(title)
        if cleaned_title != title:
            document.set_toc_item(position, title=cleaned_title)
            count += 1
    count += _scrub_custom_info(document, scrub)
    count += _scrub_structure(document, scrub)
    count += _scrub_embedded_files(document, scrub)
    count += _scrub_layers(document, scrub)
    count += _scrub_page_labels(document, scrub)
    count += _scrub_objects(document, scrub)
    return count


def _scrub_custom_info(document: pymupdf.Document, scrub: Scrubber) -> int:
    kind, value = document.xref_get_key(-1, "Info")
    if kind != "xref":
        return 0
    info_xref = int(value.split()[0])
    return sum(
        1
        for key in document.xref_get_keys(info_xref)
        if key not in STANDARD_INFO_KEYS and _scrub_string_key(document, info_xref, key, scrub)
    )


def _scrub_structure(document: pymupdf.Document, scrub: Scrubber) -> int:
    if document.xref_get_key(document.pdf_catalog(), "StructTreeRoot")[0] == "null":
        return 0
    count = 0
    for xref in range(1, document.xref_length()):
        if document.xref_get_key(xref, "S")[0] != "name":
            continue
        if document.xref_get_key(xref, "P")[0] != "xref":
            continue
        for key in STRUCTURE_TEXT_KEYS:
            if _scrub_string_key(document, xref, key, scrub):
                count += 1
    return count


def _scrub_embedded_files(document: pymupdf.Document, scrub: Scrubber) -> int:
    count = 0
    for name in document.embfile_names():
        info = document.embfile_info(name)
        details = {
            "filename": str(info.get("filename") or ""),
            "ufilename": str(info.get("ufilename") or ""),
            "desc": str(info.get("description") or ""),
        }
        cleaned = {field: scrub(value) for field, value in details.items()}
        cleaned_name = scrub(name)
        if cleaned_name != name:
            content = document.embfile_get(name)
            document.embfile_del(name)
            taken = set(document.embfile_names())
            unique = cleaned_name
            suffix = 2
            while unique in taken:
                unique = f"{cleaned_name} ({suffix})"
                suffix += 1
            document.embfile_add(unique, content, **cleaned)
            count += 1
        elif cleaned != details:
            document.embfile_upd(name, **cleaned)
            count += 1
    return count


def _scrub_layers(document: pymupdf.Document, scrub: Scrubber) -> int:
    return sum(
        1 for xref in document.get_ocgs() if _scrub_string_key(document, xref, "Name", scrub)
    )


def _scrub_page_labels(document: pymupdf.Document, scrub: Scrubber) -> int:
    return _scrub_label_node(document, document.pdf_catalog(), "PageLabels/", scrub, set())


def _scrub_label_node(
    document: pymupdf.Document, xref: int, path: str, scrub: Scrubber, seen: set[int]
) -> int:
    count = 0
    kind, value = document.xref_get_key(xref, path + "Nums")
    if kind == "array":
        try:
            raw = value.encode("latin-1")
        except UnicodeEncodeError:
            raw = b""
        cleaned, changed = scrub_marked_content(raw, scrub, LABEL_KEYS)
        if changed:
            document.xref_set_key(xref, path + "Nums", cleaned.decode("latin-1"))
            count += changed
        count += sum(
            1
            for reference in OBJECT_REFERENCE.findall(value)
            if _scrub_string_key(document, int(reference), "P", scrub)
        )
    kind, value = document.xref_get_key(xref, path + "Kids")
    if kind == "array":
        for reference in OBJECT_REFERENCE.findall(value):
            child = int(reference)
            if child not in seen:
                seen.add(child)
                count += _scrub_label_node(document, child, "", scrub, seen)
    return count


def _scrub_script_stream(document: pymupdf.Document, xref: int, scrub: Scrubber) -> bool:
    raw = document.xref_stream(xref) or b""
    text = decode_text(raw)
    cleaned = scrub(text)
    if cleaned == text:
        return False
    document.update_stream(xref, _script_bytes(cleaned, raw.startswith(UTF16_MARK)))
    return True


def _script_bytes(text: str, wide: bool) -> bytes:
    if not wide:
        try:
            return text.encode("latin-1")
        except UnicodeEncodeError:
            pass
    return UTF16_MARK + text.encode("utf-16-be")


def _scrub_scripts(document: pymupdf.Document, xref: int, scrub: Scrubber) -> int:
    count = 0
    for path in SCRIPT_PATHS:
        kind, value = document.xref_get_key(xref, path)
        if kind == "string":
            count += _scrub_string_key(document, xref, path, scrub)
        elif kind == "xref" and _scrub_script_stream(document, int(value.split()[0]), scrub):
            count += 1
    return count


def _is_content_stream(document: pymupdf.Document, xref: int) -> bool:
    if document.xref_get_key(xref, "Subtype") == ("name", "/Form"):
        return True
    return document.xref_get_key(xref, "PatternType") == ("int", "1")


def _scrub_content_stream(document: pymupdf.Document, xref: int, scrub: Scrubber) -> int:
    data = document.xref_stream(xref)
    if not data:
        return 0
    cleaned, count = scrub_marked_content(data, scrub)
    if count:
        document.update_stream(xref, cleaned)
    return count


def _scrub_objects(document: pymupdf.Document, scrub: Scrubber) -> int:
    count = 0
    contents = {xref for page in document for xref in page.get_contents()}
    for xref in range(1, document.xref_length()):
        if document.xref_is_stream(xref):
            if xref in contents or _is_content_stream(document, xref):
                count += _scrub_content_stream(document, xref, scrub)
            continue
        if "/JS" in document.xref_object(xref, compressed=True):
            count += _scrub_scripts(document, xref, scrub)
        count += sum(
            1 for key in PROPERTY_TEXT_KEYS if _scrub_string_key(document, xref, key, scrub)
        )
    return count
