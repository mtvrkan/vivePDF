import base64
import html
import math
import re
from collections import Counter
from dataclasses import dataclass
from itertools import groupby
from urllib.parse import quote

import pymupdf

from vivepdf.ops._columns import column_order, column_side, page_columns, words_of
from vivepdf.ops._markup_tables import filled_table, page_tables
from vivepdf.ops._page_images import MAX_IMAGE_SIDE
from vivepdf.ops._pixmaps import png_ready
from vivepdf.ops._spreadsheet import clean_text
from vivepdf.ops._words import (
    LINE_BREAK,
    Vocabulary,
    breaks_word,
    html_words,
    join_marked_html,
    plain_letters,
)

MARKDOWN_TAG = re.compile(
    r"</?(?:br|sup|u|mark)>|<!-- (?:Start|End) of picture text -->|<(?=[A-Za-z/!?])"
)
CODE_SPAN = re.compile(r"(`+)(?:.*?)\1")
EMPHASIS_GAP = re.compile(r"(?<=\S)(\*\*|\*|~~|_) +(?=[,.;:!?)])")
FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
PICTURE_TEXT_MARK = re.compile(r"(?:<br>)?<!-- (?:Start|End) of picture text -->")
HEADING_LEVELS = ((1.5, "h1"), (1.25, "h2"), (1.1, "h3"))
HEADING_MAX_CHARACTERS = 200
LANGUAGE_TAG = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
LINK_SCHEMES = ("http://", "https://", "mailto:")
LINK_SAFE_CHARACTERS = ":/?#@!$&'*+,;=%~-._"
PICTURE_DPI = 150
PICTURE_PIXELS = 16_000_000
STYLE_TAGS = ((16, "b"), (2, "i"), (8, "code"), (1, "sup"))
BULLETS = (
    "\u2022\u25cf\u25cb\u25e6\u25aa\u25ab\u25a0\u25a1\u25c6\u25c7\u27a2\u27a4\u25ba\u25b6"
    "\u2713\u2714\u00b7\uf0b7\uf0a7\uf0d8\uf0fc\uf076*\u2013\u2014-"
)
BULLET_LINE = re.compile(rf"^\s*[{BULLETS}](?:\s+|$)")
NUMBER_LINE = re.compile(r"^\s*(?:\d{1,3}[.)]|[a-z]\))(?:\s+|$)")
PASSTHROUGH_PICTURES = ("jpeg", "png")
CROP_TOLERANCE = 1.0
PICTURE_ERRORS = (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase)
ORDER_TOLERANCE = 2.0
ORDER_MAX_BLOCKS = 300
GRAPHIC_MIN_SIDE = 36.0
GRAPHIC_MIN_PATHS = 3
GRAPHIC_MAX_SHARE = 0.85
GRAPHIC_TEXT_SHARE = 0.3
GRAPHIC_PROSE_WORDS = 8
GRAPHIC_PANEL_SHARE = 0.8
PAPER_WHITE = 0.98
BACKDROP_SHARE = 0.9
EMBEDDED_PICTURE = re.compile(r'<img width="(\d+)" height="(\d+)" alt="" src="(data:[^"]+)"/>')
TURKISH_LETTERS = frozenset("ğĞıİşŞ")
TURKISH_EVIDENCE = 3
LANGUAGE_SAMPLE_PAGES = 5


def _inert_line(line: str) -> str:
    parts = []
    last = 0
    for match in CODE_SPAN.finditer(line):
        parts.append(_inert_text(line[last : match.start()]))
        parts.append(match.group(0))
        last = match.end()
    parts.append(_inert_text(line[last:]))
    return "".join(parts)


def _inert_text(text: str) -> str:
    inert = MARKDOWN_TAG.sub(
        lambda match: match.group(0) if len(match.group(0)) > 1 else "&lt;", text
    )
    return EMPHASIS_GAP.sub(r"\1", inert)


def _fenced(lines: list[str]):
    fence: str | None = None
    for line in lines:
        opening = FENCE.match(line)
        if fence is not None:
            if opening and opening.group(1)[0] == fence[0] and len(opening.group(1)) >= len(fence):
                fence = None
            yield line, True
        elif opening:
            fence = opening.group(1)
            yield line, True
        else:
            yield line, False


