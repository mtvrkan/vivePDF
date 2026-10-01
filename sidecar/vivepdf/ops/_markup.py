import re
from collections import Counter
from dataclasses import dataclass

import pymupdf

from vivepdf.ops._spreadsheet import clean_text

CHARACTER_REFERENCE = re.compile(r"&#(?:[xX]([0-9a-fA-F]{1,8})|([0-9]{1,10}));")
MARKUP_BLOCK = re.compile(r"<(p|h[1-6])>(.*?)</\1>", re.DOTALL)
MARKDOWN_TAG = re.compile(
    r"</?(?:br|sup|u|mark)>|<!-- (?:Start|End) of picture text -->|<(?=[A-Za-z/!?])"
)
CODE_SPAN = re.compile(r"(`+)(?:.*?)\1")
FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
HEADING_LEVELS = ((1.5, "h1"), (1.25, "h2"), (1.1, "h3"))
HEADING_MAX_CHARACTERS = 200
LANGUAGE_TAG = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")


def _xml_character(value: int) -> bool:
    return (
        value in (0x9, 0xA, 0xD)
        or 0x20 <= value <= 0xD7FF
        or 0xE000 <= value <= 0xFFFD
        or 0x10000 <= value <= 0x10FFFF
    )


def _kept_reference(match: re.Match[str]) -> str:
    hexadecimal, decimal = match.groups()
    value = int(hexadecimal, 16) if hexadecimal else int(decimal)
    return match.group(0) if _xml_character(value) else ""


def xml_safe(markup: str) -> str:
    return CHARACTER_REFERENCE.sub(_kept_reference, clean_text(markup))


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
    return MARKDOWN_TAG.sub(
        lambda match: match.group(0) if len(match.group(0)) > 1 else "&lt;", text
    )


def inert_markdown(markdown: str) -> str:
    lines = []
    fence: str | None = None
    for line in clean_text(markdown).split("\n"):
        opening = FENCE.match(line)
        if fence is not None:
            if opening and opening.group(1)[0] == fence[0] and len(opening.group(1)) >= len(fence):
                fence = None
            lines.append(line)
        elif opening:
            fence = opening.group(1)
            lines.append(line)
        else:
            lines.append(_inert_line(line))
    return "\n".join(lines)


@dataclass(slots=True)
class PageMarkup:
    markup: str
    blocks: list[tuple[float, int] | None]
    sizes: Counter[float]


def page_markup(page: pymupdf.Page, images: bool = True) -> PageMarkup:
    flags = pymupdf.TEXTFLAGS_XHTML
    if not images:
        flags &= ~pymupdf.TEXT_PRESERVE_IMAGES
    textpage = page.get_textpage(clip=page.cropbox, flags=flags)
    markup = xml_safe(textpage.extractXHTML())
    blocks: list[tuple[float, int] | None] = []
    sizes: Counter[float] = Counter()
    for block in textpage.extractDICT()["blocks"]:
        if block.get("type") != 0:
            blocks.append(None)
            continue
        largest = 0.0
        characters = 0
        for line in block.get("lines", []):
            for span in line["spans"]:
                length = len(span["text"].strip())
                if not length:
                    continue
                largest = max(largest, span["size"])
                characters += length
                sizes[round(span["size"], 1)] += length
        blocks.append((largest, characters) if characters else None)
    return PageMarkup(markup, blocks, sizes)


def body_size(pages: list[PageMarkup]) -> float | None:
    total: Counter[float] = Counter()
    for page in pages:
        total.update(page.sizes)
    return total.most_common(1)[0][0] if total else None


def _block_tag(block: tuple[float, int], body: float) -> str:
    size, characters = block
    if characters > HEADING_MAX_CHARACTERS:
        return "p"
    for ratio, tag in HEADING_LEVELS:
        if size >= body * ratio:
            return tag
    return "p"


def retag_headings(page: PageMarkup, body: float | None) -> str:
    matches = list(MARKUP_BLOCK.finditer(page.markup))
    if not body or len(matches) != len(page.blocks):
        return page.markup
    parts = []
    last = 0
    for match, block in zip(matches, page.blocks, strict=True):
        tag = _block_tag(block, body) if block is not None else match.group(1)
        parts.append(page.markup[last : match.start()])
        parts.append(f"<{tag}>{match.group(2)}</{tag}>")
        last = match.end()
    parts.append(page.markup[last:])
    return "".join(parts)


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
