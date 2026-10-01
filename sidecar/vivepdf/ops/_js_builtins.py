import functools
import math
import re
from collections.abc import Callable
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING, Any

from vivepdf.ops import _js_regexp
from vivepdf.ops._js_date import (
    DateObject,
    construct_date,
    date_methods,
    date_text,
    now_ms,
    parse_date,
    utc_date,
)
from vivepdf.ops._js_json import Json
from vivepdf.ops._js_properties import ARRAY_MUTATORS, Properties, target_object
from vivepdf.ops._js_regexp import PatternError, RegExpObject, compile_pattern, pattern_source
from vivepdf.ops._js_values import (
    MAX_ITEMS,
    UNDEFINED,
    WIDE_DECIMALS,
    ErrorObject,
    JSArray,
    JSFunction,
    JSObject,
    NativeFunction,
    checked_string,
    join_items,
    number_to_string,
    strict_equals,
    throw_error,
    to_boolean,
    to_fixed,
    to_integer,
    to_number,
    to_string,
    to_uint32,
)

if TYPE_CHECKING:
    from vivepdf.ops._js_interpreter import Interpreter

STRING_STEP = 256
LINEAR_ARRAY_METHODS = frozenset(
    {"join", "toString", "indexOf", "lastIndexOf", "slice", "splice", "concat", "reverse", "sort"}
)
MAX_PRECISION = 100
DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"
FLOAT_PREFIX = re.compile(r"[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)")
ERROR_NAMES = ("Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError")
Native = Callable[[Any, list[Any]], Any]


def argument(args: list[Any], index: int) -> Any:
    return args[index] if index < len(args) else UNDEFINED


def _number_argument(args: list[Any], index: int) -> float:
    return to_number(argument(args, index))


def _relative(value: Any, length: int, default: int) -> int:
    if value is UNDEFINED:
        return default
    number = to_integer(value)
    if number < 0:
        return int(max(length + number, 0))
    return int(min(number, length))


def _signed_zero(result: float, source: float) -> float:
    return math.copysign(0.0, source) if result == 0 else result


def _unary_math(function: Callable[[float], float]) -> Native:
    def call(_this: Any, args: list[Any]) -> float:
        value = _number_argument(args, 0)
        try:
            return float(function(value))
        except OverflowError:
            return math.inf
        except ValueError:
            return math.nan

    return call


def _integral(function: Callable[[float], int]) -> Callable[[float], float]:
    def apply(value: float) -> float:
        if not math.isfinite(value):
            return value
        return _signed_zero(float(function(value)), value)

    return apply


def _round(value: float) -> float:
    if not math.isfinite(value):
        return value
    lower = math.floor(value)
    result = float(lower + 1 if value - lower >= 0.5 else lower)
    return math.copysign(0.0, value) if result == 0 else result


def _log(value: float) -> float:
    if value == 0:
        return -math.inf
    if value == math.inf:
        return math.inf
    return math.log(value)


def js_pow(base: float, exponent: float) -> float:
    if math.isnan(exponent):
        return math.nan
    if exponent == 0:
        return 1.0
    if math.isnan(base) or (abs(base) == 1 and math.isinf(exponent)):
        return math.nan
    odd = math.isfinite(exponent) and exponent.is_integer() and exponent % 2 == 1
    if base == 0:
        if exponent > 0:
            return math.copysign(0.0, base) if odd else 0.0
        return math.copysign(math.inf, base) if odd else math.inf
    try:
        return math.pow(base, exponent)
    except OverflowError:
        return -math.inf if base < 0 and odd else math.inf
    except ValueError:
        return math.nan


def _extreme(pick_larger: bool) -> Native:
    def call(_this: Any, args: list[Any]) -> float:
        result = -math.inf if pick_larger else math.inf
        for value in args:
            number = to_number(value)
            if math.isnan(number):
                return math.nan
            if (number > result) if pick_larger else (number < result):
                result = number
        return result

    return call


def parse_int(text: Any, radix: Any) -> float:
    source = to_string(text).strip()
    sign = -1.0 if source.startswith("-") else 1.0
    if source[:1] in "+-" and source:
        source = source[1:]
    base = int(to_integer(radix)) if radix is not UNDEFINED else 0
    if base == 0:
        base = 10
        if source[:2].lower() == "0x":
            base = 16
            source = source[2:]
    elif base == 16 and source[:2].lower() == "0x":
        source = source[2:]
    if not 2 <= base <= 36:
        return math.nan
    valid = DIGITS[:base]
    end = 0
    while end < len(source) and source[end].lower() in valid:
        end += 1
    if end == 0:
        return math.nan
    return sign * float(int(source[:end], base))