def inert_markdown(markdown: str) -> str:
    return "\n".join(
        line if fenced else _inert_line(line)
        for line, fenced in _fenced(clean_text(markdown).split("\n"))
    )


def tidy_markdown(markdown: str) -> str:
    lines: list[str] = []
    for line, fenced in _fenced(markdown.split("\n")):
        if not fenced and PICTURE_TEXT_MARK.search(line):
            line = PICTURE_TEXT_MARK.sub("", line)
            if not line.strip():
                continue
        if not fenced and not line.strip() and lines and not lines[-1].strip():
            continue
        lines.append(line)
    return "\n".join(lines)


@dataclass(slots=True)
class MarkupBlock:
    kind: str
    body: str
    size: float = 0.0
    characters: int = 0


@dataclass(slots=True)
class PageMarkup:
    blocks: list[MarkupBlock]
    sizes: Counter[float]


@dataclass(slots=True)
class _Line:
    pieces: list[tuple[str, tuple[str, ...], str | None]]
    weighted: float
    characters: int

    @property
    def text(self) -> str:
        return "".join(piece[0] for piece in self.pieces)


def _compact(text: str) -> str:
    return "".join(clean_text(text).split())


def picture_dpi(clip: pymupdf.Rect) -> int:
    square_inches = clip.width * clip.height / (72 * 72)
    by_pixels = math.sqrt(PICTURE_PIXELS / square_inches)
    by_side = (MAX_IMAGE_SIDE["png"] - 2) * 72 / max(clip.width, clip.height)
    return max(1, math.floor(min(PICTURE_DPI, by_pixels, by_side)))


def _span_style(flags: int) -> tuple[str, ...]:
    return tuple(tag for bit, tag in STYLE_TAGS if flags & bit)


def _link_at(rect: pymupdf.Rect, links: list[tuple[pymupdf.Rect, str]]) -> str | None:
    center = (rect.tl + rect.br) / 2
    return next((url for area, url in links if center in area), None)


def _span_text(span: dict) -> str:
    if "chars" in span:
        return "".join(char["c"] for char in span["chars"])
    return span.get("text", "")


def _span_pieces(span: dict, links: list[tuple[pymupdf.Rect, str]]):
    style = _span_style(span["flags"])
    if not links or "chars" not in span:
        return [(plain_letters(clean_text(_span_text(span))), style, None)]
    pieces: list[tuple[str, tuple[str, ...], str | None]] = []
    for char in span["chars"]:
        url = _link_at(pymupdf.Rect(char["bbox"]), links)
        text = plain_letters(clean_text(char["c"]))
        if pieces and pieces[-1][2] == url:
            pieces[-1] = (pieces[-1][0] + text, style, url)
        else:
            pieces.append((text, style, url))
    return pieces


def _line(line: dict, links: list[tuple[pymupdf.Rect, str]]) -> _Line:
    pieces = []
    weighted = 0.0
    characters = 0
    for span in line["spans"]:
        span_pieces = _span_pieces(span, links)
        length = len(_compact("".join(piece[0] for piece in span_pieces)))
        weighted += span["size"] * length
        characters += length
        pieces.extend(span_pieces)
    return _Line(pieces, weighted, characters)


def _without_prefix(pieces, count: int):
    kept = []
    for text, style, url in pieces:
        cut = min(count, len(text))
        count -= cut
        if text[cut:]:
            kept.append((text[cut:], style, url))
    return kept


def _inline(pieces) -> str:
    parts = []
    for (style, url), group in groupby(pieces, key=lambda piece: (piece[1], piece[2])):
        text = "".join(piece[0] for piece in group)
        core = text.strip() if url else text
        if not core:
            parts.append(html.escape(text, quote=False))
            continue
        lead, _, trail = text.partition(core)
        body = html.escape(core, quote=False)
        for tag in reversed(style):
            body = f"<{tag}>{body}</{tag}>"
        if url:
            body = f'<a href="{html.escape(url)}">{body}</a>'
        parts.append(lead + body + trail)
    return "".join(parts).strip()


