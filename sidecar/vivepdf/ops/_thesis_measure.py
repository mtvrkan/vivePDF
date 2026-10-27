import bisect
import re
from collections import Counter
from dataclasses import dataclass, field

import pymupdf

from vivepdf.ops._thesis_fonts import family_name
from vivepdf.ops._thesis_numbers import NUMBER, PageNumber, parse_number

BOLD_FLAG = 16
EDGE_BAND = 0.12
FURNITURE_BAND = 0.12
CENTER_BAND = 0.08
MAX_NUMBER_CHARS = 16
MIN_TEXT_CHARS = 20
BACKGROUND_SHARE = 0.9
WHITE = 0.97
RULE_THICKNESS = 3.0
ISOLATION_PT = 10.0
ISOLATION_RATIO = 1.2
POSITION_SLACK = 3.0
FURNITURE_SHARE = 0.25
EDGE_SHARE = 0.2
HEADING_INDENT = 45.0
HEADING_CENTER = 20.0
HEADING_NUMBER = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,5})\.?\s+\S")
LEADERS = re.compile(r"(?:\.\s?){4,}|…")
SENTENCE_END = re.compile(r"[.:;,]$")
INK_DPI = 72
INK_LEVEL = 245
UNREADABLE = (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase)
FOLD = str.maketrans({"İ": "I", "ı": "I", "i": "I", "\xa0": " "})
LEADING_LABEL = re.compile(r"^[\d.\s\-–—]+")
CHAPTER_ONE = re.compile(
    r"^(?:(?:BÖLÜM|BOLUM|CHAPTER|KISIM)\s*[-–:]?\s*(?:1|I|BIR)\b"
    r"|(?:BIRINCI)\s+BÖLÜM\b|1\.?\s*BÖLÜM\b|(?:GIRIŞ|GIRIS|INTRODUCTION)$)"
)
REFERENCE_TITLES = {
    "KAYNAKLAR",
    "KAYNAKÇA",
    "KAYNAKCA",
    "REFERENCES",
    "REFERANSLAR",
    "BIBLIOGRAPHY",
    "BIBLIYOGRAFYA",
    "LITERATÜR",
    "LITERATÜR LISTESI",
    "YARARLANILAN KAYNAKLAR",
    "KAYNAK DIZINI",
    "KAYNAKLAR DIZINI",
    "WORKS CITED",
}
END_TITLES = re.compile(
    r"^(?:EKLER|EK\s*[-–]?\s*\d*|APPENDIX.*|APPENDICES|ÖZGEÇMIŞ|ÖZ GEÇMIŞ|CURRICULUM VITAE|"
    r"DIZIN|INDEX)$"
)


Frame = tuple[float, float, float, float]


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


@dataclass
class PageFacts:
    width: float
    height: float
    lines: list[TextLine]
    images: list[pymupdf.Rect] = field(default_factory=list)
    drawings: list[pymupdf.Rect] = field(default_factory=list)
    has_image: bool = False
    number: PageNumber | None = None
    number_line: TextLine | None = None
    body: list[TextLine] = field(default_factory=list)
    unreadable: bool = False

    @property
    def landscape(self) -> bool:
        return self.width > self.height


def fold(text: str) -> str:
    return text.translate(FOLD).upper().strip()


def _direction(vector: tuple[float, float], matrix: pymupdf.Matrix) -> bool:
    turned = pymupdf.Point(vector) * pymupdf.Matrix(matrix.a, matrix.b, matrix.c, matrix.d, 0, 0)
    return abs(turned.x - 1) < 0.01 and abs(turned.y) < 0.01


def _span_lines(blocks: list[dict], matrix: pymupdf.Matrix) -> list[TextLine]:
    lines: list[TextLine] = []
    for block in blocks:
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
            origin = pymupdf.Point(spans[0]["origin"]) * matrix
            lines.append(
                TextLine(
                    rect=pymupdf.Rect(line["bbox"]) * matrix,
                    text="".join(span["text"] for span in line["spans"]).strip(),
                    size=size,
                    family=family,
                    bold=bold,
                    chars=sum(weights.values()),
                    baseline=origin.y,
                    horizontal=_direction(line.get("dir", (1, 0)), matrix),
                )
            )
    return lines


