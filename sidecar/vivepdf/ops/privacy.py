import contextlib
import secrets

import pymupdf
from pydantic import Field

from vivepdf.ops._actions import remove_risky_actions, risky_action_count
from vivepdf.ops._document import open_document
from vivepdf.ops._offpage import OffPageTally
from vivepdf.ops._payloads import (
    associated_file_names,
    image_metadata_holders,
)
from vivepdf.ops._redact_presets import PRESET_NAMES, preset_matches
from vivepdf.ops._scrub import (
    CANCEL_STRIDE,
    LoadedPages,
)
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MAX_LINKS = 100
SENSITIVE_PRESETS = [name for name in PRESET_NAMES if name != "date"]
STRUCTURAL_ANNOTATIONS = {pymupdf.PDF_ANNOT_WIDGET, pymupdf.PDF_ANNOT_LINK, pymupdf.PDF_ANNOT_POPUP}
UNREADABLE_OBJECT_ERRORS = (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase)
MAX_INFO_VALUE = 500
STANDARD_INFO_KEYS = frozenset(
    {
        "Title",
        "Author",
        "Subject",
        "Keywords",
        "Creator",
        "Producer",
        "CreationDate",
        "ModDate",
        "Trapped",
    }
)


class InspectParams(RpcModel):
    path: str
    password: str | None = Field(default=None, repr=False)


class LinkEntry(RpcModel):
    page: int
    uri: str


class PrivacyReport(RpcModel):
    metadata: dict[str, str]
    xmp_metadata: bool
    javascript: int
    embedded_files: list[str]
    file_attachments: int
    annotations: int
    links: list[LinkEntry]
    link_count: int
    layers: int
    hidden_layers: int
    form_fields: int
    hidden_text: int
    bookmarks: int
    private_data: int = 0
    off_page_content: int = 0
    image_metadata: int = 0
    thumbnails: int = 0
    signatures: int = 0
    sensitive: dict[str, int]
    page_count: int


def _custom_info(document: pymupdf.Document) -> dict[str, str]:
    try:
        kind, value = document.xref_get_key(-1, "Info")
        if kind != "xref":
            return {}
        info = int(value.split()[0])
        keys = document.xref_get_keys(info)
    except UNREADABLE_OBJECT_ERRORS:
        return {}
    found: dict[str, str] = {}
    for key in keys:
        if key in STANDARD_INFO_KEYS:
            continue
        with contextlib.suppress(*UNREADABLE_OBJECT_ERRORS):
            entry_kind, entry = document.xref_get_key(info, key)
            if entry_kind != "null" and entry:
                found[key] = entry[:MAX_INFO_VALUE]
    return found


def _metadata(document: pymupdf.Document) -> dict[str, str]:
    raw = document.metadata or {}
    standard = {
        key: value
        for key, value in raw.items()
        if isinstance(value, str) and value and key not in {"format", "encryption"}
    }
    return standard | _custom_info(document)


def _renew_identifier(document: pymupdf.Document) -> None:
    if document.metadata and document.metadata.get("encryption"):
        return
    first, second = secrets.token_hex(16), secrets.token_hex(16)
    with contextlib.suppress(*UNREADABLE_OBJECT_ERRORS):
        document.xref_set_key(-1, "ID", f"[<{first}><{second}>]")


def _signed_fields(page: pymupdf.Page) -> tuple[int, int]:
    fields = 0
    signed = 0
    for widget in page.widgets():
        fields += 1
        if widget.field_type == pymupdf.PDF_WIDGET_TYPE_SIGNATURE and widget.field_value:
            signed += 1
    return fields, signed


def _has_thumbnail(document: pymupdf.Document, page: pymupdf.Page) -> bool:
    try:
        return document.xref_get_key(page.xref, "Thumb")[0] != "null"
    except UNREADABLE_OBJECT_ERRORS:
        return False


def _signature_total(document: pymupdf.Document, signed: int) -> int:
    if signed:
        return signed
    try:
        return 1 if document.get_sigflags() > 0 else 0
    except UNREADABLE_OBJECT_ERRORS:
        return 0


def _javascript_count(document: pymupdf.Document) -> int:
    return risky_action_count(document)


def _private_data_holders(document: pymupdf.Document) -> list[int]:
    holders: list[int] = []
    for xref in range(1, document.xref_length()):
        try:
            kind, _ = document.xref_get_key(xref, "PieceInfo")
        except Exception:
            continue
        if kind not in ("null", ""):
            holders.append(xref)
    return holders


def _remove_private_data(document: pymupdf.Document) -> None:
    for xref in _private_data_holders(document):
        document.xref_set_key(xref, "PieceInfo", "null")


