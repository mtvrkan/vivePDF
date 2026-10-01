import re
from collections.abc import Callable
from typing import Literal

import pymupdf

from vivepdf.ops._content import (
    content_tokens,
    cut_spans,
    invocation_spans,
    marked_blocks,
    merge_spans,
)
from vivepdf.ops._document import open_document
from vivepdf.ops._objects import add_resource
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._watermark_style import GridPosition, grid_cell
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

FurnitureRole = Literal["pageNumber", "headerFooter", "letterhead"]
FurnitureScope = Literal["vivepdf", "all"]

ROLE_NAMES: dict[str, bytes] = {
    "pageNumber": b"/PageNumber",
    "headerFooter": b"/HeaderFooter",
    "letterhead": b"/Letterhead",
}
ARTIFACT = b"/Artifact"
PAGINATION = b"/Pagination"
FURNITURE_SUBTYPES = {b"Header", b"Footer", b"PageNum", b"Bates"}
SUBTYPE = re.compile(rb"/Subtype\s*/([A-Za-z]+)")
ROLE = re.compile(rb"/VivePDFRole\s*(/[A-Za-z]+)")
WRAPPER_STREAMS = {b"", b"q", b"Q"}
OBJECT_REFERENCE = re.compile(r"(\d+)\s+0\s+R")
EMPTY_REMAINDER = re.compile(rb"^[\sqQ]*$")

PropertyResolver = Callable[[bytes], bytes]


def artifact_opening(position: GridPosition, role: FurnitureRole) -> bytes:
    row, _column = grid_cell(position)
    subtype = "Header" if row == "top" else "Footer"
    role_name = ROLE_NAMES[role].decode("ascii")
    return (
        f"/Artifact <</Type /Pagination /Subtype /{subtype} /VivePDFRole {role_name}>> BDC\n"
    ).encode("ascii")


def background_opening(role: FurnitureRole) -> bytes:
    role_name = ROLE_NAMES[role].decode("ascii")
    return f"/Artifact <</Type /Background /VivePDFRole {role_name}>> BDC\n".encode("ascii")


def mark_new_content(page: pymupdf.Page, before: set[int], opening: bytes) -> None:
    document = page.parent
    for xref in page.get_contents():
        if xref in before:
            continue
        data = document.xref_stream(xref)
        if data.strip() in WRAPPER_STREAMS:
            continue
        document.update_stream(xref, opening + data + b"\nEMC\n")


def is_furniture(tag: bytes, prop: bytes, roles: set[bytes] | None) -> bool:
    if tag != ARTIFACT or not prop.startswith(b"<<"):
        return False
    if roles is not None:
        role = ROLE.search(prop)
        return role is not None and role.group(1) in roles
    if PAGINATION not in prop:
        return False
    subtype = SUBTYPE.search(prop)
    return subtype is not None and subtype.group(1) in FURNITURE_SUBTYPES


def named_property(document: pymupdf.Document, holder: int, name: bytes) -> bytes:
    key = name[1:].decode("latin-1")
    if not key:
        return b""
    try:
        kind, value = document.xref_get_key(holder, f"Resources/Properties/{key}")
    except (ValueError, RuntimeError):
        return b""
    if kind == "dict":
        return value.encode("latin-1")
    match = OBJECT_REFERENCE.match(value) if kind == "xref" else None
    if match is None:
        return b""
    try:
        return document.xref_object(int(match.group(1)), compressed=True).encode("latin-1")
    except (ValueError, RuntimeError):
        return b""


def property_resolver(document: pymupdf.Document, *holders: int) -> PropertyResolver:
    cache: dict[bytes, bytes] = {}

    def resolve(prop: bytes) -> bytes:
        if not prop.startswith(b"/"):
            return prop
        if prop not in cache:
            cache[prop] = next(
                (found for holder in holders if (found := named_property(document, holder, prop))),
                b"",
            )
        return cache[prop]

    return resolve


def furniture_spans(
    content: bytes, roles: set[bytes] | None, resolve: PropertyResolver | None = None
) -> list[tuple[int, int]]:
    if ARTIFACT not in content:
        return []
    tokens = content_tokens(content)
    blocks = marked_blocks(
        tokens,
        lambda tag, prop: is_furniture(tag, resolve(prop) if resolve else prop, roles),
    )
    return merge_spans([(opening[0], closing[1]) for opening, closing in blocks])


