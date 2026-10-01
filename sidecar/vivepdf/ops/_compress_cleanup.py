from dataclasses import dataclass

import pymupdf

from vivepdf.ops._objects import set_key
from vivepdf.ops._scrub import CANCEL_STRIDE, load_pages
from vivepdf.ops.privacy import _javascript_count, _remove_actions
from vivepdf.rpc.progress import Progress

KEPT_WITH_COMMENTS = {pymupdf.PDF_ANNOT_POPUP, pymupdf.PDF_ANNOT_FILE_ATTACHMENT}


@dataclass(frozen=True)
class CleanupChoice:
    attachments: bool = False
    comments: bool = False
    scripts: bool = False

    @property
    def any(self) -> bool:
        return self.attachments or self.comments or self.scripts


@dataclass(frozen=True)
class Cleanup:
    attachments: int = 0
    comments: int = 0
    scripts: int = 0

    @property
    def removed(self) -> int:
        return self.attachments + self.comments + self.scripts


def _annotations_of(page: pymupdf.Page, wanted) -> list[int]:
    try:
        return [annot.xref for annot in page.annots() if wanted(annot.type[0])]
    except Exception:  # noqa: BLE001
        return []


def _delete_annotations(page: pymupdf.Page, xrefs: list[int]) -> int:
    deleted = 0
    for xref in xrefs:
        try:
            annot = page.load_annot(xref)
        except Exception:  # noqa: BLE001
            continue
        if annot is None:
            continue
        page.delete_annot(annot)
        deleted += 1
    return deleted


def _remove_page_annotations(document: pymupdf.Document, wanted, progress: Progress) -> int:
    removed = 0
    for index in range(document.page_count):
        if index % CANCEL_STRIDE == 0:
            progress.check_cancelled()
        page = document[index]
        removed += _delete_annotations(page, _annotations_of(page, wanted))
    return removed


def remove_attachments(document: pymupdf.Document, progress: Progress) -> int:
    embedded = document.embfile_count()
    for _ in range(embedded):
        document.embfile_del(0)
    annotated = _remove_page_annotations(
        document, lambda kind: kind == pymupdf.PDF_ANNOT_FILE_ATTACHMENT, progress
    )
    return embedded + annotated


def remove_comments(document: pymupdf.Document, progress: Progress) -> int:
    return _remove_page_annotations(document, lambda kind: kind not in KEPT_WITH_COMMENTS, progress)


def remove_scripts(document: pymupdf.Document, progress: Progress) -> int:
    found = _javascript_count(document)
    if not found:
        return 0
    _remove_actions(document, load_pages(document), progress)
    catalog = document.pdf_catalog()
    if document.xref_get_key(catalog, "Names/JavaScript")[0] != "null":
        set_key(document, catalog, ["Names", "JavaScript"], "null")
    return found


def clean_up(document: pymupdf.Document, choice: CleanupChoice, progress: Progress) -> Cleanup:
    if not choice.any or document.is_encrypted:
        return Cleanup()
    return Cleanup(
        attachments=remove_attachments(document, progress) if choice.attachments else 0,
        comments=remove_comments(document, progress) if choice.comments else 0,
        scripts=remove_scripts(document, progress) if choice.scripts else 0,
    )
