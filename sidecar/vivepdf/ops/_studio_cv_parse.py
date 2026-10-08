from dataclasses import dataclass, field

import pymupdf

from vivepdf.ops._studio_cv_text import (
    BULLET,
    EMAIL,
    FOOTER,
    contacts_in,
    find_range,
    find_single,
    fold,
    heading_key,
    heading_of,
    location_value,
    plain_line,
    trimmed,
)

KEYWORD_CONFIDENCE = 0.9
FONT_CONFIDENCE = 0.6
INFERRED_CONFIDENCE = 0.4
BOLD_FLAG = 16


@dataclass
class Line:
    text: str
    size: float
    bold: bool
    x0: float
    x1: float
    y0: float
    y1: float
    page: int
    column: int = 0
    starts_column: bool = False


@dataclass
class Block:
    key: str
    heading: str
    confidence: float
    lines: list[Line] = field(default_factory=list)


@dataclass
class Header:
    name: str = ""
    headline: str = ""
    location: str = ""
    contacts: list[tuple[str, str]] = field(default_factory=list)
    leftover: list[Line] = field(default_factory=list)


def _bold(span: dict) -> bool:
    return bool(span.get("flags", 0) & BOLD_FLAG) or "bold" in str(span.get("font", "")).lower()


def page_lines(page: pymupdf.Page, number: int) -> tuple[list[Line], int]:
    lines: list[Line] = []
    footers = 0
    for block in page.get_text("dict").get("blocks", ()):
        if block.get("type") != 0:
            continue
        for entry in block.get("lines", ()):
            if abs(entry.get("dir", (1, 0))[1]) > 0.2:
                continue
            spans = [span for span in entry.get("spans", ()) if span.get("text", "").strip()]
            if not spans:
                continue
            text = plain_line("".join(span["text"] for span in entry["spans"]))
            if FOOTER.fullmatch(fold(text)):
                footers += 1
                continue
            weights = [len(span["text"].strip()) for span in spans]
            heavy = sum(weight for span, weight in zip(spans, weights, strict=True) if _bold(span))
            x0, y0, x1, y1 = entry["bbox"]
            size = round(max(span["size"] for span in spans), 1)
            lines.append(Line(text, size, heavy * 2 > sum(weights), x0, x1, y0, y1, number))
    return _ordered(lines, page.rect.width), footers


def _split(lines: list[Line], width: float) -> float | None:
    if len(lines) < 6:
        return None
    for percent in range(20, 56, 2):
        split = width * percent / 100
        if any(line.x0 < split - 1 and line.x1 > split + 1 for line in lines):
            continue
        left = [line for line in lines if line.x1 <= split + 1]
        right = [line for line in lines if line.x0 >= split - 1]
        if len(left) < 3 or len(right) < 3:
            continue
        dated = sum(1 for line in left if find_range(line.text) or find_single(line.text))
        if dated * 2 >= len(left):
            return None
        overlap = min(max(line.y1 for line in left), max(line.y1 for line in right)) - max(
            min(line.y0 for line in left), min(line.y0 for line in right)
        )
        if overlap > 0:
            return split
    return None


def _same_row(first: Line, second: Line) -> bool:
    height = min(first.y1 - first.y0, second.y1 - second.y0)
    centre = abs((first.y0 + first.y1) - (second.y0 + second.y1)) / 2
    apart = second.x0 >= first.x1 - 1 or first.x0 >= second.x1 - 1
    return centre < height * 0.35 and apart


def _joined(first: Line, second: Line) -> Line:
    left, right = (first, second) if first.x0 <= second.x0 else (second, first)
    heavier = left if len(left.text) >= len(right.text) else right
    return Line(
        f"{left.text} | {right.text}",
        max(left.size, right.size),
        heavier.bold,
        min(left.x0, right.x0),
        max(left.x1, right.x1),
        min(left.y0, right.y0),
        max(left.y1, right.y1),
        left.page,
        left.column,
    )


def _rows(lines: list[Line]) -> list[Line]:
    rows: list[Line] = []
    for line in sorted(lines, key=lambda item: ((item.y0 + item.y1) / 2, item.x0)):
        if rows and _same_row(rows[-1], line):
            rows[-1] = _joined(rows[-1], line)
        else:
            rows.append(line)
    return rows


def _ordered(lines: list[Line], width: float) -> list[Line]:
    split = _split(lines, width)
    if split is None:
        return _rows(lines)
    left = _rows([line for line in lines if (line.x0 + line.x1) / 2 < split])
    right = _rows([line for line in lines if (line.x0 + line.x1) / 2 >= split])
    for line in right:
        line.column = 1
    if left and right:
        right[0].starts_column = True
    return left + right


