import html as html_module
import io
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import quote

import pymupdf

from vivepdf.ops._document import open_document
from vivepdf.ops._docx_bidi import mostly_right_to_left
from vivepdf.ops._docx_running import strip_running_text
from vivepdf.ops._markup import (
    LINK_SAFE_CHARACTERS,
    LINK_SCHEMES,
    body_size,
    document_language,
    inert_markdown,
    join_broken_words,
    page_html,
    page_markup,
    picture_dpi,
    text_language,
    tidy_markdown,
)
from vivepdf.ops._placement import drop_unplaceable_annotations, turn_text_upright
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._spreadsheet import clean_text
from vivepdf.ops._words import (
    LINE_BREAK,
    Vocabulary,
    breaks_word,
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
TEXT_FLAGS = pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_PRESERVE_LIGATURES
SAME_BASELINE = 0.3
OVERLAP_TOLERANCE = 1.0
LINK_CORE = 0.5


def _horizontal(direction: tuple[float, float]) -> bool:
    return abs(direction[1]) < 1e-3 and direction[0] > 0


def turned_lines(page: pymupdf.Page) -> list[dict]:
    return [
        line
        for block in page.get_text("dict", flags=TEXT_FLAGS)["blocks"]
        for line in block.get("lines", [])
        if line["spans"] and not _horizontal(line["dir"])
    ]


def _line_text(line: dict) -> str:
    return "".join(span["text"] for span in line["spans"]).strip()


def layout_text(page: pymupdf.Page) -> str:
    from pymupdf.__main__ import page_layout

    buffer = io.BytesIO()
    try:
        page_layout(page, buffer, LAYOUT_GRID, LAYOUT_SMALLEST_FONT, True, True, LAYOUT_FLAGS)
    except (RuntimeError, ArithmeticError, ValueError):
        return page.get_text("text", sort=True)
    text = buffer.getvalue().decode("utf-8", errors="replace").strip("\n")
    turned = [line for line in map(_line_text, turned_lines(page)) if line]
    return "\n\n".join(part for part in (text, "\n".join(turned)) if part)


@dataclass(slots=True)
class _Row:
    text: str
    baseline: float
    size: float
    right: float
    horizontal: bool


def _continues(row: _Row, line: dict, baseline: float, size: float) -> bool:
    return (
        row.horizontal
        and abs(baseline - row.baseline) <= max(row.size, size) * SAME_BASELINE
        and line["bbox"][0] >= row.right - OVERLAP_TOLERANCE
    )


def _joined(left: str, right: str) -> str:
    if not right.strip():
        return left
    if not left.strip():
        return right
    return f"{left.rstrip()} {right.lstrip()}"


def reading_text(page: pymupdf.Page) -> str:
    rows: list[_Row] = []
    for block in page.get_text("dict", flags=TEXT_FLAGS)["blocks"]:
        for line in block.get("lines", []):
            spans = line["spans"]
            if not spans:
                continue
            text = "".join(span["text"] for span in spans)
            baseline = spans[0]["origin"][1]
            size = max(span["size"] for span in spans) or 1.0
            horizontal = _horizontal(line["dir"])
            if horizontal and rows and _continues(rows[-1], line, baseline, size):
                row = rows[-1]
                row.text = _joined(row.text, text)
                row.right = line["bbox"][2]
                row.size = max(row.size, size)
                continue
            rows.append(_Row(text, baseline, size, line["bbox"][2], horizontal))
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
PICTURE_GAP = 36.0
PICTURE_IMAGE_SHARE = 0.5
STRIKE_KINDS = ("fill-path", "stroke-path")
COVER_KINDS = ("fill-path", "fill-image", "fill-shade")
STRIKE_THICKNESS = 0.25
STRIKE_REACH = 0.7
LOG_AREA_LIMIT = 1e12

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


def _page_glyphs(textpage: pymupdf.TextPage) -> dict[float, list[tuple[float, float, str]]]:
    glyphs: dict[float, list[tuple[float, float, str]]] = {}
    for block in textpage.extractRAWDICT()["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                for char in span["chars"]:
                    key = round(char["origin"][1], 1)
                    glyphs.setdefault(key, []).append((char["bbox"][0], char["bbox"][2], char["c"]))
    return glyphs


def _middle(glyph: tuple[float, float, str]) -> float:
    return (glyph[0] + glyph[1]) / 2


def _linked_text(
    span: dict,
    glyphs: dict[float, list[tuple[float, float, str]]],
    links: list[tuple[pymupdf.Rect, str]],
) -> str:
    area = pymupdf.Rect(span["bbox"])
    baseline = span["origin"][1]
    core = span["size"] * LINK_CORE
    row = sorted(
        glyph
        for glyph in glyphs.get(round(baseline, 1), [])
        if area.x0 - OVERLAP_TOLERANCE <= _middle(glyph) <= area.x1 + OVERLAP_TOLERANCE
    )
    text = span["text"]
    cursor = 0
    for rect, url in links:
        if min(baseline, rect.y1) - max(baseline - core, rect.y0) < core / 2:
            continue
        label = "".join(glyph[2] for glyph in row if rect.x0 <= _middle(glyph) <= rect.x1).strip()
        position = text.find(label, cursor) if any(map(str.isalnum, label)) else -1
        if position < 0:
            continue
        linked = f"[{_link_label(label)}]({url})"
        text = text[:position] + linked + text[position + len(label) :]
        cursor = position + len(linked)
    return text


def _baseline(line: dict) -> tuple[float, float]:
    spans = line["spans"]
    return spans[0]["origin"][1], max(span["size"] for span in spans) or 1.0


def _apart(line: dict, other: dict) -> bool:
    return all(
        span["bbox"].x1 <= piece["bbox"].x0 + OVERLAP_TOLERANCE
        or piece["bbox"].x1 <= span["bbox"].x0 + OVERLAP_TOLERANCE
        for span in line["spans"]
        for piece in other["spans"]
    )


def _shares_baseline(line: dict, other: dict) -> bool:
    (baseline, size), (other_baseline, other_size) = _baseline(line), _baseline(other)
    return abs(baseline - other_baseline) <= max(size, other_size) * SAME_BASELINE and _apart(
        line, other
    )


def _joined_lines(textlines: list[dict]) -> list[dict]:
    from pymupdf4llm.helpers.document_layout import is_superscripted

    lines: list[dict] = []
    for line in textlines:
        if not line["spans"] or not all(
            abs(span.get("dir", (1, 0))[1]) < 1e-3 for span in line["spans"]
        ):
            lines.append(line)
            continue
        target = next(
            (kept for kept in lines if kept["spans"] and _shares_baseline(kept, line)), None
        )
        if target is None:
            lines.append(line)
            continue
        spans = sorted(target["spans"] + line["spans"], key=lambda span: span["bbox"].x0)
        bbox = pymupdf.Rect(target["bbox"]) | line["bbox"]
        if is_superscripted({"spans": spans, "bbox": bbox}) and not is_superscripted(target):
            lines.append(line)
            continue
        target["spans"] = spans
        target["bbox"] = bbox
    return lines


def _turned_boxes(page: pymupdf.Page, tables: list[pymupdf.Rect]) -> list:
    from pymupdf4llm.helpers.document_layout import LayoutBox

    boxes = []
    for number, line in enumerate(turned_lines(page)):
        area = pymupdf.Rect(line["bbox"])
        centre = (area.tl + area.br) / 2
        if not _line_text(line) or any(centre in table for table in tables):
            continue
        spans = [
            {
                **span,
                "bbox": pymupdf.Rect(span["bbox"]),
                "dir": line["dir"],
                "line": number,
                "block": number,
            }
            for span in line["spans"]
        ]
        boxes.append(LayoutBox(*area, "text", textlines=[{"bbox": area, "spans": spans}]))
    return boxes


def _add_turned_text(page: pymupdf.Page, layout) -> None:
    tables = [
        pymupdf.Rect(box.x0, box.y0, box.x1, box.y1)
        for box in layout.boxes
        if box.boxclass == "table"
    ]
    boxes = _turned_boxes(page, tables)
    if not boxes:
        return
    position = len(layout.boxes)
    while position and layout.boxes[position - 1].boxclass == "page-footer":
        position -= 1
    layout.boxes[position:position] = boxes


def _close(box, other) -> bool:
    across = min(box.x1, other.x1) - max(box.x0, other.x0)
    down = min(box.y1, other.y1) - max(box.y0, other.y0)
    return (across > 0 and down >= -PICTURE_GAP) or (down > 0 and across >= -PICTURE_GAP)


def _drawn(box, images: list[pymupdf.Rect]) -> bool:
    area = pymupdf.Rect(box.x0, box.y0, box.x1, box.y1)
    return area.is_empty or all(
        abs(area & image) < abs(area) * PICTURE_IMAGE_SHARE for image in images
    )


def _merge_pictures(page: pymupdf.Page, layout) -> None:
    images = [pymupdf.Rect(info["bbox"]) for info in page.get_image_info()]
    boxes = []
    for box in layout.boxes:
        last = boxes[-1] if boxes else None
        if (
            last is not None
            and box.boxclass == last.boxclass == "picture"
            and _close(last, box)
            and _drawn(last, images)
            and _drawn(box, images)
        ):
            last.x0, last.y0 = min(last.x0, box.x0), min(last.y0, box.y0)
            last.x1, last.y1 = max(last.x1, box.x1), max(last.y1, box.y1)
            if box.textlines:
                last.textlines = [*(last.textlines or []), *box.textlines]
            continue
        boxes.append(box)
    layout.boxes = boxes


def _strike_lines(span: dict, log: list[tuple[int, str, pymupdf.Rect]]) -> list:
    area = pymupdf.Rect(span["bbox"])
    baseline, size = span["origin"][1], span["size"] or 1.0
    return [
        (order, pymupdf.Rect(max(rect.x0, area.x0), rect.y0, min(rect.x1, area.x1), rect.y1))
        for order, kind, rect in log
        if kind in STRIKE_KINDS
        and rect.height <= size * STRIKE_THICKNESS
        and baseline - size * STRIKE_REACH <= rect.y1
        and rect.y0 <= baseline
        and min(rect.x1, area.x1) - max(rect.x0, area.x0) >= area.width / 2
    ]


def _covered(segment: pymupdf.Rect, order: int, log: list[tuple[int, str, pymupdf.Rect]]) -> bool:
    cover = pymupdf.Rect(
        segment.x0 + OVERLAP_TOLERANCE, segment.y0, segment.x1 - OVERLAP_TOLERANCE, segment.y1
    )
    return any(
        later > order and kind in COVER_KINDS and rect.contains(cover) for later, kind, rect in log
    )


def _clear_hidden_strikes(page: pymupdf.Page, layout) -> None:
    struck = [
        span
        for box in layout.boxes
        for line in box.textlines or []
        for span in line["spans"]
        if span.get("char_flags", 0) & pymupdf.mupdf.FZ_STEXT_STRIKEOUT
    ]
    if not struck:
        return
    log = [
        (order, kind, pymupdf.Rect(rect))
        for order, (kind, rect) in enumerate(page.get_bboxlog())
        if pymupdf.Rect(rect).is_valid and abs(pymupdf.Rect(rect)) < LOG_AREA_LIMIT
    ]
    for span in struck:
        lines = _strike_lines(span, log)
        if lines and all(_covered(segment, order, log) for order, segment in lines):
            span["char_flags"] &= ~pymupdf.mupdf.FZ_STEXT_STRIKEOUT


def _right_to_left(line: dict) -> dict:
    if len(line["spans"]) > 1 and mostly_right_to_left(
        "".join(span["text"] for span in line["spans"])
    ):
        line["spans"] = sorted(line["spans"], key=lambda span: -span["bbox"].x1)
    return line


def _join_baselines(layout) -> None:
    for box in layout.boxes:
        if box.textlines:
            box.textlines = [_right_to_left(line) for line in _joined_lines(box.textlines)]


def _link_spans(page: pymupdf.Page, layout) -> None:
    links = _page_links(page)
    if not links:
        return
    glyphs = _page_glyphs(page.get_textpage(flags=TEXT_FLAGS))
    for box in layout.boxes:
        for line in box.textlines or []:
            for span in line["spans"]:
                span["text"] = _linked_text(span, glyphs, links)


def _mark_broken_words(layout) -> None:
    for box in layout.boxes:
        lines = [line for line in box.textlines or [] if line["spans"]]
        for line, following in zip(lines, lines[1:], strict=False):
            last = line["spans"][-1]
            if breaks_word(last["text"], following["spans"][0]["text"]):
                last["text"] = last["text"].rstrip() + LINE_BREAK


def _cover_bare_page(page: pymupdf.Page, layout) -> None:
    from pymupdf4llm.helpers.document_layout import LayoutBox

    if layout.boxes:
        return
    area = pymupdf.Rect()
    for info in page.get_image_info():
        area |= pymupdf.Rect(info["bbox"]) & page.rect
    if not area.is_empty:
        layout.boxes.append(LayoutBox(*area, "picture"))


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
            _merge_pictures(page, layout)
            _join_baselines(layout)
            _clear_hidden_strikes(page, layout)
            _add_turned_text(page, layout)
            _link_spans(page, layout)
            _mark_broken_words(layout)
            if pictures is not None and index + 1 not in recognised:
                _cover_bare_page(page, layout)
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
        ".page{border-bottom:1px solid #ddd;padding:1em 0}img{max-width:100%}</style>"
        "</head><body>" + "".join(parts) + "</body></html>"
    )
    return _write_text_file(target, html, textless, recognised)
