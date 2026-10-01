import html as html_module
import io
import math
import re
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import quote

import pymupdf

from vivepdf.ops._document import open_document
from vivepdf.ops._markup import (
    PageMarkup,
    body_size,
    document_language,
    inert_markdown,
    page_markup,
    retag_headings,
)
from vivepdf.ops._page_images import MAX_IMAGE_SIDE
from vivepdf.ops._placement import drop_unplaceable_annotations, turn_text_upright
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._spreadsheet import clean_text
from vivepdf.ops.convert import (
    TextFileResult,
    TextSourceParams,
    _prepare_file,
    _write_text_file,
    recognise_first,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.registry import op


class TextParams(TextSourceParams):
    layout: bool = False


LAYOUT_FLAGS = pymupdf.TEXT_PRESERVE_LIGATURES | pymupdf.TEXT_PRESERVE_WHITESPACE
LAYOUT_GRID = 2
LAYOUT_SMALLEST_FONT = 3


def layout_text(page: pymupdf.Page) -> str:
    from pymupdf.__main__ import page_layout

    buffer = io.BytesIO()
    try:
        page_layout(page, buffer, LAYOUT_GRID, LAYOUT_SMALLEST_FONT, True, True, LAYOUT_FLAGS)
    except (RuntimeError, ArithmeticError, ValueError):
        return page.get_text("text", sort=True)
    return buffer.getvalue().decode("utf-8", errors="replace").strip("\n")


def page_text(page: pymupdf.Page, layout: bool) -> str:
    text = layout_text(page) if layout else ""
    return clean_text(text if text.strip() else page.get_text("text"))


@op("convert.to_text", TextParams)
def to_text(params: TextParams, progress: Progress) -> TextFileResult:
    target = _prepare_file(params.output, [params.path], params.overwrite, ".txt")
    chunks: list[str] = []
    textless: list[int] = []
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        recognised, progress = recognise_first(document, indices, params, progress)
        for position, index in enumerate(indices):
            progress.check_cancelled()
            chunk = page_text(document[index], params.layout)
            if not chunk.strip():
                textless.append(index + 1)
            chunks.append(chunk if not chunk or chunk.endswith("\n") else chunk + "\n")
            if position % 20 == 0:
                progress.report(position / len(indices), "progress.converting")
    return _write_text_file(target, "\f".join(chunks), textless, recognised)


MARKDOWN_BAND = (0.1, 0.95)
PAGE_ID = re.compile(r'<div id="page\d+">')
HEADER_BOX_CLASSES = ("title", "section-header")
PICTURE_BOX_CLASSES = ("picture", "formula")
MARKDOWN_PICTURE_DPI = 150
MARKDOWN_PICTURE_PIXELS = 16_000_000
LINK_SCHEMES = ("http://", "https://", "mailto:")
LINK_SAFE_CHARACTERS = ":/?#@!$&'*+,;=%~-._"

MarkdownPictures = Literal["none", "files", "embed"]


class MarkdownParams(TextSourceParams):
    pictures: MarkdownPictures = "none"


class MarkdownResult(TextFileResult):
    picture_count: int = 0
    picture_folder: str | None = None


def _page_links(page: pymupdf.Page) -> list[tuple[pymupdf.Rect, str]]:
    links = []
    for link in page.get_links():
        uri = (link.get("uri") or "").strip()
        if link.get("kind") == pymupdf.LINK_URI and uri.lower().startswith(LINK_SCHEMES):
            links.append((pymupdf.Rect(link["from"]), quote(uri, safe=LINK_SAFE_CHARACTERS)))
    return sorted(links, key=lambda item: (item[0].y0, item[0].x0))


def _link_label(text: str) -> str:
    return text.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")


def _linked_text(
    page: pymupdf.Page,
    textpage: pymupdf.TextPage,
    span: dict,
    links: list[tuple[pymupdf.Rect, str]],
) -> str:
    area = pymupdf.Rect(span["bbox"])
    text = span["text"]
    cursor = 0
    for rect, url in links:
        overlap = area & rect
        if overlap.is_empty or overlap.height < area.height / 2:
            continue
        label = page.get_textbox(overlap, textpage=textpage).strip()
        position = text.find(label, cursor) if label else -1
        if position < 0:
            continue
        linked = f"[{_link_label(label)}]({url})"
        text = text[:position] + linked + text[position + len(label) :]
        cursor = position + len(linked)
    return text


def _link_spans(page: pymupdf.Page, layout) -> None:
    links = _page_links(page)
    if not links:
        return
    textpage = page.get_textpage()
    for box in layout.boxes:
        for line in box.textlines or []:
            for span in line["spans"]:
                span["text"] = _linked_text(page, textpage, span, links)


def _picture_dpi(clip: pymupdf.Rect) -> int:
    square_inches = clip.width * clip.height / (72 * 72)
    by_pixels = math.sqrt(MARKDOWN_PICTURE_PIXELS / square_inches)
    by_side = (MAX_IMAGE_SIDE["png"] - 2) * 72 / max(clip.width, clip.height)
    return max(1, math.floor(min(MARKDOWN_PICTURE_DPI, by_pixels, by_side)))


@dataclass(slots=True)
class _PictureSink:
    mode: MarkdownPictures
    staging: Path | None
    reference: str
    names: list[str] = field(default_factory=list)
    count: int = 0

    def take(self, page: pymupdf.Page, layout) -> None:
        number = 0
        for box in layout.boxes:
            if box.boxclass not in PICTURE_BOX_CLASSES:
                continue
            clip = pymupdf.Rect(box.x0, box.y0, box.x1, box.y1) & page.rect
            if clip.is_empty:
                continue
            pixmap = page.get_pixmap(clip=clip, dpi=_picture_dpi(clip))
            if pixmap.width == 0 or pixmap.height == 0:
                continue
            data = pixmap.tobytes("png")
            number += 1
            self.count += 1
            if self.staging is None:
                box.image = data
                continue
            name = f"page-{page.number + 1:04d}-{number:02d}.png"
            (self.staging / name).write_bytes(data)
            self.names.append(name)
            box.image = f"{self.reference}/{name}"


def _markdown_pages(
    document: pymupdf.Document,
    indices: list[int],
    progress: Progress,
    pictures: _PictureSink | None = None,
    recognised: tuple[int, ...] | list[int] = (),
) -> tuple[str, list[int]]:
    from pymupdf4llm.helpers import document_layout

    ordered = sorted(set(indices))
    start, end = MARKDOWN_BAND
    layouts = []
    textless: list[int] = []
    for position, index in enumerate(ordered):
        progress.check_cancelled()
        progress.report(
            start + (end - start) * position / len(ordered),
            "progress.convertingPages",
            {"current": position + 1, "total": len(ordered)},
        )
        page = document[index]
        if not page.get_text("text").strip():
            textless.append(index + 1)
            if pictures is None:
                continue
        turn_text_upright(document, [index])
        if page.rotation:
            drop_unplaceable_annotations(page)
        parsed = document_layout.parse_document(
            document, pages=[index], force_text=True, use_ocr=False
        )
        for layout in parsed.pages:
            _link_spans(page, layout)
            if pictures is not None and index + 1 not in recognised:
                pictures.take(page, layout)
        layouts.extend(parsed.pages)
    progress.check_cancelled()
    header_sizes = {
        box.max_fontsize
        for layout in layouts
        for box in layout.boxes
        if box.boxclass in HEADER_BOX_CLASSES
    }
    if header_sizes:
        document_layout.update_header_tags(layouts, header_sizes)
    markdown = document_layout.ParsedDocument(pages=layouts).to_markdown(
        header=True, footer=True, write_images=False, embed_images=False
    )
    return inert_markdown(markdown), textless


def _picture_folder(target: Path, overwrite: bool) -> Path:
    folder = target.with_name(f"{target.stem}-images")
    if folder.exists() and not overwrite:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"output already exists: {folder.name}",
            {"exists": True, "path": str(folder)},
        )
    return folder


