from dataclasses import dataclass

import pymupdf

from vivepdf.ops._actions import remove_risky_actions
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress

CANCEL_STRIDE = 200
EXTERNAL_LINK_KINDS = frozenset({pymupdf.LINK_URI, pymupdf.LINK_LAUNCH, pymupdf.LINK_GOTOR})

LoadedPages = list[tuple[pymupdf.Page, int]]


@dataclass(frozen=True)
class ScrubOptions:
    attached_files: bool = True
    embedded_files: bool = True
    hidden_text: bool = True
    javascript: bool = True
    metadata: bool = True
    remove_links: bool = True
    reset_fields: bool = True
    reset_responses: bool = True
    thumbnails: bool = True
    xml_metadata: bool = True


def load_pages(document: pymupdf.Document) -> LoadedPages:
    return [(document[index], document.page_xref(index)) for index in range(document.page_count)]


def _is_hidden_span(span: dict) -> bool:
    font = span.get(pymupdf.dictkey_font) or span.get("font")
    if isinstance(font, str) and font.split("+")[-1] == "GlyphLessFont":
        return True
    if span.get("alpha") == 0:
        return True
    flags = span.get(pymupdf.dictkey_char_flags)
    filled_flag = getattr(pymupdf.mupdf, "FZ_STEXT_FILLED", None)
    stroked_flag = getattr(pymupdf.mupdf, "FZ_STEXT_STROKED", None)
    if isinstance(flags, int) and isinstance(filled_flag, int) and isinstance(stroked_flag, int):
        return not (flags & filled_flag) and not (flags & stroked_flag)
    return False


def _redact_hidden_text(page: pymupdf.Page) -> int:
    count = 0
    content = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_SPANS | pymupdf.TEXT_COLLECT_STYLES)
    for block in content.get("blocks", ()):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", ()):
            for span in line.get(pymupdf.dictkey_spans, ()):
                if not _is_hidden_span(span):
                    continue
                bbox = span.get(pymupdf.dictkey_bbox) or span.get("bbox")
                if not bbox:
                    continue
                rect = pymupdf.Rect(bbox)
                if rect.is_empty or rect.is_infinite:
                    continue
                page.add_redact_annot(rect, cross_out=False)
                count += 1
    return count


def _scrub_page(
    document: pymupdf.Document, page: pymupdf.Page, page_xref: int, options: ScrubOptions
) -> None:
    if options.reset_fields:
        for widget in page.widgets():
            widget.reset()
    if options.remove_links:
        for link in page.get_links():
            if link.get("kind") in EXTERNAL_LINK_KINDS:
                page.delete_link(link)
    hidden = _redact_hidden_text(page) if options.hidden_text else 0
    for annot in page.annots():
        if annot.type[0] == pymupdf.PDF_ANNOT_FILE_ATTACHMENT and options.attached_files:
            annot.update_file(buffer_=b" ")
        if options.reset_responses:
            annot.delete_responses()
    if hidden:
        page.apply_redactions(images=0)
    page.clean_contents()
    if options.thumbnails and document.xref_get_key(page_xref, "Thumb")[0] != "null":
        document.xref_set_key(page_xref, "Thumb", "null")


def _scrub_objects(document: pymupdf.Document, options: ScrubOptions, progress: Progress) -> None:
    if not (options.xml_metadata or options.javascript):
        return
    for xref in range(1, document.xref_length()):
        if xref % CANCEL_STRIDE == 0:
            progress.check_cancelled()
        if not document.xref_object(xref):
            raise OpError(
                ErrorCode.INVALID_PDF,
                f"document is damaged: bad xref {xref}",
                {"reason": "damaged"},
            )
        if not options.xml_metadata:
            continue
        if document.xref_get_key(xref, "Type")[1] == "/Metadata":
            document.update_object(xref, "<<>>")
            document.update_stream(xref, b"deleted", new=True)
            continue
        if document.xref_get_key(xref, "Metadata")[0] != "null":
            document.xref_set_key(xref, "Metadata", "null")


def scrub_document(
    document: pymupdf.Document,
    pages: LoadedPages,
    options: ScrubOptions,
    progress: Progress,
    band: tuple[float, float] | None = None,
) -> None:
    if options.metadata:
        document.set_metadata({})
    for position, (page, page_xref) in enumerate(pages):
        if position % CANCEL_STRIDE == 0:
            progress.check_cancelled()
            if band is not None:
                progress.report(
                    band[0] + band[1] * position / max(1, len(pages)),
                    "progress.sanitizing",
                    {"current": position + 1, "total": len(pages)},
                )
        _scrub_page(document, page, page_xref, options)
    if options.embedded_files:
        for name in document.embfile_names():
            document.embfile_del(name)
    if options.xml_metadata:
        document.del_xml_metadata()
    _scrub_objects(document, options, progress)
    if options.javascript:
        remove_risky_actions(document, progress)


def clean_page_contents(pages: LoadedPages, progress: Progress) -> None:
    for position, (page, _) in enumerate(pages):
        if position % CANCEL_STRIDE == 0:
            progress.check_cancelled()
        page.clean_contents()
        for annot in page.annots():
            annot.clean_contents()
