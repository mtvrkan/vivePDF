import re
from collections.abc import Callable
from pathlib import Path

import pymupdf
from lxml import etree

from vivepdf.external import libreoffice
from vivepdf.rpc.errors import ErrorCode, OpError

MAX_SVG_BYTES = 50 * 1024 * 1024
DECLARATIONS = re.compile(rb"<!\s*(DOCTYPE|ENTITY)", re.IGNORECASE)
EXTERNAL_URL = re.compile(r"url\(\s*(?!['\"]?\s*#)[^)]*\)", re.IGNORECASE)
IMPORT_RULE = re.compile(r"@import[^;]*;?", re.IGNORECASE)
EMBEDDED_PICTURE = re.compile(r"^data:image/(png|jpe?g|gif|bmp|webp);", re.IGNORECASE)
LINK_TARGET = re.compile(r"^(https?:|mailto:)", re.IGNORECASE)
DROPPED_ELEMENTS = frozenset({"script", "foreignObject", "iframe", "audio", "video"})
ABSOLUTE_LENGTH = re.compile(r"^\s*\d+(\.\d+)?\s*(px|pt|pc|mm|cm|in)?\s*$")


def _refusal(reason: str, message: str, **data: object) -> OpError:
    return OpError(ErrorCode.INVALID_PARAMS, message, {"reason": reason, **data})


def _local(name: object) -> str:
    return etree.QName(name).localname if isinstance(name, str) else ""


def _kept_reference(element_name: str, value: str) -> bool:
    target = value.strip()
    if target.startswith("#") or EMBEDDED_PICTURE.match(target):
        return True
    return element_name == "a" and bool(LINK_TARGET.match(target))


def _clean_element(element: etree._Element) -> None:
    name = _local(element.tag)
    for key in list(element.attrib):
        value = element.attrib[key]
        local = _local(key)
        if local == "href":
            if not _kept_reference(name, value):
                del element.attrib[key]
        elif local.lower().startswith("on"):
            del element.attrib[key]
        elif "url(" in value.lower() or "@import" in value.lower():
            element.attrib[key] = EXTERNAL_URL.sub("none", IMPORT_RULE.sub("", value))
    if name == "style" and element.text:
        element.text = EXTERNAL_URL.sub("none", IMPORT_RULE.sub("", element.text))


def _too_large(name: str) -> OpError:
    return _refusal("svgTooLarge", f"{name} is too large", limitMb=MAX_SVG_BYTES // (1024 * 1024))


def read_svg(source: Path) -> etree._Element:
    if source.stat().st_size > MAX_SVG_BYTES:
        raise _too_large(source.name)
    return _parse_svg(source.read_bytes(), source.name)


def _parse_svg(raw: bytes, name: str) -> etree._Element:
    if DECLARATIONS.search(raw):
        raise _refusal("svgDoctype", f"{name} declares a document type")
    parser = etree.XMLParser(
        resolve_entities=False,
        no_network=True,
        load_dtd=False,
        remove_comments=True,
        remove_pis=True,
    )
    try:
        root = etree.fromstring(raw, parser)
    except etree.XMLSyntaxError as error:
        raise _refusal("notSvg", f"{name} is not a readable SVG file") from error
    if root is None or _local(root.tag) != "svg":
        raise _refusal("notSvg", f"{name} is not an SVG drawing")
    return root


def _clean_tree(root: etree._Element) -> None:
    dropped = [
        element
        for element in root.iter()
        if isinstance(element.tag, str) and _local(element.tag) in DROPPED_ELEMENTS
    ]
    for element in dropped:
        parent = element.getparent()
        if parent is not None:
            parent.remove(element)
    for element in root.iter():
        if isinstance(element.tag, str):
            _clean_element(element)


def sanitized_svg(source: Path, directory: Path) -> Path:
    root = read_svg(source)
    _clean_tree(root)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{source.stem or 'drawing'}.svg"
    etree.ElementTree(root).write(str(target), xml_declaration=True, encoding="utf-8")
    return target


def svg_pdf_bytes(
    source: Path, working: Path, check_cancelled: Callable[[], None] | None = None
) -> bytes:
    clean = sanitized_svg(source, working / "source")
    if libreoffice.find_soffice() is not None:
        produced = libreoffice.convert_to_pdf(clean, working / "office", None, check_cancelled)
        return produced.read_bytes()
    try:
        with pymupdf.open(str(clean)) as document:
            return document.convert_to_pdf()
    except Exception as error:  # noqa: BLE001
        raise _refusal("notSvg", f"{source.name} could not be drawn") from error


def _view_box_size(root: etree._Element) -> tuple[float, float] | None:
    parts = (root.get("viewBox") or "").replace(",", " ").split()
    if len(parts) != 4:
        return None
    try:
        width, height = float(parts[2]), float(parts[3])
    except ValueError:
        return None
    return (width, height) if width > 0 and height > 0 else None


def _absolute_size(root: etree._Element) -> None:
    width, height = root.get("width") or "", root.get("height") or ""
    if ABSOLUTE_LENGTH.match(width) and ABSOLUTE_LENGTH.match(height):
        return
    size = _view_box_size(root)
    if size is None:
        raise _refusal("notSvg", "the drawing has no size")
    root.set("width", f"{size[0]:g}")
    root.set("height", f"{size[1]:g}")


def _zero_width(value: str) -> bool:
    try:
        return float(value.strip().removesuffix("px").removesuffix("pt")) == 0
    except ValueError:
        return False


def _drop_zero_width_strokes(
    element: etree._Element, stroke: str | None = None, width: str = "1"
) -> None:
    stroke = element.get("stroke", stroke)
    width = element.get("stroke-width", width)
    if stroke is not None and stroke != "none":
        if _zero_width(width):
            element.set("stroke", "none")
        elif element.get("stroke") is None:
            element.set("stroke", stroke)
    for child in element:
        if isinstance(child.tag, str):
            _drop_zero_width_strokes(child, stroke, width)


def drawing_pdf(raw: bytes, name: str, opacity: float = 1.0) -> pymupdf.Document:
    if len(raw) > MAX_SVG_BYTES:
        raise _too_large(name)
    root = _parse_svg(raw, name)
    _clean_tree(root)
    _absolute_size(root)
    _drop_zero_width_strokes(root)
    if opacity < 1.0:
        root.set("opacity", f"{max(0.0, opacity):.3f}")
    data = etree.tostring(root, xml_declaration=True, encoding="utf-8")
    try:
        with pymupdf.open(stream=data, filetype="svg") as drawing:
            return pymupdf.open("pdf", drawing.convert_to_pdf())
    except Exception as error:  # noqa: BLE001
        raise _refusal("notSvg", f"{name} could not be drawn") from error