def _paragraph(kind: str, lines: list[_Line]) -> MarkupBlock | None:
    pieces = []
    for line in lines:
        if pieces and line.pieces:
            text, style, url = pieces[-1]
            if breaks_word(text, line.text):
                pieces[-1] = (text.rstrip() + LINE_BREAK, style, url)
            elif not text.endswith((" ", "\u00a0")):
                pieces[-1] = (text + " ", style, url)
        pieces.extend(line.pieces)
    characters = sum(line.characters for line in lines)
    body = _inline(pieces)
    if not characters or not body:
        return None
    size = sum(line.weighted for line in lines) / characters
    return MarkupBlock(kind, body, size, characters)


def _text_blocks(lines: list[_Line]) -> list[MarkupBlock]:
    numbered = sum(1 for line in lines if NUMBER_LINE.match(line.text)) >= 2
    groups: list[tuple[str, list[_Line]]] = []
    for line in lines:
        if not line.text.strip():
            continue
        bullet = BULLET_LINE.match(line.text)
        if bullet:
            rest = _without_prefix(line.pieces, bullet.end())
            groups.append(("li", [_Line(rest, line.weighted, line.characters)]))
        elif not groups or (numbered and NUMBER_LINE.match(line.text)):
            groups.append(("p", [line]))
        else:
            groups[-1][1].append(line)
    blocks = [_paragraph(kind, group) for kind, group in groups]
    return [block for block in blocks if block is not None]


def _page_links(page: pymupdf.Page) -> list[tuple[pymupdf.Rect, str]]:
    links = []
    for link in page.get_links():
        uri = (link.get("uri") or "").strip()
        if link.get("kind") == pymupdf.LINK_URI and uri.lower().startswith(LINK_SCHEMES):
            area = pymupdf.Rect(link["from"]) * page.derotation_matrix
            links.append((area, quote(uri, safe=LINK_SAFE_CHARACTERS)))
    return links


def _picture(data: bytes, media: str, area: pymupdf.Rect) -> MarkupBlock:
    encoded = base64.b64encode(data).decode("ascii")
    return MarkupBlock(
        "figure",
        f'<img width="{round(area.width)}" height="{round(area.height)}" alt="" '
        f'src="data:{media};base64,{encoded}"/>',
    )


def _png_picture(pixmap: pymupdf.Pixmap, area: pymupdf.Rect) -> MarkupBlock:
    return _picture(png_ready(pixmap).tobytes("png"), "image/png", area)


def _placement(block: dict) -> pymupdf.Rect | None:
    a, b, c, d, e, f = block["transform"]
    if b or c or a <= 0 or d <= 0:
        return None
    return pymupdf.Rect(e, f, e + a, f + d)


def _cropped(pixmap: pymupdf.Pixmap, placed: pymupdf.Rect, shown: pymupdf.Rect):
    clip = pymupdf.IRect(
        math.floor((shown.x0 - placed.x0) / placed.width * pixmap.width),
        math.floor((shown.y0 - placed.y0) / placed.height * pixmap.height),
        math.ceil((shown.x1 - placed.x0) / placed.width * pixmap.width),
        math.ceil((shown.y1 - placed.y0) / placed.height * pixmap.height),
    ) & pymupdf.IRect(0, 0, pixmap.width, pixmap.height)
    if clip.is_empty:
        return None
    return pymupdf.Pixmap(pixmap, pixmap.width, pixmap.height, clip)


def _image_block(block: dict, visible: pymupdf.Rect) -> MarkupBlock | None:
    placed = _placement(block)
    area = placed or pymupdf.Rect(block["bbox"])
    shown = area & visible if placed else area
    cropped = (
        area.width - shown.width > CROP_TOLERANCE or area.height - shown.height > CROP_TOLERANCE
    )
    ext = block.get("ext")
    if (
        not cropped
        and not block.get("mask")
        and ext in PASSTHROUGH_PICTURES
        and block.get("colorspace", 3) <= 3
    ):
        return _picture(block["image"], f"image/{ext}", area)
    try:
        pixmap = pymupdf.Pixmap(block["image"])
        if block.get("mask") and not pixmap.alpha:
            mask = pymupdf.Pixmap(block["mask"])
            if (mask.width, mask.height) != (pixmap.width, pixmap.height):
                mask = pymupdf.Pixmap(mask, pixmap.width, pixmap.height, None)
            pixmap = pymupdf.Pixmap(png_ready(pixmap), mask)
        if cropped:
            pixmap = _cropped(pixmap, area, shown)
        if pixmap is None or pixmap.width == 0 or pixmap.height == 0:
            return None
        return _png_picture(pixmap, shown if cropped else area)
    except PICTURE_ERRORS:
        return None


