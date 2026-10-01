import functools
import math
from dataclasses import dataclass

import pymupdf

from vivepdf.ops._form_appearance import FONT_PATH

FONT_NAME = "VivContents"
MARGIN = 56.0
TITLE_SIZE = 18.0
TITLE_GAP = 36.0
ENTRY_SIZE = 11.0
LINE_HEIGHT = 20.0
NUMBER_GAP = 12.0
LEADER_COLOR = (0.6, 0.6, 0.6)
ELLIPSIS = "…"


@dataclass(frozen=True)
class ContentsEntry:
    title: str
    target: int


@functools.lru_cache(maxsize=1)
def _font() -> pymupdf.Font:
    return pymupdf.Font(fontfile=str(FONT_PATH))


def _entries_per_page(height: float) -> int:
    usable = height - 2 * MARGIN - TITLE_SIZE - TITLE_GAP
    return max(1, int(usable // LINE_HEIGHT))


def contents_page_count(entry_count: int, height: float) -> int:
    return max(1, math.ceil(entry_count / _entries_per_page(height)))


def _fitted(text: str, width: float) -> str:
    font = _font()
    if font.text_length(text, fontsize=ENTRY_SIZE) <= width:
        return text
    while text and font.text_length(text + ELLIPSIS, fontsize=ENTRY_SIZE) > width:
        text = text[:-1]
    return text.rstrip() + ELLIPSIS


def draw_contents(
    document: pymupdf.Document,
    pages: int,
    title: str,
    entries: list[ContentsEntry],
    number_of: dict[int, str],
) -> None:
    font = _font()
    per_page = _entries_per_page(document[0].rect.height)
    for sheet_index in range(pages):
        page = document[sheet_index]
        page.insert_font(fontname=FONT_NAME, fontfile=str(FONT_PATH))
        width = page.rect.width
        page.insert_text(
            (MARGIN, MARGIN + TITLE_SIZE), title, fontname=FONT_NAME, fontsize=TITLE_SIZE
        )
        top = MARGIN + TITLE_SIZE + TITLE_GAP
        chunk = entries[sheet_index * per_page : (sheet_index + 1) * per_page]
        for row, entry in enumerate(chunk):
            baseline = top + row * LINE_HEIGHT
            number = number_of.get(entry.target, str(entry.target + 1))
            number_width = font.text_length(number, fontsize=ENTRY_SIZE)
            number_x = width - MARGIN - number_width
            shown = _fitted(entry.title, number_x - MARGIN - 2 * NUMBER_GAP)
            shown_width = font.text_length(shown, fontsize=ENTRY_SIZE)
            page.insert_text((MARGIN, baseline), shown, fontname=FONT_NAME, fontsize=ENTRY_SIZE)
            page.insert_text((number_x, baseline), number, fontname=FONT_NAME, fontsize=ENTRY_SIZE)
            leader_start = MARGIN + shown_width + NUMBER_GAP / 2
            leader_end = number_x - NUMBER_GAP / 2
            if leader_end > leader_start:
                page.draw_line(
                    (leader_start, baseline),
                    (leader_end, baseline),
                    color=LEADER_COLOR,
                    width=0.6,
                    dashes="[0.6 2.4] 0",
                )
            page.insert_link(
                {
                    "kind": pymupdf.LINK_GOTO,
                    "page": entry.target,
                    "from": pymupdf.Rect(
                        MARGIN, baseline - ENTRY_SIZE, width - MARGIN, baseline + 4
                    ),
                    "to": pymupdf.Point(0, 0),
                }
            )
