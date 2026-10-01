import re
from dataclasses import dataclass, field

import pymupdf

from vivepdf.rpc.progress import Progress

CANCEL_STRIDE = 200
MAX_DEPTH = 64
RISKY_ACTIONS = frozenset(
    {
        "/GoToE",
        "/GoToR",
        "/ImportData",
        "/JavaScript",
        "/Launch",
        "/Movie",
        "/Rendition",
        "/Sound",
        "/SubmitForm",
    }
)
RISKY_HINT = re.compile(r"/(?:" + "|".join(name[1:] for name in RISKY_ACTIONS) + r"|JS)\b|#")
DELIMITERS = set("()<>[]{}/%")
WHITESPACE = set("\x00\t\n\x0c\r ")
ESCAPED = re.compile(r"#([0-9A-Fa-f]{2})")
EMPTY_STRINGS = {"()", "<>"}
UNREADABLE = (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase)


@dataclass
class Atom:
    text: str


@dataclass
class PdfArray:
    items: list[object] = field(default_factory=list)


@dataclass
class PdfDict:
    items: list[tuple[str, object]] = field(default_factory=list)


def decoded(name: str) -> str:
    return ESCAPED.sub(lambda found: chr(int(found.group(1), 16)), name)


class _Reader:
    def __init__(self, text: str) -> None:
        self.text = text
        self.position = 0

    def _skip(self) -> None:
        text = self.text
        while self.position < len(text):
            char = text[self.position]
            if char in WHITESPACE:
                self.position += 1
            elif char == "%":
                while self.position < len(text) and text[self.position] not in "\r\n":
                    self.position += 1
            else:
                return

    def _regular(self) -> str:
        start = self.position
        text = self.text
        while (
            self.position < len(text)
            and text[self.position] not in WHITESPACE
            and text[self.position] not in DELIMITERS
        ):
            self.position += 1
        if self.position == start:
            raise ValueError("unexpected delimiter")
        return text[start : self.position]

    def _literal(self) -> str:
        start = self.position
        depth = 0
        text = self.text
        while self.position < len(text):
            char = text[self.position]
            if char == "\\":
                self.position += 2
                continue
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    self.position += 1
                    return text[start : self.position]
            self.position += 1
        raise ValueError("unterminated string")

    def _hex(self) -> str:
        end = self.text.find(">", self.position)
        if end < 0:
            raise ValueError("unterminated hex string")
        start, self.position = self.position, end + 1
        return self.text[start : self.position]

    def _name(self) -> str:
        start = self.position
        self.position += 1
        text = self.text
        while (
            self.position < len(text)
            and text[self.position] not in WHITESPACE
            and text[self.position] not in DELIMITERS
        ):
            self.position += 1
        return text[start : self.position]

    def _reference_tail(self) -> str | None:
        saved = self.position
        self._skip()
        if self.position < len(self.text) and self.text[self.position].isdigit():
            generation = self._regular()
            self._skip()
            if generation.isdigit() and self.text.startswith("R", self.position):
                after = self.position + 1
                if after >= len(self.text) or (
                    self.text[after] in WHITESPACE or self.text[after] in DELIMITERS
                ):
                    self.position = after
                    return f" {generation} R"
        self.position = saved
        return None

    def value(self, depth: int = 0) -> object:
        if depth > MAX_DEPTH:
            raise ValueError("nested too deeply")
        self._skip()
        text = self.text
        if self.position >= len(text):
            raise ValueError("unexpected end")
        if text.startswith("<<", self.position):
            self.position += 2
            return self._dict(depth)
        char = text[self.position]
        if char == "[":
            self.position += 1
            return self._array(depth)
        if char == "(":
            return Atom(self._literal())
        if char == "<":
            return Atom(self._hex())
        if char == "/":
            return Atom(self._name())
        token = self._regular()
        if token.isdigit():
            tail = self._reference_tail()
            if tail:
                return Atom(token + tail)
        return Atom(token)

    def _dict(self, depth: int) -> PdfDict:
        node = PdfDict()
        while True:
            self._skip()
            if self.position >= len(self.text):
                raise ValueError("unterminated dictionary")
            if self.text.startswith(">>", self.position):
                self.position += 2
                return node
            if self.text[self.position] != "/":
                raise ValueError("dictionary key is not a name")
            key = self._name()
            node.items.append((key, self.value(depth + 1)))

    def _array(self, depth: int) -> PdfArray:
        node = PdfArray()
        while True:
            self._skip()
            if self.position >= len(self.text):
                raise ValueError("unterminated array")
            if self.text[self.position] == "]":
                self.position += 1
                return node
            node.items.append(self.value(depth + 1))