def _is_navigation(document: pymupdf.Document, kind: str, value: str) -> bool:
    if kind == "array":
        return True
    if kind == "xref":
        target = int(value.split()[0])
        if document.xref_object(target, compressed=True).strip() == "<<>>":
            return False
        return document.xref_get_key(target, "S")[1] == "/GoTo" or (
            document.xref_get_key(target, "S")[0] == "null"
        )
    return kind == "dict" and "/GoTo" in value and "/Next" not in value


def _remove_actions(document: pymupdf.Document, pages: LoadedPages, progress: Progress) -> None:
    catalog = document.pdf_catalog()
    document.xref_set_key(catalog, "AA", "null")
    kind, value = document.xref_get_key(catalog, "OpenAction")
    if kind != "null" and not _is_navigation(document, kind, value):
        document.xref_set_key(catalog, "OpenAction", "null")
    for position, (page, page_xref) in enumerate(pages):
        if position % CANCEL_STRIDE == 0:
            progress.check_cancelled()
        document.xref_set_key(page_xref, "AA", "null")
        for annot in page.annots():
            document.xref_set_key(annot.xref, "AA", "null")
    remove_risky_actions(document, progress)


def _invisible_spans(page: pymupdf.Page) -> int:
    try:
        spans = page.get_texttrace()
    except Exception:  # noqa: BLE001
        return 0
    return sum(1 for span in spans if span.get("type") == 3)


def _layer_counts(document: pymupdf.Document) -> tuple[int, int]:
    try:
        layers = document.get_ocgs()
    except Exception:
        return 0, 0
    hidden = sum(1 for entry in layers.values() if not entry.get("on", True))
    return len(layers), hidden


def _bookmark_count(document: pymupdf.Document) -> int:
    try:
        return len(document.get_toc(simple=True))
    except Exception:
        return 0


def _embedded_names(document: pymupdf.Document) -> list[str]:
    names: list[str] = []
    for index in range(document.embfile_count()):
        info = document.embfile_info(index)
        names.append(str(info.get("filename") or info.get("name") or f"#{index + 1}"))
    return names


def build_report(
    document: pymupdf.Document,
    progress: Progress | None = None,
    *,
    sensitive_scan: bool = True,
    band: tuple[float, float] = (0.0, 1.0),
) -> PrivacyReport:
    links: list[LinkEntry] = []
    link_count = 0
    annotations = 0
    attachments = 0
    form_fields = 0
    hidden_text = 0
    thumbnails = 0
    signed = 0
    off_page = OffPageTally()
    sensitive = {name: 0 for name in SENSITIVE_PRESETS}
    for index, page in enumerate(document):
        if progress is not None:
            progress.check_cancelled()
        for link in page.get_links():
            if link.get("kind") != pymupdf.LINK_URI:
                continue
            link_count += 1
            if len(links) < MAX_LINKS:
                links.append(LinkEntry(page=index + 1, uri=str(link.get("uri", ""))))
        for annot in page.annots():
            kind = annot.type[0]
            if kind == pymupdf.PDF_ANNOT_FILE_ATTACHMENT:
                attachments += 1
            elif kind not in STRUCTURAL_ANNOTATIONS:
                annotations += 1
        fields, signed_here = _signed_fields(page)
        form_fields += fields
        signed += signed_here
        thumbnails += int(_has_thumbnail(document, page))
        hidden_text += _invisible_spans(page)
        off_page.add(page)
        if sensitive_scan:
            for preset, _ in preset_matches(page.get_text(), SENSITIVE_PRESETS):
                sensitive[preset] += 1
        if progress is not None and index % 20 == 0:
            progress.report(
                band[0] + band[1] * index / max(document.page_count, 1),
                "progress.inspecting",
                {"current": index + 1, "total": document.page_count},
            )
    layers, hidden = _layer_counts(document)
    embedded = _embedded_names(document)
    return PrivacyReport(
        metadata=_metadata(document),
        xmp_metadata=bool(document.get_xml_metadata()),
        javascript=_javascript_count(document),
        embedded_files=embedded + associated_file_names(document, embedded),
        file_attachments=attachments,
        annotations=annotations,
        links=links,
        link_count=link_count,
        layers=layers,
        hidden_layers=hidden,
        form_fields=form_fields,
        hidden_text=hidden_text,
        bookmarks=_bookmark_count(document),
        private_data=len(_private_data_holders(document)),
        off_page_content=off_page.total,
        image_metadata=len(image_metadata_holders(document, progress)),
        thumbnails=thumbnails,
        signatures=_signature_total(document, signed),
        sensitive={key: value for key, value in sensitive.items() if value},
        page_count=document.page_count,
    )


@op("security.inspect", InspectParams)
def inspect(params: InspectParams, progress: Progress) -> PrivacyReport:
    with open_document(params.path, params.password) as document:
        return build_report(document, progress)
