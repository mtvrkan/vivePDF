import re

import pymupdf

OBJECT_REFERENCE = re.compile(r"(\d+)\s+0\s+R")


def key_holder(document: pymupdf.Document, xref: int, path: list[str]) -> tuple[int, str]:
    holder = xref
    prefix: list[str] = []
    for segment in path[:-1]:
        kind, value = document.xref_get_key(holder, "/".join([*prefix, segment]))
        match = OBJECT_REFERENCE.match(value) if kind == "xref" else None
        if match:
            holder = int(match.group(1))
            prefix = []
            continue
        prefix.append(segment)
    return holder, "/".join([*prefix, path[-1]])


def set_key(document: pymupdf.Document, xref: int, path: list[str], value: str) -> None:
    holder, key = key_holder(document, xref, path)
    document.xref_set_key(holder, key, value)


def inherited_resources(document: pymupdf.Document, page_xref: int) -> tuple[str, str]:
    holder = page_xref
    for _depth in range(64):
        kind, value = document.xref_get_key(holder, "Resources")
        if kind != "null":
            return kind, value
        parent_kind, parent = document.xref_get_key(holder, "Parent")
        if parent_kind != "xref":
            break
        holder = int(parent.split()[0])
    return "dict", "<<>>"


def add_resource(
    document: pymupdf.Document, holder: int, category: str, name: str, xref: int, page: int
) -> tuple[int, str]:
    prefix = ""
    if document.xref_get_key(holder, "Resources")[0] == "null":
        kind, value = inherited_resources(document, page)
        document.xref_set_key(holder, "Resources", value if kind in ("dict", "xref") else "<<>>")
    for key in ("Resources", category):
        kind, value = document.xref_get_key(holder, prefix + key)
        if kind == "xref":
            holder = int(value.split()[0])
            prefix = ""
            continue
        if kind != "dict":
            document.xref_set_key(holder, prefix + key, "<<>>")
        prefix += key + "/"
    document.xref_set_key(holder, prefix + name, f"{xref} 0 R")
    return holder, prefix + name
