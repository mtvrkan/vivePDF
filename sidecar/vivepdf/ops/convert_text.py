import html as html_module
import io
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import quote

import pymupdf

from vivepdf.ops._columns import column_order, page_columns, visible_direction, words_of
from vivepdf.ops._document import open_document
from vivepdf.ops._docx_running import strip_running_text
from vivepdf.ops._markdown_layout import (
    OVERLAP_TOLERANCE,
    SAME_BASELINE,
    TEXT_FLAGS,
    add_turned_text,
    clear_hidden_strikes,
    cover_bare_page,
    is_horizontal,
    join_baselines,
    line_text,
    link_spans,
    mark_broken_words,
    merge_pictures,
    turned_lines,
)
from vivepdf.ops._markdown_text import inert_markdown, tidy_markdown
from vivepdf.ops._markup import (
    body_size,
    document_language,
    join_broken_words,
    page_html,
    page_markup,
    share_repeated_pictures,
    text_language,
)
from vivepdf.ops._markup_pictures import picture_dpi
from vivepdf.ops._placement import drop_unplaceable_annotations, turn_text_upright
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._spreadsheet import clean_text
from vivepdf.ops._words import (
    Vocabulary,
    join_marked_markdown,
    join_plain_lines,
    plain_letters,
)
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


LAYOUT_FLAGS = pymupdf.TEXT_PRESERVE_WHITESPACE
LAYOUT_GRID = 2
LAYOUT_SMALLEST_FONT = 3


def layout_text(page: pymupdf.Page) -> str:
    from pymupdf.__main__ import page_layout

    buffer = io.BytesIO()
    try:
        page_layout(page, buffer, LAYOUT_GRID, LAYOUT_SMALLEST_FONT, True, True, LAYOUT_FLAGS)
    except (RuntimeError, ArithmeticError, ValueError):
        return page.get_text("text", sort=True)
    text = buffer.getvalue().decode("utf-8", errors="replace").strip("\n")
    turned = [line for line in map(line_text, turned_lines(page)) if line]
    return "\n\n".join(part for part in (text, "\n".join(turned)) if part)


@dataclass(slots=True)
class _Row:
    text: str
    baseline: float
    size: float
    right: float
    horizontal: bool


def _continues(row: _Row, left: float, baseline: float, size: float) -> bool:
    return (
        row.horizontal
        and abs(baseline - row.baseline) <= max(row.size, size) * SAME_BASELINE
        and left >= row.right - OVERLAP_TOLERANCE
    )


def _joined(left: str, right: str) -> str:
    if not right.strip():
        return left
    if not left.strip():
        return right
    return f"{left.rstrip()} {right.lstrip()}"


def _in_columns(page: pymupdf.Page, lines: list[dict]) -> list[dict]:
    turn = page.rotation_matrix
    placed = [(pymupdf.Rect(line["bbox"]) * turn, line) for line in lines]
    columns = page_columns(
        page,
        [
            (rect, words_of("".join(span["text"] for span in line["spans"])))
            for rect, line in placed
            if is_horizontal(visible_direction(line["dir"], turn))
        ],
    )
    return lines if columns is None else column_order(placed, columns)


def reading_text(page: pymupdf.Page) -> str:
    rows: list[_Row] = []
    lines = [
        line
        for block in page.get_text("dict", flags=TEXT_FLAGS)["blocks"]
        for line in block.get("lines", [])
        if line["spans"]
    ]
    turn = page.rotation_matrix
    for line in _in_columns(page, lines):
        spans = line["spans"]
        text = "".join(span["text"] for span in spans)
        shown = pymupdf.Rect(line["bbox"]) * turn
        baseline = (pymupdf.Point(spans[0]["origin"]) * turn).y
        size = max(span["size"] for span in spans) or 1.0
        horizontal = is_horizontal(visible_direction(line["dir"], turn))
        if horizontal and rows and _continues(rows[-1], shown.x0, baseline, size):
            row = rows[-1]
            row.text = _joined(row.text, text)
            row.right = shown.x1
            row.size = max(row.size, size)
            continue
        rows.append(_Row(text, baseline, size, shown.x1, horizontal))
    return "".join(f"{row.text}\n" for row in rows)


