from collections import Counter
from dataclasses import dataclass, field

import pymupdf

from vivepdf.ops._a11y_tree import _refs
from vivepdf.ops._content_objects import (
    Box,
    ContentObject,
    FormFacts,
    PageContent,
    page_bytes,
    walk_content,
)
from vivepdf.rpc.progress import Progress

KEPT_MARK_TAGS = {b"/OC"}
HEADING_RATIO = 1.2
HEADING_MIN_GAIN = 1.0
HEADING_MAX_CHARACTERS = 240
HEADING_LEVELS = 3
SAME_SIZE_SHARE = 0.1
LINE_GAP_FACTOR = 2.0
MAX_PARAGRAPH_PARTS = 200
SIZE_STEP = 0.5
ANNOTATION_ROLES = {"/Link": "Link", "/Widget": "Form"}
SKIPPED_ANNOTATIONS = {"/Popup"}


@dataclass
class TaggedElement:
    role: str
    mcids: list[int] = field(default_factory=list)
    box: Box | None = None
    size: float = 0.0
    last_y: float | None = None


@dataclass
class _PageScan:
    data: bytes
    content: PageContent


@dataclass
class AutoTagSummary:
    paragraphs: int = 0
    headings: int = 0
    figures: int = 0
    artifacts: int = 0
    annotations: int = 0
    pages: int = 0


def _bucket(size: float) -> float:
    return round(size / SIZE_STEP) * SIZE_STEP


def _body_size(scans: list[_PageScan]) -> float:
    sizes: Counter[float] = Counter()
    for scan in scans:
        for item in scan.content.objects:
            if item.kind == "text" and item.shown and item.size > 0:
                sizes[_bucket(item.size)] += max(1, item.characters)
    return sizes.most_common(1)[0][0] if sizes else 0.0


def _heading_levels(scans: list[_PageScan], body: float) -> dict[float, int]:
    if body <= 0:
        return {}
    large = {
        _bucket(item.size)
        for scan in scans
        for item in scan.content.objects
        if _is_heading_candidate(item, body)
    }
    ranked = sorted(large, reverse=True)
    return {size: min(index + 1, HEADING_LEVELS) for index, size in enumerate(ranked)}


def _is_heading_candidate(item: ContentObject, body: float) -> bool:
    return (
        item.kind == "text"
        and item.shown
        and item.size >= body * HEADING_RATIO
        and item.size - body >= HEADING_MIN_GAIN
        and item.characters <= HEADING_MAX_CHARACTERS
    )


def _role(item: ContentObject, body: float, levels: dict[float, int]) -> str:
    if item.kind == "text":
        if not item.shown:
            return "Artifact"
        if _is_heading_candidate(item, body):
            return f"H{levels.get(_bucket(item.size), HEADING_LEVELS)}"
        return "P"
    if item.kind in ("image", "inline"):
        return "Figure"
    if item.kind == "form":
        if item.has_text:
            return "P"
        return "Figure" if item.has_images else "Artifact"
    return "Artifact"


def _continues(previous: TaggedElement, item: ContentObject, role: str) -> bool:
    if previous.role != role or role == "Figure" or item.kind != "text":
        return False
    if len(previous.mcids) >= MAX_PARAGRAPH_PARTS or previous.size <= 0:
        return False
    if abs(item.size - previous.size) > previous.size * SAME_SIZE_SHARE:
        return False
    if previous.last_y is None or item.first_y is None:
        return False
    drop = previous.last_y - item.first_y
    return -previous.size * 0.5 <= drop <= previous.size * LINE_GAP_FACTOR


def _rewritten(
    data: bytes, content: PageContent, wraps: list[tuple[ContentObject, bytes]]
) -> bytes:
    cuts: list[tuple[int, int]] = []
    for mark in content.marks:
        if mark.tag in KEPT_MARK_TAGS or mark.close_start is None or mark.close_end is None:
            continue
        cuts.append((mark.open_start, mark.open_end))
        cuts.append((mark.close_start, mark.close_end))
    opens: dict[int, list[bytes]] = {}
    closes: dict[int, list[bytes]] = {}
    for item, opening in wraps:
        opens.setdefault(item.start, []).append(opening)
        closes.setdefault(item.end, []).append(b" EMC\n")
    cut_at = {start: end for start, end in cuts}
    positions = sorted(set(opens) | set(closes) | set(cut_at))
    output = bytearray()
    cursor = 0
    for position in positions:
        if position < cursor:
            continue
        output += data[cursor:position]
        cursor = position
        for closing in closes.get(position, []):
            output += closing
        for opening in opens.get(position, []):
            output += opening
        if position in cut_at:
            output += b" "
            cursor = cut_at[position]
    output += data[cursor:]
    return bytes(output)


def _new_object(document: pymupdf.Document) -> int:
    xref = document.get_new_xref()
    document.update_object(xref, "<<>>")
    return xref


def _box_attribute(box: Box | None) -> str:
    if box is None:
        return ""
    x0, y0, x1, y1 = (round(value, 2) for value in box)
    return f"/A<</O/Layout/BBox[{x0} {y0} {x1} {y1}]>>"


