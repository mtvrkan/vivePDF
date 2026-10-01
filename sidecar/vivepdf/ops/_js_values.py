import math
import re
from collections.abc import Callable
from contextvars import ContextVar
from decimal import ROUND_HALF_UP, Context, Decimal
from typing import Any

MAX_STRING = 1 << 20
MAX_ITEMS = 100_000
MAX_FIXED_DIGITS = 100
DECIMAL_LITERAL = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
HEX_LITERAL = re.compile(r"[+-]?0[xX][0-9a-fA-F]+")
INFINITY_LITERAL = re.compile(r"[+-]?Infinity")
INT32 = 1 << 32
PROPERTY_COST = 64
WIDE_DECIMALS = Context(prec=400)
SLOT_COST = 16
MAX_PROTOTYPE_DEPTH = 64
READ_ONLY = 1
HIDDEN = 2
FIXED = 4


class ScriptError(Exception):
    pass


class ScriptLimit(ScriptError):
    pass


class _Undefined:
    __slots__ = ()

    def __repr__(self) -> str:
        return "undefined"


UNDEFINED = _Undefined()


class Budget:
    def __init__(self, steps: int, memory: int) -> None:
        self.steps = steps
        self.memory = memory

    def step(self) -> None:
        self.steps -= 1
        if self.steps < 0:
            raise ScriptLimit("script ran too long")

    def allocate(self, amount: int) -> None:
        self.memory -= amount
        if self.memory < 0:
            raise ScriptLimit("script used too much memory")


ACTIVE_BUDGET: ContextVar[Budget | None] = ContextVar("active_budget", default=None)


def allocate(amount: int) -> None:
    budget = ACTIVE_BUDGET.get()
    if budget is not None:
        budget.allocate(amount)


class Accessor:
    __slots__ = ("getter", "setter")

    def __init__(self) -> None:
        self.getter: Any = None
        self.setter: Any = None


class JSObject:
    type_name = "object"
    attributes: dict[str, int] | None = None
    extensible = True
    bare = False

    def __init__(
        self, properties: dict[str, Any] | None = None, proto: "JSObject | None" = None
    ) -> None:
        self.properties: dict[str, Any] = dict(properties or {})
        self.proto = proto
        self.depth = 0 if proto is None else proto.depth + 1
        if self.depth > MAX_PROTOTYPE_DEPTH:
            raise throw_error("RangeError", "prototype chain too long")
        if proto is not None and proto.bare:
            self.bare = True

    def flags(self, key: str) -> int:
        return 0 if self.attributes is None else self.attributes.get(key, 0)

    def set_flags(self, key: str, flags: int) -> None:
        if self.attributes is None:
            if not flags:
                return
            self.attributes = {}
        if flags:
            self.attributes[key] = flags
        else:
            self.attributes.pop(key, None)

    def owner(self, key: str) -> "JSObject | None":
        holder: JSObject | None = self
        while holder is not None:
            if holder.has(key):
                return holder
            holder = holder.proto
        return None

    def has_property(self, key: str) -> bool:
        return self.owner(key) is not None

    def all_keys(self) -> list[str]:
        keys = self.keys()
        seen = set(self.own_keys())
        holder = self.proto
        while holder is not None:
            inherited = holder.keys()
            for key in inherited:
                if key not in seen:
                    keys.append(key)
            seen.update(holder.own_keys())
            holder = holder.proto
        return keys

    def get(self, key: str) -> Any:
        return self.properties.get(key, UNDEFINED)

    def put(self, key: str, value: Any) -> None:
        if key not in self.properties:
            if len(self.properties) >= MAX_ITEMS:
                raise ScriptLimit("too many properties")
            allocate(PROPERTY_COST)
        self.properties[key] = value

    def has(self, key: str) -> bool:
        return key in self.properties

    def remove(self, key: str) -> bool:
        if self.flags(key) & FIXED:
            return False
        self.properties.pop(key, None)
        self.set_flags(key, 0)
        return True

    def keys(self) -> list[str]:
        if not self.attributes:
            return list(self.properties)
        return [key for key in self.properties if not self.flags(key) & HIDDEN]

    def own_keys(self) -> list[str]:
        return list(self.properties)

    def enumerable(self, key: str) -> bool:
        return self.has(key) and not self.flags(key) & HIDDEN

    def default_value(self) -> Any:
        return "[object Object]"

    def number_value(self) -> Any:
        return self.default_value()