def parse_object(text: str) -> object:
    return _Reader(text).value()


def serialized(node: object) -> str:
    if isinstance(node, PdfDict):
        return "<<" + "".join(f"{key} {serialized(value)}" for key, value in node.items) + ">>"
    if isinstance(node, PdfArray):
        return "[" + " ".join(serialized(item) for item in node.items) + "]"
    assert isinstance(node, Atom)
    return node.text


def _carries_script(value: object) -> bool:
    if isinstance(value, Atom):
        return value.text not in EMPTY_STRINGS and value.text != "null"
    return True


def is_risky_action(node: object) -> bool:
    if not isinstance(node, PdfDict):
        return False
    for key, value in node.items:
        name = decoded(key)
        if name == "/S" and isinstance(value, Atom) and decoded(value.text) in RISKY_ACTIONS:
            return True
        if name == "/JS" and _carries_script(value):
            return True
    return False


def risky_count(node: object) -> int:
    own = 1 if is_risky_action(node) else 0
    if isinstance(node, PdfDict):
        return own + sum(risky_count(value) for _, value in node.items)
    if isinstance(node, PdfArray):
        return own + sum(risky_count(item) for item in node.items)
    return own


def without_risky(node: object) -> object:
    if isinstance(node, PdfDict):
        return PdfDict(
            [(key, without_risky(value)) for key, value in node.items if not is_risky_action(value)]
        )
    if isinstance(node, PdfArray):
        return PdfArray(
            [Atom("null") if is_risky_action(item) else without_risky(item) for item in node.items]
        )
    return node


def _object_text(document: pymupdf.Document, xref: int) -> str | None:
    try:
        return document.xref_object(xref, compressed=True)
    except UNREADABLE:
        return None


def _top_level_risky(document: pymupdf.Document, xref: int) -> bool:
    try:
        action = document.xref_get_key(xref, "S")[1]
        kind, value = document.xref_get_key(xref, "JS")
    except UNREADABLE:
        return False
    scripted = kind in ("stream", "xref") or (kind == "string" and value.strip("() \n") != "")
    return action in RISKY_ACTIONS or scripted


def _parsed(document: pymupdf.Document, xref: int) -> tuple[str | None, object | None]:
    text = _object_text(document, xref)
    if text is None or not RISKY_HINT.search(text):
        return text, None
    try:
        return text, parse_object(text)
    except (ValueError, IndexError):
        return text, None


def _has_xfa(document: pymupdf.Document) -> bool:
    return document.xref_get_key(document.pdf_catalog(), "AcroForm/XFA")[0] not in ("null", "")


def risky_action_count(document: pymupdf.Document, progress: Progress | None = None) -> int:
    count = 0
    for xref in range(1, document.xref_length()):
        if progress is not None and xref % CANCEL_STRIDE == 0:
            progress.check_cancelled()
        text, node = _parsed(document, xref)
        if text is None:
            continue
        if node is not None:
            count += risky_count(node)
        elif RISKY_HINT.search(text) and _top_level_risky(document, xref):
            count += 1
    return count + (1 if _has_xfa(document) else 0)


def _neutralise(document: pymupdf.Document, xref: int) -> None:
    if document.xref_is_stream(xref):
        for key in ("S", "JS", "Next", "F"):
            document.xref_set_key(xref, key, "null")
        return
    document.update_object(xref, "<<>>")


def _strip_keys(document: pymupdf.Document, xref: int, node: PdfDict) -> None:
    for key, value in node.items:
        name = decoded(key)[1:]
        if not name or "/" in name:
            continue
        if is_risky_action(value):
            document.xref_set_key(xref, name, "null")
        elif risky_count(value):
            document.xref_set_key(xref, name, serialized(without_risky(value)))


def remove_risky_actions(document: pymupdf.Document, progress: Progress | None = None) -> None:
    for xref in range(1, document.xref_length()):
        if progress is not None and xref % CANCEL_STRIDE == 0:
            progress.check_cancelled()
        text, node = _parsed(document, xref)
        if text is None:
            continue
        if node is None:
            if RISKY_HINT.search(text) and _top_level_risky(document, xref):
                _neutralise(document, xref)
            continue
        if is_risky_action(node):
            _neutralise(document, xref)
        elif isinstance(node, PdfDict) and risky_count(node):
            _strip_keys(document, xref, node)
    catalog = document.pdf_catalog()
    for path in ("Names/JavaScript", "AcroForm/XFA", "NeedsRendering"):
        if document.xref_get_key(catalog, path)[0] not in ("null", ""):
            document.xref_set_key(catalog, path, "null")
