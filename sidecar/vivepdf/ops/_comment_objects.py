import base64
import binascii
import xml.etree.ElementTree as ElementTree

import pymupdf

from vivepdf.ops._comment_format import (
    SAFE_NAME,
    _Budget,
    _numbers,
)
from vivepdf.ops._comment_xfdf_read import _GuardedBuilder, _local
from vivepdf.ops._pdf_syntax import (
    PdfName,
    PdfRef,
    PdfStream,
    PdfString,
    is_page_object,
    make_string,
    serialize,
    write_object,
)
from vivepdf.rpc.errors import OpError


def _node_value(node: ElementTree.Element, budget: _Budget) -> object:
    budget.spend()
    tag = _local(node.tag).upper()
    value = node.get("VAL", "")
    if tag == "DICT":
        return {
            child.get("KEY", ""): _node_value(child, budget)
            for child in node
            if child.get("KEY") and _local(child.tag).upper() != "DATA"
        }
    if tag == "ARRAY":
        return [_node_value(child, budget) for child in node]
    if tag == "STREAM":
        dictionary: dict[str, object] = {}
        data = b""
        filtered = False
        for child in node:
            if _local(child.tag).upper() == "DATA":
                data, filtered = _stream_data(child)
            elif child.get("KEY"):
                dictionary[child.get("KEY", "")] = _node_value(child, budget)
        return PdfStream(dictionary, data, filtered=filtered)
    if tag == "NAME":
        return PdfName(SAFE_NAME.sub("", value) or "None")
    if tag == "INT":
        numbers = _numbers(value)
        return int(numbers[0]) if numbers else 0
    if tag == "FIXED":
        numbers = _numbers(value)
        return numbers[0] if numbers else 0.0
    if tag == "BOOL":
        return value.strip().lower() == "true"
    if tag == "STRING":
        if node.get("ENCODING", "").upper() == "HEX":
            try:
                return make_string(bytes.fromhex("".join(value.split())))
            except ValueError:
                return make_string(b"")
        return PdfString(value)
    return None


def _stream_data(node: ElementTree.Element) -> tuple[bytes, bool]:
    text = "".join(node.itertext())
    encoding = node.get("ENCODING", "ASCII").upper()
    mode = node.get("MODE", "").upper()
    try:
        if encoding == "HEX":
            data = bytes.fromhex("".join(text.split()))
        elif encoding == "BASE64":
            data = base64.b64decode("".join(text.split()))
        else:
            data = text.encode("latin-1", errors="replace")
    except (ValueError, binascii.Error):
        return b"", True
    filtered = mode == "FILTERED" or (mode != "RAW" and encoding != "HEX")
    return data, filtered


def _parse_appearance(text: str | None) -> dict | None:
    if not text or not text.strip():
        return None
    try:
        payload = base64.b64decode("".join(text.split()))
    except (ValueError, binascii.Error):
        return None
    parser = ElementTree.XMLParser(target=_GuardedBuilder())
    try:
        parser.feed(payload)
        root = parser.close()
        tree = _node_value(root, _Budget())
    except (ElementTree.ParseError, OpError, ValueError):
        return None
    return tree if isinstance(tree, dict) and tree else None


def _materialize(
    document: pymupdf.Document,
    value: object,
    objects: dict[int, object],
    created: dict[int, int],
    budget: _Budget,
) -> object:
    budget.spend()
    if isinstance(value, PdfRef):
        if value.number in created:
            return PdfRef(created[value.number])
        target = objects.get(value.number)
        if target is None or is_page_object(target):
            return None
        xref = document.get_new_xref()
        created[value.number] = xref
        if isinstance(target, PdfStream):
            dictionary = _materialize(document, target.dictionary, objects, created, budget)
            write_object(document, xref, PdfStream(dictionary, target.data, target.filtered))
        else:
            write_object(document, xref, _materialize(document, target, objects, created, budget))
        return PdfRef(xref)
    if isinstance(value, PdfStream):
        dictionary = _materialize(document, value.dictionary, objects, created, budget)
        xref = document.get_new_xref()
        write_object(document, xref, PdfStream(dictionary, value.data, value.filtered))
        return PdfRef(xref)
    if isinstance(value, dict):
        return {
            key: _materialize(document, item, objects, created, budget)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_materialize(document, item, objects, created, budget) for item in value]
    return value


def _set_appearance(document: pymupdf.Document, xref: int, appearance: dict) -> bool:
    try:
        built = _materialize(document, appearance, {}, {}, _Budget())
    except (ValueError, RuntimeError):
        return False
    document.xref_set_key(xref, "AP", serialize(built).decode("latin-1"))
    return True


def _append_annotation(document: pymupdf.Document, page: pymupdf.Page, xref: int) -> None:
    existing = [item[0] for item in page.annot_xrefs()]
    listing = " ".join(f"{number} 0 R" for number in [*existing, xref])
    document.xref_set_key(page.xref, "Annots", f"[{listing}]")