class ErrorObject(JSObject):
    def __init__(self, name: str, message: str) -> None:
        super().__init__({"name": name, "message": message})
        self.attributes = {"name": HIDDEN, "message": HIDDEN}

    def default_value(self) -> Any:
        name, message = to_string(self.get("name")), to_string(self.get("message"))
        return f"{name}: {message}" if message else name


class JSArray(JSObject):
    def __init__(self, items: list[Any] | None = None) -> None:
        super().__init__()
        self.items: list[Any] = list(items or [])
        if len(self.items) > MAX_ITEMS:
            raise ScriptLimit("array too long")
        allocate(len(self.items) * SLOT_COST)

    def get(self, key: str) -> Any:
        if key == "length":
            return float(len(self.items))
        index = array_index(key)
        if index is not None:
            return self.items[index] if index < len(self.items) else UNDEFINED
        return super().get(key)

    def put(self, key: str, value: Any) -> None:
        if key == "length":
            size = to_number(value)
            if not size.is_integer() or size < 0:
                raise throw_error("RangeError", "invalid array length")
            self.resize(int(size))
            return
        index = array_index(key)
        if index is None:
            super().put(key, value)
            return
        if index >= len(self.items):
            self.resize(index + 1)
        self.items[index] = value

    def remove(self, key: str) -> bool:
        index = array_index(key)
        if index is not None and index < len(self.items):
            if self.flags(key) & FIXED:
                return False
            self.items[index] = UNDEFINED
            return True
        return super().remove(key)

    def has(self, key: str) -> bool:
        index = array_index(key)
        if key == "length" or (index is not None and index < len(self.items)):
            return True
        return super().has(key)

    def resize(self, size: int) -> None:
        if size > MAX_ITEMS:
            raise ScriptLimit("array too long")
        allocate(max(0, size - len(self.items)) * SLOT_COST)
        del self.items[size:]
        self.items.extend([UNDEFINED] * (size - len(self.items)))

    def keys(self) -> list[str]:
        return [str(index) for index in range(len(self.items))] + super().keys()

    def own_keys(self) -> list[str]:
        return [str(index) for index in range(len(self.items))] + ["length", *super().own_keys()]

    def enumerable(self, key: str) -> bool:
        return key != "length" and super().enumerable(key)

    def default_value(self) -> Any:
        return join_items(self.items, ",")


class JSFunction(JSObject):
    type_name = "function"

    def __init__(self, name: str | None, params: list[str], body: list, scope: Any) -> None:
        super().__init__()
        self.name = name
        self.params = params
        self.body = body
        self.scope = scope

    def get(self, key: str) -> Any:
        if key == "prototype" and key not in self.properties:
            self.put(key, JSObject({"constructor": self}))
        return super().get(key)

    def has(self, key: str) -> bool:
        return key == "prototype" or super().has(key)

    def default_value(self) -> Any:
        return f"function {self.name or ''}() {{ [code] }}"


class NativeFunction(JSObject):
    type_name = "function"

    def __init__(
        self,
        name: str,
        call: Callable[[Any, list[Any]], Any],
        construct: Callable[[list[Any]], Any] | None = None,
    ) -> None:
        super().__init__()
        self.name = name
        self.call = call
        self.construct = construct

    def default_value(self) -> Any:
        return f"function {self.name}() {{ [native code] }}"


class JSThrow(Exception):
    def __init__(self, value: Any) -> None:
        super().__init__(to_string(value) if not isinstance(value, JSObject) else value.type_name)
        self.value = value


def throw_error(name: str, message: str) -> JSThrow:
    return JSThrow(ErrorObject(name, message))


def array_index(key: str) -> int | None:
    if key.isascii() and key.isdigit() and (key == "0" or key[0] != "0"):
        return int(key)
    return None


