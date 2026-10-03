import contextlib
import html
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document_structure import plain_text_html
from vivepdf.ops._html_clean import without_remote_pictures
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._story import FONT_DIR, MAX_STORY_PAGES, markdown_to_html
from vivepdf.ops.cover import CoverParams, CoverStyle, draw_cover
from vivepdf.ops.create import (
    COLOUR,
    DEFAULT_ACCENT,
    FAMILIES,
    FURNITURE_HEIGHT,
    POINTS_PER_MM,
    FontChoice,
    furniture_html,
    read_text_file,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

BookPaper = Literal["a4", "a5", "b5", "letter"]
MAX_CHAPTERS = 200
MAX_TOTAL_BYTES = 60 * 1024 * 1024
LEADING_H1 = re.compile(r"^\s*<h1\b[^>]*>(.*?)</h1>\s*", re.IGNORECASE | re.DOTALL)
HEADING_TAG = re.compile(r"<(/?)h([1-6])\b", re.IGNORECASE)
SECTION_OPEN = re.compile(r"<h2\b([^>]*)>(.*?)</h2>", re.IGNORECASE | re.DOTALL)
INTERNAL_LINK = re.compile(r"""\shref\s*=\s*["']#[^"']*["']""", re.IGNORECASE)
ID_ATTRIBUTE = re.compile(r"""\sid\s*=\s*["'][^"']*["']""", re.IGNORECASE)
TAG = re.compile(r"<[^>]*>")
NUMBER_PREFIX = re.compile(r"^\d+[\s._-]+")


class CreateBookParams(RpcModel):
    chapters: list[str] = Field(min_length=1, max_length=MAX_CHAPTERS)
    title: str = Field(default="", max_length=300)
    subtitle: str = Field(default="", max_length=300)
    author: str = Field(default="", max_length=300)
    date: str = Field(default="", max_length=80)
    cover: bool = True
    cover_style: CoverStyle = "classic"
    cover_image: str | None = None
    toc: bool = True
    toc_title: str = Field(default="Contents", max_length=100)
    toc_depth: Literal[1, 2] = 2
    chapter_label: str = Field(default="", max_length=60)
    running_header: bool = True
    page_numbers: bool = True
    font: FontChoice = "serif"
    font_size: float = Field(default=11, ge=8, le=16)
    margin_mm: float = Field(default=20, ge=10, le=40)
    accent: str = DEFAULT_ACCENT
    paper: BookPaper = "a5"
    output: str
    overwrite: bool = False


@dataclass
class Section:
    anchor: str
    title: str


@dataclass
class Chapter:
    anchor: str
    title: str
    body: str
    sections: list[Section] = field(default_factory=list)


def _plain(fragment: str) -> str:
    return " ".join(html.unescape(TAG.sub(" ", fragment)).split())


def _title_from_name(path: Path) -> str:
    name = NUMBER_PREFIX.sub("", path.stem).replace("_", " ").strip()
    return name or path.stem


def _shift_headings(body: str) -> str:
    levels = [int(level) for _slash, level in HEADING_TAG.findall(body)]
    if not levels:
        return body
    delta = 2 - min(levels)

    def shifted(match: re.Match[str]) -> str:
        level = min(6, max(2, int(match.group(2)) + delta))
        return f"<{match.group(1)}h{level}"

    return HEADING_TAG.sub(shifted, body)


def _chapter(index: int, path: str) -> Chapter:
    text, markdown = read_text_file(path)
    rendered = markdown_to_html(text) if markdown else plain_text_html(text)
    rendered = ID_ATTRIBUTE.sub("", INTERNAL_LINK.sub("", without_remote_pictures(rendered)))
    leading = LEADING_H1.match(rendered)
    title = _plain(leading.group(1)) if leading else ""
    if leading:
        rendered = rendered[leading.end() :]
    chapter = Chapter(f"c{index}", title or _title_from_name(Path(path)), "")

    def numbered(match: re.Match[str]) -> str:
        anchor = f"c{index}s{len(chapter.sections) + 1}"
        chapter.sections.append(Section(anchor, _plain(match.group(2))))
        return f'<h2 id="{anchor}"{match.group(1)}>{match.group(2)}</h2>'

    chapter.body = SECTION_OPEN.sub(numbered, _shift_headings(rendered))
    return chapter


def _read_chapters(paths: list[str]) -> list[Chapter]:
    total = sum(Path(path).stat().st_size for path in paths if Path(path).is_file())
    if total > MAX_TOTAL_BYTES:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the chapters are too large together",
            {"reason": "sourceTooLarge", "limit": MAX_TOTAL_BYTES},
        )
    return [_chapter(index, path) for index, path in enumerate(paths, start=1)]


