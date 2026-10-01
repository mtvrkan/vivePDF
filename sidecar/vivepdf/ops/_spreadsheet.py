import datetime as dt
import re
from collections.abc import Iterable
from dataclasses import dataclass

FORMULA_PREFIXES = {"=", "+", "-", "@", "\t", "\r"}
PLAIN_NUMBER = re.compile(r"[+-]?(\d[\d.,\s]*)?\d%?")
ILLEGAL_TEXT = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")

MAX_EXACT_DIGITS = 15
GROUP_SPACES = " \u00a0\u202f\u2009'"
CURRENCIES = "$\u20ac\u00a3\u00a5\u20ba\u20bd\u20b9"
MINUS_SIGNS = "-\u2212"
NUMBER = re.compile(
    rf"(?P<open>\()?(?P<sign>[{MINUS_SIGNS}])?(?P<lead>%\s?)?"
    rf"(?:(?P<before>[{CURRENCIES}])\s?)?"
    rf"(?P<body>\d(?:[\d.,{GROUP_SPACES}]*\d)?)"
    rf"(?:\s?(?P<after>[{CURRENCIES}]))?"
    rf"(?P<percent>\s?%)?(?P<close>\))?"
)
ISO_DATE = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})")
DOTTED_DATE = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})")
SLASHED_DATE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")


def inert_cell[T](value: T) -> T | str:
    if (
        not isinstance(value, str)
        or value[:1] not in FORMULA_PREFIXES
        or PLAIN_NUMBER.fullmatch(value.strip())
    ):
        return value
    return f"'{value}"


def clean_text(value: str) -> str:
    return ILLEGAL_TEXT.sub("", value)


def needs_quote_prefix(value: str) -> bool:
    return value[:1] in FORMULA_PREFIXES


@dataclass(frozen=True, slots=True)
class TypedValue:
    value: float | int | dt.date
    number_format: str | None


def _groups_valid(groups: list[str]) -> bool:
    return 1 <= len(groups[0]) <= 3 and all(len(group) == 3 for group in groups[1:])


def _decimal_mark(body: str, convention: str | None) -> str | None:
    dots, commas = body.count("."), body.count(",")
    if dots and commas:
        mark = "." if body.rfind(".") > body.rfind(",") else ","
        return mark if body.count(mark) == 1 else None
    mark = "." if dots else "," if commas else ""
    if not mark:
        return ""
    if body.count(mark) > 1:
        return "" if _groups_valid(body.split(mark)) else None
    whole, fraction = body.split(mark)
    if len(fraction) != 3 or whole in {"", "0"} or len(whole) > 3:
        return mark
    if convention is None:
        return None
    return mark if mark == convention else ""


def _split_number(body: str, convention: str | None) -> tuple[str, str, bool] | None:
    mark = _decimal_mark(body.translate(str.maketrans("", "", GROUP_SPACES)), convention)
    if mark is None:
        return None
    whole, _, fraction = body.partition(mark) if mark else (body, "", "")
    grouping = [piece for piece in re.split(rf"[.,{GROUP_SPACES}]", whole)]
    if len(grouping) > 1 and not _groups_valid(grouping):
        return None
    digits = "".join(grouping)
    if not digits.isdigit() or not (fraction == "" or fraction.isdigit()):
        return None
    return digits, fraction, len(grouping) > 1


def decimal_evidence(text: str) -> str | None:
    match = NUMBER.fullmatch(text.strip())
    if match is None:
        return None
    body = match["body"].translate(str.maketrans("", "", GROUP_SPACES))
    mark = _decimal_mark(body, None)
    return mark or None


def date_order_evidence(text: str) -> str | None:
    match = SLASHED_DATE.fullmatch(text.strip())
    if match is None:
        return None
    first, second = int(match[1]), int(match[2])
    if first > 12 >= second:
        return "day"
    if second > 12 >= first:
        return "month"
    return None


def _majority(votes: Iterable[str | None]) -> str | None:
    counts: dict[str, int] = {}
    for vote in votes:
        if vote is not None:
            counts[vote] = counts.get(vote, 0) + 1
    if not counts:
        return None
    ranked = sorted(counts.items(), key=lambda item: item[1], reverse=True)
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return None
    return ranked[0][0]


def _number_format(
    decimals: int, grouped: bool, percent: bool, before: str, after: str
) -> str | None:
    pattern = ("#,##0" if grouped else "0") + ("." + "0" * decimals if decimals else "")
    if percent:
        return pattern + "%"
    if before:
        return f'"{before}"{pattern}'
    if after:
        return f'{pattern} "{after}"'
    if grouped or decimals:
        return pattern
    return None


def _date(year: int, month: int, day: int) -> dt.date | None:
    try:
        return dt.date(year, month, day)
    except ValueError:
        return None


class CellTyping:
    def __init__(self, texts: Iterable[str]):
        samples = [text for text in texts if text]
        self.decimal = _majority(decimal_evidence(text) for text in samples)
        self.date_order = _majority(date_order_evidence(text) for text in samples)
        if self.date_order is None and self.decimal == ",":
            self.date_order = "day"

    def _typed_date(self, text: str) -> TypedValue | None:
        if match := ISO_DATE.fullmatch(text):
            value = _date(int(match[1]), int(match[2]), int(match[3]))
            return TypedValue(value, "yyyy-mm-dd") if value else None
        if match := DOTTED_DATE.fullmatch(text):
            value = _date(int(match[3]), int(match[2]), int(match[1]))
            return TypedValue(value, "dd.mm.yyyy") if value else None
        if (match := SLASHED_DATE.fullmatch(text)) and self.date_order:
            first, second, year = int(match[1]), int(match[2]), int(match[3])
            if self.date_order == "day":
                value = _date(year, second, first)
                return TypedValue(value, "dd/mm/yyyy") if value else None
            value = _date(year, first, second)
            return TypedValue(value, "mm/dd/yyyy") if value else None
        return None

    def typed(self, text: str) -> TypedValue | None:
        stripped = text.strip()
        if not stripped or "\n" in stripped:
            return None
        dated = self._typed_date(stripped)
        if dated is not None:
            return dated
        match = NUMBER.fullmatch(stripped)
        if match is None or bool(match["open"]) != bool(match["close"]):
            return None
        if (match["before"] and match["after"]) or (match["lead"] and match["percent"]):
            return None
        parts = _split_number(match["body"], self.decimal)
        if parts is None:
            return None
        digits, fraction, grouped = parts
        if len(digits) > 1 and digits.startswith("0") and not grouped:
            return None
        if len(digits) + len(fraction) > MAX_EXACT_DIGITS:
            return None
        negative = bool(match["sign"]) or bool(match["open"])
        magnitude: float | int = float(f"{digits}.{fraction}") if fraction else int(digits)
        percent = bool(match["percent"] or match["lead"])
        if percent:
            magnitude = magnitude / 100
        value = -magnitude if negative else magnitude
        number_format = _number_format(
            len(fraction), grouped, percent, match["before"] or "", match["after"] or ""
        )
        return TypedValue(value, number_format)
