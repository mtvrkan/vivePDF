import base64
import html
import json
import re
import threading
import uuid
from collections import OrderedDict
from pathlib import Path

import pymupdf

from vivepdf.ops._html_clean import body_fragment, visible_text, without_remote_pictures
from vivepdf.ops._output import (
    OutputResult,
    prepare_data_output,
    prepare_output,
    save_document,
    write_atomically,
)
from vivepdf.ops._story import declared_charset, decode_text, markdown_to_html
from vivepdf.ops._studio_document import (
    IMAGE_TAG,
    SOURCE,
    data_url,
    layout_document,
    picture_file,
    subset,
)
from vivepdf.ops._studio_document_models import (
    DOCUMENT_EXTENSION,
    DOCUMENT_VERSION,
    MAX_DOCUMENT_BYTES,
    StudioDocumentImageResult,
    StudioDocumentImportResult,
    StudioDocumentOpenParams,
    StudioDocumentOpenResult,
    StudioDocumentPageParams,
    StudioDocumentPageResult,
    StudioDocumentPreviewParams,
    StudioDocumentPreviewResult,
    StudioDocumentRenderParams,
    StudioDocumentSaveParams,
    StudioDocumentSaveResult,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.registry import op

PREVIEW_SLOTS = 4
IMPORT_EXTENSIONS = {"md", "markdown", "txt", "text", "html", "htm"}
IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif"}
MAX_IMPORT_BYTES = 20 * 1024 * 1024
MAX_IMPORTED_IMAGES = 100
LEADING_H1 = re.compile(r"<h1\b[^>]*>(.*?)</h1\s*>", re.IGNORECASE | re.DOTALL)
BLANK_LINES = re.compile(r"\n\s*\n")

_previews: OrderedDict[str, bytes] = OrderedDict()
_previews_lock = threading.Lock()


def _missing(path: str) -> OpError:
    return OpError(ErrorCode.FILE_NOT_FOUND, f"file not found: {Path(path).name}", {"path": path})


def _remember(payload: bytes) -> str:
    token = uuid.uuid4().hex
    with _previews_lock:
        _previews[token] = payload
        while len(_previews) > PREVIEW_SLOTS:
            _previews.popitem(last=False)
    return token


def _recall(token: str) -> bytes:
    with _previews_lock:
        payload = _previews.get(token)
        if payload is not None:
            _previews.move_to_end(token)
    if payload is None:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the preview is no longer available",
            {"reason": "previewGone"},
        )
    return payload


@op("studio.render_document", StudioDocumentRenderParams)
def render_document(params: StudioDocumentRenderParams, progress: Progress) -> OutputResult:
    target = prepare_output(params.output, [], params.overwrite)
    progress.report(0.1, "progress.rendering")
    document = layout_document(params, progress.check_cancelled)
    with document:
        progress.report(0.85, "progress.saving")
        subset(document)
        return save_document(document, target)


@op("studio.preview_document", StudioDocumentPreviewParams)
def preview_document(
    params: StudioDocumentPreviewParams, progress: Progress
) -> StudioDocumentPreviewResult:
    document = layout_document(params, progress.check_cancelled)
    with document:
        first = document[0].rect
        payload = document.tobytes(garbage=0, deflate=False)
        return StudioDocumentPreviewResult(
            token=_remember(payload),
            page_count=document.page_count,
            width=first.width,
            height=first.height,
        )


@op("studio.preview_document_page", StudioDocumentPageParams)
def preview_document_page(
    params: StudioDocumentPageParams, _progress: Progress
) -> StudioDocumentPageResult:
    with pymupdf.open("pdf", _recall(params.token)) as document:
        if params.page >= document.page_count:
            raise OpError(ErrorCode.INVALID_PARAMS, "no such page", {"reason": "badRange"})
        page = document[params.page]
        scale = params.width / max(page.rect.width, 1.0)
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
        return StudioDocumentPageResult(
            image=base64.b64encode(pixmap.tobytes("png")).decode("ascii"),
            width=pixmap.width,
            height=pixmap.height,
        )


@op("studio.save_document", StudioDocumentSaveParams)
def save_studio_document(
    params: StudioDocumentSaveParams, _progress: Progress
) -> StudioDocumentSaveResult:
    if params.document.get("kind") != "document":
        raise OpError(ErrorCode.INVALID_PARAMS, "not a Studio document", {"reason": "noDocument"})
    payload = json.dumps(params.document, ensure_ascii=False, separators=(",", ":")).encode()
    if len(payload) > MAX_DOCUMENT_BYTES:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the document is too large",
            {"reason": "documentFileTooLarge", "limitMb": MAX_DOCUMENT_BYTES // (1024 * 1024)},
        )
    target = prepare_data_output(params.output, DOCUMENT_EXTENSION, params.overwrite)
    write_atomically(target, lambda path: path.write_bytes(payload))
    return StudioDocumentSaveResult(output=str(target), bytes=len(payload))


