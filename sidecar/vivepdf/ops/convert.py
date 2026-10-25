import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

import pymupdf
from pydantic import Field

from vivepdf.external import libreoffice
from vivepdf.ops._document import open_document
from vivepdf.ops._docx_running import (
    RunningText,
    cleared_copy,
    find_running_text,
    name_running_fonts,
)
from vivepdf.ops._image_files import HEIF_EXTENSIONS
from vivepdf.ops._ocr_layer import Rule, recognise_textless_pages
from vivepdf.ops._output import write_atomically
from vivepdf.ops._placement import turn_text_upright
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.failures import document_failure
from vivepdf.rpc.paths import ReadPath, WritePath
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

IMAGE_EXTENSIONS = {
    "png",
    "jpg",
    "jpeg",
    "webp",
    "bmp",
    "gif",
    "tif",
    "tiff",
    "pnm",
    "pgm",
    "ppm",
    "jp2",
    "jxr",
    "avif",
    *HEIF_EXTENSIONS,
}
MUPDF_DOCUMENT_EXTENSIONS = {"xps", "oxps", "epub", "mobi", "fb2", "cbz", "txt"}
TEXT_EXTENSIONS = {"txt", "md", "markdown", "html", "htm"}
REPLACED_SUFFIXES = {
    "",
    ".pdf",
    ".docx",
    ".doc",
    ".xlsx",
    ".xls",
    ".csv",
    ".pptx",
    ".ppt",
    ".txt",
    ".md",
    ".markdown",
    ".html",
    ".htm",
    ".epub",
}


class FileResult(RpcModel):
    output: str
    bytes: int


class PagedFileResult(FileResult):
    page_count: int


def _prepare_file(output: str, inputs: list[str], overwrite: bool, suffix: str) -> Path:
    target = Path(output)
    if target.suffix.lower() in REPLACED_SUFFIXES:
        target = target.with_suffix(suffix)
    elif target.suffix.lower() != suffix:
        target = target.with_name(target.name + suffix)
    resolved = target.resolve()
    for source in inputs:
        if Path(source).resolve() == resolved:
            raise OpError(ErrorCode.INVALID_PARAMS, "output must differ from the input file")
    if resolved.exists() and not overwrite:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"output already exists: {resolved.name}",
            {"exists": True, "path": str(resolved)},
        )
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


class TextFileResult(FileResult):
    textless_pages: list[int] = Field(default_factory=list)
    ocr_pages: list[int] = Field(default_factory=list)


def _write_text_file(
    target: Path, text: str, textless: list[int], recognised: list[int]
) -> TextFileResult:
    write_atomically(
        target, lambda partial: partial.write_text(text, encoding="utf-8", newline="\n")
    )
    return TextFileResult(
        output=str(target),
        bytes=target.stat().st_size,
        textless_pages=textless,
        ocr_pages=recognised,
    )


class PdfSourceParams(RpcModel):
    path: ReadPath
    password: str | None = None
    output: WritePath
    overwrite: bool = False
    pages: str | None = None


class TextSourceParams(PdfSourceParams):
    ocr: bool = False
    ocr_languages: list[str] = Field(default_factory=lambda: ["tur", "eng"])


def recognise_first(
    document: pymupdf.Document,
    indices: list[int],
    params: TextSourceParams,
    progress: Progress,
    rules: dict[int, list[Rule]] | None = None,
) -> tuple[list[int], Progress]:
    if not params.ocr:
        return [], progress
    recognised = recognise_textless_pages(
        document, indices, params.ocr_languages, progress.within(0.0, 0.5), rules
    )
    return recognised, progress.within(0.5, 1.0)


class DocxParams(PdfSourceParams):
    header_footer: bool = True


class DocxResult(FileResult):
    skipped_pages: list[int] = Field(default_factory=list)
    textless_pages: list[int] = Field(default_factory=list)
    header_lines: int = 0
    footer_lines: int = 0


