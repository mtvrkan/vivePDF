import re
from typing import Literal

import pymupdf

from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.protocol import RpcModel

BACKUP_KEY = "VivePdfLayerBackup"
DEFAULT_CONFIG = "OCProperties/D"
BACKED_UP_KEYS = ("BaseState", "ON", "OFF")
MAX_NESTING = 64

_REFERENCE = re.compile(r"(\d+)\s+(\d+)\s+R")


class LayerRow(RpcModel):
    id: int | None
    name: str
    depth: int
    kind: Literal["layer", "label"]
    on: bool
    locked: bool


def _skip_literal_string(text: str, start: int) -> int:
    depth = 0
    index = start
    while index < len(text):
        character = text[index]
        if character == "\\":
            index += 2
            continue
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth == 0:
                return index + 1
        index += 1
    return index


def _array_body(document: pymupdf.Document, xref: int) -> str | None:
    source = document.xref_object(xref, compressed=True).strip()
    return source if source.startswith("[") else None


def _order_sequence(
    document: pymupdf.Document,
    text: str,
    layers: set[int],
    visited: set[int],
    nesting: int,
) -> list[int | None]:
    if nesting > MAX_NESTING:
        return []
    sequence: list[int | None] = []
    index = 0
    while index < len(text):
        character = text[index]
        if character == "(":
            sequence.append(None)
            index = _skip_literal_string(text, index)
            continue
        if character == "<" and not text.startswith("<<", index):
            sequence.append(None)
            closing = text.find(">", index)
            index = len(text) if closing < 0 else closing + 1
            continue
        reference = _REFERENCE.match(text, index)
        if reference and (index == 0 or not text[index - 1].isdigit()):
            xref = int(reference.group(1))
            if xref in layers:
                sequence.append(xref)
            elif xref not in visited and 0 < xref < document.xref_length():
                body = _array_body(document, xref)
                if body is not None:
                    sequence.extend(
                        _order_sequence(document, body, layers, visited | {xref}, nesting + 1)
                    )
            index = reference.end()
            continue
        index += 1
    return sequence


def _order_text(document: pymupdf.Document) -> str:
    kind, value = document.xref_get_key(document.pdf_catalog(), f"{DEFAULT_CONFIG}/Order")
    if kind == "array":
        return value
    if kind == "xref":
        body = _array_body(document, int(value.split()[0]))
        return body or ""
    return ""


def layer_rows(document: pymupdf.Document) -> list[LayerRow]:
    ocgs = document.get_ocgs()
    if not ocgs:
        return []
    interface = document.layer_ui_configs()
    sequence = _order_sequence(document, _order_text(document), set(ocgs), set(), 0)
    aligned = len(sequence) == len(interface) and all(
        (entry["type"] == "label") == (item is None)
        for entry, item in zip(interface, sequence, strict=True)
    )
    if not aligned or all(item is None for item in sequence):
        return [
            LayerRow(id=xref, name=info["name"], depth=0, kind="layer", on=info["on"], locked=False)
            for xref, info in ocgs.items()
        ]
    return [
        LayerRow(
            id=item,
            name=str(entry["text"]),
            depth=int(entry["depth"]),
            kind="label" if item is None else "layer",
            on=bool(ocgs[item]["on"]) if item is not None else False,
            locked=item is not None and bool(entry["locked"]),
        )
        for entry, item in zip(interface, sequence, strict=True)
    ]


def _references(xrefs: list[int]) -> str:
    return "[" + " ".join(f"{xref} 0 R" for xref in xrefs) + "]"


def apply_layer_choices(document: pymupdf.Document, choices: dict[int, bool]) -> int:
    ocgs = document.get_ocgs()
    if set(choices) - set(ocgs):
        raise OpError(ErrorCode.INVALID_PARAMS, "Unknown layer", {"reason": "unknownLayer"})
    changed = {xref: on for xref, on in choices.items() if bool(ocgs[xref]["on"]) != on}
    if not changed:
        return 0
    catalog = document.pdf_catalog()
    if document.xref_get_key(catalog, f"{DEFAULT_CONFIG}/{BACKUP_KEY}")[0] == "null":
        saved = []
        for key in BACKED_UP_KEYS:
            kind, value = document.xref_get_key(catalog, f"{DEFAULT_CONFIG}/{key}")
            if kind != "null":
                saved.append(f"/{key} {value}")
        document.xref_set_key(catalog, f"{DEFAULT_CONFIG}/{BACKUP_KEY}", f"<<{' '.join(saved)}>>")
    states = {xref: bool(info["on"]) for xref, info in ocgs.items()} | changed
    document.xref_set_key(
        catalog, f"{DEFAULT_CONFIG}/ON", _references([x for x, on in states.items() if on])
    )
    document.xref_set_key(
        catalog, f"{DEFAULT_CONFIG}/OFF", _references([x for x, on in states.items() if not on])
    )
    return len(changed)


def restore_layer_state(document: pymupdf.Document) -> int:
    catalog = document.pdf_catalog()
    if document.xref_get_key(catalog, f"{DEFAULT_CONFIG}/{BACKUP_KEY}")[0] != "dict":
        return 0
    for key in BACKED_UP_KEYS:
        _kind, value = document.xref_get_key(catalog, f"{DEFAULT_CONFIG}/{BACKUP_KEY}/{key}")
        document.xref_set_key(catalog, f"{DEFAULT_CONFIG}/{key}", value)
    document.xref_set_key(catalog, f"{DEFAULT_CONFIG}/{BACKUP_KEY}", "null")
    return 1
