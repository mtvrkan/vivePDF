import re

import pymupdf

_REFERENCE = re.compile(r"(\d+)\s+0\s+R")
_ADDED_SUFFIX = re.compile(r"^(.*) \[\d+\]$")


def _top_fields(document: pymupdf.Document) -> list[int]:
    catalog = document.pdf_catalog()
    kind, value = document.xref_get_key(catalog, "AcroForm/Fields")
    if kind == "xref":
        value = document.xref_object(int(value.split()[0]), compressed=True)
    elif kind != "array":
        return []
    return [int(match) for match in _REFERENCE.findall(value)]


def _name(document: pymupdf.Document, xref: int) -> str | None:
    kind, value = document.xref_get_key(xref, "T")
    return value if kind == "string" else None


def top_field_names(document: pymupdf.Document) -> set[str]:
    return {name for xref in _top_fields(document) if (name := _name(document, xref))}


def separate_field_names(merged: pymupdf.Document, originals: set[str]) -> int:
    fields = [(xref, _name(merged, xref)) for xref in _top_fields(merged)]
    used = {name for _, name in fields if name}
    renamed = 0
    for xref, name in fields:
        if not name or name in originals:
            continue
        match = _ADDED_SUFFIX.match(name)
        if match is None or match.group(1) not in originals:
            continue
        base = match.group(1)
        number = 2
        while f"{base}_{number}" in used or f"{base}_{number}" in originals:
            number += 1
        fresh = f"{base}_{number}"
        merged.xref_set_key(xref, "T", pymupdf.get_pdf_str(fresh))
        used.add(fresh)
        renamed += 1
    return renamed
