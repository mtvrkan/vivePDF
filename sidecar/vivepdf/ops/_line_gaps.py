import re
from statistics import median

EXTRA_GAP = 0.35
WORD_GAP = 0.15
SPACE_SHARE = 0.3
LIST_MARKER = re.compile(r"^(?:[^\w\s]|\(?\w{1,3}[.)])$")
LEVEL = 1e-3


def _horizontal(line: dict) -> bool:
    dx, dy = line["dir"]
    return dx > 0 and abs(dy) < LEVEL


def _word_gaps(line: dict) -> list[tuple[int, float]]:
    gaps: list[tuple[int, float]] = []
    previous = None
    spaces = 0
    index = 0
    for span in line["spans"]:
        size = span["size"] or 1.0
        for char in span["chars"]:
            if char["c"].isspace():
                spaces += 1
            else:
                if previous is not None:
                    gap = (char["bbox"][0] - previous["bbox"][2]) / size
                    if spaces or gap > WORD_GAP:
                        gaps.append((index, gap - spaces * SPACE_SHARE))
                previous = char
                spaces = 0
            index += 1
    return gaps


def _first_word(line: dict, end: int) -> str:
    chars = [char["c"] for span in line["spans"] for char in span["chars"]]
    return "".join(chars[:end]).strip()


def wide_gap_starts(line: dict) -> set[int]:
    if not _horizontal(line):
        return set()
    gaps = _word_gaps(line)
    wide: set[int] = set()
    for position, (index, missing) in enumerate(gaps):
        if missing <= EXTRA_GAP:
            continue
        others = [other for spot, (_index, other) in enumerate(gaps) if spot != position]
        typical = max(median(others), 0.0) if others else 0.0
        marker = position == 0 and LIST_MARKER.match(_first_word(line, index)) is not None
        if marker or missing > typical + EXTRA_GAP:
            wide.add(index)
    return wide