def _shown_lines(block: dict) -> list[pymupdf.Rect]:
    return [
        pymupdf.Rect(line["bbox"])
        for line in block.get("lines", [])
        if any(span.get("alpha", 255) and _span_text(span).strip() for span in line["spans"])
    ]


def _is_backdrop(area: pymupdf.Rect, visible: pymupdf.Rect, texts: list[pymupdf.Rect]) -> bool:
    if abs(area & visible) < abs(visible) * BACKDROP_SHARE:
        return False
    return any((rect.tl + rect.br) / 2 in area for rect in texts)


def _holds_text(
    lines: list[tuple[pymupdf.Rect, _Line]], area: pymupdf.Rect, backdrop: float
) -> bool:
    inside = [(rect, line) for rect, line in lines if (rect.tl + rect.br) / 2 in area]
    if not any(line.text.strip() for _rect, line in inside):
        return False
    if backdrop >= abs(area) * GRAPHIC_PANEL_SHARE:
        return True
    if any(len(line.text.split()) >= GRAPHIC_PROSE_WORDS for _rect, line in inside):
        return True
    return sum(abs(rect & area) for rect, _line in inside) > abs(area) * GRAPHIC_TEXT_SHARE


def _shows(drawing: dict) -> bool:
    if drawing.get("type") != "f":
        return True
    fill = drawing.get("fill")
    if fill is None or not drawing.get("fill_opacity", 1):
        return False
    return any(channel < PAPER_WHITE for channel in fill)


def _is_table(page: pymupdf.Page, area: pymupdf.Rect) -> bool:
    try:
        tables = page.find_tables(clip=area * page.rotation_matrix, use_layout=False).tables
    except PICTURE_ERRORS:
        return False
    return any(
        filled_table(table) for table in tables if table.row_count > 1 and table.col_count > 1
    )


def _graphic_areas(page, visible, lines) -> list[pymupdf.Rect]:
    drawings = [drawing for drawing in page.get_drawings() if _shows(drawing)]
    if len(drawings) < GRAPHIC_MIN_PATHS:
        return []
    areas = []
    for cluster in page.cluster_drawings(clip=visible, drawings=drawings):
        area = pymupdf.Rect(cluster) & visible
        if min(area.width, area.height) < GRAPHIC_MIN_SIDE:
            continue
        if abs(area) > abs(visible) * GRAPHIC_MAX_SHARE:
            continue
        touching = [(item, pymupdf.Rect(item["rect"]) & area) for item in drawings]
        touching = [(item, rect) for item, rect in touching if not rect.is_empty]
        backdrop = sum(abs(rect) for item, rect in touching if item.get("fill") is not None)
        if len(touching) < GRAPHIC_MIN_PATHS or _holds_text(lines, area, backdrop):
            continue
        if not _is_table(page, area):
            areas.append(area)
    return areas


def _graphic_block(page: pymupdf.Page, area: pymupdf.Rect) -> MarkupBlock | None:
    clip = area * page.rotation_matrix
    pixmap = page.get_pixmap(clip=clip, dpi=picture_dpi(clip))
    if pixmap.width == 0 or pixmap.height == 0:
        return None
    return _png_picture(pixmap, area)


def _slot(texts: list[tuple[pymupdf.Rect, list[MarkupBlock]]], area: pymupdf.Rect) -> int:
    beside = [
        index
        for index, (rect, _blocks) in enumerate(texts)
        if min(rect.x1, area.x1) > max(rect.x0, area.x0)
    ]
    below = [index for index in beside if texts[index][0].y0 >= area.y0 - ORDER_TOLERANCE]
    if below:
        return below[0]
    if beside:
        return beside[-1] + 1
    return next(
        (index for index, (rect, _blocks) in enumerate(texts) if rect.y0 >= area.y0), len(texts)
    )


