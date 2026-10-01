import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._layer_flatten import _flatten_layers
from vivepdf.ops._metadata import clear_metadata
from vivepdf.ops._offpage import remove_off_page
from vivepdf.ops._output import garbage_level, prepare_output, save_document
from vivepdf.ops._passwords import authenticate_password
from vivepdf.ops._payloads import (
    remove_associated_files,
    remove_image_metadata,
)
from vivepdf.ops._scrub import (
    LoadedPages,
    ScrubOptions,
    clean_page_contents,
    load_pages,
    scrub_document,
)
from vivepdf.ops.privacy import (
    STRUCTURAL_ANNOTATIONS,
    UNREADABLE_OBJECT_ERRORS,
    PrivacyReport,
    _remove_actions,
    _remove_private_data,
    _renew_identifier,
    build_report,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class SanitizeParams(RpcModel):
    path: str
    password: str | None = Field(default=None, repr=False)
    output: str
    overwrite: bool = False
    metadata: bool = True
    xmp_metadata: bool = True
    javascript: bool = True
    embedded_files: bool = True
    file_attachments: bool = True
    annotations: bool = False
    links: bool = False
    thumbnails: bool = True
    reset_forms: bool = False
    hidden_text: bool = False
    hidden_layers: bool = False
    bookmarks: bool = False
    private_data: bool = False
    off_page: bool = False
    image_metadata: bool = True


class SanitizeResult(RpcModel):
    output: str
    page_count: int
    bytes: int
    removed: dict[str, int]


def _delete_annotations(pages: LoadedPages) -> int:
    removed = 0
    for page, _ in pages:
        for annot in list(page.annots()):
            if annot.type[0] in STRUCTURAL_ANNOTATIONS:
                continue
            page.delete_annot(annot)
            removed += 1
    return removed


def _delete_file_annotations(pages: LoadedPages) -> int:
    removed = 0
    for page, _ in pages:
        for annot in list(page.annots(types=[pymupdf.PDF_ANNOT_FILE_ATTACHMENT])):
            page.delete_annot(annot)
            removed += 1
    return removed


def _delete_bookmarks(document: pymupdf.Document) -> None:
    document.set_toc([])
    catalog = document.pdf_catalog()
    kind, _ = document.xref_get_key(catalog, "Dests")
    if kind != "null":
        document.xref_set_key(catalog, "Dests", "null")
    kind, value = document.xref_get_key(catalog, "Names")
    if kind == "xref":
        names_xref = int(value.split()[0])
        sub_kind, _ = document.xref_get_key(names_xref, "Dests")
        if sub_kind != "null":
            document.xref_set_key(names_xref, "Dests", "null")


SANITIZE_SWITCHES = (
    "metadata",
    "xmp_metadata",
    "javascript",
    "embedded_files",
    "file_attachments",
    "annotations",
    "links",
    "thumbnails",
    "reset_forms",
    "hidden_text",
    "hidden_layers",
    "bookmarks",
    "private_data",
    "off_page",
    "image_metadata",
)


def _scrub_options(params: SanitizeParams) -> ScrubOptions:
    return ScrubOptions(
        attached_files=params.file_attachments,
        embedded_files=params.embedded_files,
        hidden_text=params.hidden_text,
        javascript=params.javascript,
        metadata=params.metadata,
        remove_links=params.links,
        reset_fields=params.reset_forms,
        reset_responses=params.annotations,
        thumbnails=params.thumbnails,
        xml_metadata=params.xmp_metadata,
    )


def _report_of(path: str, password: str | None, progress: Progress) -> PrivacyReport:
    document = pymupdf.open(path)
    try:
        if document.needs_pass:
            authenticate_password(document, password or "")
        return build_report(document, progress, sensitive_scan=False, band=(0.9, 0.1))
    finally:
        document.close()


def _verified_removals(
    before: PrivacyReport, after: PrivacyReport, params: SanitizeParams
) -> dict[str, int]:
    counted = {
        "metadata": (params.metadata, len(before.metadata), len(after.metadata)),
        "xmpMetadata": (params.xmp_metadata, int(before.xmp_metadata), int(after.xmp_metadata)),
        "javascript": (params.javascript, before.javascript, after.javascript),
        "embeddedFiles": (
            params.embedded_files,
            len(before.embedded_files),
            len(after.embedded_files),
        ),
        "fileAttachments": (
            params.file_attachments,
            before.file_attachments,
            after.file_attachments,
        ),
        "annotations": (params.annotations, before.annotations, after.annotations),
        "links": (params.links, before.link_count, after.link_count),
        "hiddenText": (params.hidden_text, before.hidden_text, after.hidden_text),
        "hiddenLayers": (params.hidden_layers, before.hidden_layers, after.hidden_layers),
        "bookmarks": (params.bookmarks, before.bookmarks, after.bookmarks),
        "privateData": (params.private_data, before.private_data, after.private_data),
        "offPage": (params.off_page, before.off_page_content, after.off_page_content),
        "imageMetadata": (params.image_metadata, before.image_metadata, after.image_metadata),
        "thumbnails": (params.thumbnails, before.thumbnails, after.thumbnails),
    }
    removed = {key: max(0, was - now) for key, (on, was, now) in counted.items() if on}
    return {key: value for key, value in removed.items() if value}


def _has_unreadable_objects(document: pymupdf.Document) -> bool:
    for xref in range(1, document.xref_length()):
        try:
            document.xref_object(xref)
        except UNREADABLE_OBJECT_ERRORS:
            return True
    return False


def _scrubbable(document: pymupdf.Document, params: SanitizeParams) -> pymupdf.Document:
    if not (params.javascript or params.xmp_metadata) or not _has_unreadable_objects(document):
        return document
    rebuilt = pymupdf.open("pdf", document.tobytes(garbage=1, encryption=pymupdf.PDF_ENCRYPT_KEEP))
    if rebuilt.needs_pass:
        authenticate_password(rebuilt, params.password or "")
    return rebuilt


@op("security.sanitize", SanitizeParams)
def sanitize(params: SanitizeParams, progress: Progress) -> SanitizeResult:
    if not any(getattr(params, switch) for switch in SANITIZE_SWITCHES):
        raise OpError(ErrorCode.INVALID_PARAMS, "nothing selected to remove")
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        progress.report(0.05, "progress.inspecting")
        before = build_report(document, progress, sensitive_scan=False, band=(0.05, 0.3))
        progress.report(0.35, "progress.sanitizing")
        document = _scrubbable(document, params)
        pages = load_pages(document)
        scrub_document(document, pages, _scrub_options(params), progress, (0.35, 0.35))
        if params.metadata or params.xmp_metadata:
            clear_metadata(document, info=params.metadata, xmp=params.xmp_metadata)
        if params.metadata:
            _renew_identifier(document)
        if params.annotations:
            _delete_annotations(pages)
        if params.file_attachments:
            _delete_file_annotations(pages)
        if params.hidden_layers:
            _flatten_layers(document, pages, progress)
        if params.bookmarks:
            _delete_bookmarks(document)
        if params.javascript:
            _remove_actions(document, pages, progress)
        if params.private_data:
            _remove_private_data(document)
        if params.off_page:
            remove_off_page(pages, progress)
        if params.embedded_files:
            remove_associated_files(document)
        if params.image_metadata:
            remove_image_metadata(document, progress)
        progress.report(0.75, "progress.sanitizing")
        clean_page_contents(pages, progress)
        progress.check_cancelled()
        progress.report(0.85, "progress.saving")
        saved = save_document(document, target, garbage=garbage_level(document, 4))
    after = _report_of(saved.output, params.password, progress)
    return SanitizeResult(
        output=saved.output,
        page_count=saved.page_count,
        bytes=saved.bytes,
        removed=_verified_removals(before, after, params),
    )
