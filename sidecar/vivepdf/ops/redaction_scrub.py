import re
from pathlib import Path

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._inplace import finish
from vivepdf.ops._output import OutputResult
from vivepdf.ops._redact_search import HIDDEN_MASK, _scrubber
from vivepdf.ops._redaction import (
    MAX_AREAS,
    MAX_TEXTS,
    clean_texts,
    scrub_page,
    words_in,
)
from vivepdf.ops._redaction_document import scrub_document
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class ScrubArea(RpcModel):
    page: int = Field(ge=1)
    x0: float
    y0: float
    x1: float
    y1: float


class RedactedTextParams(RpcModel):
    path: str
    password: str | None = None
    areas: list[ScrubArea] = Field(default_factory=list, max_length=MAX_AREAS)


class RedactedTextResult(RpcModel):
    texts: list[str]


class ScrubHiddenParams(RpcModel):
    path: str
    password: str | None = None
    texts: list[str] = Field(default_factory=list, max_length=MAX_TEXTS)
    areas: list[ScrubArea] = Field(default_factory=list, max_length=MAX_AREAS)
    output: str | None = None
    overwrite: bool = False


class ScrubHiddenResult(OutputResult):
    hidden: int


def _rects_by_page(areas: list[ScrubArea], page_count: int) -> dict[int, list[pymupdf.Rect]]:
    grouped: dict[int, list[pymupdf.Rect]] = {}
    for area in areas:
        if area.page > page_count:
            continue
        rect = pymupdf.Rect(area.x0, area.y0, area.x1, area.y1)
        rect.normalize()
        if not rect.is_empty:
            grouped.setdefault(area.page - 1, []).append(rect)
    return grouped


@op("security.redacted_text", RedactedTextParams)
def redacted_text(params: RedactedTextParams, progress: Progress) -> RedactedTextResult:
    texts: list[str] = []
    with open_document(params.path, params.password, mutable=False) as document:
        for index, rects in sorted(_rects_by_page(params.areas, document.page_count).items()):
            progress.check_cancelled()
            page = document[index]
            for rect in rects:
                texts.extend(words_in(page, rect))
    return RedactedTextResult(texts=clean_texts(texts))


@op("security.scrub_hidden", ScrubHiddenParams)
def scrub_hidden(params: ScrubHiddenParams, progress: Progress) -> ScrubHiddenResult:
    texts = clean_texts(params.texts)
    if not texts and not params.areas:
        raise OpError(ErrorCode.INVALID_PARAMS, "nothing to scrub", {"reason": "empty"})
    scrub = _scrubber(texts, [], [], re.IGNORECASE, HIDDEN_MASK, whole_word=True) if texts else str
    hidden = 0
    document = open_document(params.path, params.password)
    try:
        grouped = _rects_by_page(params.areas, document.page_count)
        indices = range(document.page_count) if texts else sorted(grouped)
        for position, index in enumerate(indices):
            progress.check_cancelled()
            hidden += scrub_page(document[index], grouped.get(index, []), scrub)
            if position % 20 == 0:
                progress.report(position / max(1, len(indices)), "progress.redacting")
        if texts:
            hidden += scrub_document(document, scrub)
        if hidden == 0 and not params.output:
            page_count = document.page_count
            document.close()
            return ScrubHiddenResult(
                output=params.path,
                page_count=page_count,
                bytes=Path(params.path).stat().st_size,
                hidden=0,
            )
        progress.report(0.9, "progress.saving")
        saved = finish(document, params.path, params.output, not params.output, params.overwrite)
    finally:
        if not document.is_closed:
            document.close()
    return ScrubHiddenResult(**saved.model_dump(), hidden=hidden)
