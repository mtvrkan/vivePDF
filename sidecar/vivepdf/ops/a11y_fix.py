import re

import pymupdf
from pydantic import Field

from vivepdf.ops._a11y_autotag import AutoTagSummary, auto_tag
from vivepdf.ops._a11y_tree import FIGURE_TYPES
from vivepdf.ops._document import open_document
from vivepdf.ops._objects import set_key
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops.a11y import (
    LINK_KINDS,
    _is_tagged,
    _needs_tab_order,
    _page_tabs,
    build_report,
    require_pages,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

XMP_TITLE_PATTERN = re.compile(r"<dc:title>.*?</dc:title>", re.DOTALL)


def pdf_text_string(value: str) -> str:
    if value.isascii():
        escaped = value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        return f"({escaped})"
    return "<FEFF" + value.encode("utf-16-be").hex().upper() + ">"


def _link_description(page: pymupdf.Page, link: dict) -> str:
    rect = pymupdf.Rect(link.get("from") or pymupdf.Rect())
    text = " ".join(page.get_textbox(rect).split()) if not rect.is_empty else ""
    if text:
        return text
    if link.get("kind") == pymupdf.LINK_URI and link.get("uri"):
        return str(link["uri"])
    if link.get("kind") == pymupdf.LINK_GOTO and int(link.get("page", -1)) >= 0:
        return str(int(link["page"]) + 1)
    return ""


def _xmp_escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _sync_xmp_title(document: pymupdf.Document, title: str) -> None:
    xml = document.get_xml_metadata()
    if not xml or not XMP_TITLE_PATTERN.search(xml):
        return
    replacement = (
        '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">'
        f"{_xmp_escape(title)}</rdf:li></rdf:Alt></dc:title>"
    )
    document.set_xml_metadata(XMP_TITLE_PATTERN.sub(lambda _match: replacement, xml, count=1))


class FixParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    title: str | None = None
    language: str | None = None
    display_doc_title: bool | None = None
    alt_texts: dict[int, str] = Field(default_factory=dict)
    tab_order: bool = False
    link_text: bool = False
    auto_tag: bool = False


def _repair_pages(document: pymupdf.Document, params: FixParams, progress: Progress) -> int:
    changes = 0
    total = document.page_count
    for index in range(total):
        progress.check_cancelled()
        page = document[index]
        if params.tab_order and _needs_tab_order(page) and _page_tabs(document, page) != "/S":
            document.xref_set_key(page.xref, "Tabs", "/S")
            changes += 1
        if params.link_text:
            for link in page.get_links():
                xref = link.get("xref") or 0
                if xref <= 0 or link.get("kind") not in LINK_KINDS:
                    continue
                kind, value = document.xref_get_key(xref, "Contents")
                if kind == "string" and value.strip():
                    continue
                description = _link_description(page, link)
                if description:
                    document.xref_set_key(xref, "Contents", pdf_text_string(description))
                    changes += 1
        if (index + 1) % 20 == 0:
            progress.report(
                0.8 * (index + 1) / total,
                "progress.analyzing",
                {"current": index + 1, "total": total},
            )
    return changes


class AutoTagResult(RpcModel):
    paragraphs: int
    headings: int
    figures: int
    artifacts: int
    annotations: int
    pages: int


class FixResult(OutputResult):
    changes: int
    score: int
    auto_tagged: AutoTagResult | None = None
    figures_without_alt: int = 0


@op("a11y.fix", FixParams)
def fix(params: FixParams, progress: Progress) -> FixResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    changes = 0
    with open_document(params.path, params.password) as document:
        require_pages(document)
        summary: AutoTagSummary | None = None
        if params.auto_tag and not _is_tagged(document):
            summary = auto_tag(document, progress, 0.0, 0.5)
            changes += 1
        catalog = document.pdf_catalog()
        if params.title is not None and params.title.strip():
            metadata = {key: value for key, value in (document.metadata or {}).items() if value}
            metadata["title"] = params.title.strip()
            document.set_metadata(metadata)
            _sync_xmp_title(document, params.title.strip())
            changes += 1
        if params.language is not None and params.language.strip():
            document.xref_set_key(catalog, "Lang", pdf_text_string(params.language.strip()))
            changes += 1
        if params.display_doc_title is not None:
            kind, _value = document.xref_get_key(catalog, "ViewerPreferences")
            if kind == "null":
                document.xref_set_key(
                    catalog,
                    "ViewerPreferences",
                    "<</DisplayDocTitle true>>" if params.display_doc_title else "<<>>",
                )
            else:
                set_key(
                    document,
                    catalog,
                    ["ViewerPreferences", "DisplayDocTitle"],
                    "true" if params.display_doc_title else "false",
                )
            changes += 1
        for xref, alt in params.alt_texts.items():
            if xref <= 0 or xref >= document.xref_length():
                raise OpError(ErrorCode.INVALID_PARAMS, f"invalid figure reference {xref}")
            kind_type, kind = document.xref_get_key(xref, "S")
            if kind_type != "name" or kind not in FIGURE_TYPES:
                raise OpError(ErrorCode.INVALID_PARAMS, f"object {xref} is not a figure")
            if not alt.strip():
                continue
            document.xref_set_key(xref, "Alt", pdf_text_string(alt.strip()))
            changes += 1
        if params.tab_order or params.link_text:
            changes += _repair_pages(document, params, progress)
        progress.report(0.8, "progress.saving")
        report = build_report(document)
        saved = save_document(document, target)
        return FixResult(
            output=saved.output,
            page_count=saved.page_count,
            bytes=saved.bytes,
            changes=changes,
            score=report.score,
            auto_tagged=AutoTagResult(**vars(summary)) if summary else None,
            figures_without_alt=report.figures_without_alt,
        )
