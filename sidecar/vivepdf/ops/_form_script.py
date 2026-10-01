import math
import re
from dataclasses import dataclass
from typing import Any

import pymupdf

from vivepdf.ops._date_names import ENGLISH, DateNames
from vivepdf.ops._form_appearance import field_holder
from vivepdf.ops._form_calc import (
    MAX_DECIMALS,
    PLAIN_NUMBER,
    SEPARATORS,
    group_digits,
    make_number,
    number_display,
    percent_display,
    script_text,
)
from vivepdf.ops._js_builtins import argument
from vivepdf.ops._js_date import DateObject, guess_date, print_date, printd_picture, scan_date
from vivepdf.ops._js_interpreter import Interpreter
from vivepdf.ops._js_lexer import MAX_SOURCE
from vivepdf.ops._js_parser import parse
from vivepdf.ops._js_values import (
    MAX_STRING,
    UNDEFINED,
    Budget,
    JSArray,
    JSObject,
    JSThrow,
    NativeFunction,
    ScriptError,
    ScriptLimit,
    checked_string,
    number_to_string,
    throw_error,
    to_boolean,
    to_fixed,
    to_integer,
    to_number,
    to_string,
    to_uint32,
)
from vivepdf.ops._pdf_names import name_tree_values, stream_prefix

SCRIPT_STEPS = 100_000
DOCUMENT_STEPS = 500_000
DOCUMENT_MEMORY = 64 << 20
MAX_DOCUMENT_SCRIPTS = 64
MAX_WIDTH = 1024
DEFAULT_PRECISION = 6
PRINTF = re.compile(r"%(?:,([0-4]))?([+ 0#]*)(\d+)?(?:\.(\d+))?([dfsx%])")
UTF16_MARK = b"\xfe\xff"
UTF8_MARK = b"\xef\xbb\xbf"
DISPLAY = {"visible": 0.0, "hidden": 1.0, "noPrint": 2.0, "noView": 3.0}
COLOURS = {
    "transparent": ["T"],
    "black": ["G", 0.0],
    "white": ["G", 1.0],
    "red": ["RGB", 1.0, 0.0, 0.0],
    "green": ["RGB", 0.0, 1.0, 0.0],
    "blue": ["RGB", 0.0, 0.0, 1.0],
    "cyan": ["CMYK", 1.0, 0.0, 0.0, 0.0],
    "magenta": ["CMYK", 0.0, 1.0, 0.0, 0.0],
    "yellow": ["CMYK", 0.0, 0.0, 1.0, 0.0],
    "dkGray": ["G", 0.25],
    "gray": ["G", 0.5],
    "ltGray": ["G", 0.75],
}
AGGREGATES = ("SUM", "AVG", "PRD", "MIN", "MAX")
MAX_PICTURE = 256
DATE_FORMATS = (
    "m/d",
    "m/d/yy",
    "mm/dd/yy",
    "mm/yy",
    "d-mmm",
    "d-mmm-yy",
    "dd-mmm-yy",
    "yy-mm-dd",
    "mmm-yy",
    "mmmm-yy",
    "mmm d, yyyy",
    "mmmm d, yyyy",
    "m/d/yy h:MM tt",
    "m/d/yy HH:MM",
)
TIME_FORMATS = ("HH:MM", "h:MM tt", "HH:MM:ss", "h:MM:ss tt")
SPECIAL_FORMATS = {0: "99999", 1: "99999-9999", 3: "999-99-9999"}
PHONE_FORMATS = ("999-9999", "(999) 999-9999")
KEYSTROKE_HANDLERS = (
    "AFNumber_Keystroke",
    "AFPercent_Keystroke",
    "AFDate_Keystroke",
    "AFDate_KeystrokeEx",
    "AFTime_Keystroke",
    "AFSpecial_Keystroke",
    "AFSpecial_KeystrokeEx",
)
MASK_ACCEPTS = {
    "?": lambda character: True,
    "X": str.isalnum,
    "A": str.isalpha,
    "9": lambda character: character.isascii() and character.isdigit(),
}


@dataclass(frozen=True)
class Calculation:
    status: str
    raw: str = ""
    number: float | None = None


FAILED = Calculation("failed")
KEPT = Calculation("kept")


