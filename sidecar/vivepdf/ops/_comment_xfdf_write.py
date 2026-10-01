import base64
import re
import xml.etree.ElementTree as ElementTree
from pathlib import Path

import pymupdf

from vivepdf.ops._comment_format import (
    APPEARANCE_TAGS,
    BORDER_STYLES,
    CLOUDY,
    ENDING_TAGS,
    MARKUP_TAGS,
    PRINTABLE,
    SUBTYPE_TAGS,
    XFDF_NAMESPACE,
    _annotation_name,
    _Budget,
    _flag_names,
    _format,
    _hex_color,
    _joined,
    _numbers,
    _pairs,
    _raw,
    _raw_numbers,
)
from vivepdf.ops._pdf_syntax import (
    PdfKeyword,
    PdfName,
    PdfRef,
    PdfStream,
    PdfString,
    is_page_object,
    load_object,
)


def _set_optional(element: ElementTree.Element, key: str, value: str | None) -> None:
    if value:
        element.set(key, value)


def _border_attributes(document: pymupdf.Document, xref: int) -> dict[str, str]:
    attributes: dict[str, str] = {}
    kind, value = _raw(document, xref, "BS/S")
    style = BORDER_STYLES.get(value.lstrip("/")) if kind == "name" else None
    if style:
        attributes["style"] = style
    dashes = _raw_numbers(document, xref, "BS/D")
    if dashes:
        attributes["dashes"] = _joined(dashes)
    kind, value = _raw(document, xref, "BE/S")
    if kind == "name" and value.lstrip("/") == "C":
        attributes["style"] = CLOUDY
        kind, value = _raw(document, xref, "BE/I")
        if kind in ("real", "int"):
            attributes["intensity"] = _format(float(value))
    return attributes


def _export_element(
    document: pymupdf.Document,
    page_index: int,
    annot: pymupdf.Annot,
    names: dict[int, str],
) -> ElementTree.Element | None:
    tag = SUBTYPE_TAGS.get(annot.type[1])
    if tag is None:
        return None
    xref = annot.xref
    rect = _raw_numbers(document, xref, "Rect")
    if not rect or len(rect) != 4:
        return None
    info = annot.info or {}
    element = ElementTree.Element(tag)
    element.set("page", str(page_index))
    element.set("rect", _joined(rect))
    element.set("name", names[xref])
    _set_optional(element, "title", str(info.get("title") or ""))
    _set_optional(element, "subject", str(info.get("subject") or ""))
    _set_optional(element, "date", str(info.get("modDate") or ""))
    _set_optional(element, "creationdate", str(info.get("creationDate") or ""))
    _set_optional(element, "color", _hex_color(_raw_numbers(document, xref, "C")))
    _set_optional(element, "interior-color", _hex_color(_raw_numbers(document, xref, "IC")))
    kind, value = _raw(document, xref, "F")
    if kind == "int":
        _set_optional(element, "flags", _flag_names(int(value)))
    kind, value = _raw(document, xref, "CA")
    if kind in ("real", "int"):
        element.set("opacity", _format(float(value)))
    kind, value = _raw(document, xref, "BS/W")
    if kind in ("real", "int"):
        element.set("width", _format(float(value)))
    for key, border in _border_attributes(document, xref).items():
        element.set(key, border)
    for attribute, key in (("state", "State"), ("statemodel", "StateModel")):
        kind, value = _raw(document, xref, key)
        if kind == "string" and value:
            element.set(attribute, value)
    kind, value = _raw(document, xref, "Name")
    if kind == "name":
        element.set("icon", value.lstrip("/"))
    kind, value = _raw(document, xref, "IRT")
    if kind == "xref":
        target = int(value.split()[0])
        if target in names:
            element.set("inreplyto", names[target])
    if tag in MARKUP_TAGS:
        quads = _raw_numbers(document, xref, "QuadPoints")
        if quads:
            element.set("coords", _joined(quads))
    if tag == "line":
        points = _raw_numbers(document, xref, "L")
        if points and len(points) == 4:
            element.set("start", _joined(points[:2]))
            element.set("end", _joined(points[2:]))
    if tag in ENDING_TAGS:
        kind, value = _raw(document, xref, "LE")
        if kind == "array":
            endings = re.findall(r"/([A-Za-z]+)", value)
            if len(endings) == 2:
                element.set("head", endings[0])
                element.set("tail", endings[1])
    if tag == "ink":
        kind, value = _raw(document, xref, "InkList")
        if kind == "array":
            inklist = ElementTree.SubElement(element, "inklist")
            for stroke in re.findall(r"\[([^\[\]]*)\]", value[1:-1]):
                ElementTree.SubElement(inklist, "gesture").text = _pairs(_numbers(stroke))
    if tag in ("polygon", "polyline"):
        vertices = _raw_numbers(document, xref, "Vertices")
        if vertices:
            ElementTree.SubElement(element, "vertices").text = _pairs(vertices)
    if tag == "freetext":
        kind, value = _raw(document, xref, "DA")
        if kind == "string" and value:
            ElementTree.SubElement(element, "defaultappearance").text = value
    content = str(info.get("content") or "")
    if content:
        ElementTree.SubElement(element, "contents").text = content
    if tag in APPEARANCE_TAGS:
        appearance = _appearance_text(document, xref)
        if appearance:
            ElementTree.SubElement(element, "appearance").text = appearance
    return element


