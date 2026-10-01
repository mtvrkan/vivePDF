import re

import pymupdf
from pydantic import Field

from vivepdf.ops._redact_presets import PRIVATE_KEY_BLOCK, preset_matches, private_key_blocks
from vivepdf.ops._redaction import (
    Scrubber,
    clean_texts,
    words_in,
)
from vivepdf.ops._safe_pattern import MatchClock
from vivepdf.rpc.protocol import RpcModel


class RedactArea(RpcModel):
    page: int = Field(ge=1)
    x0: float
    y0: float
    x1: float
    y1: float


HIDDEN_MASK = "█████"


def _scrubber(
    terms: list[str],
    patterns: list[re.Pattern[str]],
    presets: list[str],
    flags: int,
    mask: str,
    whole_word: bool = False,
    clock: MatchClock | None = None,
) -> Scrubber:
    clock = clock or MatchClock()
    term_patterns = [
        re.compile(_term_expression(term.strip(), whole_word, bool(flags & re.IGNORECASE)), flags)
        for term in terms
        if term.strip()
    ]

    def scrub(text: str) -> str:
        cleaned = text
        for pattern in term_patterns:
            cleaned = pattern.sub(mask, cleaned)
        for needle in _pattern_needles(cleaned, patterns, presets, flags, clock):
            cleaned = cleaned.replace(needle, mask)
        return cleaned

    return scrub


def _full_page_rect(page: pymupdf.Page) -> pymupdf.Rect:
    origin = page.cropbox.tl
    return page.mediabox + (-origin.x, -origin.y, -origin.x, -origin.y)


def _pattern_needles(
    text: str, patterns: list[re.Pattern[str]], presets: list[str], flags: int, clock: MatchClock
) -> list[str]:
    needles: list[str] = []
    for pattern in patterns:
        for match in clock.matches(pattern, text):
            needle = match.group().strip()
            if len(needle) >= 2:
                needles.append(needle)
    needles.extend(needle for _, needle in preset_matches(text, presets, flags))
    if "privateKey" in presets:
        needles[:0] = private_key_blocks(text)
    return needles


def _searchable(needle: str) -> bool:
    return "\n" not in needle


def private_key_block_lines(page: pymupdf.Page) -> list[tuple[str, pymupdf.Rect]]:
    characters: list[tuple[str, pymupdf.Rect | None]] = []
    for line in _line_characters(page):
        characters.extend(line)
        characters.append(("\n", None))
    text = "".join(char for char, _ in characters)
    found: list[tuple[str, pymupdf.Rect]] = []
    for match in PRIVATE_KEY_BLOCK.finditer(text):
        current = ""
        box: pymupdf.Rect | None = None
        for char, rect in characters[match.start() : match.end()]:
            if rect is None:
                if box is not None and current.strip():
                    found.append((current.strip(), box))
                current, box = "", None
                continue
            current += char
            box = pymupdf.Rect(rect) if box is None else box | rect
        if box is not None and current.strip():
            found.append((current.strip(), box))
    return found


def _regex_rects(
    page: pymupdf.Page,
    patterns: list[re.Pattern[str]],
    presets: list[str],
    flags: int,
    clock: MatchClock,
) -> list[pymupdf.Rect]:
    rects: list[pymupdf.Rect] = []
    for needle in _pattern_needles(page.get_text(), patterns, presets, flags, clock):
        if _searchable(needle):
            rects.extend(page.search_for(needle))
    if "privateKey" in presets:
        rects.extend(rect for _, rect in private_key_block_lines(page))
    return rects


DOTTED_I_FAMILY = "iIİı"


def _term_expression(term: str, whole_word: bool, folded: bool = False) -> str:
    escaped = "".join(
        f"[{DOTTED_I_FAMILY}]" if folded and char in DOTTED_I_FAMILY else re.escape(char)
        for char in term
    )
    return rf"(?<!\w){escaped}(?!\w)" if whole_word else escaped


def _line_characters(page: pymupdf.Page) -> list[list[tuple[str, pymupdf.Rect]]]:
    lines: list[list[tuple[str, pymupdf.Rect]]] = []
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            characters = [
                (char["c"], pymupdf.Rect(char["bbox"]))
                for span in line["spans"]
                for char in span["chars"]
            ]
            if characters:
                lines.append(characters)
    return lines


def _stands_alone(rect: pymupdf.Rect, lines: list[list[tuple[str, pymupdf.Rect]]]) -> bool:
    for characters in lines:
        inside = [
            position
            for position, (_, box) in enumerate(characters)
            if rect.contains(pymupdf.Point((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2))
        ]
        if not inside:
            continue
        before = characters[inside[0] - 1][0] if inside[0] > 0 else " "
        after = characters[inside[-1] + 1][0] if inside[-1] + 1 < len(characters) else " "
        return not (before.isalnum() or before == "_" or after.isalnum() or after == "_")
    return True


def _folded_rects(
    term: str, whole_word: bool, lines: list[list[tuple[str, pymupdf.Rect]]]
) -> list[pymupdf.Rect]:
    pattern = re.compile(_term_expression(" ".join(term.split()), whole_word, True), re.IGNORECASE)
    rects: list[pymupdf.Rect] = []
    for characters in lines:
        text = "".join(char for char, _ in characters)
        for match in pattern.finditer(text):
            box = pymupdf.Rect(characters[match.start()][1])
            for _, rect in characters[match.start() + 1 : match.end()]:
                box |= rect
            rects.append(box)
    return rects


def _overlaps(rect: pymupdf.Rect, others: list[pymupdf.Rect]) -> bool:
    return any(
        other.contains((rect.tl + rect.br) / 2) or rect.contains((other.tl + other.br) / 2)
        for other in others
    )


def _term_rects(
    page: pymupdf.Page,
    term: str,
    case_sensitive: bool,
    whole_word: bool = False,
    lines: list[list[tuple[str, pymupdf.Rect]]] | None = None,
) -> list[pymupdf.Rect]:
    rects = page.search_for(term, flags=0 if case_sensitive else pymupdf.TEXT_DEHYPHENATE)
    if case_sensitive:
        needle = " ".join(term.split())
        rects = [rect for rect in rects if " ".join(page.get_textbox(rect).split()) == needle]
    if not case_sensitive or (whole_word and rects):
        lines = _line_characters(page) if lines is None else lines
    if whole_word and rects:
        rects = [rect for rect in rects if _stands_alone(rect, lines)]
    if not case_sensitive:
        found = list(rects)
        rects.extend(
            rect for rect in _folded_rects(term, whole_word, lines) if not _overlaps(rect, found)
        )
    return rects


def _words_under_areas(
    document: pymupdf.Document, areas_by_page: dict[int, list[RedactArea]]
) -> list[str]:
    texts: list[str] = []
    for index, areas in sorted(areas_by_page.items()):
        if not 0 <= index < document.page_count:
            continue
        page = document[index]
        for area in areas:
            rect = pymupdf.Rect(area.x0, area.y0, area.x1, area.y1)
            rect.normalize()
            texts.extend(words_in(page, rect))
    return clean_texts(texts)


def _images_under(page: pymupdf.Page, rects: list[pymupdf.Rect]) -> int:
    return sum(
        1
        for info in page.get_image_info()
        if any(not (pymupdf.Rect(info["bbox"]) & rect).is_empty for rect in rects)
    )


def _chained(first: Scrubber | None, second: Scrubber | None) -> Scrubber | None:
    if first is None or second is None:
        return first or second
    return lambda text: second(first(text))
