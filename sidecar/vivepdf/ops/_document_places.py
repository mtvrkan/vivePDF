import re
from dataclasses import dataclass

import pymupdf

BLOCK_ID = re.compile(r"^[bceh]-\d+$")
FIRST_WORDS = 8


@dataclass(frozen=True)
class BlockStart:
    id: str
    page: int
    top: float


@dataclass(frozen=True)
class PageStart:
    page: int
    top: float
    words: list[str]


@dataclass
class Places:
    blocks: list[BlockStart]
    pages: list[PageStart]


def block_starts(positions: list, offset: int) -> list[BlockStart]:
    found: dict[str, BlockStart] = {}
    for position in positions:
        if not (position.id and position.open_close & 1 and BLOCK_ID.match(position.id)):
            continue
        if position.id not in found:
            found[position.id] = BlockStart(
                position.id, position.page_num + offset, round(position.rect[1], 2)
            )
    return list(found.values())


def page_starts(document: pymupdf.Document, offset: int) -> list[PageStart]:
    starts = []
    for index in range(1, document.page_count):
        words = sorted(
            document[index].get_text("words"), key=lambda word: (round(word[1]), word[0])
        )
        if not words:
            continue
        starts.append(
            PageStart(
                index + 1 + offset,
                round(words[0][1], 2),
                [word[4] for word in words[:FIRST_WORDS]],
            )
        )
    return starts


def places_of(document: pymupdf.Document, positions: list, offset: int) -> Places:
    return Places(block_starts(positions, offset), page_starts(document, offset))
