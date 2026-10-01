import contextlib
import xml.etree.ElementTree as ElementTree
from pathlib import Path

import pymupdf

from vivepdf.ops._comment_fdf import _fdf_entries, _valid_rect
from vivepdf.ops._comment_format import (
    APPEARANCE_TAGS,
    DROPPED_KEYS,
    DUPLICATE_TOLERANCE,
    SUBTYPE_TAGS,
    TAG_SUBTYPES,
    _annotation_name,
    _Budget,
    _numbers,
    _raw_numbers,
)
from vivepdf.ops._comment_objects import (
    _append_annotation,
    _materialize,
    _parse_appearance,
    _set_appearance,
)
from vivepdf.ops._comment_xfdf_read import (
    _annotation_object,
    _child,
    _child_text,
    _local,
    _parse_xfdf,
    _read_source,
)
from vivepdf.ops._document import open_document
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._pdf_syntax import (
    PdfName,
    PdfRef,
    write_object,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class CommentsImportParams(RpcModel):
    path: str
    password: str | None = None
    source: str
    output: str
    overwrite: bool = False
    replace_existing: bool = False


class CommentsImportResult(OutputResult):
    imported: int
    skipped: int
    duplicates: int = 0


Known = dict[str, tuple[int, int, str, list[float]]]


def _known_annotations(document: pymupdf.Document) -> Known:
    known: Known = {}
    for page in document:
        for annot in page.annots():
            rect = _raw_numbers(document, annot.xref, "Rect") or []
            known[_annotation_name(document, annot.xref)] = (
                annot.xref,
                page.number,
                annot.type[1],
                rect,
            )
    return known


def _duplicate_of(
    known: Known, name: str, subtype: str, index: int, rect: list[float]
) -> int | None:
    match = known.get(name) if name else None
    if match is None:
        return None
    xref, page_index, kind, existing = match
    if kind != subtype or page_index != index or len(existing) != 4 or len(rect) != 4:
        return None
    close = all(
        abs(first - second) <= DUPLICATE_TOLERANCE
        for first, second in zip(existing, rect, strict=True)
    )
    return xref if close else None


def _refresh_appearance(document: pymupdf.Document, page: pymupdf.Page, xref: int) -> None:
    page = document.reload_page(page)
    annot = page.load_annot(xref)
    if annot is not None:
        with contextlib.suppress(RuntimeError, ValueError):
            annot.update()


def _import_xfdf(
    document: pymupdf.Document, elements: list[ElementTree.Element], progress: Progress
) -> tuple[int, int, int]:
    imported = 0
    skipped = 0
    duplicates = 0
    known = _known_annotations(document)
    by_name = {name: entry[0] for name, entry in known.items()}
    replies: list[tuple[int, str]] = []
    for position, element in enumerate(elements):
        progress.check_cancelled()
        page_numbers = _numbers(element.get("page", ""))
        index = int(page_numbers[0]) if page_numbers else -1
        if not 0 <= index < document.page_count:
            skipped += 1
            continue
        page = document[index]
        subtype = TAG_SUBTYPES.get(_local(element.tag), "")
        rect = _numbers(element.get("rect", ""))
        if _duplicate_of(known, element.get("name", ""), subtype, index, rect) is not None:
            duplicates += 1
            continue
        body = _annotation_object(element, page)
        if body is None:
            skipped += 1
            continue
        xref = document.get_new_xref()
        document.update_object(xref, body)
        _append_annotation(document, page, xref)
        appearance = (
            _parse_appearance(_child_text(element, "appearance"))
            if _local(element.tag) in APPEARANCE_TAGS
            else None
        )
        if appearance is None or not _set_appearance(document, xref, appearance):
            _refresh_appearance(document, page, xref)
        name = element.get("name")
        if name:
            by_name[name] = xref
        reply_to = element.get("inreplyto")
        if reply_to:
            replies.append((xref, reply_to))
        imported += 1
        if position % 50 == 0:
            progress.report(position / max(1, len(elements)), "progress.importingComments")
    for xref, reply_to in replies:
        parent = by_name.get(reply_to)
        if parent is not None and parent != xref:
            document.xref_set_key(xref, "IRT", f"{parent} 0 R")
    return imported, skipped, duplicates


def _import_fdf(
    document: pymupdf.Document,
    objects: dict[int, object],
    entries: list[tuple[int | None, object]],
    progress: Progress,
) -> tuple[int, int, int]:
    imported = 0
    skipped = 0
    duplicates = 0
    known = _known_annotations(document)
    created: dict[int, int] = {}
    replies: list[tuple[int, int]] = []
    for position, (number, body) in enumerate(entries):
        progress.check_cancelled()
        index = body.get("Page") if isinstance(body, dict) else None
        if (
            not isinstance(body, dict)
            or str(body.get("Subtype") or "") not in SUBTYPE_TAGS
            or not isinstance(index, int)
            or isinstance(index, bool)
            or not 0 <= index < document.page_count
            or not _valid_rect(body.get("Rect"))
        ):
            skipped += 1
            continue
        rect = [float(value) for value in body["Rect"]]
        name = str(body.get("NM") or "")
        subtype = str(body.get("Subtype") or "")
        duplicate = _duplicate_of(known, name, subtype, index, rect)
        if duplicate is not None:
            if number is not None:
                created[number] = duplicate
            duplicates += 1
            continue
        page = document[index]
        xref = document.get_new_xref()
        if number is not None:
            created[number] = xref
        try:
            budget = _Budget()
            copied: dict[str, object] = {"Type": PdfName("Annot")}
            for key, value in body.items():
                if key not in DROPPED_KEYS and key != "Type":
                    copied[key] = _materialize(document, value, objects, created, budget)
        except ValueError:
            document.update_object(xref, "null")
            skipped += 1
            continue
        copied["P"] = PdfRef(page.xref)
        copied.setdefault("F", 4)
        write_object(document, xref, copied)
        _append_annotation(document, page, xref)
        if not isinstance(copied.get("AP"), dict):
            _refresh_appearance(document, page, xref)
        reply = body.get("IRT")
        if isinstance(reply, PdfRef):
            replies.append((xref, reply.number))
        imported += 1
        if position % 50 == 0:
            progress.report(position / max(1, len(entries)), "progress.importingComments")
    for xref, number in replies:
        parent = created.get(number)
        if parent is not None and parent != xref:
            document.xref_set_key(xref, "IRT", f"{parent} 0 R")
    return imported, skipped, duplicates


@op("comments.import", CommentsImportParams)
def import_comments(params: CommentsImportParams, progress: Progress) -> CommentsImportResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    raw = _read_source(Path(params.source))
    stripped = raw.lstrip(b"\xef\xbb\xbf \t\r\n")
    is_fdf = stripped.startswith(b"%FDF")
    elements: list[ElementTree.Element] = []
    objects: dict[int, object] = {}
    entries: list[tuple[int | None, object]] = []
    if is_fdf:
        objects, entries = _fdf_entries(raw)
    else:
        annots = _child(_parse_xfdf(raw), "annots")
        elements = list(annots) if annots is not None else []
    with open_document(params.path, params.password) as document:
        if params.replace_existing:
            for page in document:
                for xref in [annot.xref for annot in page.annots()]:
                    if page.load_annot(xref).type[1] in SUBTYPE_TAGS:
                        page.delete_annot(page.load_annot(xref))
        if is_fdf:
            imported, skipped, duplicates = _import_fdf(document, objects, entries, progress)
        else:
            imported, skipped, duplicates = _import_xfdf(document, elements, progress)
        if imported == 0 and duplicates:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "every comment in the file is already in the document",
                {"reason": "commentsAlreadyPresent", "count": duplicates},
            )
        if imported == 0:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "the comment file has no comments to import",
                {"reason": "noCommentsToImport"},
            )
        progress.report(0.9, "progress.saving")
        saved = save_document(document, target)
    return CommentsImportResult(
        **saved.model_dump(), imported=imported, skipped=skipped, duplicates=duplicates
    )