def _resolved_tree(
    document: pymupdf.Document, value: object, path: tuple[int, ...], budget: _Budget
) -> object:
    budget.spend()
    if isinstance(value, PdfRef):
        if value.number in path or not 0 < value.number < document.xref_length():
            return None
        loaded = load_object(document, value.number)
        if is_page_object(loaded):
            return None
        inner = (*path, value.number)
        if isinstance(loaded, PdfStream):
            decoded = document.xref_stream(value.number) or b""
            dictionary = _resolved_tree(document, loaded.dictionary, inner, budget)
            if len(decoded) < 4 * 1024 * 1024 and set(decoded) <= PRINTABLE:
                return PdfStream(dictionary, decoded, filtered=True)
            return PdfStream(dictionary, loaded.data)
        return _resolved_tree(document, loaded, inner, budget)
    if isinstance(value, dict):
        return {key: _resolved_tree(document, item, path, budget) for key, item in value.items()}
    if isinstance(value, list):
        return [_resolved_tree(document, item, path, budget) for item in value]
    return value


def _appearance_node(parent: ElementTree.Element, key: str | None, value: object) -> None:
    def add(tag: str, **attributes: str) -> ElementTree.Element:
        element = ElementTree.SubElement(parent, tag)
        if key is not None:
            element.set("KEY", key)
        for name, text in attributes.items():
            element.set(name, text)
        return element

    if isinstance(value, PdfStream):
        stream = add("STREAM")
        for name, item in value.dictionary.items():
            if name == "Length" or (value.filtered and name in ("Filter", "DecodeParms")):
                continue
            _appearance_node(stream, name, item)
        ElementTree.SubElement(stream, "INT", {"KEY": "Length", "VAL": str(len(value.data))})
        if value.filtered:
            data = ElementTree.SubElement(stream, "DATA", {"MODE": "FILTERED", "ENCODING": "ASCII"})
            data.text = value.data.decode("ascii")
        else:
            data = ElementTree.SubElement(stream, "DATA", {"MODE": "RAW", "ENCODING": "HEX"})
            data.text = value.data.hex().upper()
    elif isinstance(value, dict):
        holder = add("DICT")
        for name, item in value.items():
            _appearance_node(holder, name, item)
    elif isinstance(value, list):
        holder = add("ARRAY")
        for item in value:
            _appearance_node(holder, None, item)
    elif isinstance(value, bool):
        add("BOOL", VAL="true" if value else "false")
    elif isinstance(value, PdfName):
        add("NAME", VAL=str(value))
    elif isinstance(value, PdfKeyword):
        return
    elif isinstance(value, PdfString) and value.raw and not set(value.raw) <= PRINTABLE:
        add("STRING", VAL=value.raw.hex().upper(), ENCODING="HEX")
    elif isinstance(value, str):
        add("STRING", VAL=str(value))
    elif isinstance(value, int):
        add("INT", VAL=str(value))
    elif isinstance(value, float):
        add("FIXED", VAL=_format(value))
    else:
        add("NULL")


def _appearance_text(document: pymupdf.Document, xref: int) -> str | None:
    kind, _value = _raw(document, xref, "AP")
    if kind not in ("dict", "xref"):
        return None
    try:
        source = load_object(document, xref)
        appearance = source.get("AP") if isinstance(source, dict) else None
        tree = _resolved_tree(document, appearance, (xref,), _Budget())
    except (ValueError, RuntimeError):
        return None
    if not isinstance(tree, dict) or not tree:
        return None
    root = ElementTree.Element("DICT", {"KEY": "AP"})
    for name, item in tree.items():
        _appearance_node(root, name, item)
    payload = b'<?xml version="1.0" encoding="UTF-8" ?>' + ElementTree.tostring(
        root, encoding="utf-8", xml_declaration=False
    )
    return base64.b64encode(payload).decode("ascii")


def write_xfdf(
    document: pymupdf.Document,
    source_name: str,
    target: Path,
    xrefs: set[int],
    companions: set[int] | None = None,
) -> int:
    companions = companions or set()
    ElementTree.register_namespace("", XFDF_NAMESPACE)
    root = ElementTree.Element(f"{{{XFDF_NAMESPACE}}}xfdf")
    root.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    ElementTree.SubElement(root, "f").set("href", source_name)
    annots = ElementTree.SubElement(root, "annots")
    names: dict[int, str] = {}
    for page in document:
        for annot in page.annots():
            names[annot.xref] = _annotation_name(document, annot.xref)
    count = 0
    for page in document:
        for annot in page.annots():
            if annot.xref not in xrefs and annot.xref not in companions:
                continue
            element = _export_element(document, page.number, annot, names)
            if element is not None:
                annots.append(element)
                count += annot.xref not in companions
    for element in root.iter():
        if element is not root and not element.tag.startswith("{"):
            element.tag = f"{{{XFDF_NAMESPACE}}}{element.tag}"
    tree = ElementTree.ElementTree(root)
    ElementTree.indent(tree, space="  ")
    tree.write(target, encoding="UTF-8", xml_declaration=True)
    return count
