import math
import re
from collections.abc import Callable
from dataclasses import dataclass

import pymupdf

from vivepdf.ops._form_appearance import UnicodeAppearance, field_holder

SIMPLE_CALCULATE = re.compile(
    r"^\s*AFSimple_Calculate\s*\(\s*([\"'])(SUM|AVG|PRD|MIN|MAX)\1\s*,\s*"
    r"(?:new\s+Array\s*\((?P<array>[^()]*)\)|\[(?P<list>[^\[\]]*)\])\s*\)\s*;?\s*$",
    re.IGNORECASE,
)
SIMPLIFIED_NOTATION = re.compile(r"/\*\*\s*BVCALC(?P<expression>.*?)EVCALC\s*\*\*/", re.DOTALL)
QUOTED = re.compile(r"\"((?:[^\"\\]|\\.)*)\"|'((?:[^'\\]|\\.)*)'")
NUMBER_FORMAT = re.compile(
    r"^\s*AFNumber_Format\s*\(\s*(?P<decimals>\d+)\s*,\s*(?P<separator>\d+)\s*,\s*"
    r"(?P<negative>\d+)\s*,\s*\d+\s*,\s*(?:\"(?P<currency>(?:[^\"\\]|\\.)*)\"|'(?P<single>(?:[^'\\]|\\.)*)')"
    r"\s*,\s*(?P<prepend>true|false)\s*\)\s*;?\s*$",
    re.IGNORECASE,
)
PERCENT_FORMAT = re.compile(
    r"^\s*AFPercent_Format\s*\(\s*(?P<decimals>\d+)\s*,\s*(?P<separator>\d+)"
    r"(?:\s*,\s*(?:true|false))?\s*\)\s*;?\s*$",
    re.IGNORECASE,
)
PLAIN_NUMBER = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
SEPARATORS = {0: (",", "."), 1: ("", "."), 2: (".", ","), 3: ("", ","), 4: ("'", ".")}
MAX_DECIMALS = 10
OPERATORS = "+-*/()"
RED_NEGATIVE_STYLES = (1, 3)
RED = (1.0, 0.0, 0.0)
BLACK = (0.0, 0.0, 0.0)


@dataclass
class CalcSummary:
    recalculated: int = 0
    skipped: int = 0


class _Unsupported(Exception):
    pass


def make_number(value: object) -> float:
    if isinstance(value, bool) or value is None:
        return 0.0
    if isinstance(value, int | float):
        return float(value)
    text = str(value).strip().replace(",", ".", 1)
    if PLAIN_NUMBER.fullmatch(text):
        number = float(text)
        return number if math.isfinite(number) else 0.0
    return 0.0


def js_number(value: float) -> str:
    if value == int(value) and abs(value) < 1e21:
        return str(int(value))
    return repr(value)


def script_text(text: str) -> str:
    if text.isascii():
        return text
    try:
        return text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


def _unescape(text: str) -> str:
    return re.sub(r"\\(.)", r"\1", text)


def group_digits(separator: str, digits: str) -> str:
    if not separator:
        return digits
    head = len(digits) % 3 or 3
    parts = [digits[:head]] + [digits[index : index + 3] for index in range(head, len(digits), 3)]
    return separator.join(parts)


def _format_fixed(value: float, decimals: int, style: int) -> str:
    group, point = SEPARATORS.get(style, SEPARATORS[0])
    text = f"{abs(value):.{min(decimals, MAX_DECIMALS)}f}"
    integer, _, fraction = text.partition(".")
    body = group_digits(group, integer)
    return f"{body}{point}{fraction}" if fraction else body


def negative_colour(script: str | None, value: float) -> tuple[float, float, float] | None:
    match = NUMBER_FORMAT.match(script or "")
    if not match or int(match["negative"]) not in RED_NEGATIVE_STYLES:
        return None
    decimals = min(int(match["decimals"]), MAX_DECIMALS)
    shown_negative = value < 0 and float(f"{abs(value):.{decimals}f}") != 0
    return RED if shown_negative else BLACK


def number_display(
    value: float, decimals: int, style: int, negative_style: int, currency: str, prepend: bool
) -> str:
    body = _format_fixed(value, decimals, style)
    if currency:
        body = f"{currency}{body}" if prepend else f"{body}{currency}"
    negative = value < 0 and float(f"{abs(value):.{min(decimals, MAX_DECIMALS)}f}") != 0
    if not negative:
        return body
    return f"({body})" if negative_style in (2, 3) else f"-{body}"