def _escape(value: str) -> str:
    return html.escape(value.strip())


def _toc_rows(chapters: list[Chapter], pages: dict[str, int], depth: int, offset: int) -> str:
    rows: list[str] = []
    for chapter in chapters:
        page = pages.get(chapter.anchor, 0) + offset
        rows.append(
            f'<tr class="toc-chapter"><td><a href="#{chapter.anchor}">'
            f'{_escape(chapter.title)}</a></td><td class="toc-page">{page}</td></tr>'
        )
        if depth < 2:
            continue
        for section in chapter.sections:
            page = pages.get(section.anchor, 0) + offset
            rows.append(
                f'<tr class="toc-section"><td><div class="toc-indent"><a href="#{section.anchor}">'
                f'{_escape(section.title)}</a></div></td><td class="toc-page">{page}</td></tr>'
            )
    return f'<table class="toc">{"".join(rows)}</table>'


def _front_html(params: CreateBookParams) -> str:
    if params.cover:
        return ""
    parts = [f'<h1 class="book-title">{_escape(params.title)}</h1>'] if params.title.strip() else []
    for value, css_class in ((params.subtitle, "book-subtitle"), (params.author, "book-author")):
        if value.strip():
            parts.append(f'<p class="{css_class}">{_escape(value)}</p>')
    return f'<div class="front">{"".join(parts)}</div>' if parts else ""


def _chapter_html(params: CreateBookParams, chapter: Chapter, number: int, breaks: bool) -> str:
    label = params.chapter_label.replace("{n}", str(number)).strip()
    opening = f'<p class="chapter-label">{_escape(label)}</p>' if label else ""
    opening += f'<h1 id="{chapter.anchor}" class="chapter-title">{_escape(chapter.title)}</h1>'
    css_class = "chapter-open break" if breaks else "chapter-open"
    return f'<div class="{css_class}">{opening}</div>{chapter.body}'


