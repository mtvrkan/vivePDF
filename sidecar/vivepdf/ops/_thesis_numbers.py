import bisect
import re
from dataclasses import dataclass

NUMBER = re.compile(
    r"^[\s\-–—(\[]*(?:(?:sayfa|page|s\.|p\.)\s*)?(\d{1,4}|[ivxlc]{1,8})"
    r"(?:\s*/\s*\d{1,4})?[\s\-–—)\]]*$",
    re.IGNORECASE,
)
ROMAN = re.compile(r"^c{0,3}(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$")
ROMAN_VALUES = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100}
ROMAN_STEPS = ((100, "c"), (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"))
YEARS = range(1900, 2101)


@dataclass(frozen=True)
class PageNumber:
    kind: str
    value: int
    label: str
    place: str
    edge: str


@dataclass(frozen=True)
class Finding:
    page: int
    expected: str | None = None
    found: str | None = None
    note: str | None = None
    text: str | None = None


@dataclass
class NumberReview:
    missing: list[Finding]
    order: list[Finding]
    front: list[Finding]
    front_ok: bool


def roman_value(text: str) -> int | None:
    if text not in (text.lower(), text.upper()):
        return None
    lowered = text.lower()
    if not lowered or not ROMAN.fullmatch(lowered):
        return None
    total = 0
    for current, following in zip(lowered, [*lowered[1:], ""], strict=True):
        value = ROMAN_VALUES[current]
        total += -value if following and ROMAN_VALUES[following] > value else value
    return total


def roman_label(value: int) -> str:
    if value < 1:
        return str(value)
    text = ""
    for step, symbol in ROMAN_STEPS:
        while value >= step:
            text += symbol
            value -= step
    return text + "iv" * (value == 4) + "i" * (value if value < 4 else 0)


def number_label(kind: str, value: int) -> str:
    return str(value) if kind == "arabic" else roman_label(value)


def parse_number(text: str, page_count: int) -> tuple[str, int, str] | None:
    match = NUMBER.fullmatch(text)
    if not match:
        return None
    token = match.group(1)
    if token.isdigit():
        value = int(token)
        if len(token) == 4 and value in YEARS:
            return None
        kind = "arabic"
    else:
        roman = roman_value(token)
        if roman is None:
            return None
        kind, value = "roman", roman
    if not 1 <= value <= page_count:
        return None
    return kind, value, token


def _neighbours(
    index: int, numbered: list[tuple[int, PageNumber]], positions: list[int]
) -> tuple[tuple[int, PageNumber] | None, tuple[int, PageNumber] | None]:
    spot = bisect.bisect_left(positions, index)
    before = numbered[spot - 1] if spot > 0 else None
    after = numbered[spot] if spot < len(numbered) else None
    return before, after


def _expected_label(
    index: int, numbered: list[tuple[int, PageNumber]], positions: list[int]
) -> str | None:
    before, after = _neighbours(index, numbered, positions)
    if after and after[1].kind == "arabic" and (before is None or before[1].kind == "roman"):
        value = after[1].value - (after[0] - index)
        if value >= 1:
            return str(value)
    if before:
        return number_label(before[1].kind, before[1].value + index - before[0])
    return None


def _order(
    numbered: list[tuple[int, PageNumber]], front_roman: bool, chapter_index: int | None
) -> list[Finding]:
    found: list[Finding] = []
    last: dict[str, tuple[int, PageNumber]] = {}
    last_roman = -1
    for index, number in numbered:
        roman = last.get("roman")
        arabic = last.get("arabic")
        if number.kind == "roman":
            if arabic:
                expected = str(arabic[1].value + index - arabic[0])
                found.append(Finding(index + 1, expected, number.label))
                continue
            if roman is None and number.value - 1 > index:
                found.append(Finding(index + 1, roman_label(index + 1), number.label))
            elif roman and number.value != roman[1].value + index - roman[0]:
                expected = roman_label(roman[1].value + index - roman[0])
                found.append(Finding(index + 1, expected, number.label))
            last["roman"] = (index, number)
            last_roman = index
            continue
        if arabic is None:
            lowest = last_roman + 1
            if chapter_index is not None and chapter_index <= index:
                lowest = max(lowest, chapter_index)
            start = index - (number.value - 1)
            if front_roman and start < lowest:
                found.append(Finding(index + 1, str(index - lowest + 1), number.label))
        elif number.value != arabic[1].value + index - arabic[0]:
            expected = str(arabic[1].value + index - arabic[0])
            found.append(Finding(index + 1, expected, number.label))
        last["arabic"] = (index, number)
    return found


def _front(
    numbered: list[tuple[int, PageNumber]],
    text_pages: list[bool],
    chapter_index: int | None,
) -> tuple[list[Finding], bool]:
    first_arabic = next((index for index, number in numbered if number.kind == "arabic"), None)
    end = chapter_index if chapter_index is not None else first_arabic
    if end is None:
        return [], any(number.kind == "roman" for _, number in numbered)
    front = [(index, number) for index, number in numbered if index < end]
    arabic = [
        Finding(index + 1, "roman", number.label)
        for index, number in front
        if number.kind == "arabic"
    ]
    if arabic:
        return arabic, False
    if any(number.kind == "roman" for _, number in front):
        return [], True
    numbered_pages = {index for index, _ in numbered}
    bare = [
        Finding(index + 1, "roman")
        for index in range(1, end)
        if text_pages[index] and index not in numbered_pages
    ]
    return bare, not bare


def review_numbers(
    numbers: list[PageNumber | None],
    text_pages: list[bool],
    front_roman: bool,
    chapter_index: int | None,
) -> NumberReview:
    numbered = [(index, number) for index, number in enumerate(numbers) if number]
    positions = [index for index, _ in numbered]
    missing: list[Finding] = []
    if numbered:
        missing = [
            Finding(index + 1, _expected_label(index, numbered, positions))
            for index in range(numbered[0][0], len(numbers))
            if numbers[index] is None and text_pages[index]
        ]
    front, front_ok = _front(numbered, text_pages, chapter_index)
    return NumberReview(
        missing=missing,
        order=_order(numbered, front_roman, chapter_index),
        front=front,
        front_ok=front_ok,
    )
