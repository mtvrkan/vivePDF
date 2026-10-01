import csv
import html
import re
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._comment_fdf import write_fdf
from vivepdf.ops._comment_state import (
    CLEARED,
    COMPLETED,
    REVIEW_STATES,
    add_reply,
    add_review_state,
    descendants,
    has_legacy_resolved_subject,
    is_resolved,
    is_state_reply,
    reply_parent,
    review_states,
    state_replies,
)
from vivepdf.ops._comment_xfdf_write import write_xfdf
from vivepdf.ops._document import open_document
from vivepdf.ops._inplace import (
    INCREMENTAL_SAVE_ERRORS,
    replace_through_temporary,
    save_incrementally,
)
from vivepdf.ops._spreadsheet import inert_cell
from vivepdf.ops._story import BASE_CSS, FONT_DIR, render_html_to_pdf
from vivepdf.ops.info import printed_page_labels
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

EXCLUDED_TYPES = {"Link", "Widget", "Popup"}
MARKUP_TYPES = {"Highlight", "Underline", "StrikeOut", "Squiggly"}
PDF_DATE = re.compile(r"D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?")
BROKEN_WORD = re.compile(r"(\w)[-‐] (\w)")
MARKDOWN_SPECIAL = re.compile(r"([\\`*_\[\]<>|])")
MARKDOWN_LINE_START = re.compile(r"^(\s*)([#>+-]|\d+\.)", re.MULTILINE)
QUOTE_CHAR_LIMIT = 4000


def iso_date(raw: str | None) -> str:
    if not raw:
        return ""
    match = PDF_DATE.search(raw)
    if not match:
        return raw
    year, month, day, hour, minute, second = match.groups()
    text = f"{year}-{month}-{day}"
    if hour:
        text += f" {hour}:{minute or '00'}:{second or '00'}"
    return text


def color_hex(annot: pymupdf.Annot) -> str | None:
    colors = annot.colors or {}
    value = colors.get("stroke") or colors.get("fill")
    if not value:
        return None
    channels = [int(round(max(0.0, min(1.0, float(part))) * 255)) for part in value[:3]]
    if len(channels) < 3:
        return None
    return "#" + "".join(f"{channel:02x}" for channel in channels)


class CommentItem(RpcModel):
    xref: int
    page: int
    type: str
    author: str
    subject: str
    content: str
    created: str
    modified: str
    color: str | None
    rect: list[float]
    resolved: bool
    quote: str = ""
    parent: int | None = None
    state: str | None = None


class CommentsListParams(RpcModel):
    path: str
    password: str | None = None


class CommentsListResult(RpcModel):
    items: list[CommentItem]
    authors: list[str]
    types: list[str]
    page_count: int


Characters = list[tuple[pymupdf.Rect, str] | None]