def _book_css(params: CreateBookParams) -> str:
    size = params.font_size
    accent = params.accent if COLOUR.match(params.accent) else DEFAULT_ACCENT
    family = FAMILIES[params.font]
    return "".join(
        [
            f"body{{font-family:{family};font-size:{size}pt;line-height:1.5;color:#1a1a1a;}}",
            f"p{{margin:0 0 {size * 0.55:.1f}pt 0;text-align:justify;}}",
            f"h2{{font-size:{size * 1.3:.1f}pt;margin:{size * 1.2:.1f}pt 0 4pt 0;color:{accent};}}",
            f"h3{{font-size:{size * 1.12:.1f}pt;margin:{size:.1f}pt 0 3pt 0;}}",
            f"h4,h5,h6{{font-size:{size}pt;margin:{size * 0.8:.1f}pt 0 2pt 0;}}",
            "ul,ol{margin:0 0 6pt 0;padding-left:16pt;}",
            "li{margin:0 0 2pt 0;}",
            f"pre,code{{font-family:monospace;font-size:{size * 0.86:.1f}pt;}}",
            "pre,code{white-space:pre-wrap;}",
            "pre{background-color:#f3f4f6;padding:6pt;}",
            "table{border-collapse:collapse;margin:0 0 6pt 0;}",
            "td,th{border:0.5pt solid #999999;padding:2pt 4pt;}",
            "blockquote{margin:0 0 6pt 0;padding-left:8pt;border-left:2pt solid #cccccc;}",
            "img{max-width:100%;}",
            "a{color:#1a1a1a;text-decoration:none;}",
            ".break{page-break-before:always;}",
            f".chapter-open{{padding-top:{size * 5:.1f}pt;margin-bottom:{size * 2:.1f}pt;}}",
            f".chapter-label{{color:{accent};font-size:{size * 0.95:.1f}pt;margin:0 0 4pt 0;"
            f"letter-spacing:1pt;text-align:left;}}",
            f".chapter-title{{font-size:{size * 2:.1f}pt;margin:0;line-height:1.2;}}",
            f".front{{padding-top:{size * 3:.1f}pt;margin-bottom:{size * 2:.1f}pt;}}",
            f".book-title{{font-size:{size * 2.4:.1f}pt;color:{accent};margin:0 0 6pt 0;}}",
            f".book-subtitle{{font-size:{size * 1.3:.1f}pt;color:#444444;text-align:left;}}",
            ".book-author{color:#555555;text-align:left;}",
            f".toc-title{{font-size:{size * 1.7:.1f}pt;margin:0 0 {size:.1f}pt 0;}}",
            ".toc{width:100%;border:none;}",
            ".toc td{border:none;padding:2pt 0;vertical-align:bottom;}",
            ".toc-page{text-align:right;width:12%;}",
            ".toc-chapter td{font-weight:bold;padding-top:5pt;}",
            ".toc-section td{color:#333333;}",
            ".toc a{color:#1a1a1a;text-decoration:none;}",
            ".toc-indent{margin-left:12pt;}",
        ]
    )


def _story_html(
    params: CreateBookParams, chapters: list[Chapter], pages: dict[str, int], offset: int
) -> str:
    parts = [_front_html(params)]
    if params.toc:
        parts.append(f'<h1 class="toc-title">{_escape(params.toc_title)}</h1>')
        parts.append(_toc_rows(chapters, pages, params.toc_depth, offset))
    leads = any(parts)
    for number, chapter in enumerate(chapters, start=1):
        parts.append(_chapter_html(params, chapter, number, leads or number > 1))
    return "".join(parts)


def _layout(
    params: CreateBookParams, chapters: list[Chapter], progress: Progress, offset: int
) -> tuple[pymupdf.Document, dict[str, int]]:
    mediabox = pymupdf.paper_rect(params.paper)
    margin = params.margin_mm * POINTS_PER_MM
    where = mediabox + (margin, margin, -margin, -margin)
    archive = pymupdf.Archive(str(FONT_DIR))
    for directory in sorted({str(Path(path).resolve().parent) for path in params.chapters}):
        archive.add(directory)
    anchors: dict[str, int] = {}

    def content(positions: list) -> str:
        pages = {
            position.id: position.page_num
            for position in positions
            if position.id and position.open_close & 1
        }
        return _story_html(params, chapters, pages, offset)

    def rectangle(number: int, _filled: pymupdf.Rect):
        progress.check_cancelled()
        if number >= MAX_STORY_PAGES:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"the book would have more than {MAX_STORY_PAGES} pages",
                {"reason": "tooManyPages", "limit": MAX_STORY_PAGES},
            )
        return mediabox, where, None

    def remember(position) -> None:
        if position.id and position.open_close & 1 and position.id not in anchors:
            anchors[position.id] = position.page_num

    document = pymupdf.Story.write_stabilized_with_links(
        content,
        rectangle,
        user_css=_book_css(params),
        positionfn=remember,
        archive=archive,
        add_header_ids=False,
    )
    return document, anchors