def parse_float(text: Any) -> float:
    match = FLOAT_PREFIX.match(to_string(text).strip())
    if match is None:
        return math.nan
    literal = match.group(0)
    if literal.lstrip("+-") == "Infinity":
        return -math.inf if literal[0] == "-" else math.inf
    return float(literal)


def to_precision(value: float, precision: int) -> str:
    if not math.isfinite(value):
        return number_to_string(value)
    if not 1 <= precision <= MAX_PRECISION:
        raise throw_error("RangeError", "toPrecision() argument out of range")
    sign = "-" if value < 0 else ""
    if value == 0:
        return "0" + ("." + "0" * (precision - 1) if precision > 1 else "")
    exact = Decimal(abs(value))
    exponent = exact.adjusted()
    quantum = Decimal(1).scaleb(-(precision - 1))
    mantissa = exact.scaleb(-exponent).quantize(
        quantum, rounding=ROUND_HALF_UP, context=WIDE_DECIMALS
    )
    if mantissa >= 10:
        exponent += 1
        mantissa = (mantissa / 10).quantize(quantum, context=WIDE_DECIMALS)
    digits = str(mantissa).replace(".", "")
    if exponent < -6 or exponent >= precision:
        body = digits[0] + ("." + digits[1:] if precision > 1 else "")
        return f"{sign}{body}e{'+' if exponent >= 0 else '-'}{abs(exponent)}"
    if exponent >= 0:
        whole, fraction = digits[: exponent + 1], digits[exponent + 1 :]
        return sign + whole + ("." + fraction if fraction else "")
    return f"{sign}0.{'0' * (-exponent - 1)}{digits}"


def to_radix(value: float, radix: int) -> str:
    if radix == 10 or not math.isfinite(value):
        return number_to_string(value)
    sign = "-" if value < 0 else ""
    value = abs(value)
    whole = int(value)
    fraction = value - whole
    text = ""
    while True:
        whole, digit = divmod(whole, radix)
        text = DIGITS[digit] + text
        if whole == 0:
            break
    if fraction:
        digits = []
        while fraction and len(digits) < 52:
            fraction *= radix
            digit = int(fraction)
            digits.append(DIGITS[digit])
            fraction -= digit
        text += "." + "".join(digits).rstrip("0")
    return sign + text.rstrip(".")


def _replace_pattern(replacement: str, matched: str, before: str, after: str) -> str:
    output = []
    index = 0
    while index < len(replacement):
        character = replacement[index]
        following = replacement[index + 1 : index + 2]
        if character == "$" and following in ("$", "&", "`", "'"):
            output.append({"$": "$", "&": matched, "`": before, "'": after}[following])
            index += 2
            continue
        output.append(character)
        index += 1
    return "".join(output)


