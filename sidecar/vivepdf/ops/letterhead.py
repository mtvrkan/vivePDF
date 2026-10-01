from contextlib import ExitStack
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._placement import drop_unplaceable_annotations, insertion_matrix
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops.furniture import (
    background_opening,
    mark_new_content,
    remove_furniture,
    role_names,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

TemplateRole = Literal["template", "firstPageTemplate"]
BLANK_CHECK_DPI = 18
WHITE = 255


class LetterheadParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    template_path: str
    template_password: str | None = None
    template_page: int = Field(default=1, ge=1)
    first_page_template_path: str | None = None
    first_page_template_password: str | None = None
    first_page_template_page: int = Field(default=1, ge=1)
    position: Literal["under", "over"] = "under"
    fit: Literal["stretch", "fit"] = "stretch"
    pages: str | None = None
    replace_existing: bool = False


class LetterheadResult(OutputResult):
    applied: int


def _open_template(path: str, password: str | None, role: TemplateRole) -> pymupdf.Document:
    try:
        return open_document(path, password)
    except OpError as error:
        if error.code != ErrorCode.NEEDS_PASSWORD:
            raise
        wrong = password is not None
        raise OpError(
            ErrorCode.NEEDS_PASSWORD,
            f"{role} requires a password",
            {
                "which": role,
                "wrongPassword": wrong,
                "reason": "templateWrongPassword" if wrong else "templatePassword",
            },
        ) from error


def _straighten(page: pymupdf.Page) -> pymupdf.Page:
    document = page.parent
    crop, media = page.cropbox, page.mediabox
    if crop != media:
        box = (crop.x0, media.y1 - crop.y1, crop.x1, media.y1 - crop.y0)
        document.xref_set_key(page.xref, "MediaBox", "[{:g} {:g} {:g} {:g}]".format(*box))
        document.xref_set_key(page.xref, "CropBox", "null")
        page = document[page.number]
    if page.rotation:
        drop_unplaceable_annotations(page)
        page.remove_rotation()
    return page


def _is_blank(page: pymupdf.Page) -> bool:
    pixmap = page.get_pixmap(dpi=BLANK_CHECK_DPI, colorspace=pymupdf.csGRAY, alpha=False)
    return min(pixmap.samples, default=WHITE) == WHITE


def upright_template(
    path: str, password: str | None, number: int, role: TemplateRole
) -> pymupdf.Document:
    with _open_template(path, password, role) as template:
        if number > template.page_count:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"{role} has no page {number}",
                {"reason": "templatePage", "which": role},
            )
        copy = pymupdf.open()
        copy.insert_pdf(template, from_page=number - 1, to_page=number - 1)
    page = _straighten(copy[0])
    if _is_blank(page):
        copy.close()
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"{role} page {number} is blank",
            {"reason": "blankTemplate", "which": role},
        )
    return copy


def target_rect(page_rect: pymupdf.Rect, source_rect: pymupdf.Rect, fit: str) -> pymupdf.Rect:
    if fit == "stretch":
        return pymupdf.Rect(page_rect)
    scale = min(page_rect.width / source_rect.width, page_rect.height / source_rect.height)
    width = source_rect.width * scale
    height = source_rect.height * scale
    left = page_rect.x0 + (page_rect.width - width) / 2
    return pymupdf.Rect(left, page_rect.y0, left + width, page_rect.y0 + height)


@op("pages.letterhead", LetterheadParams)
def letterhead(params: LetterheadParams, progress: Progress) -> LetterheadResult:
    inputs = [params.path, params.template_path]
    if params.first_page_template_path:
        inputs.append(params.first_page_template_path)
    target = prepare_output(params.output, inputs, params.overwrite)
    with ExitStack() as stack:
        document = stack.enter_context(open_document(params.path, params.password))
        main = stack.enter_context(
            upright_template(
                params.template_path, params.template_password, params.template_page, "template"
            )
        )
        first = (
            stack.enter_context(
                upright_template(
                    params.first_page_template_path,
                    params.first_page_template_password,
                    params.first_page_template_page,
                    "firstPageTemplate",
                )
            )
            if params.first_page_template_path
            else None
        )
        indices = list(dict.fromkeys(parse_page_ranges(params.pages, document.page_count)))
        if params.replace_existing:
            remove_furniture(document, indices, role_names(["letterhead"]), progress)
        opening = background_opening("letterhead")
        for position, index in enumerate(indices):
            progress.check_cancelled()
            page = document[index]
            source = first if first is not None and position == 0 else main
            before = set(page.get_contents())
            box = target_rect(page.rect, source[0].rect, params.fit)
            page.show_pdf_page(
                box * insertion_matrix(page),
                source,
                0,
                overlay=params.position == "over",
                keep_proportion=False,
                rotate=page.rotation,
            )
            mark_new_content(page, before, opening)
            if position % 10 == 0:
                progress.report(
                    position / max(1, len(indices)),
                    "progress.applying",
                    {"current": position + 1, "total": len(indices)},
                )
        progress.report(0.95, "progress.saving")
        saved = save_document(document, target)
    return LetterheadResult(**saved.model_dump(), applied=len(indices))
