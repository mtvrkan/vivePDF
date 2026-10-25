import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._placement import insertion_matrix
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._watermark_style import parse_color
from vivepdf.ops.furniture import (
    background_opening,
    mark_new_content,
    remove_furniture,
    role_names,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.paths import ReadPath, WritePath
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

SHOWN_CHECK_DPI = 18
SHOWN_TOLERANCE = 6
BACKGROUND_ROLES = role_names(["pageBackground"])


class BackgroundParams(RpcModel):
    path: ReadPath
    password: str | None = None
    output: WritePath
    overwrite: bool = False
    color: str = "#fff8e1"
    pages: str | None = None
    remove: bool = False


class BackgroundResult(OutputResult):
    applied: int
    hidden_pages: list[int] = Field(default_factory=list)


def _shows(page: pymupdf.Page, color: tuple[float, float, float]) -> bool:
    pixmap = page.get_pixmap(dpi=SHOWN_CHECK_DPI, alpha=False, annots=False)
    wanted = [round(channel * 255) for channel in color]
    samples = pixmap.samples
    for offset in range(0, len(samples), pixmap.n):
        if all(
            abs(samples[offset + channel] - wanted[channel]) <= SHOWN_TOLERANCE
            for channel in range(3)
        ):
            return True
    return False


def _paint(page: pymupdf.Page, color: tuple[float, float, float]) -> None:
    before = set(page.get_contents())
    shape = page.new_shape()
    shape.draw_rect(page.rect * insertion_matrix(page))
    shape.finish(color=None, fill=color, width=0)
    shape.commit(overlay=False)
    mark_new_content(page, before, background_opening("pageBackground"))


@op("pages.background", BackgroundParams)
def page_background(params: BackgroundParams, progress: Progress) -> BackgroundResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    color = parse_color(params.color)
    with open_document(params.path, params.password) as document:
        indices = list(dict.fromkeys(parse_page_ranges(params.pages, document.page_count)))
        removed, changed = remove_furniture(document, indices, BACKGROUND_ROLES, progress)
        if params.remove:
            if removed == 0:
                raise OpError(
                    ErrorCode.INVALID_PARAMS,
                    "no page background added by vivePDF found",
                    {"reason": "noBackground"},
                )
            progress.report(0.9, "progress.saving")
            saved = save_document(document, target)
            return BackgroundResult(**saved.model_dump(), applied=changed)
        hidden: list[int] = []
        for position, index in enumerate(indices):
            progress.check_cancelled()
            if position % 10 == 0:
                progress.report(
                    position / max(1, len(indices)),
                    "progress.applying",
                    {"current": position + 1, "total": len(indices)},
                )
            page = document[index]
            _paint(page, color)
            if not _shows(page, color):
                hidden.append(index + 1)
        progress.report(0.95, "progress.saving")
        saved = save_document(document, target)
    return BackgroundResult(**saved.model_dump(), applied=len(indices), hidden_pages=hidden)
