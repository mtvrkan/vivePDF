import base64
import hashlib
import html
import json
import re
import threading
import uuid
from collections import OrderedDict
from pathlib import Path

import pymupdf

from vivepdf.ops._document_markdown import document_markdown
from vivepdf.ops._document_places import Places
from vivepdf.ops._html_clean import body_fragment, visible_text, without_remote_pictures
from vivepdf.ops._markdown_citations import FrontMatter, split_front_matter, with_citations
from vivepdf.ops._markdown_footnotes import split_notes, with_footnotes
from vivepdf.ops._output import (
    OutputResult,
    prepare_data_output,
    prepare_output,
    save_document,
    write_atomically,
)
from vivepdf.ops._story import declared_charset, decode_text, decode_text_as, markdown_to_html
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
    StudioBibliographyResult,
    StudioBibliographyWriteParams,
    StudioBibliographyWriteResult,
    StudioDocumentBlockStart,
    StudioDocumentImageResult,
    StudioDocumentImportResult,
    StudioDocumentMarkdownParams,
    StudioDocumentOpenParams,
    StudioDocumentOpenResult,
    StudioDocumentPageParams,
    StudioDocumentPageResult,
    StudioDocumentPageStart,
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
MARKDOWN_EXTENSION = "md"
IMPORT_EXTENSIONS = {"md", "markdown", "txt", "text", "html", "htm"}
BIBLIOGRAPHY_EXTENSIONS = {"bib", "bibtex"}
SOURCE_LIBRARY_EXTENSIONS = BIBLIOGRAPHY_EXTENSIONS | {"ris", "json"}
MAX_BIBLIOGRAPHY_BYTES = 8 * 1024 * 1024
MAX_LINKED_BIBLIOGRAPHIES = 10
IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif"}
MAX_IMPORT_BYTES = 20 * 1024 * 1024
MAX_IMPORTED_IMAGES = 100
LEADING_H1 = re.compile(r"<h1\b[^>]*>(.*?)</h1\s*>", re.IGNORECASE | re.DOTALL)
BLANK_LINES = re.compile(r"\n\s*\n")
JABREF_ENCODING = re.compile(
    rb"^(?:\xef\xbb\xbf)?%\s*Encoding:\s*([A-Za-z0-9_.:-]+)", re.IGNORECASE
)

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


@op("studio.export_markdown", StudioDocumentMarkdownParams)
def export_markdown(
    params: StudioDocumentMarkdownParams, progress: Progress
) -> StudioDocumentSaveResult:
    target = prepare_data_output(params.output, MARKDOWN_EXTENSION, params.overwrite)
    progress.report(0.1, "progress.rendering")
    payload = document_markdown(params).encode("utf-8")
    progress.report(0.85, "progress.saving")
    write_atomically(target, lambda path: path.write_bytes(payload))
    return StudioDocumentSaveResult(output=str(target), bytes=len(payload))


@op("studio.preview_document", StudioDocumentPreviewParams)
def preview_document(
    params: StudioDocumentPreviewParams, progress: Progress
) -> StudioDocumentPreviewResult:
    places: list[Places] = []
    document = layout_document(params, progress.check_cancelled, places)
    with document:
        first = document[0].rect
        payload = document.tobytes(garbage=0, deflate=False)
        found = places[0]
        return StudioDocumentPreviewResult(
            token=_remember(payload),
            page_count=document.page_count,
            width=first.width,
            height=first.height,
            block_starts=[
                StudioDocumentBlockStart(id=block.id, page=block.page, top=block.top)
                for block in found.blocks
            ],
            page_starts=[
                StudioDocumentPageStart(page=start.page, top=start.top, words=start.words)
                for start in found.pages
            ],
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
            {
                "reason": "sourceTooLarge",
                "limit": MAX_IMPORT_BYTES,
                "limitMb": MAX_IMPORT_BYTES // (1024 * 1024),
            },
        )
    payload = source.read_bytes()
    meta = FrontMatter()
    cited = False
    references_title = ""
    if extension in ("html", "htm"):
        body = without_remote_pictures(
            body_fragment(decode_text(payload, declared_charset(payload)))
        )
    elif extension in ("md", "markdown"):
        meta, text = split_front_matter(decode_text(payload))
        text, notes, markup = split_notes(text)
        body, cited, references_title = with_citations(
            with_footnotes(markdown_to_html(text, strikethrough=True), notes, markup)
        )
    else:
        body = _text_html(decode_text(payload))
    folder = source.parent.resolve()
    body = _with_pictures(body, folder)
    heading = LEADING_H1.search(body)
    leading = html.unescape(visible_text(heading.group(1))) if heading else ""
    return StudioDocumentImportResult(
        html=body,
        title=meta.first("title", 300) or leading or source.stem,
        author=meta.joined("author", 300),
        date=meta.first("date", 80),
        references_title=references_title,
        bibliography=_linked_bibliography(source, folder, meta, cited),
    )