def text_number(text: str) -> float | None:
    candidate = text.strip().replace(",", ".", 1)
    if not candidate or not PLAIN_NUMBER.fullmatch(candidate):
        return None
    number = float(candidate)
    return number if math.isfinite(number) else None


def typed_value(raw: str) -> Any:
    number = text_number(raw)
    return raw if number is None else number


def _decimals(value: Any) -> int:
    return int(min(max(to_integer(value), 0.0), MAX_DECIMALS))


def converted(value: Any) -> tuple[str, float | None]:
    if isinstance(value, float):
        return number_to_string(value), value if math.isfinite(value) else None
    if value is None or value is UNDEFINED:
        return "", None
    text = to_string(value)
    return text, text_number(text) if isinstance(value, str) else None


def _native(name: str, call: Any) -> NativeFunction:
    return NativeFunction(name, call)


def _ignored(_this: Any, _args: list[Any]) -> Any:
    return UNDEFINED


def _printf_value(
    conversion: str, style: int, flags: str, precision: str | None, value: Any
) -> str:
    if conversion == "s":
        return to_string(value)
    if conversion == "x":
        return format(to_uint32(value), "x")
    number = to_number(value)
    if not math.isfinite(number):
        return number_to_string(number)
    group, point = SEPARATORS.get(style, SEPARATORS[1])
    if conversion == "d":
        digits, fraction = str(abs(int(to_integer(number)))), ""
    else:
        places = DEFAULT_PRECISION if precision is None else int(precision)
        digits, _, fraction = to_fixed(abs(number), places).partition(".")
    body = group_digits(group, digits) + (point + fraction if fraction else "")
    if number < 0 and (digits.strip("0") or fraction.strip("0")):
        return "-" + body
    if "+" in flags:
        return "+" + body
    return " " + body if " " in flags else body


def _picture(value: Any) -> str:
    picture = printd_picture(value)
    if len(picture) > MAX_PICTURE:
        raise throw_error("RangeError", "date format too long")
    return picture


def print_masked(picture: str, source: str) -> str:
    output: list[str] = []
    case = "="
    index = 0
    position = 0
    while position < len(picture):
        character = picture[position]
        position += 1
        if character in MASK_ACCEPTS:
            accepts = MASK_ACCEPTS[character]
            while index < len(source) and not accepts(source[index]):
                index += 1
            if index < len(source):
                output.append(source[index])
                index += 1
        elif character == "*":
            output.append(source[index:])
            index = len(source)
        elif character in "<>=":
            case = character
            continue
        elif character == "\\":
            output.append(picture[position : position + 1])
            position += 1
        else:
            output.append(character)
        if case != "=" and output:
            output[-1] = output[-1].upper() if case == ">" else output[-1].lower()
    return checked_string("".join(output))


def printf(format_text: str, values: list[Any]) -> str:
    output: list[str] = []
    position = 0
    index = 0
    total = 0
    for match in PRINTF.finditer(format_text):
        output.append(format_text[position : match.start()])
        position = match.end()
        separator, flags, width, precision, conversion = match.groups()
        if conversion == "%":
            output.append("%")
            continue
        style = int(separator) if separator is not None else 1
        text = _printf_value(conversion, style, flags, precision, argument(values, index))
        index += 1
        size = min(int(width or 0), MAX_WIDTH)
        if len(text) < size:
            if "0" in flags and conversion != "s":
                sign = text[0] if text[:1] in "+- " and text else ""
                text = sign + text[len(sign) :].rjust(size - len(sign), "0")
            else:
                text = text.rjust(size)
        total += len(output[-1]) + len(text)
        if total > MAX_STRING:
            raise ScriptLimit("string too long")
        output.append(text)
    output.append(format_text[position:])
    return checked_string("".join(output))


class FieldObject(JSObject):
    def __init__(self, host: "FormScripts", name: str) -> None:
        super().__init__()
        self.host = host
        self.name = name

    def get(self, key: str) -> Any:
        if key == "value":
            return self.host.field_value(self.name)
        if key == "valueAsString":
            return self.host.values.get(self.name, "")
        if key == "name":
            return self.name
        if key == "getArray":
            return _native("getArray", lambda _this, _args: self.host.children(self))
        return super().get(key)

    def put(self, key: str, value: Any) -> None:
        if key == "value":
            self.host.set_value(self.name, value)
        else:
            super().put(key, value)

    def has(self, key: str) -> bool:
        return key in ("value", "valueAsString", "name", "getArray") or super().has(key)


