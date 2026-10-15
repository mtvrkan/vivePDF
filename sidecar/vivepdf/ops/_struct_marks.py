import re
from dataclasses import dataclass

import pymupdf

from vivepdf.ops._content import content_tokens

MCID = re.compile(rb"/MCID\s+(\d+)")
REFERENCE = re.compile(rb"^(\d+)\s+(\d+)\s+R$")
INDIRECT = re.compile(rb"\d+\s+\d+\s+R\b")
PAGE = re.compile(rb"/Pg\s+(\d+)\s+\d+\s+R")
MAX_TREE_NODES = 4096
MAX_PAGE_TREE_DEPTH = 64
PROPERTY_PREFIX = "vpMC"

Span = tuple[int, int]


@dataclass(frozen=True)
class OpenTag:
    tag: bytes
    properties: bytes


@dataclass(frozen=True)
class _ParentSlot:
    node: int
    path: str
    nums: bytes
    span: Span


def _integer(text: bytes) -> int | None:
    return int(text) if text.isdigit() else None


def _reference(text: bytes | str) -> int | None:
    raw = text.encode() if isinstance(text, str) else text
    found = REFERENCE.match(raw.strip())
    return int(found.group(1)) if found else None


def _elements(text: bytes) -> list[Span] | None:
    tokens = content_tokens(text)
    if len(tokens) < 2 or tokens[0][2] != b"[" or tokens[-1][2] != b"]":
        return None
    spans: list[Span] = []
    index, last = 1, len(tokens) - 1
    while index < last:
        start, end, value = tokens[index]
        if value == b"[":
            depth, probe = 1, index + 1
            while probe < last and depth:
                inner = tokens[probe][2]
                depth += 1 if inner == b"[" else -1 if inner == b"]" else 0
                probe += 1
            if depth:
                return None
            spans.append((start, tokens[probe - 1][1]))
            index = probe
            continue
        if (
            index + 2 < last
            and value.isdigit()
            and tokens[index + 1][2].isdigit()
            and tokens[index + 2][2] == b"R"
        ):
            spans.append((start, tokens[index + 2][1]))
            index += 3
            continue
        spans.append((start, end))
        index += 1
    return spans


def _items(text: bytes) -> list[bytes] | None:
    spans = _elements(text)
    return None if spans is None else [text[start:end] for start, end in spans]


def _key(document: pymupdf.Document, xref: int, path: str) -> tuple[str, bytes]:
    kind, value = document.xref_get_key(xref, path)
    return kind, value.encode("utf-8")


def _tree_root(document: pymupdf.Document) -> tuple[int, str] | None:
    catalog = document.pdf_catalog()
    kind, value = _key(document, catalog, "StructTreeRoot")
    if kind == "xref":
        base = (_reference(value), "")
    elif kind == "dict":
        base = (catalog, "StructTreeRoot/")
    else:
        return None
    if base[0] is None:
        return None
    kind, value = _key(document, base[0], base[1] + "ParentTree")
    if kind == "xref":
        node = _reference(value)
        return (node, "") if node is not None else None
    if kind == "dict":
        return base[0], base[1] + "ParentTree/"
    return None


def _parent_slot(document: pymupdf.Document, key: int) -> _ParentSlot | None:
    start = _tree_root(document)
    if start is None:
        return None
    pending, seen = [start], set()
    while pending and len(seen) < MAX_TREE_NODES:
        node, path = pending.pop()
        if (node, path) in seen:
            continue
        seen.add((node, path))
        kind, nums = _key(document, node, path + "Nums")
        if kind == "array":
            spans = _elements(nums) or []
            for position in range(0, len(spans) - 1, 2):
                if _integer(nums[slice(*spans[position])]) == key:
                    return _ParentSlot(node, path + "Nums", nums, spans[position + 1])
        kind, kids = _key(document, node, path + "Kids")
        if kind == "array":
            for item in _items(kids) or []:
                kid = _reference(item)
                if kid is not None:
                    pending.append((kid, ""))
    return None


def _mcr_page(item: bytes) -> int | None:
    found = PAGE.search(item)
    return int(found.group(1)) if found else None


def _mcr_mcid(item: bytes) -> int | None:
    found = MCID.search(item)
    return int(found.group(1)) if found else None


def _continued_kids(
    document: pymupdf.Document, element: int, page: int, old: int, new: int
) -> bytes | None:
    kind, value = _key(document, element, "K")
    continuation = f"<</Type/MCR/Pg {page} 0 R/MCID {new}>>".encode()

    def follows(item: bytes) -> bytes | None:
        if _integer(item) == old:
            return str(new).encode()
        target = item
        reference = _reference(item)
        if reference is not None:
            if document.xref_get_key(reference, "Type") != ("name", "/MCR"):
                return None
            target = document.xref_object(reference, compressed=True).encode("utf-8")
        elif not item.startswith(b"<<"):
            return None
        if _mcr_mcid(target) != old or _mcr_page(target) not in (None, page):
            return None
        return continuation

    if kind in ("int", "dict", "xref"):
        added = follows(value) or continuation
        return b"[" + value + b" " + added + b"]"
    if kind == "null":
        return b"[" + continuation + b"]"
    if kind != "array":
        return None
    spans = _elements(value)
    if spans is None:
        return None
    for start, end in spans:
        added = follows(value[start:end])
        if added:
            return value[:end] + b" " + added + value[end:]
    closing = value.rindex(b"]")
    return value[:closing].rstrip() + b" " + continuation + value[closing:]


