import re
from collections import Counter
from dataclasses import dataclass, field

import pymupdf

from vivepdf.ops._pptx_runs import font_family

BOLD_FLAG = 16
EDGE_BAND = 0.12
FURNITURE_BAND = 0.1
CENTER_BAND = 0.08
MAX_NUMBER_CHARS = 12
MIN_TEXT_CHARS = 20
BACKGROUND_SHARE = 0.9
NUMBER = re.compile(r"^[\s\-–—(]*(\d{1,4}|[ivxlcdm]{1,8})[\s\-–—)]*$", re.IGNORECASE)
ROMAN = re.compile(r"^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$")
ROMAN_VALUES = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}
DIGITS = re.compile(r"\d+")
HEADING_NUMBER = re.compile(r"^(\d+(?:\.\d+){0,5})\.?\s+\S")
LEADERS = re.compile(r"(?:\.\s?){4,}|…")
STYLE_WORDS = {
    "book",
    "regular",
    "bold",
    "italic",
    "oblique",
    "light",
    "medium",
    "semibold",
    "demibold",
    "black",
    "heavy",
    "thin",
    "condensed",
    "narrow",
}


@dataclass(frozen=True)
class TextLine:
    rect: pymupdf.Rect
    text: str
    size: float
    family: str
    bold: bool
    chars: int
    baseline: float
    horizontal: bool


@dataclass(frozen=True)
class PageNumber:
    kind: str
    value: int
    place: str
    edge: str


@dataclass
class PageFacts:
    width: float
    height: float
    lines: list[TextLine]
    images: list[pymupdf.Rect]
    number: PageNumber | None = None
    body: list[TextLine] = field(default_factory=list)


def family_name(font: str) -> str:
    words = font_family(font).split(" ")
    while len(words) > 1 and words[-1].lower() in STYLE_WORDS:
        words.pop()
    return " ".join(words)


def roman_value(text: str) -> int | None:
    lowered = text.lower()
    if not lowered or not ROMAN.fullmatch(lowered):
        return None
    total = 0
    for current, following in zip(lowered, [*lowered[1:], ""], strict=True):
        value = ROMAN_VALUES[current]
        total += -value if following and ROMAN_VALUES[following] > value else value
    return total


def _span_lines(page: pymupdf.Page) -> list[TextLine]:
    lines: list[TextLine] = []
    for block in page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]:
        for line in block.get("lines", []):
            spans = [span for span in line["spans"] if span["text"].strip()]
            if not spans:
                continue
            weights: Counter[tuple[str, float, bool]] = Counter()
            for span in spans:
                bold = bool(span["flags"] & BOLD_FLAG) or "bold" in span["font"].lower()
                key = (family_name(span["font"]), round(span["size"] * 2) / 2, bold)
                weights[key] += len(span["text"].strip())
            (family, size, bold), _ = weights.most_common(1)[0]
            text = "".join(span["text"] for span in line["spans"]).strip()
            direction = line.get("dir", (1, 0))
            lines.append(
                TextLine(
                    rect=pymupdf.Rect(line["bbox"]),
                    text=text,
                    size=size,
                    family=family,
                    bold=bold,
                    chars=sum(weights.values()),
                    baseline=spans[0]["origin"][1],
                    horizontal=abs(direction[0] - 1) < 0.01 and abs(direction[1]) < 0.01,
                )
            )
    return lines


def _images(page: pymupdf.Page, width: float, height: float) -> list[pymupdf.Rect]:
    sheet = pymupdf.Rect(0, 0, width, height)
    found: list[pymupdf.Rect] = []
    for info in page.get_image_info():
        rect = pymupdf.Rect(info["bbox"]) & sheet
        if rect.is_empty or rect.get_area() >= BACKGROUND_SHARE * sheet.get_area():
            continue
        found.append(rect)
    return found