def checked_string(text: str) -> str:
    if len(text) > MAX_STRING:
        raise ScriptLimit("string too long")
    allocate(len(text))
    return text


def join_items(items: list[Any], separator: str) -> str:
    parts = []
    total = 0
    for item in items:
        part = "" if item is None or item is UNDEFINED else to_string(item)
        total += len(part) + len(separator)
        if total > MAX_STRING:
            raise ScriptLimit("string too long")
        parts.append(part)
    allocate(total)
    return separator.join(parts)


def to_boolean(value: Any) -> bool:
    if value is UNDEFINED or value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return not (value == 0 or math.isnan(value))
    if isinstance(value, str):
        return value != ""
    return True


def to_primitive(value: Any) -> Any:
    return value.default_value() if isinstance(value, JSObject) else value


def _string_to_number(text: str) -> float:
    text = text.strip()
    if not text:
        return 0.0
    if DECIMAL_LITERAL.fullmatch(text):
        return float(text)
    if HEX_LITERAL.fullmatch(text) and text[0] not in "+-":
        return float(int(text, 16))
    if INFINITY_LITERAL.fullmatch(text):
        return -math.inf if text[0] == "-" else math.inf
    return math.nan


def to_number(value: Any) -> float:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, float):
        return value
    if value is UNDEFINED:
        return math.nan
    if value is None:
        return 0.0
    if isinstance(value, str):
        return _string_to_number(value)
    return to_number(numeric_primitive(value))


def to_integer(value: Any) -> float:
    number = to_number(value)
    if math.isnan(number):
        return 0.0
    if math.isinf(number):
        return number
    return float(math.trunc(number))


def to_int32(value: Any) -> int:
    number = to_number(value)
    if math.isnan(number) or math.isinf(number):
        return 0
    result = math.trunc(number) % INT32
    return result - INT32 if result >= INT32 // 2 else result


def to_uint32(value: Any) -> int:
    return to_int32(value) % INT32


def number_to_string(value: float) -> str:
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    if value == 0:
        return "0"
    mantissa, _, exponent = repr(abs(value)).partition("e")
    whole, _, fraction = mantissa.partition(".")
    combined = whole + fraction
    significant = combined.lstrip("0")
    point = len(whole) + int(exponent or 0) - (len(combined) - len(significant))
    digits = significant.rstrip("0") or "0"
    count = len(digits)
    if count <= point <= 21:
        text = digits + "0" * (point - count)
    elif 0 < point <= 21:
        text = f"{digits[:point]}.{digits[point:]}"
    elif -6 < point <= 0:
        text = "0." + "0" * -point + digits
    else:
        power = point - 1
        body = digits[0] + (f".{digits[1:]}" if count > 1 else "")
        text = f"{body}e{'+' if power >= 0 else '-'}{abs(power)}"
    return f"-{text}" if value < 0 else text


def to_fixed(value: float, digits: int) -> str:
    if not 0 <= digits <= MAX_FIXED_DIGITS:
        raise throw_error("RangeError", "toFixed() digits out of range")
    if math.isnan(value) or math.isinf(value) or abs(value) >= 1e21:
        return number_to_string(value)
    quantum = Decimal(1).scaleb(-digits)
    exact = Decimal(abs(value))
    text = str(exact.quantize(quantum, rounding=ROUND_HALF_UP, context=WIDE_DECIMALS))
    return f"-{text}" if value < 0 else text


def to_string(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return number_to_string(value)
    if value is UNDEFINED:
        return "undefined"
    if value is None:
        return "null"
    return to_string(to_primitive(value))


def property_key(value: Any) -> str:
    return to_string(value)


def type_of(value: Any) -> str:
    if value is UNDEFINED:
        return "undefined"
    if value is None:
        return "object"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    return value.type_name


def same_value(left: Any, right: Any) -> bool:
    if isinstance(left, float) and isinstance(right, float):
        if math.isnan(left) and math.isnan(right):
            return True
        return left == right and math.copysign(1, left) == math.copysign(1, right)
    return strict_equals(left, right)


def strict_equals(left: Any, right: Any) -> bool:
    if isinstance(left, float) and isinstance(right, float):
        return left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, str | bool):
        return left == right
    return left is right