@op("studio.open_document", StudioDocumentOpenParams)
def open_studio_document(
    params: StudioDocumentOpenParams, _progress: Progress
) -> StudioDocumentOpenResult:
    source = Path(params.path)
    if not source.is_file():
        raise _missing(params.path)
    if source.stat().st_size > MAX_DOCUMENT_BYTES:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the document is too large",
            {"reason": "documentFileTooLarge", "limitMb": MAX_DOCUMENT_BYTES // (1024 * 1024)},
        )
    try:
        document = json.loads(source.read_text("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"{source.name} is not a Studio document",
            {"reason": "noDocument"},
        ) from error
    if not isinstance(document, dict) or document.get("kind") != "document":
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"{source.name} is not a Studio document",
            {"reason": "noDocument"},
        )
    version = document.get("version")
    if not isinstance(version, int) or version > DOCUMENT_VERSION:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"{source.name} was made by a newer vivePDF",
            {"reason": "newerDocument"},
        )
    return StudioDocumentOpenResult(document=document)


def _embedded_picture(folder: Path, reference: str) -> str | None:
    if reference.startswith("data:"):
        return None
    candidate = (folder / html.unescape(reference).split("?")[0].split("#")[0]).resolve()
    if not candidate.is_relative_to(folder) or not candidate.is_file():
        return None
    if candidate.suffix.lower().lstrip(".") not in IMAGE_EXTENSIONS:
        return None
    try:
        payload, _width, _height, transparent = picture_file(candidate)
    except OpError:
        return None
    return data_url(payload, transparent)


def _with_pictures(body: str, folder: Path) -> str:
    count = 0

    def replace(match: re.Match) -> str:
        nonlocal count
        tag = match.group(0)
        source = SOURCE.search(tag)
        if source is None:
            return ""
        if source.group(2).startswith("data:image/"):
            return tag
        if count >= MAX_IMPORTED_IMAGES:
            return ""
        embedded = _embedded_picture(folder, source.group(2))
        if embedded is None:
            return ""
        count += 1
        return tag[: source.start()] + f' src="{embedded}"' + tag[source.end() :]

    return IMAGE_TAG.sub(replace, body)


def _text_html(text: str) -> str:
    paragraphs = [part.strip("\n") for part in BLANK_LINES.split(text.replace("\r\n", "\n"))]
    return "".join(
        f"<p>{'<br>'.join(html.escape(line) for line in part.split(chr(10)))}</p>"
        for part in paragraphs
        if part.strip()
    )


@op("studio.import_document", StudioDocumentOpenParams)
def import_document(
    params: StudioDocumentOpenParams, _progress: Progress
) -> StudioDocumentImportResult:
    source = Path(params.path)
    if not source.is_file():
        raise _missing(params.path)
    extension = source.suffix.lower().lstrip(".")
    if extension not in IMPORT_EXTENSIONS:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"unsupported file type: .{extension}",
            {"reason": "unsupportedType", "extension": extension},
        )
    if source.stat().st_size > MAX_IMPORT_BYTES:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the file is too large",
            {"reason": "sourceTooLarge", "limit": MAX_IMPORT_BYTES},
        )
    payload = source.read_bytes()
    if extension in ("html", "htm"):
        body = without_remote_pictures(
            body_fragment(decode_text(payload, declared_charset(payload)))
        )
    elif extension in ("md", "markdown"):
        body = markdown_to_html(decode_text(payload))
    else:
        body = _text_html(decode_text(payload))
    body = _with_pictures(body, source.parent.resolve())
    heading = LEADING_H1.search(body)
    title = visible_text(heading.group(1)) if heading else ""
    return StudioDocumentImportResult(html=body, title=html.unescape(title) or source.stem)


@op("studio.document_image", StudioDocumentOpenParams)
def document_image(
    params: StudioDocumentOpenParams, _progress: Progress
) -> StudioDocumentImageResult:
    source = Path(params.path)
    if not source.is_file():
        raise _missing(params.path)
    payload, width, height, transparent = picture_file(source)
    return StudioDocumentImageResult(src=data_url(payload, transparent), width=width, height=height)
