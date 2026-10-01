import html
import re
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._a11y_tree import (
    FigureInfo,
    StructureWalk,
    _refs,
    _walk_structure,
)
from vivepdf.ops._access_structure import (
    ImageSamples,
    StructureFacts,
    content_mcids,
    low_contrast_runs,
    order_differs,
    structure_facts,
)
from vivepdf.ops._document import open_document
from vivepdf.ops.analyze import _analyze_page
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

BOOKMARK_PAGE_THRESHOLD = 10
LINK_KINDS = {pymupdf.LINK_URI, pymupdf.LINK_GOTO, pymupdf.LINK_NAMED}
Status = Literal["pass", "warn", "fail"]
XMP_TITLE_PATTERN = re.compile(r"<dc:title\b[^>]*>(.*?)</dc:title>", re.DOTALL)
XMP_ENTRY_PATTERN = re.compile(r"<rdf:li\b[^>]*>(.*?)</rdf:li>", re.DOTALL)
PDFUA_PATTERN = re.compile(r"pdfuaid:part\s*(?:=\s*[\"']\s*|>\s*)(\d+)")
PAGE_LIMIT = 200
SKIPPED_ANNOTATIONS = {"/Popup"}
UNREADABLE_ENCODINGS = {"Identity-H", "Identity-V"}


class CheckItem(RpcModel):
    id: str
    status: Status
    value: str | None = None
    count: int | None = None
    pages: list[int] = Field(default_factory=list)


class AccessReport(RpcModel):
    tagged: bool
    title: str
    display_doc_title: bool
    language: str | None
    has_bookmarks: bool
    page_count: int
    figures: list[FigureInfo]
    figures_total: int
    figures_without_alt: int
    headings: dict[str, int]
    heading_skips: int
    tables: int
    images_untagged: int
    scanned_pages: int
    unembedded_fonts: list[str]
    unlabelled_fields: int
    tables_without_headers: int = 0
    tab_order_pages: int = 0
    links_without_text: int = 0
    access_permission: bool = True
    untagged_content_pages: int = 0
    reading_order_pages: int = 0
    lists: int = 0
    list_errors: int = 0
    low_contrast_runs: int = 0
    low_contrast_pages: int = 0
    pdf_ua: str | None = None
    unmapped_types: list[str] = Field(default_factory=list)
    checks: list[CheckItem]
    score: int


def _catalog_string(document: pymupdf.Document, key: str) -> str | None:
    kind, value = document.xref_get_key(document.pdf_catalog(), key)
    if kind == "string" and value:
        return value
    return None


def _xmp_title(document: pymupdf.Document) -> str:
    try:
        xmp = document.get_xml_metadata() or ""
    except Exception:  # noqa: BLE001
        return ""
    block = XMP_TITLE_PATTERN.search(xmp)
    if not block:
        return ""
    entry = XMP_ENTRY_PATTERN.search(block.group(1))
    return html.unescape(entry.group(1)).strip() if entry else ""


def _display_doc_title(document: pymupdf.Document) -> bool:
    kind, value = document.xref_get_key(document.pdf_catalog(), "ViewerPreferences/DisplayDocTitle")
    return kind == "bool" and value == "true"


def _is_tagged(document: pymupdf.Document) -> bool:
    catalog = document.pdf_catalog()
    marked_kind, marked = document.xref_get_key(catalog, "MarkInfo/Marked")
    root_kind, _root = document.xref_get_key(catalog, "StructTreeRoot")
    return root_kind == "xref" and (marked_kind != "bool" or marked == "true")


def _page_list(pages: set[int] | list[int]) -> list[int]:
    return sorted(pages)[:PAGE_LIMIT]


def _pdf_ua_part(document: pymupdf.Document) -> str | None:
    try:
        xmp = document.get_xml_metadata() or ""
    except Exception:  # noqa: BLE001
        return None
    match = PDFUA_PATTERN.search(xmp)
    return match.group(1) if match else None