def _images(
    page: pymupdf.Page, matrix: pymupdf.Matrix, sheet: pymupdf.Rect
) -> tuple[list[pymupdf.Rect], bool]:
    found: list[pymupdf.Rect] = []
    seen = False
    for block in page.get_text("blocks", flags=pymupdf.TEXT_PRESERVE_IMAGES):
        if block[6] != 1:
            continue
        rect = (pymupdf.Rect(block[:4]) * matrix) & sheet
        if rect.is_empty:
            continue
        seen = True
        if rect.get_area() < BACKGROUND_SHARE * sheet.get_area():
            found.append(rect)
    return found, seen


def _white(colour: object) -> bool:
    return not colour or all(part >= WHITE for part in colour)


def _drawings(
    page: pymupdf.Page, matrix: pymupdf.Matrix, sheet: pymupdf.Rect
) -> list[pymupdf.Rect]:
    found: list[pymupdf.Rect] = []
    for path in page.get_drawings():
        stroke = path.get("color") if path.get("stroke_opacity", 1) else None
        fill = path.get("fill") if path.get("fill_opacity", 1) else None
        if _white(stroke) and _white(fill):
            continue
        rect = pymupdf.Rect(path["rect"])
        if not _white(stroke):
            half = max(path.get("width") or 0, 0.5) / 2
            rect = rect + (-half, -half, half, half)
        rect = (rect * matrix) & sheet
        if rect.is_empty or rect.get_area() >= BACKGROUND_SHARE * sheet.get_area():
            continue
        found.append(rect)
    return found


def _place(rect: pymupdf.Rect, width: float) -> str:
    middle_x = (rect.x0 + rect.x1) / 2
    if abs(middle_x - width / 2) <= width * CENTER_BAND:
        return "center"
    return "left" if middle_x < width / 2 else "right"


def _page_number(line: TextLine, width: float, height: float, page_count: int) -> PageNumber | None:
    if len(line.text) > MAX_NUMBER_CHARS or not line.horizontal:
        return None
    middle_y = (line.rect.y0 + line.rect.y1) / 2
    if middle_y > height * (1 - EDGE_BAND):
        edge = "bottom"
    elif middle_y < height * EDGE_BAND:
        edge = "top"
    else:
        return None
    parsed = parse_number(line.text, page_count)
    if parsed is None:
        return None
    kind, value, label = parsed
    return PageNumber(
        kind=kind, value=value, label=label, place=_place(line.rect, width), edge=edge
    )


def _number_of(
    lines: list[TextLine], width: float, height: float, page_count: int
) -> tuple[PageNumber, TextLine] | None:
    candidates = [
        (number, line)
        for line in lines
        if (number := _page_number(line, width, height, page_count)) is not None
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda item: min(item[1].rect.y0, height - item[1].rect.y1))


def read_page(document: pymupdf.Document, index: int, frame: Frame | None = None) -> PageFacts:
    try:
        return _read_page(document[index], document.page_count, frame)
    except UNREADABLE:
        return PageFacts(width=0.0, height=0.0, lines=[], unreadable=True)


def _ink_box(page: pymupdf.Page, rect: pymupdf.Rect) -> pymupdf.Rect | None:
    pixmap = page.get_pixmap(clip=rect, dpi=INK_DPI, colorspace=pymupdf.csGRAY, alpha=False)
    width, height, stride, samples = pixmap.width, pixmap.height, pixmap.stride, pixmap.samples
    rows = [
        row
        for row in range(height)
        if min(samples[row * stride : row * stride + width]) < INK_LEVEL
    ]
    if not rows:
        return None
    columns = [
        column
        for column in range(width)
        if min(samples[column : stride * height : stride]) < INK_LEVEL
    ]
    scale = 72 / INK_DPI
    return (
        pymupdf.Rect(
            (pixmap.x + columns[0]) * scale,
            (pixmap.y + rows[0]) * scale,
            (pixmap.x + columns[-1] + 1) * scale,
            (pixmap.y + rows[-1] + 1) * scale,
        )
        & rect
    )


def _outside(rect: pymupdf.Rect, frame: Frame, width: float, height: float) -> bool:
    top, bottom, left, right = frame
    if width > height:
        top = bottom = left = right = max(frame)
    return rect.y0 < top or rect.y1 > height - bottom or rect.x0 < left or rect.x1 > width - right


