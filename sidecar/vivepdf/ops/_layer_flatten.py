import re

import pymupdf

from vivepdf.ops._content import content_tokens, cut_spans, marked_blocks
from vivepdf.ops._scrub import (
    CANCEL_STRIDE,
    LoadedPages,
)
from vivepdf.rpc.progress import Progress

EMPTY_LAYER_PROPERTIES = "<</OCGs[]/D<</Order[]>>>>"
ALWAYS_VISIBLE = "<</Type/OCMD>>"


VISIBILITY_TOKEN = re.compile(r"\[|\]|/[A-Za-z]+|\d+\s+\d+\s+R")
POLICIES = {"/AnyOn", "/AllOn", "/AnyOff", "/AllOff"}


def _references(value: str) -> list[int]:
    return [int(found) for found in re.findall(r"(\d+)\s+\d+\s+R", value)]


def _parse_expression(tokens: list[str], position: int) -> tuple[object, int]:
    token = tokens[position]
    if token == "[":
        items: list[object] = []
        position += 1
        while position < len(tokens) and tokens[position] != "]":
            item, position = _parse_expression(tokens, position)
            items.append(item)
        return items, position + 1
    if token.endswith("R"):
        return int(token.split()[0]), position + 1
    return token, position + 1


def _evaluate(expression: object, on: dict[int, bool]) -> bool:
    if isinstance(expression, int):
        return on.get(expression, True)
    if not isinstance(expression, list) or not expression:
        return True
    operator, operands = expression[0], expression[1:]
    values = [_evaluate(item, on) for item in operands]
    if operator == "/Not":
        return not values[0] if values else True
    if operator == "/And":
        return all(values)
    if operator == "/Or":
        return any(values)
    return True


def _membership_visible(document: pymupdf.Document, xref: int, on: dict[int, bool]) -> bool:
    kind, value = document.xref_get_key(xref, "VE")
    expression = value if kind == "array" else None
    kind, value = document.xref_get_key(xref, "OCGs")
    members = value if kind in ("xref", "array") else None
    return _decide(expression, members, document.xref_get_key(xref, "P")[1], on)


def _balanced(text: str, start: int, opening: str, closing: str) -> str | None:
    depth = 0
    for position in range(start, len(text)):
        if text.startswith(opening, position):
            depth += 1
        elif text.startswith(closing, position):
            depth -= 1
            if depth == 0:
                return text[start : position + len(closing)]
    return None


def _inline_visible(text: str, on: dict[int, bool]) -> bool:
    expression = None
    found = re.search(r"/VE\s*\[", text)
    if found:
        expression = _balanced(text, found.end() - 1, "[", "]")
    members = None
    found = re.search(r"/OCGs\s*(\[[^\]]*\]|\d+\s+\d+\s+R)", text)
    if found:
        members = found.group(1)
    policy = re.search(r"/P\s*(/[A-Za-z]+)", text)
    return _decide(expression, members, policy.group(1) if policy else None, on)


def _decide(
    expression: str | None, members_text: str | None, policy: str | None, on: dict[int, bool]
) -> bool:
    if expression:
        tokens = VISIBILITY_TOKEN.findall(expression)
        if tokens:
            parsed, _ = _parse_expression(tokens, 0)
            return _evaluate(parsed, on)
    members = _references(members_text) if members_text else []
    if not members:
        return True
    states = [on.get(member, True) for member in members]
    policy = policy if policy in POLICIES else "/AnyOn"
    if policy == "/AllOn":
        return all(states)
    if policy == "/AnyOff":
        return not all(states)
    if policy == "/AllOff":
        return not any(states)
    return any(states)


PROPERTY_NAME = re.compile(r"\s*/([^\s/<>\[\]()]+)\s*")
PROPERTY_SCALAR = re.compile(r"\d+\s+\d+\s+R|/[^\s/<>\[\]()]+|[^\s/<>\[\]()]+")


def _properties_text(document: pymupdf.Document, page_xref: int) -> str | None:
    kind, value = document.xref_get_key(page_xref, "Resources")
    if kind == "xref":
        kind, value = document.xref_get_key(int(value.split()[0]), "Properties")
    elif kind == "dict":
        kind, value = document.xref_get_key(page_xref, "Resources/Properties")
    else:
        return None
    if kind == "xref":
        return document.xref_object(int(value.split()[0]), compressed=True)
    return value if kind == "dict" else None


def inline_memberships(text: str) -> dict[str, str]:
    body = text.strip()
    if not body.startswith("<<"):
        return {}
    found: dict[str, str] = {}
    position = 2
    while position < len(body) and not body.startswith(">>", position):
        match = PROPERTY_NAME.match(body, position)
        if not match:
            break
        position = match.end()
        if body.startswith("<<", position):
            value = _balanced(body, position, "<<", ">>")
            if value is None:
                break
            position += len(value)
            if "/OCMD" in value:
                found[match.group(1)] = value
            continue
        scalar = PROPERTY_SCALAR.match(body, position)
        if not scalar:
            break
        position = scalar.end()
        while position < len(body) and body[position].isspace():
            position += 1
    return found


PROPERTY_REFERENCE = re.compile(r"/([^\s/<>\[\]()]+)\s*(\d+)\s+\d+\s+R")