class MarkReopener:
    def __init__(self, page: pymupdf.Page, data: bytes) -> None:
        self.document = page.parent
        self.page = page.xref
        self.pairs: list[tuple[int, int, int]] = []
        self.named: list[tuple[str, bytes]] = []
        self.resources = self._resources()
        kind, key = _key(self.document, self.page, "StructParents")
        self.slot = _parent_slot(self.document, int(key)) if kind == "int" else None
        self.parents = self._parents() if self.slot else None
        used = [int(found.group(1)) for found in MCID.finditer(data)]
        self.next_id = max([len(self.parents or []) - 1, *used, -1]) + 1

    def _parents(self) -> list[bytes] | None:
        value = self.slot.nums[slice(*self.slot.span)]
        xref = _reference(value)
        if xref is not None:
            value = self.document.xref_object(xref, compressed=True).encode("utf-8")
        return _items(value)

    def _resources(self) -> tuple[int, str] | None:
        node: int | None = self.page
        for _ in range(MAX_PAGE_TREE_DEPTH):
            if node is None:
                return None
            kind, value = _key(self.document, node, "Resources")
            if kind == "xref":
                holder = _reference(value)
                return (holder, "") if holder is not None else None
            if kind == "dict":
                return node, "Resources/"
            kind, value = _key(self.document, node, "Parent")
            node = _reference(value) if kind == "xref" else None
        return None

    def _property(self, name: str) -> tuple[str, bytes]:
        if self.resources is None:
            return "null", b""
        holder, prefix = self.resources
        return _key(self.document, holder, f"{prefix}Properties/{name}")

    def _resolved(self, properties: bytes) -> bytes | None:
        if properties.startswith(b"<<"):
            return properties
        if not properties.startswith(b"/"):
            return None
        kind, value = self._property(properties[1:].decode("latin-1"))
        if kind == "xref":
            xref = _reference(value)
            return self.document.xref_object(xref, compressed=True).encode("utf-8")
        return value if kind == "dict" else None

    def _free_name(self) -> str:
        taken = {name for name, _ in self.named}
        number = len(self.named)
        while True:
            name = f"{PROPERTY_PREFIX}{number}"
            if name not in taken and self._property(name)[0] == "null":
                return name
            number += 1

    def _written(self, tag: bytes, properties: bytes) -> bytes | None:
        if not INDIRECT.search(properties):
            return tag + b" " + properties + b" BDC"
        if self.resources is None:
            return None
        name = self._free_name()
        self.named.append((name, properties))
        return tag + b" /" + name.encode("ascii") + b" BDC"

    def _element(self, old: int) -> int | None:
        if self.parents is None or old >= len(self.parents):
            return None
        return _reference(self.parents[old])

    def reopen(self, mark: OpenTag) -> bytes | None:
        source = self._resolved(mark.properties)
        if source is None:
            return None
        old = _mcr_mcid(source)
        if old is None:
            return mark.tag + b" " + mark.properties + b" BDC"
        new = self.next_id
        element = self._element(old) if self.slot is not None else None
        if self.slot is not None and (
            element is None or _continued_kids(self.document, element, self.page, old, new) is None
        ):
            return self._written(mark.tag, MCID.sub(b"", source, count=1))
        written = self._written(mark.tag, MCID.sub(f"/MCID {new}".encode(), source, count=1))
        if written is None:
            return None
        if element is not None:
            self.pairs.append((element, old, new))
        self.next_id += 1
        return written

    def _register_names(self) -> None:
        if not self.named or self.resources is None:
            return
        holder, prefix = self.resources
        entries = ""
        for name, properties in self.named:
            xref = self.document.get_new_xref()
            self.document.update_object(xref, properties.decode("utf-8"))
            entries += f"/{name} {xref} 0 R"
        kind, value = _key(self.document, holder, f"{prefix}Properties")
        if kind == "xref":
            target = _reference(value)
            text = self.document.xref_object(target, compressed=True)
            self.document.update_object(target, "<<" + entries + text.strip()[2:])
            return
        existing = value.decode("utf-8").strip()[2:] if kind == "dict" else ">>"
        self.document.xref_set_key(holder, f"{prefix}Properties", "<<" + entries + existing)

    def commit(self) -> None:
        self._register_names()
        if not self.pairs or self.slot is None or self.parents is None:
            return
        parents = list(self.parents)
        for element, old, new in self.pairs:
            kids = _continued_kids(self.document, element, self.page, old, new)
            if kids is not None:
                self.document.xref_set_key(element, "K", kids.decode("utf-8"))
            parents.extend([b"null"] * (new + 1 - len(parents)))
            parents[new] = f"{element} 0 R".encode()
        array = (b"[" + b" ".join(parents) + b"]").decode("utf-8")
        value = self.slot.nums[slice(*self.slot.span)]
        xref = _reference(value)
        if xref is not None:
            self.document.update_object(xref, array)
            return
        xref = self.document.get_new_xref()
        self.document.update_object(xref, array)
        start, end = self.slot.span
        nums = self.slot.nums[:start] + f" {xref} 0 R ".encode() + self.slot.nums[end:]
        self.document.xref_set_key(self.slot.node, self.slot.path, nums.decode("utf-8"))
