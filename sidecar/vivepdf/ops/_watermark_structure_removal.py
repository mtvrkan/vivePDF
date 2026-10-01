import re
from collections import defaultdict

import pymupdf

from vivepdf.ops._content import (
    content_tokens,
    cut_pieces,
    invocation_spans,
    join_streams,
)
from vivepdf.ops._objects import key_holder
from vivepdf.ops.watermark_detection import (
    OBJECT_REFERENCE,
    REPEATED_IMAGE_MIN_PAGES,
    _artifact_names,
    _image_digests,
    _image_placement,
    _looks_like_a_mark,
    _mark_spans,
    _page_properties,
    _page_xobjects,
    _repeated_digests,
    _tagged_names,
    _xobject_layer,
)

DICT_ENTRY = re.compile(r"/([^\s/<>\[\]()]+)\s+\d+\s+0\s+R")


def _remove_annotations(page: pymupdf.Page, types: tuple[int, ...]) -> int:
    annots = list(page.annots(types=types))
    for annot in annots:
        page.delete_annot(annot)
    return len(annots)


def _repeated_image_xrefs(
    document: pymupdf.Document, indices: list[int], only: set[str] | None = None
) -> dict[int, set[int]]:
    if len(indices) < REPEATED_IMAGE_MIN_PAGES and not only:
        return {}
    digest_of, pages_by_digest, xrefs_by_page = _image_digests(document, indices)
    repeated = set(only) if only else _repeated_digests(pages_by_digest, len(indices))
    return {
        index: {
            xref
            for xref in xrefs
            if digest_of.get(xref) in repeated
            and (bool(only) or _looks_like_a_mark(*_image_placement(document[index], xref)))
        }
        for index, xrefs in xrefs_by_page.items()
    }


def _pages_using(document: pymupdf.Document, xrefs: set[int]) -> dict[int, set[int]]:
    users: dict[int, set[int]] = defaultdict(set)
    for index in range(document.page_count):
        for image in document[index].get_images(full=True):
            if image[0] in xrefs:
                users[image[0]].add(index)
    return users


def _drop_image_calls(document: pymupdf.Document, page: pymupdf.Page, xref: int) -> bool:
    names = {
        b"/" + str(image[7]).encode("latin-1")
        for image in page.get_images(full=True)
        if image[0] == xref and not image[9]
    }
    if not names:
        return False
    xrefs, pieces = _page_pieces(document, page)
    if not xrefs:
        return False
    spans = invocation_spans(content_tokens(join_streams(pieces)), names)
    if not spans:
        return False
    _write_pieces(document, page, xrefs, pieces, cut_pieces(pieces, spans))
    return True


def _remove_image(document: pymupdf.Document, page: pymupdf.Page, xref: int, shared: bool) -> bool:
    if shared:
        return _drop_image_calls(document, page, xref)
    page.delete_image(xref)
    return True


def _layer_names(
    document: pymupdf.Document, page: pymupdf.Page, layers: set[int]
) -> dict[str, int]:
    return {
        name: xref
        for xref, name in _page_xobjects(page)
        if _xobject_layer(document, xref) in layers
    }


def _layer_properties(
    document: pymupdf.Document, page: pymupdf.Page, layers: set[int]
) -> set[bytes]:
    return {
        b"/" + name.encode("latin-1")
        for name, xref in _page_properties(document, page).items()
        if xref in layers
    }


def _without_spaces(value: str) -> str:
    return re.sub(r"\s+", "", value)


def _drop_names(document: pymupdf.Document, page: pymupdf.Page, names: set[str]) -> None:
    holder, key = key_holder(document, page.xref, ["Resources", "XObject"])
    kind, value = document.xref_get_key(holder, key)
    if kind != "dict":
        return
    entries = list(DICT_ENTRY.finditer(value))
    if _without_spaces("".join(entry.group(0) for entry in entries)) != _without_spaces(
        value[2:-2]
    ):
        return
    kept = [entry.group(0) for entry in entries if entry.group(1) not in names]
    document.xref_set_key(holder, key, "<<" + "".join(kept) + ">>")