def _page_number(line: TextLine, width: float, height: float) -> PageNumber | None:
    if len(line.text) > MAX_NUMBER_CHARS or not line.horizontal:
        return None
    match = NUMBER.fullmatch(line.text)
    if not match:
        return None
    middle_y = (line.rect.y0 + line.rect.y1) / 2
    if middle_y > height * (1 - EDGE_BAND):
        edge = "bottom"
    elif middle_y < height * EDGE_BAND:
        edge = "top"
    else:
        return None
    token = match.group(1)
    if token.isdigit():
        kind, value = "arabic", int(token)
    else:
        roman = roman_value(token)
        if roman is None:
            return None
        kind, value = "roman", roman
    middle_x = (line.rect.x0 + line.rect.x1) / 2
    if abs(middle_x - width / 2) <= width * CENTER_BAND:
        place = "center"
    else:
        place = "left" if middle_x < width / 2 else "right"
    return PageNumber(kind=kind, value=value, place=place, edge=edge)


def read_page(page: pymupdf.Page) -> PageFacts:
    box = page.cropbox
    width, height = box.width, box.height
    lines = _span_lines(page)
    facts = PageFacts(width=width, height=height, lines=lines, images=_images(page, width, height))
    candidates = [
        (number, line)
        for line in lines
        if (number := _page_number(line, width, height)) is not None
    ]
    if candidates:
        candidates.sort(key=lambda item: min(item[1].rect.y0, height - item[1].rect.y1))
        facts.number = candidates[0][0]
    return facts


def furniture_key(line: TextLine, height: float) -> str | None:
    middle_y = (line.rect.y0 + line.rect.y1) / 2
    if height * FURNITURE_BAND < middle_y < height * (1 - FURNITURE_BAND):
        return None
    side = "top" if middle_y < height / 2 else "bottom"
    return f"{side}:{DIGITS.sub('#', line.text.lower())}"


def split_body(pages: list[PageFacts]) -> None:
    seen: Counter[str] = Counter()
    for facts in pages:
        seen.update({key for line in facts.lines if (key := furniture_key(line, facts.height))})
    repeated = max(3, round(len(pages) * 0.3))
    for facts in pages:
        facts.body = [
            line
            for line in facts.lines
            if not (facts.number and _page_number(line, facts.width, facts.height) == facts.number)
            and seen[furniture_key(line, facts.height) or ""] < repeated
        ]


def content_box(facts: PageFacts) -> pymupdf.Rect | None:
    rects = [line.rect for line in facts.body] + facts.images
    if not rects:
        return None
    box = pymupdf.Rect(rects[0])
    for rect in rects[1:]:
        box |= rect
    return box


def has_text(facts: PageFacts) -> bool:
    return sum(line.chars for line in facts.lines) >= MIN_TEXT_CHARS


def line_gaps(facts: PageFacts, size: float) -> list[float]:
    lines = sorted(
        (line for line in facts.body if line.horizontal and abs(line.size - size) <= 0.6),
        key=lambda line: line.baseline,
    )
    gaps: list[float] = []
    for upper, lower in zip(lines, lines[1:], strict=False):
        overlap = min(upper.rect.x1, lower.rect.x1) - max(upper.rect.x0, lower.rect.x0)
        gap = lower.baseline - upper.baseline
        if overlap > 0 and 0.8 * size < gap < 3.2 * size:
            gaps.append(gap)
    return gaps


def _is_contents_row(line: TextLine, facts: PageFacts) -> bool:
    if LEADERS.search(line.text):
        return True
    for other in facts.lines:
        if other is line or other.rect.x0 <= line.rect.x1 or not NUMBER.fullmatch(other.text):
            continue
        overlap = min(line.rect.y1, other.rect.y1) - max(line.rect.y0, other.rect.y0)
        if overlap > 0.5 * min(line.rect.height, other.rect.height):
            return True
    return False


def heading_level(line: TextLine, facts: PageFacts, body_size: float) -> int | None:
    if not line.horizontal or len(line.text) > 150 or _is_contents_row(line, facts):
        return None
    if not (line.bold or line.size >= body_size + 1):
        return None
    match = HEADING_NUMBER.match(line.text)
    return match.group(1).count(".") + 1 if match else None
