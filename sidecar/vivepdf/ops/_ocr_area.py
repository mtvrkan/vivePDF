import statistics
from collections.abc import Callable
from dataclasses import dataclass, field

import pymupdf

from vivepdf.ops._orientation import capped_dpi

CONSENSUS_MAX_PIXELS = 400_000
CONSENSUS_DPI_RATIOS = (1.0, 2 / 3, 4 / 3)
ROW_JOIN_RATIO = 0.5
CLUSTER_OVERLAP_RATIO = 0.5
EDGE_SLACK = 1.5
CLIPPED_ROW_RATIO = 0.8


@dataclass(frozen=True)
class Word:
    rect: pymupdf.Rect
    text: str


@dataclass
class Row:
    words: list[Word] = field(default_factory=list)

    @property
    def rect(self) -> pymupdf.Rect:
        box = pymupdf.Rect(self.words[0].rect)
        for word in self.words[1:]:
            box |= word.rect
        return box

    @property
    def center(self) -> float:
        return statistics.median((word.rect.y0 + word.rect.y1) / 2 for word in self.words)

    @property
    def height(self) -> float:
        return statistics.median(word.rect.height for word in self.words)

    @property
    def text(self) -> str:
        return " ".join(word.text for word in sorted(self.words, key=lambda item: item.rect.x0))


def visual_rows(words: list[Word]) -> list[Row]:
    rows: list[Row] = []
    for word in sorted(words, key=lambda item: ((item.rect.y0 + item.rect.y1) / 2, item.rect.x0)):
        middle = (word.rect.y0 + word.rect.y1) / 2
        row = next(
            (
                candidate
                for candidate in rows
                if abs(middle - candidate.center)
                <= ROW_JOIN_RATIO * min(candidate.height, word.rect.height)
            ),
            None,
        )
        if row is None:
            rows.append(Row([word]))
        else:
            row.words.append(word)
    return sorted((row for row in rows if row.text.strip()), key=lambda row: row.center)


def _same_row(first: Row, second: Row) -> bool:
    top, bottom = first.rect, second.rect
    overlap = min(top.y1, bottom.y1) - max(top.y0, bottom.y0)
    return overlap > CLUSTER_OVERLAP_RATIO * min(top.height, bottom.height)


def edit_distance(first: str, second: str) -> int:
    previous = list(range(len(second) + 1))
    for row, left in enumerate(first, start=1):
        current = [row]
        for column, right in enumerate(second, start=1):
            current.append(
                min(
                    previous[column] + 1,
                    current[column - 1] + 1,
                    previous[column - 1] + (left != right),
                )
            )
        previous = current
    return previous[-1]


def consensus_rows(readings: list[list[Row]]) -> list[Row]:
    clusters: list[dict[int, Row]] = []
    for index, reading in enumerate(readings):
        for row in reading:
            cluster = next(
                (
                    group
                    for group in clusters
                    if index not in group and _same_row(next(iter(group.values())), row)
                ),
                None,
            )
            if cluster is None:
                clusters.append({index: row})
            else:
                cluster[index] = row
    chosen: list[Row] = []
    for cluster in clusters:
        if len(cluster) * 2 <= len(readings):
            continue
        candidates = [cluster[index] for index in sorted(cluster)]
        texts = [candidate.text for candidate in candidates]
        chosen.append(
            min(
                candidates,
                key=lambda candidate: sum(edit_distance(candidate.text, other) for other in texts),
            )
        )
    return sorted(chosen, key=lambda row: row.center)


def without_clipped_rows(rows: list[Row], area: pymupdf.Rect) -> list[Row]:
    def at_edge(row: Row) -> bool:
        box = row.rect
        return box.y0 - area.y0 <= EDGE_SLACK or area.y1 - box.y1 <= EDGE_SLACK

    inner = [row.height for row in rows if not at_edge(row)]
    if not inner:
        return rows
    reference = statistics.median(inner)
    return [
        row for row in rows if not (at_edge(row) and row.height < CLIPPED_ROW_RATIO * reference)
    ]


def _reading(
    page: pymupdf.Page, area: pymupdf.Rect, dpi: int, language: str, tessdata: str
) -> list[Row]:
    pixmap = page.get_pixmap(dpi=dpi, clip=area, alpha=False)
    data = pixmap.pdfocr_tobytes(compress=True, language=language, tessdata=tessdata)
    with pymupdf.open("pdf", data) as recognised:
        sheet = recognised[0].rect
        scale_x = area.width / sheet.width if sheet.width else 1.0
        scale_y = area.height / sheet.height if sheet.height else 1.0
        words = [
            Word(
                pymupdf.Rect(
                    area.x0 + word[0] * scale_x,
                    area.y0 + word[1] * scale_y,
                    area.x0 + word[2] * scale_x,
                    area.y0 + word[3] * scale_y,
                ),
                word[4],
            )
            for word in recognised[0].get_text("words")
        ]
    return visual_rows(words)


def _reading_dpis(area: pymupdf.Rect, dpi: int) -> list[int]:
    base = capped_dpi(area, dpi)
    pixels = (area.width * base / 72) * (area.height * base / 72)
    if pixels > CONSENSUS_MAX_PIXELS:
        return [base]
    return list(
        dict.fromkeys(capped_dpi(area, round(dpi * ratio)) for ratio in CONSENSUS_DPI_RATIOS)
    )


def _same_texts(first: list[Row], second: list[Row]) -> bool:
    return [row.text for row in first] == [row.text for row in second]


def read_area(
    page: pymupdf.Page,
    area: pymupdf.Rect,
    dpi: int,
    language: str,
    tessdata: str,
    check_cancelled: Callable[[], None],
) -> list[Row]:
    dpis = _reading_dpis(area, dpi)
    readings: dict[int, list[Row]] = {}
    for position in sorted(range(len(dpis)), key=lambda index: dpis[index]):
        if len(readings) == 2 and _same_texts(*readings.values()):
            break
        check_cancelled()
        readings[position] = _reading(page, area, dpis[position], language, tessdata)
    ordered = [readings[position] for position in sorted(readings)]
    rows = ordered[0] if len(ordered) == 1 else consensus_rows(ordered)
    return without_clipped_rows(rows, area)
