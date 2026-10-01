import pymupdf

from vivepdf.rpc.progress import Progress

ANNOT_HIDDEN = 2
ANNOT_PRINT = 4
ANNOT_NO_VIEW = 32


def annotation_flags(document: pymupdf.Document, xref: int) -> int:
    kind, value = document.xref_get_key(xref, "F")
    return int(value) if kind == "int" else 0


def is_unseen(flags: int, printed_only: bool) -> bool:
    if flags & (ANNOT_HIDDEN | ANNOT_NO_VIEW):
        return True
    return printed_only and not flags & ANNOT_PRINT


def drop_unseen(
    document: pymupdf.Document,
    progress: Progress,
    printed_only: bool,
    annotations: bool,
    widgets: bool,
) -> int:
    dropped = 0
    for page in document:
        progress.check_cancelled()
        if annotations:
            for annotation in list(page.annots()):
                if is_unseen(annotation.flags, printed_only):
                    page.delete_annot(annotation)
                    dropped += 1
        if widgets:
            for widget in list(page.widgets()):
                if is_unseen(annotation_flags(document, widget.xref), printed_only):
                    page.delete_widget(widget)
                    dropped += 1
    return dropped