def _add_cover(document: pymupdf.Document, params: CreateBookParams, workdir: Path) -> None:
    first = document[0].rect
    cover = CoverParams(
        path="",
        output="",
        style=params.cover_style,
        title=params.title,
        subtitle=params.subtitle,
        author=params.author,
        date=params.date,
        image=params.cover_image,
        accent=params.accent,
        font=params.font,
    )
    with pymupdf.open() as cover_document:
        page = cover_document.new_page(width=first.width, height=first.height)
        draw_cover(page, cover, workdir)
        document.insert_pdf(cover_document, start_at=0)


def _chapter_of_page(chapters: list[Chapter], anchors: dict[str, int], page: int) -> Chapter | None:
    current = None
    for chapter in chapters:
        start = anchors.get(chapter.anchor)
        if start is not None and start <= page:
            current = chapter
    return current


def _add_furniture(
    document: pymupdf.Document,
    params: CreateBookParams,
    chapters: list[Chapter],
    anchors: dict[str, int],
    offset: int,
) -> None:
    family = FAMILIES[params.font]
    margin = params.margin_mm * POINTS_PER_MM
    openings = {anchors.get(chapter.anchor) for chapter in chapters}
    for index in range(offset, document.page_count):
        page = document[index]
        story_page = index - offset + 1
        width, height = page.rect.width, page.rect.height
        if params.running_header and story_page not in openings:
            chapter = _chapter_of_page(chapters, anchors, story_page)
            if chapter is not None:
                top = max(4.0, margin / 2 - FURNITURE_HEIGHT / 2)
                page.insert_htmlbox(
                    pymupdf.Rect(margin, top, width - margin, top + FURNITURE_HEIGHT),
                    furniture_html(chapter.title, "right", family),
                )
        if params.page_numbers:
            bottom = min(height - 4.0, height - margin / 2 + FURNITURE_HEIGHT / 2)
            page.insert_htmlbox(
                pymupdf.Rect(margin, bottom - FURNITURE_HEIGHT, width - margin, bottom),
                furniture_html(str(index + 1), "center", family),
            )


def _bookmarks(
    params: CreateBookParams, chapters: list[Chapter], anchors: dict[str, int], offset: int
) -> list[list]:
    toc: list[list] = []
    if params.toc:
        toc.append([1, params.toc_title.strip() or "Contents", 1 + offset])
    for chapter in chapters:
        if chapter.anchor not in anchors:
            continue
        toc.append([1, chapter.title, anchors[chapter.anchor] + offset])
        for section in chapter.sections:
            if section.anchor in anchors:
                toc.append([2, section.title, anchors[section.anchor] + offset])
    return toc


@op("create.book", CreateBookParams)
def create_book(params: CreateBookParams, progress: Progress) -> OutputResult:
    if not params.title.strip():
        raise OpError(ErrorCode.INVALID_PARAMS, "the book needs a title", {"reason": "noTitle"})
    inputs = [*params.chapters, *([params.cover_image] if params.cover_image else [])]
    target = prepare_output(params.output, inputs, params.overwrite)
    progress.report(0.05, "progress.converting")
    chapters = _read_chapters(params.chapters)
    offset = 1 if params.cover else 0
    progress.report(0.15, "progress.converting")
    document, anchors = _layout(params, chapters, progress, offset)
    with (
        document,
        tempfile.TemporaryDirectory(prefix="vivepdf-book-", ignore_cleanup_errors=True) as temp,
    ):
        if params.cover:
            _add_cover(document, params, Path(temp))
        progress.report(0.8, "progress.saving")
        _add_furniture(document, params, chapters, anchors, offset)
        document.set_toc(_bookmarks(params, chapters, anchors, offset))
        metadata = dict(document.metadata or {})
        metadata.update(
            {
                "title": params.title.strip(),
                "subject": params.subtitle.strip(),
                "author": params.author.strip(),
                "creator": "vivePDF",
            }
        )
        document.set_metadata(metadata)
        with contextlib.suppress(Exception):
            document.subset_fonts(fallback=False)
        return save_document(document, target)