def page_text(page: pymupdf.Page, layout: bool) -> str:
    text = layout_text(page) if layout else ""
    return plain_letters(clean_text(text if text.strip() else reading_text(page)))


@op("convert.to_text", TextParams)
def to_text(params: TextParams, progress: Progress) -> TextFileResult:
    target = _prepare_file(params.output, [params.path], params.overwrite, ".txt")
    chunks: list[str] = []
    textless: list[int] = []
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        recognised, progress = recognise_first(document, indices, params, progress)
        strip_running_text(document, indices)
        for position, index in enumerate(indices):
            progress.check_cancelled()
            chunk = page_text(document[index], params.layout)
            if not chunk.strip():
                textless.append(index + 1)
            chunks.append(chunk if not chunk or chunk.endswith("\n") else chunk + "\n")
            if position % 20 == 0:
                progress.report(position / len(indices), "progress.converting")
    if not params.layout:
        vocabulary = Vocabulary(chunks)
        chunks = [join_plain_lines(chunk, vocabulary) for chunk in chunks]
    return _write_text_file(target, "\f".join(chunks), textless, recognised)


MARKDOWN_BAND = (0.1, 0.95)
CONTENT_POLICY = (
    '<meta http-equiv="Content-Security-Policy" '
    "content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">"
)
HEADER_BOX_CLASSES = ("title", "section-header")
PICTURE_BOX_CLASSES = ("picture", "formula")

MarkdownPictures = Literal["none", "files", "embed"]


class MarkdownParams(TextSourceParams):
    pictures: MarkdownPictures = "none"


class MarkdownResult(TextFileResult):
    picture_count: int = 0
    picture_folder: str | None = None


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
            pixmap = page.get_pixmap(clip=clip, dpi=picture_dpi(clip))
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
            merge_pictures(page, layout)
            join_baselines(layout)
            clear_hidden_strikes(page, layout)
            add_turned_text(page, layout)
            link_spans(page, layout)
            mark_broken_words(layout)
            if pictures is not None and index + 1 not in recognised:
                cover_bare_page(page, layout)
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
    markdown = inert_markdown(plain_letters(markdown))
    return tidy_markdown(join_marked_markdown(markdown, Vocabulary([markdown]))), textless


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
            strip_running_text(document, indices)
            progress.report(0.02, "progress.converting")
            markdown, textless = _markdown_pages(document, indices, progress, pictures, recognised)
        return _publish_markdown(target, markdown, textless, recognised, pictures, folder)
    finally:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)


@op("convert.to_html", TextSourceParams)
def to_html(params: TextSourceParams, progress: Progress) -> TextFileResult:
    target = _prepare_file(params.output, [params.path], params.overwrite, ".html")
    pages = []
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        title = html_module.escape(
            clean_text((document.metadata or {}).get("title") or Path(params.path).stem)
        )
        recognised, progress = recognise_first(document, indices, params, progress)
        language = document_language(document) or text_language(document, indices)
        strip_running_text(document, indices)
        for position, index in enumerate(indices):
            progress.check_cancelled()
            pages.append(page_markup(document[index], images=index + 1 not in recognised))
            if position % 10 == 0:
                progress.report(position / len(indices), "progress.converting")
    join_broken_words(pages)
    shared = share_repeated_pictures(pages)
    body = body_size(pages)
    parts = [
        f'<section class="page" data-page="{index + 1}">{page_html(page, body)}</section>'
        for index, page in zip(indices, pages, strict=True)
    ]
    textless = [index + 1 for index, page in zip(indices, pages, strict=True) if not page.sizes]
    opening = f'<html lang="{html_module.escape(language)}">' if language else "<html>"
    html = (
        f'<!doctype html>{opening}<head><meta charset="utf-8">{CONTENT_POLICY}'
        f"<title>{title}</title>"
        "<style>body{font-family:sans-serif;max-width:52em;margin:2em auto;padding:0 1em}"
        ".page{border-bottom:1px solid #ddd;padding:1em 0}img,svg.picture{max-width:100%}"
        "svg.picture{height:auto}table{border-collapse:collapse;margin:1em 0}"
        "th,td{border:1px solid #ccc;padding:.25em .5em;vertical-align:top;text-align:left}</style>"
        "</head><body>" + shared + "".join(parts) + "</body></html>"
    )
    return _write_text_file(target, html, textless, recognised)