def _linked_bibliography(source: Path, folder: Path, meta: FrontMatter, cited: bool) -> str:
    names = meta.values.get("bibliography", [])[:MAX_LINKED_BIBLIOGRAPHIES]
    if not names and cited:
        names = [f"{source.stem}.{extension}" for extension in sorted(BIBLIOGRAPHY_EXTENSIONS)]
    texts: list[str] = []
    budget = MAX_BIBLIOGRAPHY_BYTES
    for name in names:
        candidate = (folder / name).resolve()
        if not candidate.is_relative_to(folder) or not candidate.is_file():
            continue
        if candidate.suffix.lower().lstrip(".") not in BIBLIOGRAPHY_EXTENSIONS:
            continue
        size = candidate.stat().st_size
        if size > budget:
            continue
        budget -= size
        texts.append(decode_text(candidate.read_bytes()))
    return "\n".join(texts)


@op("studio.document_image", StudioDocumentOpenParams)
def document_image(
    params: StudioDocumentOpenParams, _progress: Progress
) -> StudioDocumentImageResult:
    source = Path(params.path)
    if not source.is_file():
        raise _missing(params.path)
    payload, width, height, transparent = picture_file(source)
    return StudioDocumentImageResult(src=data_url(payload, transparent), width=width, height=height)


@op("studio.read_bibliography", StudioDocumentOpenParams)
def read_bibliography(
    params: StudioDocumentOpenParams, _progress: Progress
) -> StudioBibliographyResult:
    source = Path(params.path)
    if not source.is_file():
        raise _missing(params.path)
    extension = source.suffix.lower().lstrip(".")
    if extension not in SOURCE_LIBRARY_EXTENSIONS:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"unsupported file type: .{extension}",
            {"reason": "unsupportedType", "extension": extension},
        )
    if source.stat().st_size > MAX_BIBLIOGRAPHY_BYTES:
        raise _bibliography_too_large()
    payload = source.read_bytes()
    declared = JABREF_ENCODING.match(payload)
    text, encoding, lossy = decode_text_as(
        payload, declared.group(1).decode("ascii") if declared else None
    )
    return StudioBibliographyResult(
        text=text, name=source.name, encoding=encoding, hash=_digest(payload), lossy=lossy
    )


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _bibliography_too_large() -> OpError:
    return OpError(
        ErrorCode.INVALID_PARAMS,
        "the file is too large",
        {
            "reason": "sourceTooLarge",
            "limit": MAX_BIBLIOGRAPHY_BYTES,
            "limitMb": MAX_BIBLIOGRAPHY_BYTES // (1024 * 1024),
        },
    )


@op("studio.write_bibliography", StudioBibliographyWriteParams)
def write_bibliography(
    params: StudioBibliographyWriteParams, _progress: Progress
) -> StudioBibliographyWriteResult:
    target = Path(params.output)
    extension = target.suffix.lower().lstrip(".")
    if extension not in SOURCE_LIBRARY_EXTENSIONS:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"unsupported file type: .{extension}",
            {"reason": "unsupportedType", "extension": extension},
        )
    try:
        payload = params.text.encode(params.encoding)
    except LookupError as error:
        raise OpError(ErrorCode.INVALID_PARAMS, f"unknown encoding: {params.encoding}") from error
    except UnicodeEncodeError as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"the text does not fit {params.encoding}",
            {"reason": "sourceNotEncodable", "encoding": params.encoding},
        ) from error
    if len(payload) > MAX_BIBLIOGRAPHY_BYTES:
        raise _bibliography_too_large()
    if target.exists() and not params.overwrite:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"output already exists: {target.name}",
            {"exists": True, "path": str(target)},
        )
    if (
        params.expected_hash is not None
        and target.is_file()
        and _digest(target.read_bytes()) != params.expected_hash
    ):
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"{target.name} changed on disk",
            {"reason": "sourceChangedOnDisk", "name": target.name},
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    write_atomically(target, lambda path: path.write_bytes(payload))
    return StudioBibliographyWriteResult(
        output=str(target), bytes=len(payload), hash=_digest(payload)
    )
