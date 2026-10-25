import base64
import copy
import re
from collections.abc import Callable
from pathlib import Path
from urllib.parse import unquote, urlsplit
from urllib.request import url2pathname

import pymupdf
from lxml import etree

from vivepdf.external import libreoffice
from vivepdf.ops._image_files import open_picture
from vivepdf.rpc.errors import ErrorCode, OpError

MAX_SVG_BYTES = 50 * 1024 * 1024
DECLARATIONS = re.compile(rb"<!\s*(DOCTYPE|ENTITY)", re.IGNORECASE)
PLAIN_DOCTYPE = re.compile(rb"<!DOCTYPE\s+svg\s+(?:PUBLIC|SYSTEM)\b[^\[\]<>]*>", re.IGNORECASE)
EXTERNAL_URL = re.compile(r"url\(\s*(?!['\"]?\s*#)[^)]*\)", re.IGNORECASE)
IMPORT_RULE = re.compile(r"@import[^;]*;?", re.IGNORECASE)
EMBEDDED_PICTURE = re.compile(r"^data:image/(png|jpe?g|gif|bmp|webp);", re.IGNORECASE)
LINK_TARGET = re.compile(r"^(https?:|mailto:)", re.IGNORECASE)
DROPPED_ELEMENTS = frozenset({"script", "foreignObject", "iframe", "audio", "video"})
ABSOLUTE_NUMBER = re.compile(r"\d+(?:\.\d+)?")
MAX_STYLE_RULES = 2000
SIMPLE_SELECTOR = re.compile(r"^([A-Za-z][\w-]*|\*)?(?:#([\w-]+))?((?:\.[\w-]+)*)$")
USE_POSITION = frozenset({"href", "x", "y", "width", "height"})
SYMBOL_PLACEMENT = frozenset({"id", "x", "y", "width", "height"})
MAX_SYMBOL_PASSES = 8
MAX_SVG_LINKS = 200
DRAWN_ELEMENTS = frozenset(
    {"path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "image", "use"}
)
DEFINITION_ELEMENTS = frozenset({"defs", "symbol", "clipPath", "mask", "pattern", "marker"})
MAX_EXPANDED_ELEMENTS = 200_000
ABSOLUTE_LENGTH = re.compile(r"^\s*\d+(\.\d+)?\s*(px|pt|pc|mm|cm|in)?\s*$")
LINKED_PICTURE_TYPES = {"PNG": "png", "JPEG": "jpeg", "GIF": "gif", "BMP": "bmp", "WEBP": "webp"}
MAX_LINKED_PICTURE_BYTES = 20 * 1024 * 1024
WINDOWS_DRIVE = re.compile(r"^[A-Za-z]:[\\/]")
HIDING_PROPERTIES = ("display", "visibility", "opacity")
LOCAL_REFERENCE = re.compile(r"(?:url\(\s*['\"]?\s*#|^\s*#)([^)'\"\s]+)")
CSS_PIXELS = {
    "": 1.0,
    "px": 1.0,
    "pt": 4 / 3,
    "pc": 16.0,
    "mm": 96 / 25.4,
    "cm": 96 / 2.54,
    "in": 96.0,
}
POINTS_PER_CSS_PIXEL = 0.75


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
    raw = PLAIN_DOCTYPE.sub(b"", raw, count=1)
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
    _expand_symbols(root)
    _drop_hidden(root)


def _declaration(body: str, name: str) -> str | None:
    found = None
    for declaration in body.split(";"):
        key, colon, value = declaration.partition(":")
        if colon and key.strip().lower() == name:
            found = value.replace("!important", "").strip()
    return found or None


def _declared(element: etree._Element, name: str, rules: list[tuple[str, str]]) -> str | None:
    value = element.get(name)
    for selector, body in rules:
        if _selector_matches(selector, element):
            value = _declaration(body, name) or value
    value = _declaration(element.get("style") or "", name) or value
    return value.strip().lower() if value else None


def _transparent(value: str | None) -> bool:
    try:
        return value is not None and float(value.removesuffix("%")) == 0
    except ValueError:
        return False


def _referenced_ids(root: etree._Element) -> set[str]:
    referenced: set[str] = set()
    for element in root.iter():
        if isinstance(element.tag, str):
            for value in element.attrib.values():
                referenced.update(LOCAL_REFERENCE.findall(value))
    return referenced


def _hiding_rules(root: etree._Element) -> list[tuple[str, str]]:
    sheets = "\n".join(
        element.text or ""
        for element in root.iter()
        if isinstance(element.tag, str) and _local(element.tag) == "style"
    )
    return [
        (selector, body)
        for _, _, selector, body in _stylesheet_rules(sheets)
        if any(name in body.lower() for name in HIDING_PROPERTIES)
    ]


def _drop_hidden(root: etree._Element) -> None:
    rules = _hiding_rules(root)
    referenced = _referenced_ids(root)
    stack = [(root, False)]
    while stack:
        element, hidden = stack.pop()
        for child in list(element):
            name = _local(child.tag)
            if not isinstance(child.tag, str) or name in DEFINITION_ELEMENTS or name == "style":
                continue
            if child.get("id") in referenced:
                continue
            if _declared(child, "display", rules) == "none" or _transparent(
                _declared(child, "opacity", rules)
            ):
                element.remove(child)
                continue
            visibility = _declared(child, "visibility", rules)
            child_hidden = (
                hidden if visibility in (None, "inherit") else visibility in ("hidden", "collapse")
            )
            shown_inside = any(
                _declared(inner, "visibility", rules) == "visible"
                for inner in child.iterdescendants()
                if isinstance(inner.tag, str)
            )
            if child_hidden and name in DRAWN_ELEMENTS and not shown_inside:
                element.remove(child)
                continue
            stack.append((child, child_hidden))


def _href(element: etree._Element) -> str:
    return next((value for key, value in element.attrib.items() if _local(key) == "href"), "")


def _plain_number(value: str) -> float | None:
    try:
        return float(value.strip().removesuffix("px"))
    except ValueError:
        return None


def _symbol_instance(use: etree._Element, symbol: etree._Element) -> etree._Element:
    namespace = etree.QName(symbol.tag).namespace
    group = etree.Element(etree.QName(namespace, "g") if namespace else "g")
    for key, value in use.attrib.items():
        if _local(key) not in USE_POSITION:
            group.set(key, value)
    viewport = etree.SubElement(group, etree.QName(namespace, "svg") if namespace else "svg")
    for key, value in symbol.attrib.items():
        if _local(key) not in SYMBOL_PLACEMENT:
            viewport.set(key, value)
    offset = [_plain_number(use.get(key) or "0") for key in ("x", "y")]
    if None in offset:
        for key in ("x", "y"):
            if use.get(key):
                viewport.set(key, use.get(key))
    elif any(offset):
        moved = f"translate({offset[0]:g} {offset[1]:g})"
        group.set("transform", f"{use.get('transform', '')} {moved}".strip())
    for key in ("width", "height"):
        viewport.set(key, use.get(key) or symbol.get(key) or "100%")
    viewport.extend(copy.deepcopy(child) for child in symbol)
    group.tail = use.tail
    return group


def _expand_symbols(root: etree._Element) -> None:
    symbols = {
        element.get("id"): element
        for element in root.iter()
        if isinstance(element.tag, str) and _local(element.tag) == "symbol" and element.get("id")
    }
    if not symbols:
        return
    budget = MAX_EXPANDED_ELEMENTS
    for _ in range(MAX_SYMBOL_PASSES):
        uses = [
            (element, symbols[_href(element).strip()[1:]])
            for element in root.iter()
            if isinstance(element.tag, str)
            and _local(element.tag) == "use"
            and _href(element).strip()[1:] in symbols
            and _href(element).strip().startswith("#")
        ]
        if not uses:
            return
        for use, symbol in uses:
            parent = use.getparent()
            size = sum(1 for _ in symbol.iter())
            if parent is None or size > budget:
                return
            budget -= size
            parent.replace(use, _symbol_instance(use, symbol))


def _linked_file(reference: str, folder: Path) -> Path | None:
    target = reference.strip()
    if not target or target.startswith("#"):
        return None
    if WINDOWS_DRIVE.match(target):
        path = Path(target)
    else:
        parts = urlsplit(target)
        if parts.scheme == "file":
            path = Path(url2pathname(parts.path))
        elif parts.scheme or parts.netloc:
            return None
        else:
            path = Path(unquote(parts.path))
    try:
        resolved = (folder / path).resolve()
    except (OSError, ValueError):
        return None
    if resolved.parent != folder or not resolved.is_file():
        return None
    return resolved


def _picture_uri(path: Path) -> str | None:
    try:
        if path.stat().st_size > MAX_LINKED_PICTURE_BYTES:
            return None
        with open_picture(path) as picture:
            kind = LINKED_PICTURE_TYPES.get(picture.format or "")
        if kind is None:
            return None
        return f"data:image/{kind};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"
    except (OSError, ValueError, OpError):
        return None


def _embed_neighbour_pictures(root: etree._Element, folder: Path) -> None:
    budget = MAX_SVG_BYTES
    embedded: dict[Path, str] = {}
    for element in root.iter():
        if not isinstance(element.tag, str) or _local(element.tag) != "image":
            continue
        for key, value in element.attrib.items():
            if _local(key) != "href" or (path := _linked_file(value, folder)) is None:
                continue
            if path not in embedded:
                uri = _picture_uri(path)
                if uri is None or len(uri) > budget:
                    continue
                budget -= len(uri)
                embedded[path] = uri
            element.set(key, embedded[path])


def sanitized_svg(source: Path, directory: Path) -> Path:
    root = read_svg(source)
    _embed_neighbour_pictures(root, source.resolve().parent)
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
        produced = libreoffice.convert_to_pdf(clean, working / "office", check_cancelled)
        return _with_links(clean, produced.read_bytes())
    root = read_svg(clean)
    _anchors_as_groups(root)
    _size_in_points(root)
    try:
        with pymupdf.open(stream=etree.tostring(root), filetype="svg") as document:
            drawn = document.convert_to_pdf()
    except Exception as error:  # noqa: BLE001
        raise _refusal("notSvg", f"{source.name} could not be drawn") from error
    return _with_links(clean, drawn)


def _anchors_as_groups(root: etree._Element) -> None:
    for element in root.iter():
        if isinstance(element.tag, str) and _local(element.tag) == "a":
            namespace = etree.QName(element.tag).namespace
            element.tag = f"{{{namespace}}}g" if namespace else "g"
            for key in list(element.attrib):
                if _local(key) in ("href", "target"):
                    del element.attrib[key]


def _drawn_area(root: etree._Element) -> pymupdf.Rect | None:
    with pymupdf.open(stream=etree.tostring(root), filetype="svg") as drawing:
        page = drawing[0]
        area = pymupdf.Rect()
        for kind, box in page.get_bboxlog():
            if "clip" not in kind:
                area |= pymupdf.Rect(box)
        if area.is_empty:
            return None
        return area * pymupdf.Matrix(1 / page.rect.width, 1 / page.rect.height)


def _link_areas(root: etree._Element, anchors: list[etree._Element]) -> list[pymupdf.Rect | None]:
    trimmed = copy.deepcopy(root)
    twins = dict(zip(root.iter(), trimmed.iter(), strict=True))
    groups = [twins[anchor] for anchor in anchors]
    linked = {element for group in groups for element in group.iter()}
    dropped = [
        element
        for element in trimmed.iter()
        if element not in linked
        and isinstance(element.tag, str)
        and _local(element.tag) in DRAWN_ELEMENTS
        and not any(_local(parent.tag) in DEFINITION_ELEMENTS for parent in element.iterancestors())
    ]
    for element in dropped:
        element.getparent().remove(element)
    _anchors_as_groups(trimmed)
    places = [(group.getparent(), group.getparent().index(group)) for group in groups]
    for group in groups:
        group.getparent().remove(group)
    areas = []
    for group, (parent, index) in zip(groups, places, strict=True):
        parent.insert(index, group)
        areas.append(_drawn_area(trimmed))
        parent.remove(group)
    return areas


def _with_links(clean: Path, drawn: bytes) -> bytes:
    root = read_svg(clean)
    anchors = [
        element
        for element in root.iter()
        if isinstance(element.tag, str)
        and _local(element.tag) == "a"
        and LINK_TARGET.match(_href(element).strip())
    ][:MAX_SVG_LINKS]
    if not anchors:
        return drawn
    try:
        areas = _link_areas(root, anchors)
        with pymupdf.open("pdf", drawn) as document:
            page = document[0]
            scale = pymupdf.Matrix(page.rect.width, page.rect.height)
            for anchor, area in zip(anchors, areas, strict=True):
                if area is not None:
                    page.insert_link(
                        {
                            "kind": pymupdf.LINK_URI,
                            "uri": _href(anchor).strip(),
                            "from": area * scale,
                        }
                    )
            return document.tobytes()
    except Exception:  # noqa: BLE001
        return drawn


def _view_box_size(root: etree._Element) -> tuple[float, float] | None:
    parts = (root.get("viewBox") or "").replace(",", " ").split()
    if len(parts) != 4:
        return None
    try:
        width, height = float(parts[2]), float(parts[3])
    except ValueError:
        return None
    return (width, height) if width > 0 and height > 0 else None


def _css_pixels(value: str) -> float | None:
    match = ABSOLUTE_LENGTH.match(value)
    if match is None:
        return None
    return float(ABSOLUTE_NUMBER.search(value)[0]) * CSS_PIXELS[(match.group(2) or "").lower()]


def _size_in_points(root: etree._Element) -> None:
    box = _view_box_size(root)
    width, height = _css_pixels(root.get("width") or ""), _css_pixels(root.get("height") or "")
    if box is not None:
        if width is None and height is None:
            width, height = box
        elif width is None:
            width = height * box[0] / box[1]
        elif height is None:
            height = width * box[1] / box[0]
    if width is None or height is None or width <= 0 or height <= 0:
        return
    if box is None:
        root.set("viewBox", f"0 0 {width:g} {height:g}")
    root.set("width", f"{width * POINTS_PER_CSS_PIXEL:g}pt")
    root.set("height", f"{height * POINTS_PER_CSS_PIXEL:g}pt")


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


def clean_svg_markup(source: Path, limit: int) -> tuple[str, float, float]:
    if source.stat().st_size > limit:
        raise _too_large(source.name)
    root = read_svg(source)
    _clean_tree(root)
    _absolute_size(root)
    markup = etree.tostring(root, encoding="unicode")
    if len(markup) > limit:
        raise _too_large(source.name)
    width, height = (
        float(ABSOLUTE_NUMBER.match(root.get(key) or "")[0]) for key in ("width", "height")
    )
    return markup, width, height


def _without_comments(text: str) -> str:
    parts, position = [], 0
    while (start := text.find("/*", position)) >= 0:
        parts.append(text[position:start])
        end = text.find("*/", start + 2)
        if end < 0:
            return "".join(parts)
        position = end + 2
    parts.append(text[position:])
    return "".join(parts)


def _stylesheet_blocks(text: str) -> list[tuple[str, str]]:
    blocks, depth, selector_start, body_start = [], 0, 0, 0
    for index, character in enumerate(text):
        if character == "{":
            if depth == 0:
                body_start = index + 1
            depth += 1
        elif character == "}" and depth > 0:
            depth -= 1
            if depth == 0:
                selector = text[selector_start : body_start - 1].strip()
                if not selector.startswith("@"):
                    blocks.append((selector, text[body_start:index]))
                selector_start = index + 1
        elif character == ";" and depth == 0:
            selector_start = index + 1
    return blocks


def _stylesheet_rules(text: str) -> list[tuple[tuple[int, int, int], int, str, str]]:
    rules = []
    for selectors, body in _stylesheet_blocks(_without_comments(text)):
        for selector in selectors.split(","):
            match = SIMPLE_SELECTOR.match(selector.strip())
            if not match or not selector.strip() or len(rules) >= MAX_STYLE_RULES:
                continue
            tag, identifier, classes = match.group(1), match.group(2), match.group(3) or ""
            specificity = (
                1 if identifier else 0,
                classes.count("."),
                1 if tag and tag != "*" else 0,
            )
            rules.append((specificity, len(rules), selector.strip(), body.strip().strip(";")))
    return sorted(rules)


def _selector_matches(selector: str, element: etree._Element) -> bool:
    match = SIMPLE_SELECTOR.match(selector)
    if match is None:
        return False
    tag, identifier, classes = match.group(1), match.group(2), match.group(3) or ""
    if tag and tag != "*" and tag != _local(element.tag):
        return False
    if identifier and element.get("id") != identifier:
        return False
    owned = set((element.get("class") or "").split())
    return all(name in owned for name in classes.split(".") if name)


def _inline_stylesheets(root: etree._Element) -> None:
    sheets = [
        element.text or ""
        for element in root.iter()
        if isinstance(element.tag, str) and _local(element.tag) == "style"
    ]
    rules = _stylesheet_rules("\n".join(sheets))
    if not rules:
        return
    for element in root.iter():
        if not isinstance(element.tag, str) or _local(element.tag) == "style":
            continue
        matched = [body for _, _, selector, body in rules if _selector_matches(selector, element)]
        if not matched:
            continue
        declarations: dict[str, str] = {}
        for body in [*matched, element.get("style") or ""]:
            for declaration in body.split(";"):
                name, colon, value = declaration.partition(":")
                if colon and name.strip() and value.strip():
                    declarations[name.strip().lower()] = value.strip()
        element.set("style", ";".join(f"{name}:{value}" for name, value in declarations.items()))


def drawing_pdf(raw: bytes, name: str, opacity: float = 1.0) -> pymupdf.Document:
    if len(raw) > MAX_SVG_BYTES:
        raise _too_large(name)
    root = _parse_svg(raw, name)
    _clean_tree(root)
    _anchors_as_groups(root)
    _inline_stylesheets(root)
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


def placed_svg(raw: bytes, name: str, width: float, height: float) -> bytes:
    if len(raw) > MAX_SVG_BYTES:
        raise _too_large(name)
    root = _parse_svg(raw, name)
    _clean_tree(root)
    _anchors_as_groups(root)
    if _view_box_size(root) is None:
        _absolute_size(root)
        natural = [
            float(ABSOLUTE_NUMBER.match(root.get(key) or "")[0]) for key in ("width", "height")
        ]
        root.set("viewBox", f"0 0 {natural[0]:g} {natural[1]:g}")
    root.set("width", f"{width:g}pt")
    root.set("height", f"{height:g}pt")
    root.set("preserveAspectRatio", "none")
    return etree.tostring(root, xml_declaration=True, encoding="utf-8")