def percent_display(value: float, decimals: int, style: int) -> str:
    percent = value * 100
    body = _format_fixed(percent, decimals, style) + "%"
    return f"-{body}" if percent < 0 and body.strip("0.,%'") else body


def format_value(script: str | None, value: float) -> str | None:
    if not script:
        return None
    match = NUMBER_FORMAT.match(script)
    if match:
        return number_display(
            value,
            int(match["decimals"]),
            int(match["separator"]),
            int(match["negative"]),
            _unescape(match["currency"] or match["single"] or ""),
            match["prepend"].lower() == "true",
        )
    match = PERCENT_FORMAT.match(script)
    if match:
        return percent_display(value, int(match["decimals"]), int(match["separator"]))
    return None


def _simple_calculate(script: str, lookup: Callable[[str], list[float]]) -> float | None:
    match = SIMPLE_CALCULATE.match(script)
    if not match:
        return None
    operation = match.group(2).upper()
    listing = match["array"] if match["array"] is not None else match["list"] or ""
    names = [_unescape(double or single) for double, single in QUOTED.findall(listing)]
    numbers = [number for name in names for number in lookup(name)]
    if not numbers:
        return 0.0
    if operation == "SUM":
        return math.fsum(numbers)
    if operation == "AVG":
        return math.fsum(numbers) / len(numbers)
    if operation == "PRD":
        return math.prod(numbers)
    if operation == "MIN":
        return min(numbers)
    return max(numbers)


def _tokens(expression: str) -> list[tuple[str, str]]:
    tokens: list[tuple[str, str]] = []
    index = 0
    while index < len(expression):
        character = expression[index]
        if character.isspace():
            index += 1
            continue
        if character in OPERATORS:
            tokens.append(("op", character))
            index += 1
            continue
        number = PLAIN_NUMBER.match(expression, index)
        if number and number.group(0)[0] not in "+-":
            tokens.append(("number", number.group(0)))
            index = number.end()
            continue
        name = []
        while index < len(expression):
            character = expression[index]
            if character == "\\" and index + 1 < len(expression):
                name.append(expression[index + 1])
                index += 2
                continue
            if character.isspace() or character in OPERATORS:
                break
            name.append(character)
            index += 1
        tokens.append(("name", "".join(name)))
    return tokens


class _Expression:
    def __init__(self, tokens: list[tuple[str, str]], value: Callable[[str], float]) -> None:
        self.tokens = tokens
        self.position = 0
        self.value = value

    def _peek(self) -> tuple[str, str] | None:
        return self.tokens[self.position] if self.position < len(self.tokens) else None

    def parse(self) -> float:
        result = self._sum()
        if self._peek() is not None:
            raise _Unsupported
        return result

    def _sum(self) -> float:
        result = self._product()
        while self._peek() in (("op", "+"), ("op", "-")):
            operator = self.tokens[self.position][1]
            self.position += 1
            right = self._product()
            result = result + right if operator == "+" else result - right
        return result

    def _product(self) -> float:
        result = self._factor()
        while self._peek() in (("op", "*"), ("op", "/")):
            operator = self.tokens[self.position][1]
            self.position += 1
            right = self._factor()
            if operator == "*":
                result *= right
            elif right == 0:
                raise _Unsupported
            else:
                result /= right
        return result

    def _factor(self) -> float:
        token = self._peek()
        if token is None:
            raise _Unsupported
        self.position += 1
        kind, text = token
        if token == ("op", "-"):
            return -self._factor()
        if token == ("op", "+"):
            return self._factor()
        if token == ("op", "("):
            result = self._sum()
            if self._peek() != ("op", ")"):
                raise _Unsupported
            self.position += 1
            return result
        if kind == "number":
            return float(text)
        if kind == "name" and text:
            return self.value(text)
        raise _Unsupported


def _simplified(script: str, value: Callable[[str], float]) -> float | None:
    match = SIMPLIFIED_NOTATION.search(script)
    if not match:
        return None
    try:
        return _Expression(_tokens(match["expression"]), value).parse()
    except _Unsupported:
        return None


def evaluate(
    script: str, lookup: Callable[[str], list[float]], value: Callable[[str], float]
) -> float | None:
    result = _simple_calculate(script, lookup)
    if result is None:
        result = _simplified(script, value)
    if result is None or not math.isfinite(result):
        return None
    return result