def _visible_images(
    page: pymupdf.Page, images: list[pymupdf.Rect], frame: Frame | None
) -> list[pymupdf.Rect]:
    width, height = page.rect.width, page.rect.height
    kept: list[pymupdf.Rect] = []
    for rect in images:
        if frame and _outside(rect, frame, width, height):
            ink = _ink_box(page, rect)
            if ink is None or ink.is_empty:
                continue
            rect = ink
        kept.append(rect)
    return kept


def _read_page(page: pymupdf.Page, page_count: int, frame: Frame | None) -> PageFacts:
    matrix = page.rotation_matrix
    width, height = page.rect.width, page.rect.height
    sheet = pymupdf.Rect(0, 0, width, height)
    blocks = page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]
    lines = _span_lines(blocks, matrix)
    images, has_image = _images(page, matrix, sheet)
    images = _visible_images(page, images, frame)
    facts = PageFacts(
        width=width,
        height=height,
        lines=lines,
        images=images,
        drawings=_drawings(page, matrix, sheet),
        has_image=has_image,
    )
    found = _number_of(lines, width, height, page_count)
    if found:
        facts.number, facts.number_line = found
    elif page.rotation % 360:
        upright = _span_lines(blocks, pymupdf.Identity)
        box = page.cropbox
        turned = _number_of(upright, box.width, box.height, page_count)
        if turned:
            facts.number = turned[0]
            facts.number_line = next(
                (line for line in lines if line.text == turned[1].text and not line.horizontal),
                None,
            )
    return facts


def _band(line: TextLine, height: float) -> str | None:
    middle_y = (line.rect.y0 + line.rect.y1) / 2
    if middle_y < height * FURNITURE_BAND:
        return "top"
    if middle_y > height * (1 - FURNITURE_BAND):
        return "bottom"
    return None


def _isolated(line: TextLine, side: str, lines: list[TextLine]) -> bool:
    nearest = float("inf")
    for other in lines:
        if other is line:
            continue
        if side == "top" and other.rect.y0 >= line.rect.y1 - 1:
            nearest = min(nearest, other.rect.y0 - line.rect.y1)
        elif side == "bottom" and other.rect.y1 <= line.rect.y0 + 1:
            nearest = min(nearest, line.rect.y0 - other.rect.y1)
    return nearest >= max(ISOLATION_PT, ISOLATION_RATIO * line.rect.height)


def _edge_distance(line: TextLine, side: str, height: float) -> float:
    middle_y = (line.rect.y0 + line.rect.y1) / 2
    return middle_y if side == "top" else height - middle_y


def split_body(pages: list[PageFacts]) -> None:
    loose: list[list[tuple[str, float, TextLine]]] = []
    spots: dict[str, list[float]] = {"top": [], "bottom": []}
    for facts in pages:
        found: list[tuple[str, float, TextLine]] = []
        for line in facts.lines:
            side = _band(line, facts.height)
            if side and line is not facts.number_line and _isolated(line, side, facts.lines):
                found.append((side, _edge_distance(line, side, facts.height), line))
        loose.append(found)
        for side in ("top", "bottom"):
            spots[side].extend({round(spot) for where, spot, _ in found if where == side})
    for values in spots.values():
        values.sort()
    edges = _typical_edges(pages, loose)
    text_pages = sum(1 for facts in pages if has_text(facts))
    needed = max(3, round(text_pages * FURNITURE_SHARE))
    for facts, found in zip(pages, loose, strict=True):
        furniture: set[int] = set()
        sides: set[str] = set()
        for side, spot, line in found:
            if _reach(line, side, facts.height) > edges[side] - POSITION_SLACK:
                continue
            values = spots[side]
            count = bisect.bisect_right(values, spot + POSITION_SLACK) - bisect.bisect_left(
                values, spot - POSITION_SLACK
            )
            if count >= needed:
                furniture.add(id(line))
                sides.add(side)
        if facts.number:
            sides.add(facts.number.edge)
        facts.body = [
            line
            for line in facts.lines
            if line is not facts.number_line and id(line) not in furniture
        ]
        facts.drawings = [
            rect for rect in facts.drawings if not _furniture_rule(rect, sides, facts.height)
        ]


def _reach(line: TextLine, side: str, height: float) -> float:
    return line.rect.y1 if side == "top" else height - line.rect.y0


