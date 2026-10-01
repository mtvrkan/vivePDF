import hashlib
import re

import pymupdf

from vivepdf.rpc.progress import Progress

CANCEL_STRIDE = 200
MAX_ROUNDS = 6
SKIPPED_TYPES = frozenset({"/XRef", "/ObjStm"})
UNIQUE_TYPES = frozenset(
    {
        "/Catalog",
        "/Pages",
        "/Page",
        "/Annot",
        "/StructTreeRoot",
        "/StructElem",
        "/OBJR",
        "/MCR",
        "/Outlines",
        "/Sig",
        "/OCG",
        "/OCMD",
        "/EmbeddedFile",
        "/Filespec",
    }
)
OWNED_KEYS = frozenset(
    {"Parent", "P", "Kids", "First", "Last", "Next", "Prev", "Fields", "FT", "T"}
)
REFERENCE = re.compile(r"(?<![\w.#/+-])(\d+)\s+(\d+)\s+R(?![\w])")


def _literal_end(text: str, start: int) -> int:
    depth = 0
    position = start
    length = len(text)
    while position < length:
        char = text[position]
        if char == "\\":
            position += 2
            continue
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return position + 1
        position += 1
    return length


def _redirect_code(code: str, mapping: dict[int, int]) -> str:
    def replace(match: re.Match) -> str:
        target = mapping.get(int(match.group(1)))
        return match.group(0) if target is None else f"{target} 0 R"

    return REFERENCE.sub(replace, code)


def rewrite_references(text: str, mapping: dict[int, int]) -> str:
    pieces: list[str] = []
    position = 0
    code_start = 0
    length = len(text)
    while position < length:
        char = text[position]
        if char == "<" and text.startswith("<<", position):
            position += 2
            continue
        if char not in "(<":
            position += 1
            continue
        if char == "(":
            end = _literal_end(text, position)
        else:
            closing = text.find(">", position)
            end = length if closing < 0 else closing + 1
        pieces.append(_redirect_code(text[code_start:position], mapping))
        pieces.append(text[position:end])
        position = code_start = end
    pieces.append(_redirect_code(text[code_start:], mapping))
    return "".join(pieces)


def _digest(document: pymupdf.Document, xref: int) -> bytes | None:
    try:
        if not document.xref_is_stream(xref):
            return _object_digest(document, xref)
        if document.xref_get_key(xref, "Type")[1] in SKIPPED_TYPES:
            return None
        head = document.xref_object(xref, compressed=True)
        body = document.xref_stream_raw(xref)
    except (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase):
        return None
    if body is None:
        return None
    return hashlib.sha256(b"s" + head.encode("utf-8", "surrogatepass") + b"\0" + body).digest()


def _object_digest(document: pymupdf.Document, xref: int) -> bytes | None:
    text = document.xref_object(xref, compressed=True)
    if text.startswith("<<"):
        keys = set(document.xref_get_keys(xref))
        if keys & OWNED_KEYS or document.xref_get_key(xref, "Type")[1] in UNIQUE_TYPES:
            return None
    elif not text.startswith("["):
        return None
    return hashlib.sha256(b"o" + text.encode("utf-8", "surrogatepass")).digest()


def _redirect_all(
    document: pymupdf.Document, mapping: dict[int, int], retired: set[int], progress: Progress
) -> set[int]:
    changed: set[int] = set()
    for xref in range(1, document.xref_length()):
        if xref % CANCEL_STRIDE == 0:
            progress.check_cancelled()
        if xref in retired:
            continue
        try:
            text = document.xref_object(xref, compressed=True)
        except (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase):
            continue
        if " R" not in text:
            continue
        rewritten = rewrite_references(text, mapping)
        if rewritten == text:
            continue
        if document.xref_is_stream(xref):
            _redirect_stream_keys(document, xref, mapping)
        else:
            document.update_object(xref, rewritten)
        changed.add(xref)
    return changed


def _redirect_stream_keys(document: pymupdf.Document, xref: int, mapping: dict[int, int]) -> None:
    for key in document.xref_get_keys(xref):
        kind, value = document.xref_get_key(xref, key)
        if kind not in ("xref", "array", "dict"):
            continue
        rewritten = rewrite_references(value, mapping)
        if rewritten != value:
            document.xref_set_key(xref, key, rewritten)


def merge_duplicate_streams(document: pymupdf.Document, progress: Progress) -> int:
    digests: dict[int, bytes | None] = {}
    retired: set[int] = set()
    stale = set(range(1, document.xref_length()))
    for _ in range(MAX_ROUNDS):
        for position, xref in enumerate(sorted(stale)):
            if position % CANCEL_STRIDE == 0:
                progress.check_cancelled()
            digests[xref] = _digest(document, xref)
        keepers: dict[bytes, int] = {}
        mapping: dict[int, int] = {}
        for xref in sorted(digests):
            digest = digests[xref]
            if digest is None or xref in retired:
                continue
            keeper = keepers.setdefault(digest, xref)
            if keeper != xref:
                mapping[xref] = keeper
        if not mapping:
            break
        retired.update(mapping)
        for xref in mapping:
            digests.pop(xref, None)
        stale = _redirect_all(document, mapping, retired, progress)
        if not stale:
            break
    return len(retired)