def _suspects(document: pymupdf.Document) -> bool:
    return document.xref_get_key(document.pdf_catalog(), "MarkInfo/Suspects") == ("bool", "true")


def _font_has_unicode(document: pymupdf.Document, xref: int) -> bool:
    if xref <= 0:
        return True
    kind, _value = document.xref_get_key(xref, "ToUnicode")
    return kind != "null"


class FontFacts:
    def __init__(self) -> None:
        self.unembedded: list[str] = []
        self.unembedded_pages: set[int] = set()
        self.without_unicode: set[int] = set()
        self.without_unicode_pages: set[int] = set()


def _font_facts(document: pymupdf.Document) -> FontFacts:
    facts = FontFacts()
    seen: set[str] = set()
    checked: dict[int, bool] = {}
    for index in range(document.page_count):
        for font in document.get_page_fonts(index, full=True):
            xref, ext, font_type, basefont, encoding = font[0], font[1], font[2], font[3], font[5]
            needs_map = font_type == "Type3" or (
                font_type == "Type0" and str(encoding).lstrip("/") in UNREADABLE_ENCODINGS
            )
            if needs_map:
                if xref not in checked:
                    checked[xref] = _font_has_unicode(document, xref)
                if not checked[xref]:
                    facts.without_unicode.add(xref)
                    facts.without_unicode_pages.add(index + 1)
            if font_type == "Type3" or ext != "n/a":
                continue
            facts.unembedded_pages.add(index + 1)
            if basefont not in seen:
                seen.add(basefont)
                facts.unembedded.append(basefont)
    facts.unembedded.sort()
    return facts


def _annotations_without_structure(document: pymupdf.Document, page: pymupdf.Page) -> int:
    kind, value = document.xref_get_key(page.xref, "Annots")
    if kind == "xref":
        value = document.xref_object(int(value.split()[0]), compressed=True)
    elif kind != "array":
        return 0
    missing = 0
    for xref in _refs(value):
        if xref <= 0 or xref >= document.xref_length():
            continue
        subtype_kind, subtype = document.xref_get_key(xref, "Subtype")
        if subtype_kind != "name" or subtype in SKIPPED_ANNOTATIONS:
            continue
        if document.xref_get_key(xref, "StructParent")[0] != "int":
            missing += 1
    return missing


def require_pages(document: pymupdf.Document) -> None:
    if document.page_count == 0 or document.pdf_catalog() <= 0:
        raise OpError(ErrorCode.INVALID_PDF, "document has no pages")


def _page_tabs(document: pymupdf.Document, page: pymupdf.Page) -> str | None:
    kind, value = document.xref_get_key(page.xref, "Tabs")
    return value if kind == "name" else None


def _needs_tab_order(page: pymupdf.Page) -> bool:
    return page.first_annot is not None or page.first_widget is not None or bool(page.get_links())


def _links_without_text(document: pymupdf.Document, page: pymupdf.Page) -> int:
    missing = 0
    for link in page.get_links():
        if link.get("kind") not in LINK_KINDS:
            continue
        xref = link.get("xref") or 0
        if xref <= 0:
            continue
        kind, value = document.xref_get_key(xref, "Contents")
        if kind != "string" or not value.strip():
            missing += 1
    return missing


def _has_access_permission(document: pymupdf.Document) -> bool:
    if not (document.metadata or {}).get("encryption"):
        return True
    return bool(document.permissions & pymupdf.PDF_PERM_ACCESSIBILITY)