def body_size(lines: list[Line]) -> float:
    weighted = sorted((line.size, len(line.text)) for line in lines)
    total = sum(weight for _, weight in weighted)
    running = 0
    for size, weight in weighted:
        running += weight
        if running * 2 >= total:
            return size
    return 10.0


def _font_heading(line: Line, body: float, top: float) -> bool:
    text = line.text.strip()
    if (
        len(text) > 40
        or len(text.split()) > 4
        or any(character.isdigit() for character in text)
        or "@" in text
        or "|" in text
        or text[-1:] in ".,;"
        or BULLET.match(text)
        or line.size >= top * 0.95
    ):
        return False
    letters = sum(character.isalpha() for character in text)
    return line.size >= body * 1.2 or (line.bold and text.isupper() and letters >= 3)


def segment(lines: list[Line]) -> tuple[list[Line], list[Block], set[str]]:
    body = body_size(lines)
    top = max(line.size for line in lines if line.page == lines[0].page)
    keyword_any = any(heading_of(line.text) for line in lines)
    header: list[Line] = []
    blocks: list[Block] = []
    headings: set[str] = set()
    current: Block | None = None
    keyword_seen = False
    for index, line in enumerate(lines):
        if line.starts_column:
            current, keyword_seen = None, False
        key = heading_of(line.text)
        if key is not None:
            headings.add(heading_key(line.text))
            current = Block(key, line.text, KEYWORD_CONFIDENCE)
            blocks.append(current)
            keyword_seen = True
            continue
        if (keyword_seen or (not keyword_any and index > 2)) and _font_heading(line, body, top):
            current = Block("custom", line.text, FONT_CONFIDENCE)
            blocks.append(current)
            continue
        (header if current is None else current.lines).append(line)
    return header, blocks, headings


def _pieces(text: str) -> list[str]:
    return [piece.strip() for piece in text.split(" | ") if piece.strip()]


def _name_piece(text: str) -> str:
    for piece in _pieces(text):
        found, rest = contacts_in(piece)
        words = rest.split()
        if (
            not found
            and rest == trimmed(piece)
            and 1 <= len(words) <= 6
            and len(rest) <= 60
            and not any(character.isdigit() for character in rest)
            and heading_of(rest) is None
            and any(character.isalpha() for character in rest)
        ):
            return rest
    return ""


def _continues(previous: Line, line: Line) -> bool:
    return (
        previous.page == line.page
        and abs(previous.size - line.size) < 0.6
        and line.y0 - previous.y1 < line.size * 0.6
    )


def read_header(header: list[Line], lines: list[Line], linkedin: bool) -> Header:
    result = Header()
    page = header[0].page if header else lines[0].page
    pool = [line for line in header if line.page == page] or lines[:6]
    name_line = None
    for line in sorted(pool, key=lambda item: -item.size):
        result.name = _name_piece(line.text)
        if result.name:
            name_line = line
            break
    texts: list[Line] = []
    for line in pool:
        if line is name_line:
            continue
        remainder = []
        for piece in _pieces(line.text):
            found, rest = contacts_in(piece)
            result.contacts.extend(found)
            if found:
                result.location = result.location or location_value(rest)
            elif rest:
                remainder.append(rest)
        after_name = name_line is None or pool.index(line) > pool.index(name_line)
        if remainder and after_name and line in header:
            texts.append(
                Line(
                    " ".join(remainder),
                    line.size,
                    line.bold,
                    line.x0,
                    line.x1,
                    line.y0,
                    line.y1,
                    line.page,
                )
            )
    if linkedin and len(texts) >= 2 and not any(c.isdigit() for c in texts[-1].text):
        result.location = result.location or trimmed(texts.pop().text)
    headline: list[Line] = []
    for line in texts:
        place = location_value(line.text)
        if not headline or not result.leftover and _continues(headline[-1], line) and not place:
            headline.append(line)
        elif place and not result.location:
            result.location = place
        else:
            result.leftover.append(line)
    result.headline = " ".join(line.text for line in headline)
    return result


def block_contacts(lines: list[Line]) -> tuple[list[tuple[str, str]], str]:
    texts: list[str] = []
    for line in lines:
        text = line.text.strip()
        if texts and texts[-1].endswith(("-", "/")) and " " not in texts[-1].split("(")[0].strip():
            texts[-1] += text
        else:
            texts.append(text)
    contacts: list[tuple[str, str]] = []
    location = ""
    for text in texts:
        found, rest = contacts_in(text)
        contacts.extend(found)
        if not found and rest:
            location = location or location_value(rest)
    return contacts, location


def first_page_emails(lines: list[Line]) -> list[tuple[str, str]]:
    page = lines[0].page
    for line in lines:
        if line.page == page:
            match = EMAIL.search(line.text)
            if match:
                return [("email", match.group())]
    return []