class Builtins:
    def __init__(self, interpreter: "Interpreter") -> None:
        self.interpreter = interpreter
        self.properties = Properties(interpreter)
        self.json = Json(interpreter)
        self.constructors: dict[int, Callable[[Any], bool]] = {}
        self.string_methods = self._string_methods()
        self.number_methods = self._number_methods()
        self.boolean_methods = {
            "toString": self._native("toString", lambda this, _args: to_string(this)),
            "valueOf": self._native("valueOf", lambda this, _args: this),
        }
        self.array_methods = self._array_methods()
        self.regexp_methods = {
            "exec": self._native("exec", self._exec),
            "test": self._native("test", lambda this, args: self._exec(this, args) is not None),
            "toString": self._native("toString", lambda this, _args: to_string(this)),
        }
        self.date_methods = {
            name: self._date_method(name, body) for name, body in date_methods().items()
        }
        self.object_methods = {
            "hasOwnProperty": self._native(
                "hasOwnProperty",
                lambda this, args: (
                    isinstance(this, JSObject) and this.has(to_string(argument(args, 0)))
                ),
            ),
            "propertyIsEnumerable": self._native(
                "propertyIsEnumerable",
                lambda this, args: (
                    isinstance(this, JSObject) and this.enumerable(to_string(argument(args, 0)))
                ),
            ),
            "toString": self._native(
                "toString",
                lambda this, _args: to_string(this) if isinstance(this, JSObject) else "",
            ),
            "valueOf": self._native("valueOf", lambda this, _args: this),
        }
        self.function_methods = {
            "call": self._native(
                "call",
                lambda this, args: self.interpreter.call(this, argument(args, 0), args[1:]),
            ),
            "apply": self._native("apply", self._apply),
        }

    def spend(self, amount: int) -> None:
        budget = self.interpreter.budget
        budget.steps -= amount
        budget.step()

    def _native(
        self, name: str, call: Native, construct: Callable[[list[Any]], Any] | None = None
    ) -> NativeFunction:
        return NativeFunction(name, call, construct)

    def _object(self, members: dict[str, Any]) -> JSObject:
        return JSObject(members)

    def globals(self) -> dict[str, Any]:
        errors = {name: self._error_constructor(name) for name in ERROR_NAMES}
        array = self._native("Array", lambda _this, args: self._new_array(args), self._new_array)
        array.put(
            "isArray",
            self._native("isArray", lambda _this, args: isinstance(argument(args, 0), JSArray)),
        )
        self.constructors[id(array)] = lambda value: isinstance(value, JSArray)
        object_constructor = self._native(
            "Object", lambda _this, args: self._new_object(args), self._new_object
        )
        object_constructor.put("keys", self._native("keys", self._keys))
        object_constructor.put("create", self._native("create", self._create))
        object_constructor.put("getPrototypeOf", self._native("getPrototypeOf", self._prototype_of))
        for name, method in self._property_functions().items():
            object_constructor.put(name, self._native(name, method))
        self.constructors[id(object_constructor)] = lambda value: isinstance(value, JSObject)
        number = self._native(
            "Number",
            lambda _this, args: _number_argument(args, 0) if args else 0.0,
            lambda args: _number_argument(args, 0) if args else 0.0,
        )
        for key, value in {
            "MAX_VALUE": 1.7976931348623157e308,
            "MIN_VALUE": 5e-324,
            "NaN": math.nan,
            "POSITIVE_INFINITY": math.inf,
            "NEGATIVE_INFINITY": -math.inf,
            "isNaN": self._native(
                "isNaN",
                lambda _this, args: (
                    isinstance(argument(args, 0), float) and math.isnan(argument(args, 0))
                ),
            ),
            "isFinite": self._native(
                "isFinite",
                lambda _this, args: (
                    isinstance(argument(args, 0), float) and math.isfinite(argument(args, 0))
                ),
            ),
        }.items():
            number.put(key, value)
        string = self._native(
            "String",
            lambda _this, args: to_string(args[0]) if args else "",
            lambda args: to_string(args[0]) if args else "",
        )
        string.put("fromCharCode", self._native("fromCharCode", self._from_char_code))
        regexp = self._native(
            "RegExp", lambda _this, args: self._new_regexp(args), self._new_regexp
        )
        self.constructors[id(regexp)] = lambda value: isinstance(value, RegExpObject)
        date = self._native(
            "Date", lambda _this, _args: date_text(now_ms()), lambda args: construct_date(args)
        )
        date.put("now", self._native("now", lambda _this, _args: now_ms()))
        date.put("UTC", self._native("UTC", lambda _this, args: utc_date(args)))
        date.put(
            "parse",
            self._native("parse", lambda _this, args: parse_date(to_string(argument(args, 0)))),
        )
        self.constructors[id(date)] = lambda value: isinstance(value, DateObject)
        boolean = self._native(
            "Boolean",
            lambda _this, args: to_boolean(argument(args, 0)),
            lambda args: to_boolean(argument(args, 0)),
        )
        return {
            "NaN": math.nan,
            "Infinity": math.inf,
            "undefined": UNDEFINED,
            "Math": self._math(),
            "Number": number,
            "String": string,
            "Boolean": boolean,
            "Array": array,
            "Object": object_constructor,
            "RegExp": regexp,
            "Date": date,
            "JSON": self._object(
                {
                    "parse": self._native(
                        "parse",
                        lambda _this, args: self.json.parse(
                            to_string(argument(args, 0)), argument(args, 1)
                        ),
                    ),
                    "stringify": self._native(
                        "stringify",
                        lambda _this, args: self.json.stringify(
                            argument(args, 0), argument(args, 1), argument(args, 2)
                        ),
                    ),
                }
            ),
            "parseInt": self._native(
                "parseInt", lambda _this, args: parse_int(argument(args, 0), argument(args, 1))
            ),
            "parseFloat": self._native(
                "parseFloat", lambda _this, args: parse_float(argument(args, 0))
            ),
            "isNaN": self._native(
                "isNaN", lambda _this, args: math.isnan(_number_argument(args, 0))
            ),
            "isFinite": self._native(
                "isFinite", lambda _this, args: math.isfinite(_number_argument(args, 0))
            ),
            **errors,
        }

    def _math(self) -> JSObject:
        functions: dict[str, Callable[[float], Any]] = {
            "abs": abs,
            "ceil": _integral(math.ceil),
            "floor": _integral(math.floor),
            "trunc": _integral(math.trunc),
            "round": _round,
            "sqrt": math.sqrt,
            "exp": math.exp,
            "log": _log,
            "sin": math.sin,
            "cos": math.cos,
            "tan": math.tan,
            "asin": math.asin,
            "acos": math.acos,
            "atan": math.atan,
        }
        members: dict[str, Any] = {
            name: self._native(name, _unary_math(function)) for name, function in functions.items()
        }
        members.update(
            {
                "PI": math.pi,
                "E": math.e,
                "LN2": math.log(2),
                "LN10": math.log(10),
                "LOG2E": 1 / math.log(2),
                "LOG10E": 1 / math.log(10),
                "SQRT2": math.sqrt(2),
                "SQRT1_2": math.sqrt(0.5),
                "min": self._native("min", _extreme(False)),
                "max": self._native("max", _extreme(True)),
                "pow": self._native(
                    "pow",
                    lambda _this, args: js_pow(
                        _number_argument(args, 0), _number_argument(args, 1)
                    ),
                ),
                "atan2": self._native(
                    "atan2",
                    lambda _this, args: math.atan2(
                        _number_argument(args, 0), _number_argument(args, 1)
                    ),
                ),
            }
        )
        return self._object(members)

    def _error_constructor(self, name: str) -> NativeFunction:
        def construct(args: list[Any]) -> ErrorObject:
            message = argument(args, 0)
            return ErrorObject(name, "" if message is UNDEFINED else to_string(message))

        constructor = self._native(name, lambda _this, args: construct(args), construct)
        if name == "Error":
            self.constructors[id(constructor)] = lambda value: isinstance(value, ErrorObject)
        else:
            self.constructors[id(constructor)] = lambda value: (
                isinstance(value, ErrorObject) and value.get("name") == name
            )
        return constructor

    def _new_array(self, args: list[Any]) -> JSArray:
        if len(args) == 1 and isinstance(args[0], float):
            size = args[0]
            if not size.is_integer() or not 0 <= size <= MAX_ITEMS:
                raise throw_error("RangeError", "invalid array length")
            self.spend(int(size))
            return JSArray([UNDEFINED] * int(size))
        return JSArray(args)

    def step(self) -> None:
        self.interpreter.budget.step()

    def _new_regexp(self, args: list[Any]) -> RegExpObject:
        source, flags = argument(args, 0), argument(args, 1)
        if isinstance(source, RegExpObject):
            if flags is not UNDEFINED:
                raise throw_error("TypeError", "cannot supply flags when copying a RegExp")
            return RegExpObject(source.pattern)
        return self._compiled(pattern_source(source), pattern_source(flags))

    def _compiled(self, source: str, flags: str) -> RegExpObject:
        try:
            return RegExpObject(compile_pattern(source, flags))
        except PatternError as error:
            raise throw_error("SyntaxError", str(error)) from error

    def _regexp_argument(self, value: Any) -> RegExpObject:
        if isinstance(value, RegExpObject):
            return value
        return self._compiled(pattern_source(value), "")

    def _exec(self, this: Any, args: list[Any]) -> Any:
        if not isinstance(this, RegExpObject):
            raise throw_error("TypeError", "RegExp.prototype.exec needs a regular expression")
        return _js_regexp.execute(this, to_string(argument(args, 0)), self.step)

    def _new_object(self, args: list[Any]) -> JSObject:
        value = argument(args, 0)
        return value if isinstance(value, JSObject) else JSObject()

    def _create(self, _this: Any, args: list[Any]) -> JSObject:
        prototype = argument(args, 0)
        if prototype is not None and not isinstance(prototype, JSObject):
            raise throw_error("TypeError", "Object prototype may only be an Object or null")
        created = JSObject(proto=prototype)
        if prototype is None:
            created.bare = True
        described = argument(args, 1)
        if described is not UNDEFINED:
            self.properties.define_all(created, described)
        return created

    def _property_functions(self) -> dict[str, Native]:
        properties = self.properties

        def define(_this: Any, args: list[Any]) -> Any:
            target = target_object(argument(args, 0), "defineProperty")
            fields = properties.descriptor(argument(args, 2))
            properties.define(target, to_string(argument(args, 1)), fields)
            return target

        def define_all(_this: Any, args: list[Any]) -> Any:
            target = target_object(argument(args, 0), "defineProperties")
            properties.define_all(target, argument(args, 1))
            return target

        def names(_this: Any, args: list[Any]) -> JSArray:
            keys = target_object(argument(args, 0), "getOwnPropertyNames").own_keys()
            self.spend(len(keys))
            return JSArray(keys)

        def prevent(_this: Any, args: list[Any]) -> Any:
            value = argument(args, 0)
            if isinstance(value, JSObject):
                value.extensible = False
            return value

        def locker(frozen: bool) -> Native:
            return lambda _this, args: (
                properties.lock(argument(args, 0), frozen)
                if isinstance(argument(args, 0), JSObject)
                else argument(args, 0)
            )

        def checker(frozen: bool) -> Native:
            return lambda _this, args: (
                not isinstance(argument(args, 0), JSObject)
                or properties.locked(argument(args, 0), frozen)
            )

        return {
            "defineProperty": define,
            "defineProperties": define_all,
            "getOwnPropertyDescriptor": lambda _this, args: properties.own_descriptor(
                target_object(argument(args, 0), "getOwnPropertyDescriptor"),
                to_string(argument(args, 1)),
            ),
            "getOwnPropertyNames": names,
            "preventExtensions": prevent,
            "isExtensible": lambda _this, args: (
                isinstance(argument(args, 0), JSObject) and argument(args, 0).extensible
            ),
            "seal": locker(False),
            "freeze": locker(True),
            "isSealed": checker(False),
            "isFrozen": checker(True),
        }

    def _prototype_of(self, _this: Any, args: list[Any]) -> Any:
        value = argument(args, 0)
        if not isinstance(value, JSObject):
            raise throw_error("TypeError", "Object.getPrototypeOf called on a non-object")
        return value.proto

    def _keys(self, _this: Any, args: list[Any]) -> JSArray:
        value = argument(args, 0)
        if not isinstance(value, JSObject):
            raise throw_error("TypeError", "Object.keys called on a non-object")
        keys = value.keys()
        self.spend(len(keys))
        return JSArray(keys)

    def _from_char_code(self, _this: Any, args: list[Any]) -> str:
        self.spend(len(args))
        return checked_string("".join(chr(to_uint32(value) & 0xFFFF) for value in args))

    def _apply(self, this: Any, args: list[Any]) -> Any:
        values = argument(args, 1)
        if values is None or values is UNDEFINED:
            listed: list[Any] = []
        elif isinstance(values, JSArray):
            listed = list(values.items)
        else:
            raise throw_error("TypeError", "apply needs an array")
        return self.interpreter.call(this, argument(args, 0), listed)

    def instance_of(self, value: Any, constructor: Any) -> bool:
        if isinstance(constructor, NativeFunction):
            check = self.constructors.get(id(constructor))
            return check is not None and check(value)
        if isinstance(constructor, JSFunction):
            prototype = constructor.get("prototype")
            holder = value.proto if isinstance(value, JSObject) else None
            while holder is not None:
                if holder is prototype:
                    return True
                holder = holder.proto
            return False
        raise throw_error("TypeError", "right side of instanceof is not callable")

    def prototype(self, value: Any, key: str) -> Any:
        if isinstance(value, str):
            if key == "length":
                return float(len(value))
            if key.isascii() and key.isdigit():
                index = int(key)
                return value[index] if index < len(value) else UNDEFINED
            return self.string_methods.get(key, UNDEFINED)
        if isinstance(value, bool):
            return self.boolean_methods.get(key, UNDEFINED)
        if isinstance(value, float):
            return self.number_methods.get(key, UNDEFINED)
        if isinstance(value, RegExpObject) and key in self.regexp_methods:
            return self.regexp_methods[key]
        if isinstance(value, DateObject) and key in self.date_methods:
            return self.date_methods[key]
        if isinstance(value, JSArray) and key in self.array_methods:
            return self.array_methods[key]
        if isinstance(value, JSFunction | NativeFunction) and key in self.function_methods:
            return self.function_methods[key]
        if isinstance(value, JSObject) and not value.bare:
            return self.object_methods.get(key, UNDEFINED)
        return UNDEFINED

    def _string_method(self, name: str, body: Callable[[str, list[Any]], Any]) -> NativeFunction:
        def call(this: Any, args: list[Any]) -> Any:
            if this is None or this is UNDEFINED:
                raise throw_error("TypeError", f"String.prototype.{name} called on {this!r}")
            text = to_string(this)
            self.spend(len(text) // STRING_STEP)
            return body(text, args)

        return self._native(name, call)

    def _string_methods(self) -> dict[str, NativeFunction]:
        methods: dict[str, Callable[[str, list[Any]], Any]] = {
            "charAt": self._char_at,
            "charCodeAt": self._char_code_at,
            "indexOf": self._index_of,
            "lastIndexOf": self._last_index_of,
            "substring": self._substring,
            "substr": self._substr,
            "slice": lambda text, args: text[
                _relative(argument(args, 0), len(text), 0) : _relative(
                    argument(args, 1), len(text), len(text)
                )
            ],
            "toUpperCase": lambda text, _args: checked_string(text.upper()),
            "toLowerCase": lambda text, _args: checked_string(text.lower()),
            "toLocaleUpperCase": lambda text, _args: checked_string(text.upper()),
            "toLocaleLowerCase": lambda text, _args: checked_string(text.lower()),
            "trim": lambda text, _args: text.strip(),
            "split": self._split,
            "replace": self._replace,
            "match": self._match,
            "search": self._search,
            "concat": lambda text, args: checked_string(
                text + "".join(to_string(value) for value in args)
            ),
            "localeCompare": lambda text, args: float(
                (text > to_string(argument(args, 0))) - (text < to_string(argument(args, 0)))
            ),
            "toString": lambda text, _args: text,
            "valueOf": lambda text, _args: text,
        }
        return {name: self._string_method(name, body) for name, body in methods.items()}

    def _char_at(self, text: str, args: list[Any]) -> str:
        index = to_integer(argument(args, 0))
        return text[int(index)] if 0 <= index < len(text) else ""

    def _char_code_at(self, text: str, args: list[Any]) -> float:
        index = to_integer(argument(args, 0))
        return float(ord(text[int(index)])) if 0 <= index < len(text) else math.nan

    def _index_of(self, text: str, args: list[Any]) -> float:
        start = int(min(max(to_integer(argument(args, 1)), 0), len(text)))
        return float(text.find(to_string(argument(args, 0)), start))

    def _last_index_of(self, text: str, args: list[Any]) -> float:
        position = _number_argument(args, 1)
        limit = len(text) if math.isnan(position) else int(min(max(position, 0), len(text)))
        search = to_string(argument(args, 0))
        return float(text.rfind(search, 0, limit + len(search)))

    def _substring(self, text: str, args: list[Any]) -> str:
        length = len(text)
        start = int(min(max(to_integer(argument(args, 0)), 0), length))
        end_value = argument(args, 1)
        end = length if end_value is UNDEFINED else int(min(max(to_integer(end_value), 0), length))
        return text[min(start, end) : max(start, end)]

    def _substr(self, text: str, args: list[Any]) -> str:
        start = _relative(argument(args, 0), len(text), 0)
        count_value = argument(args, 1)
        count = len(text) if count_value is UNDEFINED else to_integer(count_value)
        count = int(min(max(count, 0), len(text) - start))
        return text[start : start + count]

    def _match(self, text: str, args: list[Any]) -> Any:
        regexp = self._regexp_argument(argument(args, 0))
        if not regexp.pattern.is_global:
            return _js_regexp.execute(regexp, text, self.step)
        found = _js_regexp.all_matches(regexp.pattern, text, self.step)
        regexp.put("lastIndex", 0.0)
        if not found:
            return None
        return JSArray([_js_regexp.captured(text, slots, 0) for slots in found])

    def _search(self, text: str, args: list[Any]) -> float:
        regexp = self._regexp_argument(argument(args, 0))
        slots = regexp.pattern.search(text, 0, self.step)
        return -1.0 if slots is None else float(slots[0] or 0)

    def _split(self, text: str, args: list[Any]) -> JSArray:
        separator = argument(args, 0)
        limit_value = argument(args, 1)
        limit = MAX_ITEMS if limit_value is UNDEFINED else to_uint32(limit_value)
        if isinstance(separator, RegExpObject):
            parts = _js_regexp.split(separator.pattern, text, min(limit, MAX_ITEMS), self.step)
            return JSArray(parts)
        if separator is UNDEFINED:
            parts = [text]
        else:
            search = to_string(separator)
            if search == "":
                if len(text) > MAX_ITEMS and limit > MAX_ITEMS:
                    raise throw_error("RangeError", "too many parts")
                parts = list(text[:limit])
            else:
                parts = text.split(search, MAX_ITEMS)
        return JSArray(parts[:limit])

    def _replace(self, text: str, args: list[Any]) -> str:
        if isinstance(argument(args, 0), RegExpObject):
            return self._replace_pattern(text, argument(args, 0), argument(args, 1))
        search = to_string(argument(args, 0))
        replacement = argument(args, 1)
        index = text.find(search)
        if index < 0:
            return text
        before, after = text[:index], text[index + len(search) :]
        if isinstance(replacement, JSFunction | NativeFunction):
            inserted = to_string(
                self.interpreter.call(replacement, UNDEFINED, [search, float(index), text])
            )
        else:
            inserted = _replace_pattern(to_string(replacement), search, before, after)
        return checked_string(before + inserted + after)

    def _replace_pattern(self, text: str, regexp: RegExpObject, replacement: Any) -> str:
        pattern = regexp.pattern

        def inserted(slots: list[int | None]) -> str:
            if isinstance(replacement, JSFunction | NativeFunction):
                groups = [
                    _js_regexp.captured(text, slots, number) for number in range(pattern.groups + 1)
                ]
                values = [*groups, float(slots[0] or 0), text]
                return to_string(self.interpreter.call(replacement, UNDEFINED, values))
            return _js_regexp.expand(to_string(replacement), text, slots, pattern.groups)

        result = _js_regexp.replace(pattern, text, inserted, self.step)
        if pattern.is_global:
            regexp.put("lastIndex", 0.0)
        return result

    def _number_method(self, name: str, body: Callable[[float, list[Any]], Any]) -> NativeFunction:
        def call(this: Any, args: list[Any]) -> Any:
            if not isinstance(this, float) or isinstance(this, bool):
                raise throw_error("TypeError", f"Number.prototype.{name} needs a number")
            return body(this, args)

        return self._native(name, call)

    def _date_method(
        self, name: str, body: Callable[[DateObject, list[Any]], Any]
    ) -> NativeFunction:
        def call(this: Any, args: list[Any]) -> Any:
            if not isinstance(this, DateObject):
                raise throw_error("TypeError", f"Date.prototype.{name} needs a date")
            return body(this, args)

        return self._native(name, call)

    def _number_methods(self) -> dict[str, NativeFunction]:
        methods: dict[str, Callable[[float, list[Any]], Any]] = {
            "toFixed": lambda value, args: to_fixed(value, int(to_integer(argument(args, 0)))),
            "toPrecision": lambda value, args: (
                number_to_string(value)
                if argument(args, 0) is UNDEFINED
                else to_precision(value, int(to_integer(argument(args, 0))))
            ),
            "toString": self._number_to_string,
            "toLocaleString": lambda value, _args: number_to_string(value),
            "valueOf": lambda value, _args: value,
        }
        return {name: self._number_method(name, body) for name, body in methods.items()}

    def _number_to_string(self, value: float, args: list[Any]) -> str:
        radix_value = argument(args, 0)
        radix = 10 if radix_value is UNDEFINED else int(to_integer(radix_value))
        if not 2 <= radix <= 36:
            raise throw_error("RangeError", "toString() radix out of range")
        return to_radix(value, radix)

    def _array_method(self, name: str, body: Callable[[JSArray, list[Any]], Any]) -> NativeFunction:
        def call(this: Any, args: list[Any]) -> Any:
            if not isinstance(this, JSArray):
                raise throw_error("TypeError", f"Array.prototype.{name} needs an array")
            if name in ARRAY_MUTATORS and not this.extensible:
                raise throw_error("TypeError", f"Array.prototype.{name} on a locked array")
            self.spend(len(this.items) if name in LINEAR_ARRAY_METHODS else 0)
            return body(this, args)

        return self._native(name, call)

    def _array_methods(self) -> dict[str, NativeFunction]:
        methods: dict[str, Callable[[JSArray, list[Any]], Any]] = {
            "push": self._push,
            "pop": lambda array, _args: array.items.pop() if array.items else UNDEFINED,
            "shift": lambda array, _args: array.items.pop(0) if array.items else UNDEFINED,
            "unshift": self._unshift,
            "join": lambda array, args: join_items(
                array.items,
                "," if argument(args, 0) is UNDEFINED else to_string(argument(args, 0)),
            ),
            "toString": lambda array, _args: join_items(array.items, ","),
            "indexOf": self._array_index_of,
            "lastIndexOf": self._array_last_index_of,
            "slice": lambda array, args: JSArray(
                array.items[
                    _relative(argument(args, 0), len(array.items), 0) : _relative(
                        argument(args, 1), len(array.items), len(array.items)
                    )
                ]
            ),
            "splice": self._splice,
            "concat": self._concat,
            "reverse": self._reverse,
            "sort": self._sort,
            "forEach": self._for_each,
            "map": self._map,
            "filter": self._filter,
            "some": self._some,
            "every": self._every,
            "reduce": self._reduce,
        }
        return {name: self._array_method(name, body) for name, body in methods.items()}

    def _push(self, array: JSArray, args: list[Any]) -> float:
        array.resize(len(array.items) + len(args))
        array.items[len(array.items) - len(args) :] = args
        return float(len(array.items))

    def _unshift(self, array: JSArray, args: list[Any]) -> float:
        array.resize(len(array.items) + len(args))
        array.items[:] = args + array.items[: len(array.items) - len(args)]
        return float(len(array.items))

    def _array_index_of(self, array: JSArray, args: list[Any]) -> float:
        wanted = argument(args, 0)
        start = _relative(argument(args, 1), len(array.items), 0)
        for index in range(start, len(array.items)):
            if strict_equals(array.items[index], wanted):
                return float(index)
        return -1.0

    def _array_last_index_of(self, array: JSArray, args: list[Any]) -> float:
        wanted = argument(args, 0)
        for index in range(len(array.items) - 1, -1, -1):
            if strict_equals(array.items[index], wanted):
                return float(index)
        return -1.0

    def _splice(self, array: JSArray, args: list[Any]) -> JSArray:
        length = len(array.items)
        start = _relative(argument(args, 0), length, 0)
        if len(args) < 2:
            count = length - start
        else:
            count = int(min(max(to_integer(args[1]), 0), length - start))
        removed = array.items[start : start + count]
        updated = array.items[:start] + args[2:] + array.items[start + count :]
        array.resize(len(updated))
        array.items[:] = updated
        return JSArray(removed)

    def _concat(self, array: JSArray, args: list[Any]) -> JSArray:
        items = list(array.items)
        for value in args:
            if isinstance(value, JSArray):
                self.spend(len(value.items))
                items.extend(value.items)
            else:
                items.append(value)
            if len(items) > MAX_ITEMS:
                raise throw_error("RangeError", "array too long")
        return JSArray(items)

    def _reverse(self, array: JSArray, _args: list[Any]) -> JSArray:
        array.items.reverse()
        return array

    def _sort(self, array: JSArray, args: list[Any]) -> JSArray:
        comparator = argument(args, 0)
        defined = [item for item in array.items if item is not UNDEFINED]
        missing = len(array.items) - len(defined)
        if comparator is UNDEFINED:
            ordered = sorted(defined, key=to_string)
        else:

            def compare(left: Any, right: Any) -> int:
                result = to_number(self.interpreter.call(comparator, UNDEFINED, [left, right]))
                return 0 if math.isnan(result) else (result > 0) - (result < 0)

            ordered = sorted(defined, key=functools.cmp_to_key(compare))
        array.items[:] = ordered + [UNDEFINED] * missing
        return array

    def _each(self, array: JSArray, args: list[Any]) -> Any:
        callback = argument(args, 0)
        this = argument(args, 1)
        for index, item in enumerate(list(array.items)):
            yield self.interpreter.call(callback, this, [item, float(index), array]), item

    def _for_each(self, array: JSArray, args: list[Any]) -> Any:
        for _result in self._each(array, args):
            pass
        return UNDEFINED

    def _map(self, array: JSArray, args: list[Any]) -> JSArray:
        return JSArray([result for result, _item in self._each(array, args)])

    def _filter(self, array: JSArray, args: list[Any]) -> JSArray:
        return JSArray([item for result, item in self._each(array, args) if to_boolean(result)])

    def _some(self, array: JSArray, args: list[Any]) -> bool:
        return any(to_boolean(result) for result, _item in self._each(array, args))

    def _every(self, array: JSArray, args: list[Any]) -> bool:
        return all(to_boolean(result) for result, _item in self._each(array, args))

    def _reduce(self, array: JSArray, args: list[Any]) -> Any:
        callback = argument(args, 0)
        items = list(array.items)
        if len(args) >= 2:
            accumulator, start = args[1], 0
        elif items:
            accumulator, start = items[0], 1
        else:
            raise throw_error("TypeError", "reduce of empty array with no initial value")
        for index in range(start, len(items)):
            accumulator = self.interpreter.call(
                callback, UNDEFINED, [accumulator, items[index], float(index), array]
            )
        return accumulator