def build_report(document: pymupdf.Document, progress: Progress | None = None) -> AccessReport:
    require_pages(document)
    catalog = document.pdf_catalog()
    tagged = _is_tagged(document)
    page_numbers = {document.page_xref(index): index + 1 for index in range(document.page_count)}
    walk = StructureWalk()
    facts = StructureFacts()
    if tagged:
        root = _refs(document.xref_get_key(catalog, "StructTreeRoot")[1])
        if root:
            walk = _walk_structure(document, root[0], page_numbers)
            facts = structure_facts(document, root[0])
    untagged_content_pages = 0
    reading_order_pages = 0
    contrast_runs = 0
    contrast_pages = 0
    image_samples = ImageSamples(document)
    images_untagged = 0
    scanned = 0
    unlabelled = 0
    tab_order_pages = 0
    links_without_text = 0
    annotations_untagged = 0
    pages_of: dict[str, set[int]] = {
        key: set()
        for key in (
            "images",
            "scanned",
            "formLabels",
            "tabOrder",
            "linkText",
            "untagged",
            "order",
            "contrast",
            "annotations",
        )
    }
    for index in range(document.page_count):
        if progress is not None:
            progress.check_cancelled()
        page = document[index]
        number = index + 1
        if not tagged:
            page_images = len(page.get_image_info())
            images_untagged += page_images
            if page_images:
                pages_of["images"].add(number)
        if _analyze_page(document, index).scanned:
            scanned += 1
            pages_of["scanned"].add(number)
        for widget in page.widgets():
            if not (widget.field_label or "").strip():
                unlabelled += 1
                pages_of["formLabels"].add(number)
        if _needs_tab_order(page) and _page_tabs(document, page) != "/S":
            tab_order_pages += 1
            pages_of["tabOrder"].add(number)
        page_links = _links_without_text(document, page)
        links_without_text += page_links
        if page_links:
            pages_of["linkText"].add(number)
        page_annotations = _annotations_without_structure(document, page)
        annotations_untagged += page_annotations
        if page_annotations:
            pages_of["annotations"].add(number)
        has_text = bool(page.get_text("text").strip())
        structure_order = facts.order.get(page.xref, [])
        if has_text and not structure_order:
            untagged_content_pages += 1
            pages_of["untagged"].add(number)
        elif structure_order and order_differs(structure_order, content_mcids(document, page)):
            reading_order_pages += 1
            pages_of["order"].add(number)
        runs = low_contrast_runs(page, image_samples) if has_text else 0
        contrast_runs += runs
        if runs:
            contrast_pages += 1
            pages_of["contrast"].add(number)
        if progress is not None and (index + 1) % 20 == 0:
            progress.report(
                (index + 1) / document.page_count,
                "progress.analyzing",
                {"current": index + 1, "total": document.page_count},
            )
    title = str((document.metadata or {}).get("title") or "").strip() or _xmp_title(document)
    language = _catalog_string(document, "Lang")
    display = _display_doc_title(document)
    has_bookmarks = bool(document.get_toc(simple=True))
    fonts = _font_facts(document)
    unembedded = fonts.unembedded
    without_alt = walk.figures_without_alt
    pdf_ua = _pdf_ua_part(document)
    suspects = _suspects(document)
    unmapped = sorted(walk.unmapped_types)
    headings = walk.headings
    access_permission = _has_access_permission(document)
    checks = [
        CheckItem(id="tagged", status="pass" if tagged else "fail"),
        CheckItem(id="title", status="pass" if title else "fail", value=title or None),
        CheckItem(id="displayTitle", status="pass" if display else "warn"),
        CheckItem(id="language", status="pass" if language else "fail", value=language),
        CheckItem(
            id="altText",
            status="pass"
            if (without_alt == 0 if tagged else images_untagged == 0)
            else ("fail" if without_alt else "warn"),
            count=without_alt if tagged else images_untagged,
            pages=_page_list(walk.figure_pages_without_alt if tagged else pages_of["images"]),
        ),
        CheckItem(
            id="headings",
            status="pass" if headings and walk.heading_skips == 0 else "warn",
            count=sum(headings.values()),
        ),
        CheckItem(
            id="bookmarks",
            status="pass"
            if has_bookmarks or document.page_count < BOOKMARK_PAGE_THRESHOLD
            else "warn",
        ),
        CheckItem(
            id="scanned",
            status="pass" if scanned == 0 else "fail",
            count=scanned,
            pages=_page_list(pages_of["scanned"]),
        ),
        CheckItem(
            id="fonts",
            status="pass" if not unembedded else "warn",
            count=len(unembedded),
            pages=_page_list(fonts.unembedded_pages),
        ),
        CheckItem(
            id="unicode",
            status="pass" if not fonts.without_unicode else "fail",
            count=len(fonts.without_unicode),
            pages=_page_list(fonts.without_unicode_pages),
        ),
        CheckItem(
            id="formLabels",
            status="pass" if unlabelled == 0 else "warn",
            count=unlabelled,
            pages=_page_list(pages_of["formLabels"]),
        ),
        CheckItem(
            id="tableHeaders",
            status="pass" if walk.tables_without_headers == 0 else "fail",
            count=walk.tables_without_headers,
        ),
        CheckItem(
            id="tabOrder",
            status="pass" if tab_order_pages == 0 else ("fail" if tagged else "warn"),
            count=tab_order_pages,
            pages=_page_list(pages_of["tabOrder"]),
        ),
        CheckItem(
            id="linkText",
            status="pass" if links_without_text == 0 else "warn",
            count=links_without_text,
            pages=_page_list(pages_of["linkText"]),
        ),
        CheckItem(
            id="annotations",
            status="pass" if annotations_untagged == 0 else ("fail" if tagged else "warn"),
            count=annotations_untagged,
            pages=_page_list(pages_of["annotations"]),
        ),
        CheckItem(id="accessPermission", status="pass" if access_permission else "fail"),
        CheckItem(
            id="readingOrder",
            status="fail" if untagged_content_pages else "warn" if reading_order_pages else "pass",
            count=untagged_content_pages or reading_order_pages,
            pages=_page_list(pages_of["untagged"] or pages_of["order"]),
        ),
        CheckItem(
            id="listStructure",
            status="fail" if facts.list_errors else "pass",
            count=facts.list_errors or facts.lists,
        ),
        CheckItem(
            id="contrast",
            status="warn" if contrast_runs else "pass",
            count=contrast_runs,
            value=str(contrast_pages) if contrast_pages else None,
            pages=_page_list(pages_of["contrast"]),
        ),
        CheckItem(
            id="roleMap",
            status="fail" if unmapped else "pass",
            count=len(unmapped),
            value=", ".join(unmapped[:10]) or None,
        ),
        CheckItem(id="suspects", status="fail" if suspects else "pass"),
        CheckItem(id="pdfUa", status="pass" if pdf_ua else "warn", value=pdf_ua),
    ]
    weights = {"pass": 1.0, "warn": 0.5, "fail": 0.0}
    score = round(100 * sum(weights[check.status] for check in checks) / len(checks))
    return AccessReport(
        tagged=tagged,
        title=title,
        display_doc_title=display,
        language=language,
        has_bookmarks=has_bookmarks,
        page_count=document.page_count,
        figures=walk.figures,
        figures_total=walk.figures_total,
        figures_without_alt=without_alt,
        headings=headings,
        heading_skips=walk.heading_skips,
        tables=walk.tables,
        images_untagged=images_untagged,
        scanned_pages=scanned,
        unembedded_fonts=unembedded,
        unlabelled_fields=unlabelled,
        tables_without_headers=walk.tables_without_headers,
        tab_order_pages=tab_order_pages,
        links_without_text=links_without_text,
        access_permission=access_permission,
        untagged_content_pages=untagged_content_pages,
        reading_order_pages=reading_order_pages,
        lists=facts.lists,
        list_errors=facts.list_errors,
        low_contrast_runs=contrast_runs,
        low_contrast_pages=contrast_pages,
        pdf_ua=pdf_ua,
        unmapped_types=unmapped,
        checks=checks,
        score=score,
    )


class CheckParams(RpcModel):
    path: str
    password: str | None = None


@op("a11y.check", CheckParams)
def check(params: CheckParams, progress: Progress) -> AccessReport:
    with open_document(params.path, params.password) as document:
        return build_report(document, progress)
