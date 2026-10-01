import json
import math
import re
from typing import TYPE_CHECKING, Any

from vivepdf.ops._js_values import (
    MAX_STRING,
    UNDEFINED,
    JSArray,
    JSFunction,
    JSObject,
    NativeFunction,
    ScriptLimit,
    allocate,
    checked_string,
    number_to_string,
    throw_error,
    to_integer,
    to_number,
    to_string,
)

if TYPE_CHECKING:
    from vivepdf.ops._js_interpreter import Interpreter

MAX_GAP = 10
TEXT_STEP = 64
ESCAPED = re.compile(r'["\\\x00-\x1f]')
SHORT_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
}


def _escape(match: re.Match[str]) -> str:
    character = match.group()
    return SHORT_ESCAPES.get(character) or f"\\u{ord(character):04x}"


def quote(text: str) -> str:
    return '"' + ESCAPED.sub(_escape, text) + '"'


def _callable(value: Any) -> bool:
    return isinstance(value, JSFunction | NativeFunction)


def _refuse_constant(name: str) -> Any:
    raise ValueError(f"unexpected token {name}")


def _script_value(value: Any) -> Any:
    if isinstance(value, list):
        return JSArray([_script_value(item) for item in value])
    if isinstance(value, str):
        allocate(len(value))
    return value


def _script_object(pairs: list[tuple[str, Any]]) -> JSObject:
    result = JSObject()
    for key, value in pairs:
        result.put(key, _script_value(value))
    return result


class Json:
    def __init__(self, interpreter: "Interpreter") -> None:
        self.interpreter = interpreter

    def spend(self, amount: int) -> None:
        self.interpreter.builtins.spend(amount)

    def parse(self, text: str, reviver: Any) -> Any:
        self.spend(len(text) // TEXT_STEP)
        try:
            value = json.loads(
                text,
                object_pairs_hook=_script_object,
                parse_int=float,
                parse_float=float,
                parse_constant=_refuse_constant,
            )
            result = _script_value(value)
        except RecursionError as error:
            raise ScriptLimit("JSON nested too deeply") from error
        except ValueError as error:
            raise throw_error("SyntaxError", f"JSON.parse: {error}") from error
        if not _callable(reviver):
            return result
        return self._revive(JSObject({"": result}), "", reviver)

    def _revive(self, holder: JSObject, key: str, reviver: Any) -> Any:
        self.interpreter.budget.step()
        value = self.interpreter.get_member(holder, key)
        if isinstance(value, JSObject):
            keys = (
                [str(index) for index in range(len(value.items))]
                if isinstance(value, JSArray)
                else value.keys()
            )
            for name in keys:
                revived = self._revive(value, name, reviver)
                if revived is UNDEFINED:
                    value.remove(name)
                else:
                    value.put(name, revived)
        return self.interpreter.call(reviver, holder, [key, value])

    def stringify(self, value: Any, replacer: Any, space: Any) -> Any:
        writer = _Writer(self.interpreter, replacer, _gap(space))
        text = writer.serialize(JSObject({"": value}), "", "")
        return UNDEFINED if text is None else checked_string(text)


def _gap(space: Any) -> str:
    if isinstance(space, float):
        return " " * int(max(0.0, min(float(MAX_GAP), to_integer(space))))
    if isinstance(space, str):
        return space[:MAX_GAP]
    return ""


class _Writer:
    def __init__(self, interpreter: "Interpreter", replacer: Any, gap: str) -> None:
        self.interpreter = interpreter
        self.gap = gap
        self.function = replacer if _callable(replacer) else None
        self.names: list[str] | None = None
        if isinstance(replacer, JSArray):
            self.names = []
            for item in replacer.items:
                if isinstance(item, str | float):
                    name = to_string(item)
                    if name not in self.names:
                        self.names.append(name)
        self.stack: list[JSObject] = []
        self.length = 0

    def counted(self, text: str) -> str:
        self.length += len(text)
        if self.length > MAX_STRING:
            raise ScriptLimit("string too long")
        return text

    def serialize(self, holder: JSObject, key: str, indent: str) -> str | None:
        self.interpreter.budget.step()
        value = self.interpreter.get_member(holder, key)
        if isinstance(value, JSObject):
            to_json = self.interpreter.get_member(value, "toJSON")
            if _callable(to_json):
                value = self.interpreter.call(to_json, value, [key])
        if self.function is not None:
            value = self.interpreter.call(self.function, holder, [key, value])
        if value is None:
            return self.counted("null")
        if isinstance(value, bool):
            return self.counted("true" if value else "false")
        if isinstance(value, str):
            return self.counted(quote(value))
        if isinstance(value, float):
            return self.counted(number_to_string(value) if math.isfinite(value) else "null")
        if isinstance(value, JSObject) and not _callable(value):
            if any(entry is value for entry in self.stack):
                raise throw_error("TypeError", "JSON.stringify cannot serialize a cyclic structure")
            self.stack.append(value)
            try:
                if isinstance(value, JSArray):
                    return self._array(value, indent)
                return self._object(value, indent)
            finally:
                self.stack.pop()
        return None

    def _wrapped(self, parts: list[str], indent: str, inner: str, brackets: str) -> str:
        if not parts:
            return self.counted(brackets)
        if not self.gap:
            text = brackets[0] + ",".join(parts) + brackets[1]
        else:
            separator = ",\n" + inner
            text = f"{brackets[0]}\n{inner}{separator.join(parts)}\n{indent}{brackets[1]}"
        self.counted(" " * (len(text) - sum(len(part) for part in parts)))
        return text

    def _object(self, value: JSObject, indent: str) -> str:
        inner = indent + self.gap
        parts = []
        colon = ": " if self.gap else ":"
        for name in self.names if self.names is not None else value.keys():
            text = self.serialize(value, name, inner)
            if text is not None:
                parts.append(self.counted(quote(name) + colon) + text)
        return self._wrapped(parts, indent, inner, "{}")

    def _array(self, value: JSArray, indent: str) -> str:
        inner = indent + self.gap
        size = int(to_number(value.get("length")))
        parts = []
        for index in range(size):
            text = self.serialize(value, str(index), inner)
            parts.append(self.counted("null") if text is None else text)
        return self._wrapped(parts, indent, inner, "[]")