def _page_pieces(document: pymupdf.Document, page: pymupdf.Page) -> tuple[list[int], list[bytes]]:
    xrefs = list(page.get_contents())
    return xrefs, [document.xref_stream(xref) or b"" for xref in xrefs]


def _write_pieces(
    document: pymupdf.Document,
    page: pymupdf.Page,
    xrefs: list[int],
    before: list[bytes],
    after: list[bytes],
) -> None:
    if len(set(xrefs)) != len(xrefs):
        fresh = document.get_new_xref()
        document.update_object(fresh, "<<>>")
        document.update_stream(fresh, join_streams(after))
        document.xref_set_key(page.xref, "Contents", f"{fresh} 0 R")
        return
    for xref, old, new in zip(xrefs, before, after, strict=True):
        if old != new:
            document.update_stream(xref, new)


def _remove_structures(
    document: pymupdf.Document,
    page: pymupdf.Page,
    layers: set[int],
    tagged: bool,
    artifacts: bool,
    shared: set[int] | None = None,
) -> int:
    names: dict[str, int] = {}
    if tagged:
        names.update(_tagged_names(document, page))
    if layers:
        names.update(_layer_names(document, page, layers))
    properties = _layer_properties(document, page, layers) if layers else set()
    wanted = _artifact_names(document, page) if artifacts else None
    if not names and not properties and wanted is None:
        return 0
    xrefs, pieces = _page_pieces(document, page)
    if not xrefs:
        return 0
    data = join_streams(pieces)
    spans = _mark_spans(data, names, properties, wanted)
    if not spans:
        return 0
    kept_pieces = cut_pieces(pieces, spans)
    kept = join_streams(kept_pieces)
    _write_pieces(document, page, xrefs, pieces, kept_pieces)
    orphaned = (
        _orphaned_names(page, data, kept)
        if shared is not None and _holder_of(document, page) not in shared
        else set()
    )
    _drop_names(document, page, set(names) | orphaned)
    return len(spans)


def _holder_of(document: pymupdf.Document, page: pymupdf.Page) -> int:
    return key_holder(document, page.xref, ["Resources", "XObject"])[0]


def shared_holders(document: pymupdf.Document) -> set[int]:
    counts: dict[int, int] = defaultdict(int)
    for page in document:
        counts[_holder_of(document, page)] += 1
    return {holder for holder, count in counts.items() if count > 1}


def _invoked_names(data: bytes) -> set[str]:
    tokens = content_tokens(data)
    return {
        tokens[index - 1][2][1:].decode("latin-1")
        for index, (_start, _end, text) in enumerate(tokens)
        if text == b"Do" and index and tokens[index - 1][2].startswith(b"/")
    }


def _orphaned_names(page: pymupdf.Page, before: bytes, after: bytes) -> set[str]:
    own = {name for _xref, name in _page_xobjects(page)}
    return (_invoked_names(before) - _invoked_names(after)) & own


def _forget_layers(document: pymupdf.Document, layers: set[int]) -> None:
    catalog = document.pdf_catalog()
    for path in (
        ["OCProperties", "OCGs"],
        ["OCProperties", "D", "ON"],
        ["OCProperties", "D", "OFF"],
        ["OCProperties", "D", "Order"],
    ):
        holder, key = key_holder(document, catalog, path)
        kind, value = document.xref_get_key(holder, key)
        if kind != "array" or "[" in value[1:-1] or "(" in value:
            continue
        kept = [
            reference
            for reference in OBJECT_REFERENCE.finditer(value)
            if int(reference.group(1)) not in layers
        ]
        document.xref_set_key(holder, key, "[" + " ".join(item.group(0) for item in kept) + "]")
