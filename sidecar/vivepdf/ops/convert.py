import hashlib
import re
import shutil
import tempfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pymupdf
from pydantic import Field

from vivepdf.external import libreoffice
from vivepdf.ops._document import open_document
from vivepdf.ops._docx_running import RunningText, cleared_copy, find_running_text
from vivepdf.ops._image_files import HEIF_EXTENSIONS
from vivepdf.ops._image_masks import BLACK, is_stencil, stencil_colours, stencil_png
from vivepdf.ops._naming import sanitize_file_name
from vivepdf.ops._ocr_layer import recognise_textless_pages
from vivepdf.ops._output import write_atomically
from vivepdf.ops._pixmaps import png_ready
from vivepdf.ops._placement import turn_text_upright
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.failures import document_failure
from vivepdf.rpc.paths import ReadPath, WriteDir, WritePath
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
INVOKED_XOBJECT = re.compile(rb"/([^\s/\[\]()<>{}%]+)\s+Do\b")
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
    document: pymupdf.Document, indices: list[int], params: TextSourceParams, progress: Progress
) -> tuple[list[int], Progress]:
    if not params.ocr:
        return [], progress
    recognised = recognise_textless_pages(
        document, indices, params.ocr_languages, progress.within(0.0, 0.5)
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
            if running.lines or turned:
                staging = Path(tempfile.mkdtemp(prefix="vivepdf-"))
                source, password = cleared_copy(
                    document, running, staging, locked=bool(params.password)
                )
        progress.report(0.05, "progress.converting")
        return _write_docx(source, password, target, survey, running, progress)
    finally:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)


def _write_docx(
    source: str,
    password: str | None,
    target: Path,
    survey: _DocxSurvey,
    running: RunningText,
    progress: Progress,
) -> DocxResult:
    from pdf2docx import Converter

    from vivepdf.ops._docx_progress import DocxRun, clip_ratio

    converter = Converter(source, password=password)
    try:
        skipped = DocxRun(converter, progress, len(survey.indices)).run(
            survey.indices,
            target,
            image_ratio=clip_ratio(survey.largest_area),
            right_to_left=survey.right_to_left,
            running=running,
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


class ExtractImagesParams(RpcModel):
    path: ReadPath
    password: str | None = None
    output_dir: WriteDir
    pages: str | None = None
    min_size: int = Field(default=64, ge=1)
    dedupe: bool = True


class ExtractImagesResult(RpcModel):
    outputs: list[str]
    count: int
    skipped: int
    bytes: int


def _image_bytes(document: pymupdf.Document, xref: int, smask: int) -> tuple[bytes, str] | None:
    if smask:
        pixmap = pymupdf.Pixmap(document, xref)
        mask = pymupdf.Pixmap(document, smask)
        pixmap = png_ready(pixmap)
        if pixmap.alpha:
            pixmap = pymupdf.Pixmap(pixmap, 0)
        if (mask.width, mask.height) != (pixmap.width, pixmap.height):
            mask = pymupdf.Pixmap(mask, pixmap.width, pixmap.height, None)
        try:
            combined = pymupdf.Pixmap(pixmap, mask)
        except Exception:
            return pixmap.tobytes("png"), "png"
        return combined.tobytes("png"), "png"
    extracted = document.extract_image(xref)
    if not extracted:
        return None
    data = extracted["image"]
    ext = str(extracted.get("ext") or "png").lower()
    if ext in ("jpx", "jb2", "jbig2") or (extracted.get("colorspace") or 0) >= 4:
        pixmap = pymupdf.Pixmap(document, xref)
        pixmap = png_ready(pixmap)
        return pixmap.tobytes("png"), "png"
    return data, ("jpg" if ext == "jpeg" else ext)


def _invoked_names(stream: bytes) -> Iterator[str]:
    return (name.decode("latin-1") for name in INVOKED_XOBJECT.findall(stream))


def _drawn_xrefs(page: pymupdf.Page, listed: dict[int, tuple]) -> list[int]:
    document = page.parent
    forms = {(invoker, name): xref for xref, name, invoker, _bbox in page.get_xobjects()}
    images = {(image[9], image[7]): xref for xref, image in listed.items()}
    drawn: list[int] = []
    visited: set[int] = set()
    stack = [(0, _invoked_names(page.read_contents()))]
    while stack:
        owner, names = stack[-1]
        name = next(names, None)
        if name is None:
            stack.pop()
            continue
        key = (owner, name) if (owner, name) in images or (owner, name) in forms else (0, name)
        if key in images:
            drawn.append(images[key])
        form = forms.get(key)
        if form is not None and form not in visited:
            visited.add(form)
            stack.append((form, _invoked_names(document.xref_stream(form) or b"")))
    return list(dict.fromkeys(drawn))


def free_path(folder: Path, stem: str, extension: str) -> Path:
    target = folder / f"{stem}.{extension}"
    number = 2
    while target.exists():
        target = folder / f"{stem} ({number}).{extension}"
        number += 1
    return target


@op("convert.extract_images", ExtractImagesParams)
def extract_images(params: ExtractImagesParams, progress: Progress) -> ExtractImagesResult:
    output_dir = Path(params.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[str] = []
    try:
        total_bytes, skipped = _extract_page_images(params, progress, output_dir, outputs)
    except BaseException:
        for path in outputs:
            Path(path).unlink(missing_ok=True)
        raise
    return ExtractImagesResult(
        outputs=outputs, count=len(outputs), skipped=skipped, bytes=total_bytes
    )


def _extract_page_images(
    params: ExtractImagesParams,
    progress: Progress,
    output_dir: Path,
    outputs: list[str],
) -> tuple[int, int]:
    skipped = 0
    total_bytes = 0
    seen: set[int] = set()
    contents: set[bytes] = set()
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        stem = sanitize_file_name(Path(params.path).stem)
        width = len(str(document.page_count))
        for position, index in enumerate(indices):
            progress.check_cancelled()
            page = document[index]
            listed = {image[0]: image for image in page.get_images(full=True)}
            drawn = _drawn_xrefs(page, listed)
            stencils = [xref for xref in drawn if is_stencil(document, xref)]
            colours = stencil_colours(page, stencils) if stencils else {}
            for image_index, xref in enumerate(drawn):
                smask, img_width, img_height = listed[xref][1:4]
                if params.dedupe and xref in seen:
                    continue
                seen.add(xref)
                if img_width < params.min_size or img_height < params.min_size:
                    skipped += 1
                    continue
                payload = (
                    (stencil_png(document, xref, colours.get(xref, BLACK)), "png")
                    if xref in stencils
                    else _image_bytes(document, xref, smask)
                )
                if payload is None:
                    skipped += 1
                    continue
                data, ext = payload
                if params.dedupe:
                    fingerprint = hashlib.sha1(data).digest()
                    if fingerprint in contents:
                        continue
                    contents.add(fingerprint)
                target = free_path(
                    output_dir, f"{stem}-{index + 1:0{width}d}-{image_index + 1:02d}", ext
                )
                outputs.append(str(target))
                target.write_bytes(data)
                total_bytes += len(data)
            if position % 5 == 0:
                progress.report(
                    position / max(1, len(indices)),
                    "progress.extracting",
                    {"current": position + 1, "total": len(indices)},
                )
    return total_bytes, skipped
