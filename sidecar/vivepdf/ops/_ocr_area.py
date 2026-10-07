import statistics
from collections.abc import Callable
from dataclasses import dataclass, field
from difflib import SequenceMatcher

import pymupdf
from PIL import Image, ImageOps

from vivepdf.ops._orientation import capped_dpi

CONSENSUS_MAX_PIXELS = 3_000_000
SHARP_DPI_RATIO = 4 / 3
SHARP_MAX_DPI = 400
DARK_MEAN = 128
PADDING_PX = 24
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


def _text_distance(first: str, second: str) -> float:
    return 1 - SequenceMatcher(None, first, second).ratio()


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
                key=lambda candidate: sum(_text_distance(candidate.text, other) for other in texts),
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


def _image(pixmap: pymupdf.Pixmap) -> Image.Image:
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def _otsu_threshold(gray: Image.Image) -> int:
    histogram = gray.histogram()
    total = sum(histogram)
    weighted_total = sum(level * count for level, count in enumerate(histogram))
    background = 0
    background_sum = 0
    best_spread = -1.0
    threshold = DARK_MEAN
    for level, count in enumerate(histogram):
        background += count
        if not background:
            continue
        foreground = total - background
        if not foreground:
            break
        background_sum += level * count
        background_mean = background_sum / background
        foreground_mean = (weighted_total - background_sum) / foreground
        spread = background * foreground * (background_mean - foreground_mean) ** 2
        if spread > best_spread:
            best_spread = spread
            threshold = level
    return threshold


def dark_on_light(image: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(image)
    histogram = gray.histogram()
    mean = sum(level * count for level, count in enumerate(histogram)) / max(1, sum(histogram))
    if mean < DARK_MEAN:
        gray = ImageOps.invert(gray)
    return ImageOps.autocontrast(gray, cutoff=1)


def binarised(image: Image.Image) -> Image.Image:
    gray = dark_on_light(image)
    threshold = _otsu_threshold(gray)
    return gray.point(lambda level: 255 if level > threshold else 0)


def _padded(image: Image.Image) -> Image.Image:
    return ImageOps.expand(image, border=PADDING_PX, fill=255)


def _reading(
    image: Image.Image,
    padding: int,
    dpi: int,
    area: pymupdf.Rect,
    language: str,
    tessdata: str,
) -> list[Row]:
    rgb = image.convert("RGB")
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, rgb.width, rgb.height, rgb.tobytes(), False)
    pixmap.set_dpi(dpi, dpi)
    data = pixmap.pdfocr_tobytes(compress=True, language=language, tessdata=tessdata)
    with pymupdf.open("pdf", data) as recognised:
        sheet = recognised[0].rect
        inset = padding * sheet.width / rgb.width if rgb.width else 0.0
        inner_width = sheet.width - 2 * inset
        inner_height = sheet.height - 2 * inset
        scale_x = area.width / inner_width if inner_width > 0 else 1.0
        scale_y = area.height / inner_height if inner_height > 0 else 1.0
        words = [
            Word(
                pymupdf.Rect(
                    area.x0 + (word[0] - inset) * scale_x,
                    area.y0 + (word[1] - inset) * scale_y,
                    area.x0 + (word[2] - inset) * scale_x,
                    area.y0 + (word[3] - inset) * scale_y,
                ),
                word[4],
            )
            for word in recognised[0].get_text("words")
        ]
    return visual_rows(words)


def read_area(
    page: pymupdf.Page,
    area: pymupdf.Rect,
    dpi: int,
    language: str,
    tessdata: str,
    check_cancelled: Callable[[], None],
) -> list[Row]:
    base_dpi = capped_dpi(area, dpi)
    base = page.get_pixmap(dpi=base_dpi, clip=area, alpha=False)
    picture = _image(base)
    readings = [_reading(picture, 0, base_dpi, area, language, tessdata)]
    if base.width * base.height <= CONSENSUS_MAX_PIXELS:
        check_cancelled()
        normalised = _padded(dark_on_light(picture))
        readings.append(_reading(normalised, PADDING_PX, base_dpi, area, language, tessdata))
        check_cancelled()
        sharp_dpi = capped_dpi(
            area, max(base_dpi, min(SHARP_MAX_DPI, round(dpi * SHARP_DPI_RATIO)))
        )
        sharp = _image(page.get_pixmap(dpi=sharp_dpi, clip=area, alpha=False))
        readings.append(
            _reading(_padded(binarised(sharp)), PADDING_PX, sharp_dpi, area, language, tessdata)
        )
        rows = consensus_rows(readings)
    else:
        rows = readings[0]
    return without_clipped_rows(rows, area)
