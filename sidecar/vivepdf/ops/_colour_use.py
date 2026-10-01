import re

import pymupdf

from vivepdf.ops._content import content_tokens

DEVICE_FAMILIES = {
    "DeviceRGB": "rgb",
    "RGB": "rgb",
    "CalRGB": "rgb",
    "Lab": "rgb",
    "DeviceCMYK": "cmyk",
    "CMYK": "cmyk",
    "DeviceGray": "gray",
    "G": "gray",
    "CalGray": "gray",
    "Separation": "spot",
    "DeviceN": "spot",
}
COMPONENT_FAMILIES = {1: "gray", 3: "rgb", 4: "cmyk"}
DIRECT_OPERATORS = {
    b"rg": ("fill", "rgb"),
    b"RG": ("stroke", "rgb"),
    b"k": ("fill", "cmyk"),
    b"K": ("stroke", "cmyk"),
    b"g": ("fill", "gray"),
    b"G": ("stroke", "gray"),
}
SPACE_OPERATORS = {b"cs": "fill", b"CS": "stroke"}
PAINT_OPERATORS = {b"sc": "fill", b"scn": "fill", b"SC": "stroke", b"SCN": "stroke"}
PATTERN = "pattern"
MAX_DEPTH = 8
REFERENCE_PATTERN = re.compile(r"(\d+)\s+\d+\s+R")


def _reference(tokens: list[bytes], index: int) -> int | None:
    if index + 2 < len(tokens) and tokens[index + 2] == b"R" and tokens[index].isdigit():
        return int(tokens[index])
    return None