def _side_by_side(first: pymupdf.Rect, second: pymupdf.Rect) -> bool:
    across = min(first.y1, second.y1) - max(first.y0, second.y0)
    return across > ORDER_TOLERANCE and (first.x1 <= second.x0 or second.x1 <= first.x0)


def _top_down(texts: list[tuple[pymupdf.Rect, list[MarkupBlock]]]):
    if len(texts) > ORDER_MAX_BLOCKS:
        return texts
    for index, (rect, _blocks) in enumerate(texts):
        if any(_side_by_side(rect, other) for other, _others in texts[index + 1 :]):
            return texts
    return sorted(texts, key=lambda item: item[0].y0)


def _in_reading_order(texts, visuals) -> list[MarkupBlock]:
    texts = _top_down(texts)
    slots: dict[int, list[MarkupBlock]] = {}
    for area, block in sorted(visuals, key=lambda item: (item[0].y0, item[0].x0)):
        slots.setdefault(_slot(texts, area), []).append(block)
    ordered: list[MarkupBlock] = []
    for index, (_rect, blocks) in enumerate(texts):
        ordered.extend(slots.get(index, []))
        ordered.extend(blocks)
    ordered.extend(slots.get(len(texts), []))
    return ordered


def _text_groups(
    page: pymupdf.Page, text_lines: list[tuple[int, pymupdf.Rect, pymupdf.Rect, _Line]]
):
    columns = page_columns(
        page, [(rect, words_of(parsed.text)) for _p, _a, rect, parsed in text_lines]
    )
    if columns is None:
        ordered = text_lines
        groups = groupby(ordered, key=lambda item: item[0])
    else:
        ordered = column_order([(item[2], item) for item in text_lines], columns)
        groups = groupby(ordered, key=lambda item: (item[0], column_side(item[2], columns)))
    texts = []
    for _key, grouped in groups:
        members = list(grouped)
        area = members[0][1]
        if columns is not None:
            area = pymupdf.Rect(members[0][2])
            for item in members[1:]:
                area |= item[2]
        paragraphs = _text_blocks([item[3] for item in members])
        if paragraphs:
            texts.append((area, paragraphs))
    return texts


def page_markup(page: pymupdf.Page, images: bool = True) -> PageMarkup:
    flags = pymupdf.TEXTFLAGS_XHTML & ~pymupdf.TEXT_PRESERVE_LIGATURES
    if not images:
        flags &= ~pymupdf.TEXT_PRESERVE_IMAGES
    visible = pymupdf.Rect(0, 0, page.cropbox.width, page.cropbox.height)
    textpage = page.get_textpage(clip=visible, flags=flags)
    links = _page_links(page)
    raw = textpage.extractRAWDICT() if links else textpage.extractDICT()
    sizes: Counter[float] = Counter()
    blocks: list[tuple[dict, list[tuple[pymupdf.Rect, _Line]]]] = []
    for block in raw["blocks"]:
        block_lines = [
            (pymupdf.Rect(line["bbox"]), _line(line, links)) for line in block.get("lines", [])
        ]
        for line in block.get("lines", []):
            for span in line["spans"]:
                length = len(_span_text(span).strip())
                if length:
                    sizes[round(span["size"], 1)] += length
        blocks.append((block, block_lines))
    lines = [item for _block, block_lines in blocks for item in block_lines]
    shown_text = [rect for block, _lines in blocks for rect in _shown_lines(block)]
    graphics = _graphic_areas(page, visible, lines) if images else []
    tables = [
        (area, body)
        for area, body in page_tables(page)
        if not any(area in graphic for graphic in graphics)
    ]
    covers = graphics + [area for area, _body in tables]
    text_lines: list[tuple[int, pymupdf.Rect, pymupdf.Rect, _Line]] = []
    visuals = [(area, MarkupBlock("table", body)) for area, body in tables]
    for position, (block, block_lines) in enumerate(blocks):
        area = pymupdf.Rect(block["bbox"])
        if any(area in graphic for graphic in graphics):
            continue
        if block.get("type") == 1:
            if _is_backdrop(area, visible, shown_text):
                continue
            picture = _image_block(block, visible)
            if picture is not None:
                visuals.append((area & visible, picture))
            continue
        text_lines.extend(
            (position, area, rect, parsed)
            for rect, parsed in block_lines
            if not any((rect.tl + rect.br) / 2 in cover for cover in covers)
        )
    texts = _text_groups(page, text_lines)
    for graphic in graphics:
        picture = _graphic_block(page, graphic)
        if picture is not None:
            visuals.append((graphic, picture))
    turn = page.rotation_matrix
    texts = [(area * turn, paragraphs) for area, paragraphs in texts]
    visuals = [(area * turn, block) for area, block in visuals]
    return PageMarkup(_in_reading_order(texts, visuals), sizes)