def _page_characters(page: pymupdf.Page) -> Characters:
    characters: Characters = []
    for block in page.get_text("rawdict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                characters.extend((pymupdf.Rect(char["bbox"]), char["c"]) for char in span["chars"])
            characters.append(None)
    return characters


def _marked_areas(annot: pymupdf.Annot) -> list[pymupdf.Rect]:
    points = annot.vertices or []
    areas = [pymupdf.Quad(points[start : start + 4]).rect for start in range(0, len(points) - 3, 4)]
    return areas or [annot.rect]


def _join_broken_word(match: re.Match[str]) -> str:
    before, after = match.group(1), match.group(2)
    return before + after if before.isalpha() and after.islower() else match.group(0)


def marked_text(characters: Characters, areas: list[pymupdf.Rect]) -> str:
    lines: list[str] = []
    current: list[str] = []
    for entry in characters:
        if entry is None:
            if current:
                lines.append("".join(current).strip())
                current = []
            continue
        box, char = entry
        centre = pymupdf.Point((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
        if any(centre in area for area in areas):
            current.append(char)
    if current:
        lines.append("".join(current).strip())
    text = BROKEN_WORD.sub(_join_broken_word, " ".join(line for line in lines if line))
    return " ".join(text.split())[:QUOTE_CHAR_LIMIT]


def _shown_state(state: str | None, subject: str) -> str | None:
    if state is not None:
        known = next((name for name in REVIEW_STATES if name.casefold() == state.casefold()), None)
        return None if known in (None, CLEARED) else known
    return COMPLETED if has_legacy_resolved_subject(subject) else None


def _collect(document: pymupdf.Document) -> list[CommentItem]:
    items: list[CommentItem] = []
    states = review_states(document)
    for index, page in enumerate(document):
        characters: Characters | None = None
        for annot in page.annots():
            type_name = annot.type[1]
            if type_name in EXCLUDED_TYPES or is_state_reply(document, annot.xref):
                continue
            info = annot.info or {}
            subject = str(info.get("subject") or "")
            quote = ""
            if type_name in MARKUP_TYPES:
                if characters is None:
                    characters = _page_characters(page)
                quote = marked_text(characters, _marked_areas(annot))
            items.append(
                CommentItem(
                    xref=annot.xref,
                    page=index + 1,
                    type=type_name,
                    author=str(info.get("title") or ""),
                    subject=subject,
                    content=str(info.get("content") or ""),
                    created=iso_date(info.get("creationDate")),
                    modified=iso_date(info.get("modDate")),
                    color=color_hex(annot),
                    rect=[round(value, 2) for value in annot.rect],
                    resolved=is_resolved(states.get(annot.xref), subject),
                    quote=quote,
                    parent=reply_parent(document, annot.xref),
                    state=_shown_state(states.get(annot.xref), subject),
                )
            )
    return items


@op("comments.list", CommentsListParams)
def list_comments(params: CommentsListParams, progress: Progress) -> CommentsListResult:
    with open_document(params.path, params.password) as document:
        items = _collect(document)
        return CommentsListResult(
            items=items,
            authors=sorted({item.author for item in items if item.author}),
            types=sorted({item.type for item in items}),
            page_count=document.page_count,
        )


def _annots_by_xref(
    document: pymupdf.Document, xrefs: set[int]
) -> list[tuple[pymupdf.Page, pymupdf.Annot]]:
    found: list[tuple[pymupdf.Page, pymupdf.Annot]] = []
    for page in document:
        for annot in page.annots():
            if annot.xref in xrefs:
                found.append((page, annot))
    return found


Mutation = Callable[[pymupdf.Document, list[tuple[pymupdf.Page, pymupdf.Annot]]], None]


def _modify_in_place(path: str, password: str | None, xrefs: list[int], mutate: Mutation) -> int:
    document = open_document(path, password)
    try:
        matches = _annots_by_xref(document, set(xrefs))
        if not matches:
            return 0
        mutate(document, matches)
        try:
            save_incrementally(document, path)
        except INCREMENTAL_SAVE_ERRORS as error:
            print(f"[comments] incremental save failed, rewriting: {error}", file=sys.stderr)
            replace_through_temporary(document, path, garbage=0, deflate=True)
        return len(matches)
    finally:
        if not document.is_closed:
            document.close()


class CommentsUpdateParams(RpcModel):
    path: str
    password: str | None = None
    xrefs: list[int] = Field(min_length=1)
    resolved: bool = True
    author: str | None = Field(default=None, max_length=200)


class CommentsChangedResult(RpcModel):
    changed: int


@op("comments.set_resolved", CommentsUpdateParams)
def set_resolved(params: CommentsUpdateParams, progress: Progress) -> CommentsChangedResult:
    author = " ".join((params.author or "").split()) or None

    def mutate(
        document: pymupdf.Document, matches: list[tuple[pymupdf.Page, pymupdf.Annot]]
    ) -> None:
        states = review_states(document)
        for page, annot in matches:
            subject = str((annot.info or {}).get("subject") or "")
            state = states.get(annot.xref)
            legacy = has_legacy_resolved_subject(subject)
            if is_resolved(state, subject) == params.resolved:
                continue
            if params.resolved:
                add_review_state(document, page, annot.xref, COMPLETED, author)
                continue
            if legacy:
                document.xref_set_key(annot.xref, "Subj", "null")
            if state is not None:
                add_review_state(document, page, annot.xref, CLEARED, author)

    changed = _modify_in_place(params.path, params.password, params.xrefs, mutate)
    return CommentsChangedResult(changed=changed)


ReviewState = Literal["Accepted", "Rejected", "Cancelled", "Completed", "None"]


class CommentsStateParams(RpcModel):
    path: str
    password: str | None = None
    xrefs: list[int] = Field(min_length=1)
    state: ReviewState
    author: str | None = Field(default=None, max_length=200)


@op("comments.set_state", CommentsStateParams)
def set_state(params: CommentsStateParams, progress: Progress) -> CommentsChangedResult:
    author = " ".join((params.author or "").split()) or None

    def mutate(
        document: pymupdf.Document, matches: list[tuple[pymupdf.Page, pymupdf.Annot]]
    ) -> None:
        states = review_states(document)
        for page, annot in matches:
            subject = str((annot.info or {}).get("subject") or "")
            if (_shown_state(states.get(annot.xref), subject) or CLEARED) == params.state:
                continue
            if has_legacy_resolved_subject(subject):
                document.xref_set_key(annot.xref, "Subj", "null")
            add_review_state(document, page, annot.xref, params.state, author)

    changed = _modify_in_place(params.path, params.password, params.xrefs, mutate)
    return CommentsChangedResult(changed=changed)


class CommentsReplyParams(RpcModel):
    path: str
    password: str | None = None
    xref: int
    content: str = Field(min_length=1, max_length=5000)
    author: str | None = Field(default=None, max_length=200)


class CommentsReplyResult(RpcModel):
    xref: int


@op("comments.reply", CommentsReplyParams)
def reply(params: CommentsReplyParams, progress: Progress) -> CommentsReplyResult:
    content = params.content.strip()
    if not content:
        raise OpError(ErrorCode.INVALID_PARAMS, "Reply is empty", {"reason": "emptyReply"})
    author = " ".join((params.author or "").split()) or None
    created: list[int] = []

    def mutate(
        document: pymupdf.Document, matches: list[tuple[pymupdf.Page, pymupdf.Annot]]
    ) -> None:
        page, annot = matches[0]
        if annot.type[1] in EXCLUDED_TYPES or is_state_reply(document, annot.xref):
            raise OpError(ErrorCode.INVALID_PARAMS, "Not a comment", {"reason": "notAComment"})
        created.append(add_reply(document, page, annot.xref, content, author))

    if _modify_in_place(params.path, params.password, [params.xref], mutate) == 0:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "Comment not found",
            {"reason": "commentNotFound", "xref": params.xref},
        )
    return CommentsReplyResult(xref=created[0])


class CommentsDeleteParams(RpcModel):
    path: str
    password: str | None = None
    xrefs: list[int] = Field(min_length=1)


@op("comments.delete", CommentsDeleteParams)
def delete_comments(params: CommentsDeleteParams, progress: Progress) -> CommentsChangedResult:
    def mutate(
        document: pymupdf.Document, matches: list[tuple[pymupdf.Page, pymupdf.Annot]]
    ) -> None:
        roots = {annot.xref for _page, annot in matches}
        doomed = roots | descendants(document, roots)
        for page in document:
            for xref in [item[0] for item in page.annot_xrefs() if item[0] in doomed]:
                if any(item[0] == xref for item in page.annot_xrefs()):
                    page.delete_annot(page.load_annot(xref))

    changed = _modify_in_place(params.path, params.password, params.xrefs, mutate)
    return CommentsChangedResult(changed=changed)


class CommentsExportParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    format: Literal["csv", "pdf", "xfdf", "fdf", "md"] = "csv"
    include_resolved: bool = True
    overwrite: bool = False
    layout: Literal["list", "pages"] = "list"
    page_label: str = Field(default="Page", max_length=40)
    type_labels: dict[str, str] = Field(default_factory=dict, max_length=64)


class CommentsExportResult(RpcModel):
    output: str
    count: int


def _export_target(output: str, extension: str, overwrite: bool) -> Path:
    target = Path(output)
    if target.suffix.lower() != f".{extension}":
        target = target.with_suffix(f".{extension}")
    if target.exists() and not overwrite:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"output already exists: {target.name}",
            {"exists": True, "path": str(target)},
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def _summary_html(name: str, items: list[CommentItem], page_label: str = "Page") -> str:
    parts = [f"<h1>{html.escape(name)}</h1>"]
    current_page: int | None = None
    for item in items:
        if item.page != current_page:
            current_page = item.page
            parts.append(f"<h2>{html.escape(page_label)} {item.page}</h2>")
        meta = " · ".join(
            part
            for part in (item.type, item.author, item.created, "✓" if item.resolved else "")
            if part
        )
        body = html.escape(item.content) if item.content else "<i>—</i>"
        quote = f"<i>“{html.escape(item.quote)}”</i><br/>" if item.quote else ""
        parts.append(f"<p><b>{html.escape(meta)}</b><br/>{quote}{body}</p>")
    if len(parts) == 1:
        parts.append("<p>—</p>")
    return "".join(parts)


SUMMARY_PAPER = (595.0, 842.0)
SUMMARY_MARGIN = 36.0
SUMMARY_SPLIT = 0.55
SUMMARY_DPI = 110
MARKER_RADIUS = 6.5
MARKER_COLOR = (0.85, 0.2, 0.2)


def _entry_html(number: int, item: CommentItem) -> str:
    meta = " · ".join(
        part
        for part in (item.type, item.author, item.created, "✓" if item.resolved else "")
        if part
    )
    body = html.escape(item.content) if item.content else "—"
    quote = f"<i>“{html.escape(item.quote)}”</i><br/>" if item.quote else ""
    return (
        f"<p><b>{number}.</b> <span style='color:#666'>{html.escape(meta)}</span><br/>"
        f"{quote}{body}</p>"
    )


def _thumbnail_rect(area: pymupdf.Rect, page_rect: pymupdf.Rect) -> pymupdf.Rect:
    scale = min(area.width / page_rect.width, area.height / page_rect.height)
    width, height = page_rect.width * scale, page_rect.height * scale
    return pymupdf.Rect(area.x0, area.y0, area.x0 + width, area.y0 + height)


def _draw_marker(sheet: pymupdf.Page, center: pymupdf.Point, number: int) -> None:
    sheet.draw_circle(center, MARKER_RADIUS, color=MARKER_COLOR, fill=MARKER_COLOR)
    label = str(number)
    size = 7 if number < 100 else 5.5
    width = pymupdf.get_text_length(label, fontname="helv", fontsize=size)
    sheet.insert_text(
        (center.x - width / 2, center.y + size * 0.35), label, fontsize=size, color=(1, 1, 1)
    )


def _render_page_summary(
    document: pymupdf.Document,
    items: list[CommentItem],
    target: Path,
    page_label: str,
    progress: Progress,
) -> None:
    archive = pymupdf.Archive(str(FONT_DIR))
    by_page: dict[int, list[CommentItem]] = {}
    for item in items:
        by_page.setdefault(item.page, []).append(item)
    summary = pymupdf.open()
    try:
        width, height = SUMMARY_PAPER
        split = SUMMARY_MARGIN + (width - 2 * SUMMARY_MARGIN) * SUMMARY_SPLIT
        for position, (page_number, entries) in enumerate(sorted(by_page.items())):
            progress.check_cancelled()
            source = document[page_number - 1]
            sheet = summary.new_page(width=width, height=height)
            sheet.insert_htmlbox(
                pymupdf.Rect(SUMMARY_MARGIN, SUMMARY_MARGIN - 12, width - SUMMARY_MARGIN, 60),
                f"<h3>{html.escape(page_label)} {page_number}</h3>",
                css=BASE_CSS,
                archive=archive,
            )
            area = pymupdf.Rect(SUMMARY_MARGIN, 64, split - 10, height - SUMMARY_MARGIN)
            frame = _thumbnail_rect(area, source.rect)
            pixmap = source.get_pixmap(dpi=SUMMARY_DPI)
            sheet.insert_image(frame, stream=pixmap.tobytes("jpeg", jpg_quality=80))
            sheet.draw_rect(frame, color=(0.6, 0.6, 0.6), width=0.5)
            scale = frame.width / source.rect.width
            for number, item in enumerate(entries, start=1):
                shown = pymupdf.Rect(item.rect) * source.rotation_matrix
                shown.normalize()
                anchor = pymupdf.Point(frame.x0 + shown.x0 * scale, frame.y0 + shown.y0 * scale)
                _draw_marker(sheet, anchor, number)
            sheet.insert_htmlbox(
                pymupdf.Rect(split + 4, 64, width - SUMMARY_MARGIN, height - SUMMARY_MARGIN),
                "".join(_entry_html(number, item) for number, item in enumerate(entries, 1)),
                css=BASE_CSS + "p{font-size:9pt;margin:0 0 6pt 0;}",
                archive=archive,
                scale_low=0,
            )
            if position % 10 == 0:
                progress.report(position / max(1, len(by_page)), "progress.rendering")
        if summary.page_count == 0:
            summary.new_page(width=width, height=height)
        summary.save(target, garbage=3, deflate=True)
    finally:
        summary.close()


def _escape_line_start(match: re.Match[str]) -> str:
    lead, marker = match.group(1), match.group(2)
    return lead + (marker[:-1] + "\\." if marker.endswith(".") else "\\" + marker)


def _markdown_text(text: str) -> str:
    escaped = MARKDOWN_SPECIAL.sub(r"\\\1", text)
    return MARKDOWN_LINE_START.sub(_escape_line_start, escaped)


def markdown_summary(
    name: str, items: list[CommentItem], page_label: str, labels: list[str] | None
) -> str:
    lines = [f"# {_markdown_text(name)}", ""]
    current_page: int | None = None
    for item in sorted(items, key=lambda entry: (entry.page, entry.rect[1], entry.rect[0])):
        if item.page != current_page:
            current_page = item.page
            printed = labels[item.page - 1] if labels and item.page <= len(labels) else item.page
            lines += [f"## {_markdown_text(page_label)} {_markdown_text(str(printed))}", ""]
        if item.quote:
            lines += [f"> {_markdown_text(item.quote)}", ""]
        content = [_markdown_text(line.rstrip()) for line in item.content.strip().splitlines()]
        if any(content):
            lines += ["  \n".join(content), ""]
        meta = " · ".join(
            part
            for part in (item.type, item.author, item.created, "✓" if item.resolved else "")
            if part
        )
        if meta:
            lines += [f"*{_markdown_text(meta)}*", ""]
    if current_page is None:
        lines += ["—", ""]
    return "\n".join(lines).rstrip() + "\n"


def _type_label(labels: dict[str, str], subtype: str) -> str:
    label = " ".join(str(labels.get(subtype) or "").split())[:80]
    return label or subtype


@op("comments.export", CommentsExportParams)
def export_comments(params: CommentsExportParams, progress: Progress) -> CommentsExportResult:
    target = _export_target(params.output, params.format, params.overwrite)
    with open_document(params.path, params.password) as document:
        items = [
            item for item in _collect(document) if params.include_resolved or not item.resolved
        ]
        if params.format in ("xfdf", "fdf"):
            write = write_xfdf if params.format == "xfdf" else write_fdf
            chosen = {item.xref for item in items}
            companions = state_replies(document, chosen)
            count = write(document, Path(params.path).name, target, chosen, companions)
            return CommentsExportResult(output=str(target), count=count)
        items = [
            item.model_copy(update={"type": _type_label(params.type_labels, item.type)})
            for item in items
        ]
        if params.format == "pdf" and params.layout == "pages":
            _render_page_summary(document, items, target, params.page_label, progress)
            return CommentsExportResult(output=str(target), count=len(items))
        if params.format == "md":
            summary = markdown_summary(
                Path(params.path).name, items, params.page_label, printed_page_labels(document)
            )
            target.write_text(summary, encoding="utf-8", newline="\n")
            return CommentsExportResult(output=str(target), count=len(items))
    if params.format == "csv":
        with target.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.writer(handle, delimiter=";")
            writer.writerow(
                [
                    "page",
                    "type",
                    "author",
                    "created",
                    "modified",
                    "subject",
                    "content",
                    "resolved",
                    "quote",
                ]
            )
            for item in items:
                writer.writerow(
                    [
                        item.page,
                        inert_cell(item.type),
                        inert_cell(item.author),
                        item.created,
                        item.modified,
                        inert_cell(item.subject),
                        inert_cell(item.content),
                        "yes" if item.resolved else "no",
                        inert_cell(item.quote),
                    ]
                )
    else:
        render_html_to_pdf(_summary_html(Path(params.path).name, items, params.page_label), target)
    return CommentsExportResult(output=str(target), count=len(items))