@dataclass(slots=True)
class _DocxSurvey:
    indices: list[int]
    largest_area: float
    textless_pages: list[int]
    right_to_left: bool


def _survey_docx_pages(document: pymupdf.Document, pages: str | None) -> _DocxSurvey:
    from vivepdf.ops._docx_bidi import has_right_to_left

    indices = sorted(set(parse_page_ranges(pages, document.page_count)))
    textless: list[int] = []
    right_to_left = False
    largest = 0.0
    for index in indices:
        page = document[index]
        largest = max(largest, abs(page.rect.width * page.rect.height))
        text = page.get_text()
        if not text.strip():
            textless.append(index + 1)
        elif not right_to_left:
            right_to_left = has_right_to_left(text)
    return _DocxSurvey(indices, largest, textless, right_to_left)


@op("convert.to_docx", DocxParams)
def to_docx(params: DocxParams, progress: Progress) -> DocxResult:
    from vivepdf.ops._opencv_subset import ensure_cv2

    ensure_cv2()
    target = _prepare_file(params.output, [params.path], params.overwrite, ".docx")
    source, password = params.path, params.password
    staging: Path | None = None
    try:
        with open_document(params.path, params.password) as document:
            survey = _survey_docx_pages(document, params.pages)
            turned = turn_text_upright(document, survey.indices)
            running = (
                find_running_text(document, survey.indices)
                if params.header_footer
                else RunningText()
            )
            if running.lines:
                _name_running_fonts(document, running)
            if running.lines or turned:
                staging = Path(tempfile.mkdtemp(prefix="vivepdf-"))
                source, password = cleared_copy(
                    document, running, staging, locked=bool(params.password)
                )
        progress.report(0.05, "progress.converting")
        original = (params.path, params.password) if staging is not None else None
        return _write_docx(source, password, target, survey, running, progress, original)
    finally:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)


def _name_running_fonts(document: pymupdf.Document, running: RunningText) -> None:
    from vivepdf.ops._docx_fonts import docx_font_names
    from vivepdf.ops._docx_progress import stabilise_pdf2docx

    stabilise_pdf2docx()
    name_running_fonts(running, docx_font_names(document))


def _write_docx(
    source: str,
    password: str | None,
    target: Path,
    survey: _DocxSurvey,
    running: RunningText,
    progress: Progress,
    original: tuple[str, str | None] | None = None,
) -> DocxResult:
    from pdf2docx import Converter

    from vivepdf.ops._docx_progress import DocxRun, clip_ratio

    converter = Converter(source, password=password)
    font_source = open_document(*original) if original is not None else None
    try:
        skipped = DocxRun(converter, progress, len(survey.indices)).run(
            survey.indices,
            target,
            image_ratio=clip_ratio(survey.largest_area),
            right_to_left=survey.right_to_left,
            running=running,
            font_source=font_source,
        )
    except OpError:
        raise
    except Exception as error:  # noqa: BLE001
        damaged = document_failure(error)
        if damaged is not None:
            raise damaged from error
        raise OpError(ErrorCode.INTERNAL, f"docx conversion failed: {error}") from error
    finally:
        converter.close()
        if font_source is not None:
            font_source.close()
    return DocxResult(
        output=str(target),
        bytes=target.stat().st_size,
        skipped_pages=skipped,
        textless_pages=survey.textless_pages,
        header_lines=running.count("header"),
        footer_lines=running.count("footer"),
    )


class ToolsStatus(RpcModel):
    libreoffice: str | None
    ocr_languages: list[str]


class EmptyParams(RpcModel):
    pass


@op("convert.tools", EmptyParams)
def tools_status(_params: EmptyParams, _progress: Progress) -> ToolsStatus:
    from vivepdf.ops.ocr import available_languages

    soffice = libreoffice.find_soffice()
    return ToolsStatus(
        libreoffice=str(soffice) if soffice else None,
        ocr_languages=available_languages(),
    )