def _typical_edges(
    pages: list[PageFacts], loose: list[list[tuple[str, float, TextLine]]]
) -> dict[str, float]:
    tops: list[float] = []
    bottoms: list[float] = []
    for facts, found in zip(pages, loose, strict=True):
        skipped = {id(line) for _, _, line in found} | {id(facts.number_line)}
        settled = [line for line in facts.lines if id(line) not in skipped]
        if settled:
            tops.append(min(line.rect.y0 for line in settled))
            bottoms.append(facts.height - max(line.rect.y1 for line in settled))
    return {"top": _low_share(tops), "bottom": _low_share(bottoms)}


def _low_share(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[int(len(ordered) * EDGE_SHARE)]


def _furniture_rule(rect: pymupdf.Rect, sides: set[str], height: float) -> bool:
    if rect.height > RULE_THICKNESS:
        return False
    middle_y = (rect.y0 + rect.y1) / 2
    if "top" in sides and middle_y < height * FURNITURE_BAND:
        return True
    return "bottom" in sides and middle_y > height * (1 - FURNITURE_BAND)


def content_box(facts: PageFacts) -> pymupdf.Rect | None:
    rects = [line.rect for line in facts.body] + facts.images + facts.drawings
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


def _same_row(line: TextLine, other: TextLine) -> bool:
    overlap = min(line.rect.y1, other.rect.y1) - max(line.rect.y0, other.rect.y0)
    return overlap > 0.5 * min(line.rect.height, other.rect.height)


def _is_contents_row(line: TextLine, facts: PageFacts) -> bool:
    if LEADERS.search(line.text):
        return True
    return any(
        other is not line
        and other.rect.x0 > line.rect.x1
        and NUMBER.fullmatch(other.text)
        and _same_row(line, other)
        for other in facts.lines
    )


def _alone(line: TextLine, facts: PageFacts) -> bool:
    return not any(other is not line and _same_row(line, other) for other in facts.body)


def text_frame(facts: PageFacts) -> tuple[float, float] | None:
    lines = [line for line in facts.body if line.horizontal]
    if not lines:
        return None
    return min(line.rect.x0 for line in lines), max(line.rect.x1 for line in lines)


def _titled(line: TextLine, facts: PageFacts, body_size: float) -> bool:
    return (
        line.horizontal
        and len(line.text) <= 150
        and (line.bold or line.size >= body_size + 1)
        and not _is_contents_row(line, facts)
    )


def heading_level(
    line: TextLine, facts: PageFacts, body_size: float, frame: tuple[float, float] | None
) -> int | None:
    if not _titled(line, facts, body_size) or SENTENCE_END.search(line.text):
        return None
    match = HEADING_NUMBER.match(line.text)
    if not match or not _alone(line, facts):
        return None
    if frame:
        left, right = frame
        middle = (line.rect.x0 + line.rect.x1) / 2
        aligned = line.rect.x0 - left <= HEADING_INDENT
        centred = abs(middle - (left + right) / 2) <= HEADING_CENTER
        if not (aligned or centred):
            return None
    return match.group(1).count(".") + 1


def chapter_one(facts: PageFacts, body_size: float) -> bool:
    for line in facts.body:
        if not line.horizontal or _is_contents_row(line, facts):
            continue
        strong = line.bold or line.size >= body_size + 1 or line.text.isupper()
        if not strong:
            continue
        match = HEADING_NUMBER.match(line.text)
        if match and match.group(1) == "1":
            return True
        if CHAPTER_ONE.match(fold(line.text)):
            return True
    return False


def _section_title(line: TextLine, facts: PageFacts) -> str | None:
    if not line.horizontal or len(line.text) > 60 or _is_contents_row(line, facts):
        return None
    return LEADING_LABEL.sub("", fold(line.text)).strip(" :.")


def reference_pages(pages: list[PageFacts], start: int) -> set[int]:
    inside = False
    found: set[int] = set()
    for index in range(start, len(pages)):
        facts = pages[index]
        titles = [title for line in facts.body if (title := _section_title(line, facts))]
        if inside and any(END_TITLES.match(title) for title in titles):
            inside = False
        if any(title in REFERENCE_TITLES for title in titles):
            inside = True
        if inside:
            found.add(index)
    return found