class ColourUse:
    def __init__(self, document: pymupdf.Document) -> None:
        self.document = document
        self.spaces: dict[tuple[int, str], str | None] = {}
        self.objects: dict[int, str | None] = {}
        self.streams: dict[int, frozenset[str]] = {}

    def page_families(self, page: pymupdf.Page) -> set[str]:
        families: set[str] = set()
        owner = self._owner(page.xref)
        try:
            data = page.read_contents()
        except Exception:
            data = b""
        self._scan(data, owner, families, 0)
        self._group(page.xref, families, 0)
        for annotation in self._references(*self._key(page.xref, "Annots")):
            kind, value = self._key(annotation, "AP/N")
            for appearance in self._references(kind, value):
                if self.document.xref_is_stream(appearance):
                    self._form(appearance, owner, families, 0)
        return families

    def _references(self, kind: str, value: str) -> list[int]:
        if kind == "xref":
            xref = int(value.split()[0])
            if self.document.xref_is_stream(xref):
                return [xref]
            try:
                value = self.document.xref_object(xref, compressed=True)
            except Exception:
                return []
        elif kind not in ("array", "dict"):
            return []
        return [int(match) for match in REFERENCE_PATTERN.findall(value)]

    def _group(self, xref: int, families: set[str], depth: int) -> None:
        family = self._value_family(*self._key(xref, "Group/CS"), depth + 1)
        if family and family != PATTERN:
            families.add(family)

    def _key(self, xref: int, path: str) -> tuple[str, str]:
        try:
            return self.document.xref_get_key(xref, path)
        except Exception:
            return ("null", "null")

    def _owner(self, xref: int) -> int | None:
        seen: set[int] = set()
        current: int | None = xref
        while current and current not in seen:
            seen.add(current)
            if self._key(current, "Resources")[0] != "null":
                return current
            kind, value = self._key(current, "Parent")
            current = int(value.split()[0]) if kind == "xref" else None
        return None

    def _resource(self, owner: int | None, category: str, name: bytes) -> tuple[str, str]:
        if owner is None:
            return ("null", "null")
        return self._key(owner, f"Resources/{category}/{name.decode('latin-1').lstrip('/')}")

    def _space(self, owner: int | None, name: bytes) -> str | None:
        plain = name.decode("latin-1").lstrip("/")
        if plain == "Pattern":
            return PATTERN
        if plain in DEVICE_FAMILIES:
            return DEVICE_FAMILIES[plain]
        cache = (owner or 0, plain)
        if cache not in self.spaces:
            self.spaces[cache] = self._value_family(*self._resource(owner, "ColorSpace", name), 0)
        return self.spaces[cache]

    def _value_family(self, kind: str, value: str, depth: int) -> str | None:
        if depth > MAX_DEPTH or kind == "null":
            return None
        if kind == "xref":
            return self._object_family(int(value.split()[0]), depth + 1)
        return self._text_family(value, depth)

    def _object_family(self, xref: int, depth: int) -> str | None:
        if xref not in self.objects:
            self.objects[xref] = None
            try:
                text = self.document.xref_object(xref, compressed=True)
            except Exception:
                text = ""
            self.objects[xref] = self._text_family(text, depth)
        return self.objects[xref]

    def _text_family(self, text: str, depth: int) -> str | None:
        stripped = text.strip()
        if stripped.startswith("/"):
            name = stripped[1:]
            return PATTERN if name == "Pattern" else DEVICE_FAMILIES.get(name)
        if not stripped.startswith("["):
            return None
        tokens = [token[2] for token in content_tokens(stripped.encode("latin-1", "replace"))]
        return self._array_family(tokens[1:], depth)

    def _array_family(self, tokens: list[bytes], depth: int) -> str | None:
        if not tokens or depth > MAX_DEPTH:
            return None
        head = tokens[0].decode("latin-1").lstrip("/")
        if head == "ICCBased":
            xref = _reference(tokens, 1)
            if xref is None:
                return None
            kind, value = self._key(xref, "N")
            if kind == "int" and int(value) in COMPONENT_FAMILIES:
                return COMPONENT_FAMILIES[int(value)]
            return self._value_family(*self._key(xref, "Alternate"), depth + 1)
        if head == "Indexed":
            base = tokens[1:]
            if not base:
                return None
            if base[0] == b"[":
                return self._array_family(base[1:], depth + 1)
            xref = _reference(base, 0)
            if xref is not None:
                return self._object_family(xref, depth + 1)
            return self._text_family(base[0].decode("latin-1"), depth + 1)
        if head == "Pattern":
            return PATTERN
        return DEVICE_FAMILIES.get(head)

    def _form(self, xref: int, owner: int | None, families: set[str], depth: int) -> None:
        if xref not in self.streams:
            self.streams[xref] = frozenset()
            found: set[str] = set()
            try:
                data = self.document.xref_stream(xref) or b""
            except Exception:
                data = b""
            own = xref if self._key(xref, "Resources")[0] != "null" else owner
            self._scan(data, own, found, depth + 1)
            self._group(xref, found, depth)
            self.streams[xref] = frozenset(found)
        families.update(self.streams[xref])

    def _xref_of(self, kind: str, value: str) -> int | None:
        return int(value.split()[0]) if kind == "xref" else None

    def _pattern(self, owner: int | None, name: bytes, families: set[str], depth: int) -> None:
        xref = self._xref_of(*self._resource(owner, "Pattern", name))
        if xref is None:
            return
        pattern_type = self._key(xref, "PatternType")
        if pattern_type == ("int", "1"):
            self._form(xref, owner, families, depth)
            return
        family = self._shading_family(xref, "Shading/ColorSpace", depth)
        if family and family != PATTERN:
            families.add(family)

    def _shading_family(self, xref: int, path: str, depth: int) -> str | None:
        return self._value_family(*self._key(xref, path), depth + 1)

    def _shading(self, owner: int | None, name: bytes, families: set[str], depth: int) -> None:
        kind, value = self._resource(owner, "Shading", name)
        xref = self._xref_of(kind, value)
        family = (
            self._shading_family(xref, "ColorSpace", depth)
            if xref is not None
            else self._resource_family(owner, name, depth)
        )
        if family and family != PATTERN:
            families.add(family)

    def _resource_family(self, owner: int | None, name: bytes, depth: int) -> str | None:
        if owner is None:
            return None
        plain = name.decode("latin-1").lstrip("/")
        return self._value_family(
            *self._key(owner, f"Resources/Shading/{plain}/ColorSpace"), depth + 1
        )

    def _scan(self, data: bytes, owner: int | None, families: set[str], depth: int) -> None:
        if depth > MAX_DEPTH or not data:
            return
        state: dict[str, str | None] = {"fill": "gray", "stroke": "gray"}
        stack: list[dict[str, str | None]] = []
        previous = b""
        for _start, _end, text in content_tokens(data):
            if text in DIRECT_OPERATORS:
                side, family = DIRECT_OPERATORS[text]
                state[side] = family
                families.add(family)
            elif text in SPACE_OPERATORS:
                state[SPACE_OPERATORS[text]] = self._space(owner, previous)
            elif text in PAINT_OPERATORS:
                current = state[PAINT_OPERATORS[text]]
                if current == PATTERN:
                    if previous.startswith(b"/"):
                        self._pattern(owner, previous, families, depth)
                elif current:
                    families.add(current)
            elif text == b"sh" and previous.startswith(b"/"):
                self._shading(owner, previous, families, depth)
            elif text == b"Do" and previous.startswith(b"/"):
                xref = self._xref_of(*self._resource(owner, "XObject", previous))
                if xref is not None and self._key(xref, "Subtype")[1] == "/Form":
                    self._form(xref, owner, families, depth)
            elif text == b"q":
                stack.append(dict(state))
            elif text == b"Q" and stack:
                state = stack.pop()
            previous = text