class FormScripts:
    def __init__(
        self, document: pymupdf.Document, values: dict[str, str], names: DateNames = ENGLISH
    ) -> None:
        self.document = document
        self.values = values
        self.names = names
        self.changed: dict[str, tuple[str, float | None]] = {}
        self.fields: dict[str, FieldObject] = {}
        self.budget = Budget(DOCUMENT_STEPS, DOCUMENT_MEMORY)
        self.loaded = False
        self.writable = True
        self.interpreter = Interpreter()
        get_field = _native("getField", self._get_field)
        document_object = JSObject(
            {
                "getField": get_field,
                "calculateNow": _native("calculateNow", _ignored),
                "numFields": float(len(values)),
                "calculate": True,
            }
        )
        definitions: dict[str, Any] = {
            "this": document_object,
            "getField": get_field,
            "app": JSObject(
                {
                    "alert": _native("alert", lambda _this, _args: 1.0),
                    "beep": _native("beep", _ignored),
                    "viewerType": "Exchange-Pro",
                    "viewerVersion": 11.0,
                    "formsVersion": 11.0,
                    "platform": "WIN",
                    "language": names.acrobat,
                }
            ),
            "console": JSObject({name: _native(name, _ignored) for name in ("println", "show")}),
            "display": JSObject(DISPLAY),
            "color": JSObject({name: JSArray(value) for name, value in COLOURS.items()}),
            "util": JSObject(
                {
                    "printf": _native(
                        "printf",
                        lambda _this, args: printf(to_string(argument(args, 0)), args[1:]),
                    ),
                    "printd": _native("printd", self._printd),
                    "scand": _native("scand", self._scand),
                    "printx": _native(
                        "printx",
                        lambda _this, args: print_masked(
                            to_string(argument(args, 0)), to_string(argument(args, 1))
                        ),
                    ),
                }
            ),
            "event": JSObject({"name": "Open", "type": "Doc", "rc": True}),
            "AFSimple_Calculate": _native("AFSimple_Calculate", self._simple_calculate),
            "AFMakeNumber": _native("AFMakeNumber", self._make_number),
            "AFNumber_Format": _native("AFNumber_Format", self._number_format),
            "AFPercent_Format": _native("AFPercent_Format", self._percent_format),
            "AFDate_FormatEx": _native("AFDate_FormatEx", self._format_pictured),
            "AFDate_Format": _native(
                "AFDate_Format", lambda _this, args: self._format_listed(DATE_FORMATS, args)
            ),
            "AFTime_FormatEx": _native("AFTime_FormatEx", self._format_pictured),
            "AFTime_Format": _native(
                "AFTime_Format", lambda _this, args: self._format_listed(TIME_FORMATS, args)
            ),
            "AFSpecial_Format": _native("AFSpecial_Format", self._special_format),
            "AFRange_Validate": _native("AFRange_Validate", self._range_validate),
            **{name: _native(name, _ignored) for name in KEYSTROKE_HANDLERS},
        }
        for name, value in definitions.items():
            self.interpreter.define(name, value)

    def field(self, name: str) -> FieldObject:
        if name not in self.fields:
            self.fields[name] = FieldObject(self, name)
        return self.fields[name]

    def _names(self, name: str) -> list[str]:
        if name in self.values:
            return [name]
        prefix = f"{name}."
        return [key for key in self.values if key.startswith(prefix)]

    def _get_field(self, _this: Any, args: list[Any]) -> Any:
        name = to_string(argument(args, 0))
        return self.field(name) if self._names(name) else None

    def children(self, parent: FieldObject) -> JSArray:
        prefix = f"{parent.name}."
        names = sorted(key for key in self.values if key.startswith(prefix))
        return JSArray([self.field(name) for name in names] or [parent])

    def field_value(self, name: str) -> Any:
        return typed_value(self.values.get(name, ""))

    def set_value(self, name: str, value: Any) -> None:
        if not self.writable or name not in self.values:
            return
        raw, number = converted(value)
        self.values[name] = raw
        self.changed[name] = (raw, number)

    def take_changes(self) -> dict[str, tuple[str, float | None]]:
        changes, self.changed = self.changed, {}
        return changes

    def _field_names(self, listing: Any) -> list[str]:
        if isinstance(listing, JSArray):
            return [to_string(item) for item in listing.items]
        return [part.strip() for part in to_string(listing).split(",") if part.strip()]

    def _simple_calculate(self, _this: Any, args: list[Any]) -> Any:
        operation = to_string(argument(args, 0)).upper()
        if operation not in AGGREGATES:
            return UNDEFINED
        numbers = [
            make_number(self.values[key])
            for name in self._field_names(argument(args, 1))
            for key in self._names(name)
        ]
        if not numbers:
            result = 0.0
        elif operation == "SUM":
            result = math.fsum(numbers)
        elif operation == "AVG":
            result = math.fsum(numbers) / len(numbers)
        elif operation == "PRD":
            result = math.prod(numbers)
        else:
            result = min(numbers) if operation == "MIN" else max(numbers)
        event = self.interpreter.globals.names.get("event")
        if isinstance(event, JSObject):
            event.put("value", result)
        return UNDEFINED

    def _event(self) -> JSObject | None:
        event = self.interpreter.globals.names.get("event")
        return event if isinstance(event, JSObject) else None

    def _printd(self, _this: Any, args: list[Any]) -> str:
        date = argument(args, 1)
        if not isinstance(date, DateObject):
            raise throw_error("TypeError", "util.printd needs a date")
        return print_date(_picture(argument(args, 0)), date.time, self.names)

    def _scand(self, _this: Any, args: list[Any]) -> Any:
        scanned = scan_date(_picture(argument(args, 0)), to_string(argument(args, 1)), self.names)
        return None if scanned is None else DateObject(scanned)

    def _format_date(self, picture: str) -> Any:
        event = self._event()
        if event is None:
            return UNDEFINED
        text = to_string(event.get("value"))
        if text:
            parsed = guess_date(picture, text, self.names)
            if parsed is not None:
                event.put("value", print_date(picture, parsed, self.names))
        return UNDEFINED

    def _format_pictured(self, _this: Any, args: list[Any]) -> Any:
        return self._format_date(_picture(argument(args, 0)))

    def _format_listed(self, pictures: tuple[str, ...], args: list[Any]) -> Any:
        index = to_integer(argument(args, 0))
        if 0 <= index < len(pictures):
            self._format_date(pictures[int(index)])
        return UNDEFINED

    def _event_number(self, event: JSObject) -> float | None:
        number = self._make_number(None, [event.get("value")])
        return number if isinstance(number, float) and math.isfinite(number) else None

    def _number_format(self, _this: Any, args: list[Any]) -> Any:
        event = self._event()
        if event is None:
            return UNDEFINED
        number = self._event_number(event)
        if number is None:
            event.put("value", "")
            return UNDEFINED
        currency = argument(args, 4)
        display = number_display(
            number,
            _decimals(argument(args, 0)),
            int(to_integer(argument(args, 1))),
            int(to_integer(argument(args, 2))),
            "" if currency is UNDEFINED else to_string(currency),
            to_boolean(argument(args, 5)),
        )
        event.put("value", display)
        return UNDEFINED

    def _percent_format(self, _this: Any, args: list[Any]) -> Any:
        event = self._event()
        if event is None:
            return UNDEFINED
        number = self._event_number(event)
        if number is None:
            event.put("value", "")
            return UNDEFINED
        style = int(to_integer(argument(args, 1)))
        event.put("value", percent_display(number, _decimals(argument(args, 0)), style))
        return UNDEFINED

    def _special_format(self, _this: Any, args: list[Any]) -> Any:
        event = self._event()
        if event is None:
            return UNDEFINED
        value = to_string(event.get("value"))
        if not value:
            return UNDEFINED
        kind = to_integer(argument(args, 0))
        if kind == 2:
            picture = PHONE_FORMATS[len(print_masked("9999999999", value)) >= 10]
        elif kind in SPECIAL_FORMATS:
            picture = SPECIAL_FORMATS[int(kind)]
        else:
            raise throw_error("Error", "invalid psf in AFSpecial_Format")
        event.put("value", print_masked(picture, value))
        return UNDEFINED

    def _range_validate(self, _this: Any, args: list[Any]) -> Any:
        event = self._event()
        if event is None or to_string(event.get("value")) == "":
            return UNDEFINED
        number = self._event_number(event)
        if number is None:
            return UNDEFINED
        too_low = to_boolean(argument(args, 0)) and number < to_number(argument(args, 1))
        too_high = to_boolean(argument(args, 2)) and number > to_number(argument(args, 3))
        if too_low or too_high:
            event.put("rc", False)
        return UNDEFINED

    def _make_number(self, _this: Any, args: list[Any]) -> Any:
        value = argument(args, 0)
        if isinstance(value, float):
            return value
        if isinstance(value, str):
            return text_number(value)
        return None

    def _run(self, source: str, isolated: bool) -> None:
        limit = min(SCRIPT_STEPS, self.budget.steps)
        if limit <= 0:
            raise ScriptError("document script budget spent")
        program = parse(source)
        script_budget = Budget(limit, self.budget.memory)
        try:
            self.interpreter.run(program, script_budget, isolated)
        finally:
            self.budget.steps -= limit - max(script_budget.steps, 0)
            self.budget.memory = script_budget.memory

    def _load(self) -> None:
        self.loaded = True
        for source in document_scripts(self.document):
            try:
                self._run(source, isolated=False)
            except (ScriptError, JSThrow):
                continue

    def _field_event(self, name: str, kind: str, value: Any) -> JSObject:
        return JSObject(
            {
                "name": kind,
                "type": "Field",
                "value": value,
                "rc": True,
                "target": self.field(name),
                "targetName": name,
                "source": UNDEFINED,
                "willCommit": kind != "Calculate",
                "change": "",
            }
        )

    def _dispatch(self, event: JSObject, script: str, writable: bool) -> bool:
        if not self.loaded:
            self._load()
        self.interpreter.define("event", event)
        self.writable = writable
        try:
            self._run(script, isolated=True)
        except (ScriptError, JSThrow):
            return False
        finally:
            self.writable = True
        return True

    def format(self, name: str, script: str) -> str | None:
        event = self._field_event(name, "Format", self.field_value(name))
        if not self._dispatch(event, script, writable=False):
            return None
        try:
            return converted(event.get("value"))[0]
        except RecursionError:
            return None

    def validate(self, name: str, script: str, raw: str) -> bool:
        event = self._field_event(name, "Validate", typed_value(raw))
        if not self._dispatch(event, script, writable=False):
            return True
        return to_boolean(event.get("rc"))

    def calculate(self, name: str, script: str) -> Calculation:
        event = self._field_event(name, "Calculate", self.field_value(name))
        if not self._dispatch(event, script, writable=True):
            return FAILED
        if not to_boolean(event.get("rc")):
            return KEPT
        value = event.get("value")
        if isinstance(value, float) and not math.isfinite(value):
            return FAILED
        try:
            raw, number = converted(value)
        except RecursionError:
            return FAILED
        return Calculation("value", raw, number)