MAX_FORM_DEPTH = 16
XOBJECT_ENTRY = re.compile(r"/([^\s/<>\[\]()%{}]+)\s+(\d+)\s+0\s+R")
FORM_SUBTYPE = ("name", "/Form")
CLEAN = "clean"
EMPTY = "empty"
CHANGED = "changed"


def _is_form(document: pymupdf.Document, xref: int) -> bool:
    try:
        return document.xref_get_key(xref, "Subtype") == FORM_SUBTYPE
    except (ValueError, RuntimeError):
        return False


def _form_children(document: pymupdf.Document, xref: int) -> list[tuple[str, int]]:
    try:
        kind, value = document.xref_get_key(xref, "Resources/XObject")
        if kind == "xref":
            value = document.xref_object(int(value.split()[0]), compressed=True)
        elif kind != "dict":
            return []
    except (ValueError, RuntimeError):
        return []
    return [
        (name, child)
        for name, number in XOBJECT_ENTRY.findall(value)
        if (child := int(number)) != xref and _is_form(document, child)
    ]


def _page_forms(document: pymupdf.Document, page: pymupdf.Page) -> list[tuple[str, int]]:
    return [
        (name, xref)
        for xref, name, invoker, _bbox in page.get_xobjects()
        if not invoker and _is_form(document, xref)
    ]


def _form_users(document: pymupdf.Document) -> dict[int, set[int]]:
    users: dict[int, set[int]] = {}
    for index in range(document.page_count):
        pending = [(xref, 0) for _name, xref in _page_forms(document, document[index])]
        while pending:
            xref, depth = pending.pop()
            reached = users.setdefault(xref, set())
            if index in reached:
                continue
            reached.add(index)
            if depth < MAX_FORM_DEPTH:
                pending.extend(
                    (child, depth + 1) for _name, child in _form_children(document, xref)
                )
    return users


def _private_name(taken: set[str], name: str, copy: int) -> str:
    candidate = f"{name}_vp{copy}"
    suffix = 0
    while candidate in taken:
        suffix += 1
        candidate = f"{name}_vp{copy}_{suffix}"
    return candidate


def renamed_invocations(content: bytes, renames: dict[bytes, bytes]) -> bytes:
    if not renames:
        return content
    tokens = content_tokens(content)
    rewritten = bytearray()
    position = 0
    for index, (_start, _end, text) in enumerate(tokens):
        if text != b"Do" or not index:
            continue
        start, end, name = tokens[index - 1]
        if name not in renames:
            continue
        rewritten += content[position:start] + renames[name]
        position = end
    rewritten += content[position:]
    return bytes(rewritten)


class _Cleaned:
    __slots__ = ("content", "removed", "renames", "spans")

    def __init__(
        self, content: bytes, spans: list[tuple[int, int]], renames: dict[str, int], removed: int
    ):
        self.content = content
        self.spans = spans
        self.renames = renames
        self.removed = removed


