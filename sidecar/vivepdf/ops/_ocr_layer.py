import contextlib

import pymupdf

from vivepdf.ops._ocr_parallel import Sheet, recognised_in_order, rendered_sheet, worker_count
from vivepdf.ops._orientation import capped_dpi
from vivepdf.ops.ocr import HiddenFonts, _language_string, _overlay_sheet
from vivepdf.ops.tessdata import writable_tessdata_dir
from vivepdf.rpc.progress import Progress

OCR_DPI = 300


def has_text(page: pymupdf.Page) -> bool:
    return bool(page.get_text("text").strip())


def recognise_textless_pages(
    document: pymupdf.Document, indices: list[int], languages: list[str], progress: Progress
) -> list[int]:
    targets = [index for index in sorted(set(indices)) if not has_text(document[index])]
    if not targets:
        return []
    language = _language_string(languages)
    tessdata = str(writable_tessdata_dir())
    fonts = HiddenFonts()

    def render(index: int) -> Sheet:
        page = document[index]
        return rendered_sheet(
            page.get_pixmap(dpi=capped_dpi(page.rect, OCR_DPI), alpha=False), False
        )

    recognised: list[int] = []
    results = recognised_in_order(
        targets, render, language, tessdata, progress.check_cancelled, worker_count(len(targets))
    )
    with contextlib.closing(results):
        for done, (index, data) in enumerate(results, start=1):
            if _overlay_sheet(document[index], data, fonts):
                recognised.append(index + 1)
            progress.report(
                done / len(targets), "progress.ocr", {"current": done, "total": len(targets)}
            )
    return recognised
