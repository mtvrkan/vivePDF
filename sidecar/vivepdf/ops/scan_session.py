import contextlib
import uuid
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._appdata import user_data_dir
from vivepdf.ops._document import open_document
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops.ocr import OcrParams, run_ocr
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

SESSION_FOLDER = "scan-session"
MAX_SESSION_PAGES = 2000
MAX_DISCARD = 500


def session_directory() -> Path:
    folder = user_data_dir() / SESSION_FOLDER
    folder.mkdir(parents=True, exist_ok=True)
    return folder.resolve()


def session_part() -> Path:
    return session_directory() / f"{uuid.uuid4().hex}.pdf"


def session_file(path: str) -> Path | None:
    resolved = Path(path).resolve()
    if resolved.parent != session_directory() or resolved.suffix.lower() != ".pdf":
        return None
    return resolved


class SessionPage(RpcModel):
    path: str
    page: int = Field(ge=0)
    rotation: Literal[0, 90, 180, 270] = 0


class ScannerAssembleParams(RpcModel):
    pages: list[SessionPage] = Field(min_length=1, max_length=MAX_SESSION_PAGES)
    output: str
    overwrite: bool = False
    ocr: bool = False
    languages: list[str] = Field(default_factory=lambda: ["tur", "eng"])
    discard: bool = True


class ScannerAssembleResult(OutputResult):
    ocr_pages: int = 0


class ScannerDiscardParams(RpcModel):
    paths: list[str] = Field(max_length=MAX_DISCARD)


class ScannerDiscardResult(RpcModel):
    removed: int


def _combined(
    params: ScannerAssembleParams, sources: contextlib.ExitStack, progress: Progress
) -> pymupdf.Document:
    opened: dict[str, pymupdf.Document] = {}
    combined = pymupdf.open()
    total = len(params.pages)
    for position, item in enumerate(params.pages):
        progress.check_cancelled()
        source = opened.get(item.path)
        if source is None:
            source = sources.enter_context(open_document(item.path))
            opened[item.path] = source
        if item.page >= source.page_count:
            combined.close()
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"page {item.page + 1} is not in the scan",
                {"reason": "pageMissing", "path": item.path, "page": item.page},
            )
        combined.insert_pdf(source, from_page=item.page, to_page=item.page)
        if item.rotation:
            added = combined[-1]
            added.set_rotation((added.rotation + item.rotation) % 360)
        progress.report(
            (0.3 if params.ocr else 0.9) * (position + 1) / total,
            "progress.assembling",
        )
    return combined


def _discard(paths: set[str]) -> int:
    removed = 0
    for path in paths:
        part = session_file(path)
        if part is not None and part.exists():
            with contextlib.suppress(OSError):
                part.unlink()
                removed += 1
    return removed


@op("scanner.assemble", ScannerAssembleParams)
def assemble(params: ScannerAssembleParams, progress: Progress) -> ScannerAssembleResult:
    sources = {item.path for item in params.pages}
    target = prepare_output(params.output, sorted(sources), params.overwrite)
    ocr_pages = 0
    with contextlib.ExitStack() as stack:
        combined = _combined(params, stack, progress)
        try:
            if not params.ocr:
                progress.report(0.92, "progress.saving")
                saved = save_document(combined, target)
            else:
                staging = session_part()
                try:
                    combined.save(staging, garbage=3, deflate=True)
                    combined.close()
                    recognised = run_ocr(
                        OcrParams(
                            path=str(staging),
                            output=str(target),
                            overwrite=True,
                            languages=params.languages,
                        ),
                        progress.within(0.3, 1.0),
                    )
                finally:
                    staging.unlink(missing_ok=True)
                ocr_pages = recognised.ocr_pages
                saved = OutputResult(
                    output=recognised.output,
                    page_count=recognised.page_count,
                    bytes=recognised.bytes,
                )
        finally:
            if not combined.is_closed:
                combined.close()
    if params.discard:
        _discard(sources)
    return ScannerAssembleResult(
        output=saved.output, page_count=saved.page_count, bytes=saved.bytes, ocr_pages=ocr_pages
    )


@op("scanner.discard", ScannerDiscardParams)
def discard(params: ScannerDiscardParams, _progress: Progress) -> ScannerDiscardResult:
    return ScannerDiscardResult(removed=_discard(set(params.paths)))
