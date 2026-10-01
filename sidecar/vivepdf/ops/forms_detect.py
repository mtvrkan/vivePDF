import re

import pymupdf

from vivepdf.ops._document import open_document
from vivepdf.ops._form_candidates import _candidate_rects
from vivepdf.ops._form_detect_params import HELVETICA, DetectedField, DetectParams, DetectResult
from vivepdf.ops._form_text_layout import _text_layout
from vivepdf.ops._naming import sanitize_file_name, unique_name
from vivepdf.ops._objects import set_key
from vivepdf.ops._output import (
    prepare_output,
    save_document,
)
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.registry import op


def _label_for(words: list[tuple], kind: str, rect: pymupdf.Rect, field_height: float) -> str:
    center = (rect.y0 + rect.y1) / 2
    band = field_height / 2 + 3
    if kind == "checkbox":
        picked = [
            word
            for word in words
            if abs((word[1] + word[3]) / 2 - center) <= band
            and rect.x1 - 2 <= word[0] <= rect.x1 + 160
        ]
    else:
        picked = [
            word
            for word in words
            if abs((word[1] + word[3]) / 2 - center) <= band
            and rect.x0 - 220 <= word[2] <= rect.x0 + 4
        ]
    if not picked and kind == "text":
        picked = [
            word
            for word in words
            if rect.y0 - field_height - 4 <= word[3] <= rect.y0 + 2
            and word[0] >= rect.x0 - 4
            and word[2] <= rect.x1 + 4
        ]
    picked.sort(key=lambda word: (round(word[1]), word[0]))
    text = " ".join(str(word[4]) for word in picked).strip(" :.-_")
    return text[:60]


def _field_base(label: str) -> str:
    if not label:
        return ""
    text = re.sub(r"[\s.]+", "_", sanitize_file_name(label))
    return re.sub(r"_{2,}", "_", text).strip("_")[:40].rstrip("_")


def _taken_names(document: pymupdf.Document) -> set[str]:
    taken: set[str] = set()
    for page in document:
        for widget in page.widgets():
            parts = (widget.field_name or "").split(".")
            for end in range(1, len(parts) + 1):
                taken.add(".".join(parts[:end]).lower())
    return taken


def _ensure_form_resources(document: pymupdf.Document) -> None:
    catalog = document.pdf_catalog()
    if document.xref_get_key(catalog, "AcroForm/DR/Font/Helv")[0] == "null":
        font = document.get_new_xref()
        document.update_object(font, HELVETICA)
        set_key(document, catalog, ["AcroForm", "DR", "Font", "Helv"], f"{font} 0 R")
    if document.xref_get_key(catalog, "AcroForm/DA")[0] == "null":
        set_key(document, catalog, ["AcroForm", "DA"], "(/Helv 0 Tf 0 g)")


@op("forms.detect", DetectParams)
def detect_fields(params: DetectParams, progress: Progress) -> DetectResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    fields: list[DetectedField] = []
    scanned: list[int] = []
    with open_document(params.path, params.password) as document:
        names = _taken_names(document)
        indices = parse_page_ranges(params.pages, document.page_count)
        for position, index in enumerate(indices):
            progress.check_cancelled()
            page = document[index]
            layout = _text_layout(page, params)
            words = layout.words
            candidates = _candidate_rects(page, params, layout, scanned)
            for order, (kind, rect) in enumerate(candidates):
                label = _label_for(words, kind, rect, params.field_height)
                base = _field_base(label) or f"field_{index + 1}_{order + 1}"
                name = unique_name(base, names)
                widget = pymupdf.Widget()
                widget.field_type = (
                    pymupdf.PDF_WIDGET_TYPE_CHECKBOX
                    if kind == "checkbox"
                    else pymupdf.PDF_WIDGET_TYPE_TEXT
                )
                widget.field_name = name
                widget.rect = rect
                if kind == "text":
                    widget.text_fontsize = 0
                    if rect.height > 30:
                        widget.field_flags = pymupdf.PDF_TX_FIELD_IS_MULTILINE
                widget.field_label = label or None
                page.add_widget(widget)
                fields.append(
                    DetectedField(
                        name=name,
                        kind=kind,
                        page=index + 1,
                        rect=[round(value, 2) for value in rect],
                        label=label,
                    )
                )
            progress.report(
                (position + 1) / len(indices),
                "progress.analyzing",
                {"current": position + 1, "total": len(indices)},
            )
        if not fields:
            raise OpError(
                ErrorCode.INVALID_PARAMS, "no field candidates found", {"reason": "noCandidates"}
            )
        _ensure_form_resources(document)
        saved = save_document(document, target)
        return DetectResult(
            output=saved.output,
            page_count=saved.page_count,
            bytes=saved.bytes,
            fields=fields,
            scanned_pages=scanned,
        )