def _referenced_marks(
    document: pymupdf.Document, page: pymupdf.Page, page_xref: int, on: dict[int, bool]
) -> list[tuple[bytes, bool | None]]:
    try:
        items = [
            (name, xref) for name, xref, kind in page.get_oc_items() if kind in ("ocg", "ocmd")
        ]
    except (RuntimeError, ValueError):
        text = _properties_text(document, page_xref) or ""
        items = [(name, int(xref)) for name, xref in PROPERTY_REFERENCE.findall(text)]
    return [
        (f"/{name}".encode("latin-1"), _content_visible(document, xref, on))
        for name, xref in items
        if xref > 0
    ]


def _inline_marks(
    document: pymupdf.Document, page_xref: int, on: dict[int, bool]
) -> list[tuple[bytes, bool]]:
    text = _properties_text(document, page_xref)
    if not text:
        return []
    return [
        (f"/{name}".encode("latin-1"), _inline_visible(value, on))
        for name, value in inline_memberships(text).items()
    ]


def _oc_visible(
    document: pymupdf.Document, kind: str, value: str, on: dict[int, bool]
) -> bool | None:
    if kind == "xref":
        return _content_visible(document, int(value.split()[0]), on)
    if kind == "dict" and "/OCMD" in value:
        return _inline_visible(value, on)
    return None


def _flatten_annotation_layers(
    document: pymupdf.Document, pages: LoadedPages, on: dict[int, bool]
) -> set[int]:
    handled: set[int] = set()
    for page, _ in pages:
        for annot in list(page.annots()):
            handled.add(annot.xref)
            kind, value = document.xref_get_key(annot.xref, "OC")
            visible = _oc_visible(document, kind, value, on)
            if visible is None:
                continue
            if visible:
                document.xref_set_key(annot.xref, "OC", "null")
            else:
                page.delete_annot(annot)
        for widget in list(page.widgets()):
            handled.add(widget.xref)
            kind, value = document.xref_get_key(widget.xref, "OC")
            visible = _oc_visible(document, kind, value, on)
            if visible is None:
                continue
            if visible:
                document.xref_set_key(widget.xref, "OC", "null")
            else:
                page.delete_widget(widget)
    return handled


def _is_membership(document: pymupdf.Document, xref: int) -> bool:
    return document.xref_get_key(xref, "Type")[1] == "/OCMD"


def _content_visible(document: pymupdf.Document, xref: int, on: dict[int, bool]) -> bool | None:
    if xref in on:
        return on[xref]
    if _is_membership(document, xref):
        return _membership_visible(document, xref, on)
    return None


def _under(names: set[bytes]):
    def wanted(first: bytes, second: bytes) -> bool:
        return first == b"/OC" and second in names

    return wanted


def _flattened_stream(data: bytes, hidden: set[bytes], visible: set[bytes]) -> bytes:
    tokens = content_tokens(data)
    spans = [(opening[0], closing[1]) for opening, closing in marked_blocks(tokens, _under(hidden))]
    for opening, closing in marked_blocks(tokens, _under(visible)):
        spans.append(opening)
        spans.append(closing)
    return cut_spans(data, spans)


def _erase_oc_xobject(document: pymupdf.Document, xref: int) -> None:
    document.update_object(xref, "<</Type/XObject/Subtype/Form/BBox[0 0 0 0]/Length 0>>")
    document.update_stream(xref, b"")


def _flatten_layers(document: pymupdf.Document, pages: LoadedPages, progress: Progress) -> None:
    ocgs = document.get_ocgs()
    if not ocgs:
        return
    hidden = {xref for xref, entry in ocgs.items() if not entry.get("on", True)}
    on = {xref: xref not in hidden for xref in ocgs}
    for position, (page, page_xref) in enumerate(pages):
        if position % CANCEL_STRIDE == 0:
            progress.check_cancelled()
        content = page.read_contents()
        marks = _referenced_marks(document, page, page_xref, on)
        marks.extend(_inline_marks(document, page_xref, on))
        flattened = _flattened_stream(
            content,
            {name for name, visible in marks if visible is False},
            {name for name, visible in marks if visible is True},
        )
        if flattened != content:
            new_xref = document.get_new_xref()
            document.update_object(new_xref, "<<>>")
            document.update_stream(new_xref, flattened)
            page.set_contents(new_xref)
    handled = _flatten_annotation_layers(document, pages, on)
    for xref in range(1, document.xref_length()):
        if xref % CANCEL_STRIDE == 0:
            progress.check_cancelled()
        if xref in handled:
            continue
        kind, value = document.xref_get_key(xref, "OC")
        if kind not in ("xref", "dict"):
            continue
        if document.xref_get_key(xref, "Subtype")[1] not in ("/Form", "/Image"):
            continue
        visible = _oc_visible(document, kind, value, on)
        if visible is None:
            continue
        if not visible:
            _erase_oc_xobject(document, xref)
        else:
            document.xref_set_key(xref, "OC", ALWAYS_VISIBLE)
    catalog = document.pdf_catalog()
    document.xref_set_key(catalog, "OCProperties", EMPTY_LAYER_PROPERTIES)