class _FormCleaner:
    def __init__(self, document: pymupdf.Document, roles: set[bytes] | None, chosen: set[int]):
        self.document = document
        self.roles = roles
        self.chosen = chosen
        self.users: dict[int, set[int]] | None = None
        self.outcomes: dict[int, tuple[str, int]] = {}

    def in_scope(self, xref: int) -> bool:
        if self.users is None:
            self.users = _form_users(self.document)
        return self.users.get(xref, set()) <= self.chosen

    def clean_content(
        self,
        content: bytes,
        holders: tuple[int, ...],
        forms: list[tuple[str, int]],
        page: int,
        stack: tuple[int, ...],
    ) -> _Cleaned:
        whole: set[bytes] = set()
        renames: dict[bytes, bytes] = {}
        targets: dict[str, int] = {}
        removed = 0
        taken = {name for name, _xref in forms}
        for name, xref in forms:
            if xref in stack or len(stack) >= MAX_FORM_DEPTH:
                continue
            state, target, count = self.clean_form(xref, page, stack)
            removed += count
            if state == EMPTY:
                whole.add(b"/" + name.encode("latin-1"))
            elif state == CHANGED and target != xref:
                private = _private_name(taken, name, target)
                taken.add(private)
                targets[private] = target
                renames[b"/" + name.encode("latin-1")] = b"/" + private.encode("latin-1")
        content = renamed_invocations(content, renames)
        spans = furniture_spans(content, self.roles, property_resolver(self.document, *holders))
        if whole:
            spans = merge_spans([*spans, *invocation_spans(content_tokens(content), whole)])
        return _Cleaned(content, spans, targets, removed)

    def clean_form(self, xref: int, page: int, stack: tuple[int, ...]) -> tuple[str, int, int]:
        if xref in self.outcomes:
            state, target = self.outcomes[xref]
            return state, target, 0
        try:
            data = self.document.xref_stream(xref) or b""
        except (ValueError, RuntimeError):
            data = b""
        cleaned = self.clean_content(
            data, (xref, page), _form_children(self.document, xref), page, (*stack, xref)
        )
        if not cleaned.spans and not cleaned.renames:
            self.outcomes[xref] = (CLEAN, xref)
            return CLEAN, xref, cleaned.removed
        kept = cut_spans(cleaned.content, cleaned.spans)
        if EMPTY_REMAINDER.match(kept):
            self.outcomes[xref] = (EMPTY, xref)
            return EMPTY, xref, 0
        target = xref
        if not self.in_scope(xref):
            target = self.document.get_new_xref()
            self.document.update_object(target, self.document.xref_object(xref, compressed=True))
        for private, child in cleaned.renames.items():
            add_resource(self.document, target, "XObject", private, child, page)
        self.document.update_stream(target, kept)
        self.outcomes[xref] = (CHANGED, target)
        return CHANGED, target, cleaned.removed + len(cleaned.spans)


def remove_furniture(
    document: pymupdf.Document,
    indices: list[int],
    roles: set[bytes] | None,
    progress: Progress | None = None,
    pages: list[pymupdf.Page] | None = None,
) -> tuple[int, int]:
    removed = 0
    pages_changed = 0
    loaded = pages if pages is not None else [document[index] for index in indices]
    cleaner = _FormCleaner(document, roles, set(indices))
    for position, page in enumerate(loaded):
        if progress is not None:
            progress.check_cancelled()
            if position % 25 == 0:
                progress.report(
                    position / max(1, len(loaded)),
                    "progress.applying",
                    {"current": position + 1, "total": len(loaded)},
                )
        cleaned = cleaner.clean_content(
            page.read_contents(), (page.xref,), _page_forms(document, page), page.xref, ()
        )
        if not cleaned.spans and not cleaned.renames and not cleaned.removed:
            continue
        for private, child in cleaned.renames.items():
            add_resource(document, page.xref, "XObject", private, child, page.xref)
        if cleaned.spans or cleaned.renames:
            new_xref = document.get_new_xref()
            document.update_object(new_xref, "<<>>")
            document.update_stream(new_xref, cut_spans(cleaned.content, cleaned.spans))
            page.set_contents(new_xref)
        removed += len(cleaned.spans) + cleaned.removed
        pages_changed += 1
    return removed, pages_changed


def role_names(roles: list[FurnitureRole]) -> set[bytes]:
    return {ROLE_NAMES[role] for role in roles}


class RemoveFurnitureParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    pages: str | None = None
    scope: FurnitureScope = "vivepdf"


class RemoveFurnitureResult(OutputResult):
    removed: int
    pages_changed: int


@op("pages.remove_header_footer", RemoveFurnitureParams)
def remove_header_footer(
    params: RemoveFurnitureParams, progress: Progress
) -> RemoveFurnitureResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        indices = list(dict.fromkeys(parse_page_ranges(params.pages, document.page_count)))
        roles = None if params.scope == "all" else role_names(["pageNumber", "headerFooter"])
        removed, pages_changed = remove_furniture(document, indices, roles, progress)
        if removed == 0:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "no headers, footers or page numbers found",
                {"reason": "noHeaderFooter"},
            )
        progress.report(0.9, "progress.saving")
        saved = save_document(document, target)
    return RemoveFurnitureResult(**saved.model_dump(), removed=removed, pages_changed=pages_changed)