def _raw_value(widget: pymupdf.Widget) -> str:
    value = widget.field_value
    if isinstance(value, list | tuple):
        return str(value[0]) if value else ""
    return "" if value is None or isinstance(value, bool) else str(value)


def recalculate(
    document: pymupdf.Document,
    appearance: UnicodeAppearance | None = None,
    language: str | None = None,
) -> CalcSummary:
    locations: dict[str, list[tuple[int, int]]] = {}
    values: dict[str, str] = {}
    scripts: dict[str, tuple[str, str]] = {}
    formats: dict[str, str] = {}
    names_by_xref: dict[int, str] = {}
    for page in document:
        for widget in page.widgets():
            name = widget.field_name
            if not name:
                continue
            locations.setdefault(name, []).append((page.number, widget.xref))
            values.setdefault(name, _raw_value(widget))
            names_by_xref[widget.xref] = name
            names_by_xref.setdefault(field_holder(document, widget.xref), name)
            if widget.script_format and name not in formats:
                formats[name] = script_text(widget.script_format)
            if widget.script_calc and name not in scripts:
                scripts[name] = (
                    script_text(widget.script_calc),
                    script_text(widget.script_format or ""),
                )
    summary = CalcSummary()
    if not scripts:
        return summary
    from vivepdf.ops._date_names import date_names
    from vivepdf.ops._form_script import FormScripts, field_script

    validations = {
        name: script
        for name in scripts
        if (script := field_script(document, locations[name][0][1], "V"))
    }
    order: list[str] = []
    kind, listing = document.xref_get_key(document.pdf_catalog(), "AcroForm/CO")
    if kind == "array":
        for number in re.findall(r"(\d+)\s+\d+\s+R", listing):
            name = names_by_xref.get(int(number))
            if name in scripts and name not in order:
                order.append(name)
    order.extend(name for name in scripts if name not in order)

    def lookup(name: str) -> list[float]:
        if name in values:
            return [make_number(values[name])]
        prefix = f"{name}."
        return [make_number(text) for key, text in values.items() if key.startswith(prefix)]

    def single(name: str) -> float:
        numbers = lookup(name)
        return numbers[0] if numbers else 0.0

    host: FormScripts | None = None

    def scripting() -> FormScripts:
        nonlocal host
        if host is None:
            host = FormScripts(document, values, date_names(language))
        return host

    def store(name: str, raw: str, number: float | None, format_script: str) -> None:
        display = None if number is None else format_value(format_script, number)
        colour = None if number is None else negative_colour(format_script, number)
        if display is None and format_script:
            display = scripting().format(name, format_script)
        _write(
            document, locations[name], raw, raw if display is None else display, appearance, colour
        )

    def accepted(name: str, raw: str) -> bool:
        return name not in validations or scripting().validate(name, validations[name], raw)

    for name in order:
        calculation, format_script = scripts[name]
        result = evaluate(calculation, lookup, single)
        if result is not None:
            raw = js_number(result)
            if not accepted(name, raw):
                continue
            values[name] = raw
            store(name, raw, result, format_script)
            summary.recalculated += 1
            continue
        outcome = scripting().calculate(name, calculation)
        for changed, (raw, number) in scripting().take_changes().items():
            if changed != name and changed in locations:
                store(changed, raw, number, formats.get(changed, ""))
        if outcome.status == "kept":
            continue
        if outcome.status == "failed":
            summary.skipped += 1
            continue
        if not accepted(name, outcome.raw):
            continue
        values[name] = outcome.raw
        store(name, outcome.raw, outcome.number, format_script)
        summary.recalculated += 1
    return summary


def _write(
    document: pymupdf.Document,
    locations: list[tuple[int, int]],
    raw: str,
    display: str,
    appearance: UnicodeAppearance | None,
    colour: tuple[float, float, float] | None = None,
) -> None:
    wanted: dict[int, set[int]] = {}
    for page_number, xref in locations:
        wanted.setdefault(page_number, set()).add(xref)
    for page_number, xrefs in wanted.items():
        for widget in document[page_number].widgets():
            if widget.xref not in xrefs:
                continue
            widget.field_value = display
            if colour is not None:
                widget.text_color = colour
            widget.update()
            if appearance is not None:
                appearance.redraw(widget)
            if display != raw:
                document.xref_set_key(
                    field_holder(document, widget.xref), "V", pymupdf.get_pdf_str(raw)
                )