def body_size(pages: list[PageMarkup]) -> float | None:
    total: Counter[float] = Counter()
    for page in pages:
        total.update(page.sizes)
    return total.most_common(1)[0][0] if total else None


def _block_tag(size: float, characters: int, body: float) -> str:
    if characters > HEADING_MAX_CHARACTERS:
        return "p"
    for ratio, tag in HEADING_LEVELS:
        if size >= body * ratio:
            return tag
    return "p"


def page_html(page: PageMarkup, body: float | None) -> str:
    parts = []
    listing = False
    for block in page.blocks:
        if not block.body:
            continue
        if listing != (block.kind == "li"):
            parts.append("<ul>" if not listing else "</ul>")
            listing = not listing
        if block.kind == "li":
            parts.append(f"<li>{block.body}</li>")
        elif block.kind == "figure":
            parts.append(f"<p>{block.body}</p>")
        elif block.kind == "table":
            parts.append(block.body)
        else:
            tag = _block_tag(block.size, block.characters, body) if body else "p"
            parts.append(f"<{tag}>{block.body}</{tag}>")
    if listing:
        parts.append("</ul>")
    return "\n".join(parts)


def join_broken_words(pages: list[PageMarkup]) -> None:
    blocks = [block for page in pages for block in page.blocks]
    vocabulary = Vocabulary(html_words(block.body) for block in blocks)
    for block in blocks:
        if LINE_BREAK in block.body:
            block.body = join_marked_html(block.body, vocabulary)


def _shared_picture(match: re.Match, name: str) -> str:
    width, height = match.group(1), match.group(2)
    return (
        f'<svg class="picture" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
        f'aria-hidden="true"><use href="#{name}" width="{width}" height="{height}"/></svg>'
    )


def share_repeated_pictures(pages: list[PageMarkup]) -> str:
    figures = [
        (block, match)
        for page in pages
        for block in page.blocks
        if block.kind == "figure" and (match := EMBEDDED_PICTURE.fullmatch(block.body))
    ]
    counts = Counter(match.group(3) for _block, match in figures)
    repeated = [source for source, count in counts.items() if count > 1]
    names = {source: f"picture-{number}" for number, source in enumerate(repeated, 1)}
    if not names:
        return ""
    for block, match in figures:
        name = names.get(match.group(3))
        if name:
            block.body = _shared_picture(match, name)
    symbols = "".join(
        f'<symbol id="{name}" viewBox="0 0 1 1" preserveAspectRatio="none">'
        f'<image href="{source}" width="1" height="1" preserveAspectRatio="none"/></symbol>'
        for source, name in names.items()
    )
    return f'<svg width="0" height="0" style="position:absolute" aria-hidden="true">{symbols}</svg>'


def text_language(document: pymupdf.Document, indices: list[int]) -> str | None:
    found = 0
    for index in indices[:LANGUAGE_SAMPLE_PAGES]:
        found += sum(1 for char in document[index].get_text() if char in TURKISH_LETTERS)
        if found >= TURKISH_EVIDENCE:
            return "tr"
    return None


def document_language(document: pymupdf.Document) -> str | None:
    if not document.is_pdf:
        return None
    try:
        kind, value = document.xref_get_key(document.pdf_catalog(), "Lang")
    except (RuntimeError, ValueError):
        return None
    if kind != "string":
        return None
    language = value.strip()
    return language if LANGUAGE_TAG.match(language) else None