def _annotation_refs(document: pymupdf.Document, page: pymupdf.Page) -> list[tuple[int, str]]:
    kind, value = document.xref_get_key(page.xref, "Annots")
    if kind == "xref":
        value = document.xref_object(int(value.split()[0]), compressed=True)
    elif kind != "array":
        return []
    found: list[tuple[int, str]] = []
    for xref in _refs(value):
        if xref <= 0 or xref >= document.xref_length():
            continue
        subtype_kind, subtype = document.xref_get_key(xref, "Subtype")
        if subtype_kind != "name" or subtype in SKIPPED_ANNOTATIONS:
            continue
        found.append((xref, ANNOTATION_ROLES.get(subtype, "Annot")))
    return found


def auto_tag(
    document: pymupdf.Document, progress: Progress, start: float, share: float
) -> AutoTagSummary:
    summary = AutoTagSummary()
    forms: dict[int, FormFacts] = {}
    scans: list[_PageScan] = []
    total = document.page_count
    for index in range(total):
        progress.check_cancelled()
        page = document[index]
        data = page_bytes(document, page)
        scans.append(_PageScan(data=data, content=walk_content(document, page, data, forms)))
        progress.report(
            start + share * 0.5 * (index + 1) / total,
            "progress.analyzing",
            {"current": index + 1, "total": total},
        )
    body = _body_size(scans)
    levels = _heading_levels(scans, body)

    catalog = document.pdf_catalog()
    root = _new_object(document)
    top = _new_object(document)
    children: list[int] = []
    nums: list[str] = []
    next_key = 0

    for index, scan in enumerate(scans):
        progress.check_cancelled()
        page = document[index]
        elements: list[TaggedElement] = []
        wraps: list[tuple[ContentObject, bytes]] = []
        next_mcid = 0
        owners: list[int] = []
        for item in scan.content.objects:
            role = _role(item, body, levels)
            if role == "Artifact":
                wraps.append((item, b"/Artifact BMC "))
                summary.artifacts += 1
                continue
            mcid = next_mcid
            next_mcid += 1
            wraps.append((item, f"/{role} <</MCID {mcid}>> BDC ".encode("ascii")))
            if elements and _continues(elements[-1], item, role):
                element = elements[-1]
            else:
                element = TaggedElement(
                    role=role, box=item.box if role == "Figure" else None, size=item.size
                )
                elements.append(element)
            element.mcids.append(mcid)
            element.last_y = item.last_y
            owners.append(len(elements) - 1)
        annotations = _annotation_refs(document, page)
        if not wraps and not annotations:
            continue
        summary.pages += 1
        element_xrefs = [_new_object(document) for _ in elements]
        for element, xref in zip(elements, element_xrefs, strict=True):
            kids = (
                str(element.mcids[0])
                if len(element.mcids) == 1
                else "[" + " ".join(map(str, element.mcids)) + "]"
            )
            document.update_object(
                xref,
                f"<</Type/StructElem/S/{element.role}/P {top} 0 R/Pg {page.xref} 0 R"
                f"/K {kids}{_box_attribute(element.box)}>>",
            )
            if element.role == "Figure":
                summary.figures += 1
            elif element.role.startswith("H"):
                summary.headings += 1
            else:
                summary.paragraphs += 1
        children.extend(element_xrefs)
        if wraps:
            stream = _new_object(document)
            document.update_stream(stream, _rewritten(scan.data, scan.content, wraps), new=True)
            document.xref_set_key(page.xref, "Contents", f"{stream} 0 R")
        if owners:
            document.xref_set_key(page.xref, "StructParents", str(next_key))
            nums.append(
                f"{next_key} [" + " ".join(f"{element_xrefs[owner]} 0 R" for owner in owners) + "]"
            )
            next_key += 1
        for annotation, role in annotations:
            element = _new_object(document)
            document.update_object(
                element,
                f"<</Type/StructElem/S/{role}/P {top} 0 R/Pg {page.xref} 0 R"
                f"/K<</Type/OBJR/Obj {annotation} 0 R/Pg {page.xref} 0 R>>>>",
            )
            document.xref_set_key(annotation, "StructParent", str(next_key))
            nums.append(f"{next_key} {element} 0 R")
            next_key += 1
            children.append(element)
            summary.annotations += 1
        if annotations:
            document.xref_set_key(page.xref, "Tabs", "/S")
        progress.report(
            start + share * (0.5 + 0.5 * (index + 1) / total),
            "progress.analyzing",
            {"current": index + 1, "total": total},
        )

    document.update_object(
        top,
        f"<</Type/StructElem/S/Document/P {root} 0 R/K["
        + " ".join(f"{xref} 0 R" for xref in children)
        + "]>>",
    )
    document.update_object(
        root,
        f"<</Type/StructTreeRoot/K {top} 0 R/ParentTree<</Nums["
        + " ".join(nums)
        + f"]>>/ParentTreeNextKey {next_key}>>",
    )
    document.xref_set_key(catalog, "StructTreeRoot", f"{root} 0 R")
    document.xref_set_key(catalog, "MarkInfo", "<</Marked true>>")
    return summary
