import re
from dataclasses import dataclass

import pymupdf

from vivepdf.ops._content import content_tokens

MCID = re.compile(rb"/MCID\s+(\d+)")
REFERENCE = re.compile(rb"^(\d+)\s+(\d+)\s+R$")
INDIRECT = re.compile(rb"\d+\s+\d+\s+R\b")
PAGE = re.compile(rb"/Pg\s+(\d+)\s+\d+\s+R")
MAX_TREE_NODES = 4096

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

    if kind == "int":
        added = follows(value)
        return b"[" + value + b" " + added + b"]" if added else None
    if kind in ("dict", "xref"):
        added = follows(value)
        return b"[" + value + b" " + added + b"]" if added else None
    if kind != "array":
        return None
    spans = _elements(value)
    if spans is None:
        return None
    for start, end in spans:
        added = follows(value[start:end])
        if added:
            return value[:end] + b" " + added + value[end:]
    return None


class MarkReopener:
    def __init__(self, page: pymupdf.Page, data: bytes) -> None:
        self.document = page.parent
        self.page = page.xref
        self.pairs: list[tuple[int, int, int]] = []
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

    def _resolved(self, properties: bytes) -> bytes | None:
        if properties.startswith(b"<<"):
            return properties
        if not properties.startswith(b"/"):
            return None
        path = "Resources/Properties/" + properties[1:].decode("latin-1")
        kind, value = _key(self.document, self.page, path)
        if kind == "xref":
            xref = _reference(value)
            return self.document.xref_object(xref, compressed=True).encode("utf-8")
        return value if kind == "dict" else None

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
        if INDIRECT.search(source):
            return None
        new = self.next_id
        if self.slot is not None:
            element = self._element(old)
            if (
                element is None
                or _continued_kids(self.document, element, self.page, old, new) is None
            ):
                return None
            self.pairs.append((element, old, new))
        self.next_id += 1
        inline = MCID.sub(f"/MCID {new}".encode(), source, count=1)
        return mark.tag + b" " + inline + b" BDC"

    def commit(self) -> None:
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
