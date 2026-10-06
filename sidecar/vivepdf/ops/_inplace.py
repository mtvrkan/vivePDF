import sys
from pathlib import Path

import pymupdf
from pymupdf import mupdf

from vivepdf.ops._document import forget_document
from vivepdf.ops._font_unicode import repair_unicode_maps
from vivepdf.ops._output import OutputResult, garbage_level, prepare_output, save_document

INCREMENTAL_SAVE_ERRORS = (RuntimeError, ValueError, mupdf.FzErrorBase)


def replace_through_temporary(document: pymupdf.Document, path: str, **options: object) -> None:
    temporary = Path(path + ".vivepdf-tmp")
    try:
        document.save(temporary, encryption=pymupdf.PDF_ENCRYPT_KEEP, **options)
        document.close()
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def save_incrementally(document: pymupdf.Document, path: str) -> None:
    if not document.can_save_incrementally():
        raise ValueError("the document cannot be saved incrementally")
    document.save(path, incremental=True, encryption=pymupdf.PDF_ENCRYPT_KEEP)


def save_in_place(document: pymupdf.Document, path: str) -> OutputResult:
    forget_document(path)
    repair_unicode_maps(document)
    try:
        save_incrementally(document, path)
        document.close()
    except INCREMENTAL_SAVE_ERRORS as error:
        print(f"[inplace] incremental save failed, rewriting: {error}", file=sys.stderr)
        page_count = document.page_count
        replace_through_temporary(document, path, garbage=0, deflate=True)
        return OutputResult(output=path, page_count=page_count, bytes=Path(path).stat().st_size)
    with pymupdf.open(path) as reopened:
        return OutputResult(
            output=path, page_count=reopened.page_count, bytes=Path(path).stat().st_size
        )


def rewrite_in_place(document: pymupdf.Document, path: str) -> OutputResult:
    forget_document(path)
    repair_unicode_maps(document)
    page_count = document.page_count
    replace_through_temporary(document, path, garbage=garbage_level(document), deflate=True)
    return OutputResult(output=path, page_count=page_count, bytes=Path(path).stat().st_size)


def check_output(path: str, output: str | None, in_place: bool, overwrite: bool) -> None:
    if not in_place and output:
        prepare_output(output, [path], overwrite)


def finish(
    document: pymupdf.Document, path: str, output: str | None, in_place: bool, overwrite: bool
) -> OutputResult:
    if in_place or not output:
        return rewrite_in_place(document, path)
    target = prepare_output(output, [path], overwrite)
    return save_document(document, target)