def _decoded(data: bytes) -> str:
    if data.startswith(UTF16_MARK):
        return data[len(UTF16_MARK) :].decode("utf-16-be", errors="replace")
    if data.startswith(UTF8_MARK):
        return data[len(UTF8_MARK) :].decode("utf-8", errors="replace")
    return script_text(data.decode("latin-1"))


def _action_script(action: Any) -> str | None:
    mupdf = pymupdf.mupdf
    if not mupdf.pdf_is_dict(action):
        return None
    code = mupdf.pdf_dict_gets(action, "JS")
    if mupdf.pdf_is_string(code):
        return mupdf.pdf_to_text_string(code)
    if not mupdf.pdf_is_stream(code):
        return None
    data = stream_prefix(code, 2 * MAX_SOURCE + len(UTF16_MARK))
    return None if data is None else _decoded(data)


def field_script(document: pymupdf.Document, xref: int, event_key: str) -> str | None:
    mupdf = pymupdf.mupdf
    try:
        pdf = pymupdf._as_pdf_document(document)
        for number in dict.fromkeys((xref, field_holder(document, xref))):
            holder = mupdf.pdf_new_indirect(pdf, number, 0)
            script = _action_script(mupdf.pdf_dict_getp(holder, f"AA/{event_key}"))
            if script:
                return script
    except Exception:
        return None
    return None


def document_scripts(document: pymupdf.Document) -> list[str]:
    scripts: list[str] = []
    try:
        for action in name_tree_values(document, "Names/JavaScript"):
            if len(scripts) >= MAX_DOCUMENT_SCRIPTS:
                break
            script = _action_script(action)
            if script:
                scripts.append(script)
    except Exception:
        return scripts
    return scripts
