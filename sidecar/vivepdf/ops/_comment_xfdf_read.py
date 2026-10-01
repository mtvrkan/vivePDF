import re
import xml.etree.ElementTree as ElementTree
from pathlib import Path

import pymupdf

from vivepdf.ops._comment_format import (
    CLOUDY,
    ENDING_TAGS,
    FLAG_NAMES,
    MARKUP_TAGS,
    MAX_CLOUD_INTENSITY,
    MAX_DASHES,
    MAX_XFDF_BYTES,
    SAFE_NAME,
    STYLE_KEYS,
    TAG_SUBTYPES,
    _format,
    _numbers,
)
from vivepdf.rpc.errors import ErrorCode, OpError


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


class _GuardedBuilder(ElementTree.TreeBuilder):
    def doctype(self, name: str, pubid: str | None, system: str | None) -> None:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the comment file declares a document type",
            {"reason": "commentFileDoctype"},
        )


def _read_source(path: Path) -> bytes:
    if not path.is_file():
        raise OpError(ErrorCode.FILE_NOT_FOUND, "comment file not found", {"path": str(path)})
    if path.stat().st_size > MAX_XFDF_BYTES:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the comment file is too large",
            {"reason": "commentFileTooLarge", "limitMb": MAX_XFDF_BYTES // (1024 * 1024)},
        )
    return path.read_bytes()


def _parse_xfdf(raw: bytes) -> ElementTree.Element:
    parser = ElementTree.XMLParser(target=_GuardedBuilder())
    try:
        parser.feed(raw)
        root = parser.close()
    except ElementTree.ParseError as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"not an XFDF file: {error}", {"reason": "notXfdf"}
        ) from error
    if _local(root.tag) != "xfdf":
        raise OpError(ErrorCode.INVALID_PARAMS, "not an XFDF file", {"reason": "notXfdf"})
    return root


def _child_text(element: ElementTree.Element, name: str) -> str | None:
    for child in element:
        if _local(child.tag) == name:
            return "".join(child.itertext())
    return None


def _child(element: ElementTree.Element, name: str) -> ElementTree.Element | None:
    for child in element:
        if _local(child.tag) == name:
            return child
    return None


def _pdf_color(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip().lstrip("#")
    if not re.fullmatch(r"[0-9A-Fa-f]{6}", text):
        return None
    channels = [int(text[index : index + 2], 16) / 255 for index in (0, 2, 4)]
    return "[" + " ".join(_format(channel) for channel in channels) + "]"


def _pdf_array(values: list[float]) -> str:
    return "[" + " ".join(_format(value) for value in values) + "]"


def _flags_value(value: str | None) -> int | None:
    if not value:
        return None
    lookup = {name: bit for bit, name in FLAG_NAMES}
    total = 0
    for part in value.split(","):
        total |= lookup.get(part.strip().lower(), 0)
    return total


def _border_entries(element: ElementTree.Element) -> list[str]:
    entries: list[str] = []
    width = _numbers(element.get("width", ""))
    if width:
        entries.append(f"/W {_format(max(0.0, width[0]))}")
    style = element.get("style", "").strip().lower()
    dashes = [max(0.0, value) for value in _numbers(element.get("dashes", ""))][:MAX_DASHES]
    if not any(dashes):
        dashes = []
    key = STYLE_KEYS.get(style) or ("D" if dashes and style != CLOUDY else None)
    if key:
        entries.append(f"/S /{key}")
    if dashes:
        entries.append(f"/D {_pdf_array(dashes)}")
    parts = ["/BS << " + " ".join(entries) + " >>"] if entries else []
    if style == CLOUDY:
        intensity = _numbers(element.get("intensity", "")) or [1.0]
        level = max(0.0, min(MAX_CLOUD_INTENSITY, intensity[0]))
        parts.append(f"/BE << /S /C /I {_format(level)} >>")
    return parts


def _annotation_object(element: ElementTree.Element, page: pymupdf.Page) -> str | None:
    tag = _local(element.tag)
    subtype = TAG_SUBTYPES.get(tag)
    rect = _numbers(element.get("rect", ""))
    if subtype is None or len(rect) != 4:
        return None
    parts = [
        "/Type /Annot",
        f"/Subtype /{subtype}",
        f"/Rect {_pdf_array(rect)}",
        f"/P {page.xref} 0 R",
    ]
    for attribute, key in (
        ("title", "T"),
        ("subject", "Subj"),
        ("date", "M"),
        ("creationdate", "CreationDate"),
        ("name", "NM"),
        ("state", "State"),
        ("statemodel", "StateModel"),
    ):
        value = element.get(attribute)
        if value:
            parts.append(f"/{key} {pymupdf.get_pdf_str(value)}")
    contents = _child_text(element, "contents")
    if contents:
        parts.append(f"/Contents {pymupdf.get_pdf_str(contents)}")
    color = _pdf_color(element.get("color"))
    if color:
        parts.append(f"/C {color}")
    interior = _pdf_color(element.get("interior-color"))
    if interior:
        parts.append(f"/IC {interior}")
    flags = _flags_value(element.get("flags"))
    parts.append(f"/F {flags if flags is not None else 4}")
    opacity = _numbers(element.get("opacity", ""))
    if opacity:
        parts.append(f"/CA {_format(max(0.0, min(1.0, opacity[0])))}")
    parts.extend(_border_entries(element))
    icon = SAFE_NAME.sub("", element.get("icon", ""))
    if icon and tag in ("text", "stamp"):
        parts.append(f"/Name /{icon}")
    if tag in MARKUP_TAGS:
        quads = _numbers(element.get("coords", ""))
        if len(quads) < 8:
            x0, y0, x1, y1 = rect
            quads = [x0, y1, x1, y1, x0, y0, x1, y0]
        parts.append(f"/QuadPoints {_pdf_array(quads[: len(quads) // 8 * 8])}")
    if tag == "line":
        start = _numbers(element.get("start", ""))
        end = _numbers(element.get("end", ""))
        if len(start) != 2 or len(end) != 2:
            return None
        parts.append(f"/L {_pdf_array(start + end)}")
    if tag in ENDING_TAGS:
        head = SAFE_NAME.sub("", element.get("head", ""))
        tail = SAFE_NAME.sub("", element.get("tail", ""))
        if head or tail:
            parts.append(f"/LE [/{head or 'None'} /{tail or 'None'}]")
    if tag == "ink":
        inklist = _child(element, "inklist")
        strokes = [
            _numbers("".join(gesture.itertext()))
            for gesture in (inklist if inklist is not None else [])
            if _local(gesture.tag) == "gesture"
        ]
        strokes = [stroke[: len(stroke) // 2 * 2] for stroke in strokes if len(stroke) >= 2]
        if not strokes:
            return None
        parts.append("/InkList [" + "".join(_pdf_array(stroke) for stroke in strokes) + "]")
    if tag in ("polygon", "polyline"):
        vertices = _numbers(_child_text(element, "vertices") or "")
        if len(vertices) < 4:
            return None
        parts.append(f"/Vertices {_pdf_array(vertices[: len(vertices) // 2 * 2])}")
    if tag == "freetext":
        appearance = _child_text(element, "defaultappearance") or "/Helv 12 Tf 0 g"
        parts.append(f"/DA {pymupdf.get_pdf_str(appearance)}")
    return "<< " + " ".join(parts) + " >>"