def _publish_markdown(
    target: Path,
    markdown: str,
    textless: list[int],
    recognised: list[int],
    pictures: _PictureSink | None,
    folder: Path | None,
) -> MarkdownResult:
    moved = folder is not None and pictures is not None and bool(pictures.names)
    created = moved and not folder.exists()
    try:
        if moved:
            folder.mkdir(exist_ok=True)
            for name in pictures.names:
                (pictures.staging / name).replace(folder / name)
        written = _write_text_file(target, markdown, textless, recognised)
    except BaseException:
        if created:
            shutil.rmtree(folder, ignore_errors=True)
        raise
    return MarkdownResult(
        **written.model_dump(),
        picture_count=pictures.count if pictures else 0,
        picture_folder=str(folder) if moved else None,
    )


@op("convert.to_markdown", MarkdownParams)
def to_markdown(params: MarkdownParams, progress: Progress) -> MarkdownResult:
    target = _prepare_file(params.output, [params.path], params.overwrite, ".md")
    folder = _picture_folder(target, params.overwrite) if params.pictures == "files" else None
    staging = Path(tempfile.mkdtemp(prefix=".vivepdf-", dir=target.parent)) if folder else None
    try:
        pictures = (
            _PictureSink(params.pictures, staging, quote(folder.name) if folder else "")
            if params.pictures != "none"
            else None
        )
        with open_document(params.path, params.password) as document:
            indices = parse_page_ranges(params.pages, document.page_count)
            recognised, progress = recognise_first(document, indices, params, progress)
            progress.report(0.02, "progress.converting")
            markdown, textless = _markdown_pages(document, indices, progress, pictures, recognised)
        return _publish_markdown(target, markdown, textless, recognised, pictures, folder)
    finally:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)


def _html_page(page: PageMarkup, body: float | None) -> str:
    return PAGE_ID.sub("<div>", retag_headings(page, body))


@op("convert.to_html", TextSourceParams)
def to_html(params: TextSourceParams, progress: Progress) -> TextFileResult:
    target = _prepare_file(params.output, [params.path], params.overwrite, ".html")
    pages = []
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        title = html_module.escape(
            clean_text((document.metadata or {}).get("title") or Path(params.path).stem)
        )
        language = document_language(document)
        recognised, progress = recognise_first(document, indices, params, progress)
        for position, index in enumerate(indices):
            progress.check_cancelled()
            pages.append(page_markup(document[index], images=index + 1 not in recognised))
            if position % 10 == 0:
                progress.report(position / len(indices), "progress.converting")
    body = body_size(pages)
    parts = [
        f'<section class="page" data-page="{index + 1}">{_html_page(page, body)}</section>'
        for index, page in zip(indices, pages, strict=True)
    ]
    textless = [index + 1 for index, page in zip(indices, pages, strict=True) if not page.sizes]
    opening = f'<html lang="{html_module.escape(language)}">' if language else "<html>"
    html = (
        f'<!doctype html>{opening}<head><meta charset="utf-8">'
        f"<title>{title}</title>"
        "<style>body{font-family:sans-serif;max-width:52em;margin:2em auto;padding:0 1em}"
        ".page{border-bottom:1px solid #ddd;padding:1em 0}img{max-width:100%}</style>"
        "</head><body>" + "".join(parts) + "</body></html>"
    )
    return _write_text_file(target, html, textless, recognised)