def loose_equals(left: Any, right: Any) -> bool:
    if type(left) is type(right) or (isinstance(left, float) and isinstance(right, float)):
        return strict_equals(left, right)
    nullish = (None, UNDEFINED)
    if left in nullish or right in nullish:
        return left in nullish and right in nullish
    if isinstance(left, bool):
        return loose_equals(to_number(left), right)
    if isinstance(right, bool):
        return loose_equals(left, to_number(right))
    if isinstance(left, float) and isinstance(right, str):
        return left == to_number(right)
    if isinstance(left, str) and isinstance(right, float):
        return to_number(left) == right
    if isinstance(left, JSObject) and not isinstance(right, JSObject):
        return loose_equals(to_primitive(left), right)
    if isinstance(right, JSObject) and not isinstance(left, JSObject):
        return loose_equals(left, to_primitive(right))
    return False


def numeric_primitive(value: Any) -> Any:
    return value.number_value() if isinstance(value, JSObject) else value


def less_than(left: Any, right: Any) -> bool | None:
    left, right = numeric_primitive(left), numeric_primitive(right)
    if isinstance(left, str) and isinstance(right, str):
        return left < right
    first, second = to_number(left), to_number(right)
    if math.isnan(first) or math.isnan(second):
        return None
    return first < second


def _divide(left: float, right: float) -> float:
    if right == 0:
        if left == 0 or math.isnan(left):
            return math.nan
        return math.copysign(math.inf, left) * math.copysign(1.0, right)
    return left / right


def _remainder(left: float, right: float) -> float:
    if math.isnan(left) or math.isnan(right) or math.isinf(left) or right == 0:
        return math.nan
    if math.isinf(right):
        return left
    return math.fmod(left, right)


def _shift(operator: str, left: Any, right: Any) -> float:
    count = to_uint32(right) & 31
    if operator == "<<":
        return float(to_int32(float((to_int32(left) << count) % INT32)))
    if operator == ">>":
        return float(to_int32(left) >> count)
    return float(to_uint32(left) >> count)


def _bitwise(operator: str, left: Any, right: Any) -> float:
    first, second = to_int32(left), to_int32(right)
    if operator == "&":
        return float(first & second)
    if operator == "|":
        return float(to_int32(float((first | second) % INT32)))
    return float(to_int32(float((first ^ second) % INT32)))


def _add(left: Any, right: Any) -> Any:
    left, right = to_primitive(left), to_primitive(right)
    if isinstance(left, str) or isinstance(right, str):
        first, second = to_string(left), to_string(right)
        if len(first) + len(second) > MAX_STRING:
            raise ScriptLimit("string too long")
        allocate(len(first) + len(second))
        return first + second
    return to_number(left) + to_number(right)


def _compare(operator: str, left: Any, right: Any) -> bool:
    if operator == "<":
        return less_than(left, right) is True
    if operator == ">":
        return less_than(right, left) is True
    if operator == "<=":
        return less_than(right, left) is False
    return less_than(left, right) is False


ARITHMETIC: dict[str, Callable[[float, float], float]] = {
    "-": lambda left, right: left - right,
    "*": lambda left, right: left * right,
    "/": _divide,
    "%": _remainder,
}


def binary_operation(operator: str, left: Any, right: Any) -> Any:
    if operator == "+":
        return _add(left, right)
    if operator in ARITHMETIC:
        return ARITHMETIC[operator](to_number(left), to_number(right))
    if operator in ("==", "!="):
        return loose_equals(left, right) == (operator == "==")
    if operator in ("===", "!=="):
        return strict_equals(left, right) == (operator == "===")
    if operator in ("<", ">", "<=", ">="):
        return _compare(operator, left, right)
    if operator in ("<<", ">>", ">>>"):
        return _shift(operator, left, right)
    if operator in ("&", "|", "^"):
        return _bitwise(operator, left, right)
    if operator == "in":
        if not isinstance(right, JSObject):
            raise throw_error("TypeError", "'in' needs an object")
        return right.has_property(property_key(left))
    raise ScriptError(f"unsupported operator {operator}")
