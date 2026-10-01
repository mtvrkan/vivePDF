import re
from dataclasses import dataclass, field

import pymupdf

from vivepdf.ops._access_structure import role_map, standard_role
from vivepdf.rpc.protocol import RpcModel

REF_PATTERN = re.compile(r"(\d+) 0 R")
MAX_NODES = 250_000
MAX_FIGURES = 500
FIGURE_TYPES = {"/Figure", "/Formula"}
HEADING_PATTERN = re.compile(r"^/H([1-6])$")
MAX_TABLE_NODES = 5_000
STANDARD_TYPES = {
    f"/{name}"
    for name in [
        "Document",
        "DocumentFragment",
        "Part",
        "Art",
        "Sect",
        "Div",
        "BlockQuote",
        "Caption",
        "TOC",
        "TOCI",
        "Index",
        "NonStruct",
        "Private",
        "Aside",
        "Title",
        "FENote",
        "Sub",
        "P",
        "H",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "L",
        "LI",
        "Lbl",
        "LBody",
        "Table",
        "TR",
        "TH",
        "TD",
        "THead",
        "TBody",
        "TFoot",
        "Span",
        "Quote",
        "Note",
        "Reference",
        "BibEntry",
        "Code",
        "Em",
        "Strong",
        "Link",
        "Annot",
        "Ruby",
        "RB",
        "RT",
        "RP",
        "Warichu",
        "WT",
        "WP",
        "Figure",
        "Formula",
        "Form",
        "Artifact",
    ]
}


def _refs(value: str) -> list[int]:
    return [int(match) for match in REF_PATTERN.findall(value)]


class FigureInfo(RpcModel):
    xref: int
    page: int | None
    alt: str
    kind: str


@dataclass
class StructureWalk:
    figures: list[FigureInfo] = field(default_factory=list)
    figures_total: int = 0
    figures_without_alt: int = 0
    headings: dict[str, int] = field(default_factory=dict)
    heading_skips: int = 0
    tables: int = 0
    tables_without_headers: int = 0
    figure_pages_without_alt: set[int] = field(default_factory=set)
    unmapped_types: set[str] = field(default_factory=set)


def _structure_type(
    document: pymupdf.Document, xref: int, roles: dict[str, str] | None = None
) -> str | None:
    try:
        kind_type, kind = document.xref_get_key(xref, "S")
    except Exception:
        return None
    if kind_type != "name":
        return None
    return standard_role(kind, roles or {})


def _structure_children(document: pymupdf.Document, xref: int) -> list[int]:
    try:
        child_type, children = document.xref_get_key(xref, "K")
    except Exception:
        return []
    if child_type in ("array", "xref"):
        return _refs(children)
    return []


def _table_has_headers(
    document: pymupdf.Document, table: int, roles: dict[str, str] | None = None
) -> bool:
    stack = _structure_children(document, table)
    seen: set[int] = set()
    while stack and len(seen) < MAX_TABLE_NODES:
        xref = stack.pop()
        if xref in seen or xref <= 0 or xref >= document.xref_length():
            continue
        seen.add(xref)
        kind = _structure_type(document, xref, roles)
        if kind == "/TH":
            return True
        if kind == "/Table":
            continue
        stack.extend(_structure_children(document, xref))
    return False


def _alternative_text(document: pymupdf.Document, xref: int) -> str:
    for key in ("Alt", "ActualText"):
        value_type, value = document.xref_get_key(xref, key)
        if value_type == "string" and value.strip():
            return value.strip()
    return ""


def _walk_structure(
    document: pymupdf.Document, root: int, page_numbers: dict[int, int]
) -> StructureWalk:
    walk = StructureWalk()
    roles = role_map(document, root)
    heading_sequence: list[int] = []
    stack = _refs(document.xref_get_key(root, "K")[1])
    seen: set[int] = set()
    visited = 0
    while stack and visited < MAX_NODES:
        xref = stack.pop()
        if xref in seen or xref <= 0 or xref >= document.xref_length():
            continue
        seen.add(xref)
        visited += 1
        kind = _structure_type(document, xref, roles)
        if kind is not None:
            if kind in FIGURE_TYPES:
                alt = _alternative_text(document, xref)
                walk.figures_total += 1
                walk.figures_without_alt += 0 if alt else 1
                page_type, page_ref = document.xref_get_key(xref, "Pg")
                page = None
                if page_type == "xref":
                    refs = _refs(page_ref)
                    page = page_numbers.get(refs[0]) if refs else None
                if not alt and page is not None:
                    walk.figure_pages_without_alt.add(page)
                if len(walk.figures) < MAX_FIGURES:
                    walk.figures.append(
                        FigureInfo(xref=xref, page=page, alt=alt, kind=kind.lstrip("/"))
                    )
            elif match := HEADING_PATTERN.match(kind):
                level = int(match.group(1))
                walk.headings[f"h{level}"] = walk.headings.get(f"h{level}", 0) + 1
                heading_sequence.append(level)
            elif kind == "/H":
                walk.headings["h"] = walk.headings.get("h", 0) + 1
            elif kind == "/Table":
                walk.tables += 1
                if not _table_has_headers(document, xref, roles):
                    walk.tables_without_headers += 1
            if kind not in STANDARD_TYPES:
                walk.unmapped_types.add(kind.lstrip("/"))
        try:
            child_type, children = document.xref_get_key(xref, "K")
        except Exception:
            continue
        if child_type in ("array", "xref"):
            stack.extend(reversed(_refs(children)))
    walk.heading_skips = sum(
        1
        for previous, current in zip(heading_sequence, heading_sequence[1:], strict=False)
        if current > previous + 1
    )
    walk.figures.sort(key=lambda item: (item.page or 0, item.xref))
    return walk
