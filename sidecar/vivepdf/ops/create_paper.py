from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._paper import PaperPattern, draw_paper
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

PaperSize = Literal["a4", "a5", "a3", "letter"]
MAX_PAPER_PAGES = 500


class CreatePaperParams(RpcModel):
    size: PaperSize = "a4"
    landscape: bool = False
    pages: int = Field(default=10, ge=1, le=MAX_PAPER_PAGES)
    pattern: PaperPattern | None = None
    output: str
    overwrite: bool = False


def paper_rect(size: PaperSize, landscape: bool) -> pymupdf.Rect:
    return pymupdf.paper_rect(f"{size}-l" if landscape else size)


def build_paper(params: CreatePaperParams, progress: Progress) -> pymupdf.Document:
    rect = paper_rect(params.size, params.landscape)
    document = pymupdf.open()
    stencil = pymupdf.open()
    try:
        if params.pattern is not None:
            draw_paper(stencil.new_page(width=rect.width, height=rect.height), params.pattern)
        for index in range(params.pages):
            progress.check_cancelled()
            page = document.new_page(width=rect.width, height=rect.height)
            if params.pattern is not None:
                page.show_pdf_page(page.rect, stencil, 0)
            progress.report(
                0.9 * (index + 1) / params.pages,
                "progress.creatingPages",
                {"current": index + 1, "total": params.pages},
            )
    except BaseException:
        document.close()
        raise
    finally:
        stencil.close()
    return document


@op("create.paper", CreatePaperParams)
def create_paper(params: CreatePaperParams, progress: Progress) -> OutputResult:
    target = prepare_output(params.output, [], params.overwrite)
    with build_paper(params, progress) as document:
        metadata = dict(document.metadata or {})
        metadata["creator"] = "vivePDF"
        document.set_metadata(metadata)
        progress.report(0.95, "progress.saving")
        return save_document(document, target)
