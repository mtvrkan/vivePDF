import datetime as dt
import uuid

import pymupdf

REVIEW_MODEL = "Review"
COMPLETED = "Completed"
CLEARED = "None"
LEGACY_RESOLVED_SUBJECT = "Resolved"
STATE_FLAGS = 30
REPLY_FLAGS = 28
REVIEW_STATES = ("Accepted", "Rejected", "Cancelled", "Completed", "None")


def _string(document: pymupdf.Document, xref: int, key: str) -> str:
    kind, value = document.xref_get_key(xref, key)
    return value if kind == "string" else ""


def reply_parent(document: pymupdf.Document, xref: int) -> int | None:
    kind, value = document.xref_get_key(xref, "IRT")
    if kind != "xref":
        return None
    return int(value.split()[0])


def is_state_reply(document: pymupdf.Document, xref: int) -> bool:
    return reply_parent(document, xref) is not None and bool(_string(document, xref, "StateModel"))


def reply_tree(document: pymupdf.Document) -> dict[int, list[int]]:
    children: dict[int, list[int]] = {}
    for page in document:
        for xref, _kind, _name in page.annot_xrefs():
            parent = reply_parent(document, xref)
            if parent is not None:
                children.setdefault(parent, []).append(xref)
    return children


def descendants(document: pymupdf.Document, roots: set[int]) -> set[int]:
    children = reply_tree(document)
    found: set[int] = set()
    pending = list(roots)
    while pending:
        for child in children.get(pending.pop(), []):
            if child not in found and child not in roots:
                found.add(child)
                pending.append(child)
    return found


def state_replies(document: pymupdf.Document, parents: set[int]) -> set[int]:
    return {
        xref
        for parent, replies in reply_tree(document).items()
        if parent in parents
        for xref in replies
        if is_state_reply(document, xref)
    }


def review_states(document: pymupdf.Document) -> dict[int, str]:
    states: dict[int, str] = {}
    for page in document:
        for xref, _kind, _name in page.annot_xrefs():
            parent = reply_parent(document, xref)
            if parent is None:
                continue
            if _string(document, xref, "StateModel").casefold() != REVIEW_MODEL.casefold():
                continue
            states[parent] = _string(document, xref, "State")
    return states


def has_legacy_resolved_subject(subject: str) -> bool:
    return subject.strip().casefold() == LEGACY_RESOLVED_SUBJECT.casefold()


def is_resolved(state: str | None, subject: str) -> bool:
    if state is not None:
        return state.casefold() == COMPLETED.casefold()
    return has_legacy_resolved_subject(subject)


def _pdf_now() -> str:
    return dt.datetime.now(dt.UTC).strftime("D:%Y%m%d%H%M%SZ")


def _append_annotation(document: pymupdf.Document, page: pymupdf.Page, parts: list[str]) -> int:
    xref = document.get_new_xref()
    document.update_object(xref, "<< " + " ".join(parts) + " >>")
    existing = [item[0] for item in page.annot_xrefs()]
    listing = " ".join(f"{number} 0 R" for number in [*existing, xref])
    document.xref_set_key(page.xref, "Annots", f"[{listing}]")
    return xref


def add_reply(
    document: pymupdf.Document,
    page: pymupdf.Page,
    parent: int,
    content: str,
    author: str | None,
) -> int:
    now = pymupdf.get_pdf_str(_pdf_now())
    parts = [
        "/Type /Annot",
        "/Subtype /Text",
        f"/Rect {document.xref_get_key(parent, 'Rect')[1]}",
        f"/P {page.xref} 0 R",
        f"/IRT {parent} 0 R",
        "/RT /R",
        f"/F {REPLY_FLAGS}",
        "/Name /Comment",
        f"/Contents {pymupdf.get_pdf_str(content)}",
        f"/NM {pymupdf.get_pdf_str(f'vivepdf-reply-{uuid.uuid4().hex}')}",
        f"/M {now}",
        f"/CreationDate {now}",
    ]
    if author:
        parts.append(f"/T {pymupdf.get_pdf_str(author)}")
    return _append_annotation(document, page, parts)


def add_review_state(
    document: pymupdf.Document,
    page: pymupdf.Page,
    parent: int,
    state: str,
    author: str | None,
) -> int:
    now = pymupdf.get_pdf_str(_pdf_now())
    parts = [
        "/Type /Annot",
        "/Subtype /Text",
        f"/Rect {document.xref_get_key(parent, 'Rect')[1]}",
        f"/P {page.xref} 0 R",
        f"/IRT {parent} 0 R",
        f"/F {STATE_FLAGS}",
        f"/State {pymupdf.get_pdf_str(state)}",
        f"/StateModel {pymupdf.get_pdf_str(REVIEW_MODEL)}",
        f"/NM {pymupdf.get_pdf_str(f'vivepdf-state-{uuid.uuid4().hex}')}",
        f"/M {now}",
        f"/CreationDate {now}",
    ]
    if author:
        parts.append(f"/T {pymupdf.get_pdf_str(author)}")
    return _append_annotation(document, page, parts)
