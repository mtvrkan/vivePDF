import datetime
import math
import re
import time
from collections.abc import Callable
from typing import Any

from vivepdf.ops._date_names import ENGLISH, DateNames
from vivepdf.ops._js_values import (
    UNDEFINED,
    JSObject,
    throw_error,
    to_integer,
    to_number,
    to_primitive,
    to_string,
)

MS_PER_SECOND = 1000.0
MS_PER_MINUTE = 60_000.0
MS_PER_HOUR = 3_600_000.0
MS_PER_DAY = 86_400_000.0
MAX_TIME = 8.64e15
MAX_YEAR_SPAN = 400_000
MAX_PARSED_TEXT = 256
MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
DAYS = ("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
MONTH_KEYS = {name[:3].lower(): index for index, name in enumerate(MONTHS)}
PRINTD_PRESETS = {0: "D:yyyymmddHHMMss", 1: "yyyy.mm.dd HH:MM:ss", 2: "m/d/yy h:MM:ss tt"}
PICTURE_TOKEN = re.compile(
    r"mmmm|mmm|mm|m|dddd|ddd|dd|d|yyyy|yy|HH|H|hh|h|MM|M|ss|s|tt|t|\\.|.", re.DOTALL
)
NUMERIC_WIDTHS = {
    "mm": 2,
    "m": 2,
    "dd": 2,
    "d": 2,
    "yyyy": 4,
    "yy": 4,
    "HH": 2,
    "H": 2,
    "hh": 2,
    "h": 2,
    "MM": 2,
    "M": 2,
    "ss": 2,
    "s": 2,
}
SETTER_ARITY = (
    ("FullYear", 3),
    ("Month", 2),
    ("Date", 1),
    ("Hours", 4),
    ("Minutes", 3),
    ("Seconds", 2),
    ("Milliseconds", 1),
)
TIME_PICTURES = ("h:MM:ss tt", "h:MM tt", "HH:MM:ss", "HH:MM")
DATE_TOKENS = frozenset({"mmmm", "mmm", "mm", "m", "dd", "d", "yyyy", "yy"})
ISO_DATE = re.compile(
    r"([+-][0-9]{6}|[0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2}))?)?"
    r"(?:T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:[.]([0-9]{1,3})[0-9]*)?)?)?"
    r"(Z|[+-][0-9]{2}:[0-9]{2})?"
)
US_DATE = re.compile(
    r"([0-9]{1,2})/([0-9]{1,2})/([0-9]{2,4})"
    r"(?:[ ,]+([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))? *([AaPp][Mm])?)?"
)
WORD_DATE = re.compile(
    r"(?:[A-Za-z]{3,9},? +)?(?:([A-Za-z]{3,9})[.]? +([0-9]{1,2})|([0-9]{1,2}) +([A-Za-z]{3,9})),? +"
    r"([0-9]{4})(?: +([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?)?"
    r"(?: *(?:GMT|UTC|Z))?(?: *([+-][0-9]{4}))?(?: *[(][^()]*[)])?"
)
DIGITS = re.compile(r"[0-9]+")
LETTERS = re.compile(r"[A-Za-z]+")


def now_ms() -> float:
    return float(math.floor(time.time() * 1000))


def local_offset(utc_ms: float) -> float:
    try:
        moment = datetime.datetime.fromtimestamp(utc_ms / 1000, tz=datetime.UTC).astimezone()
    except (OverflowError, OSError, ValueError):
        moment = datetime.datetime.now().astimezone()
    offset = moment.utcoffset()
    return offset.total_seconds() * 1000 if offset is not None else 0.0


def days_from_civil(year: int, month: int, day: int) -> int:
    year -= month <= 2
    era = year // 400
    year_of_era = year - era * 400
    day_of_year = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5 + day - 1
    day_of_era = year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year
    return era * 146097 + day_of_era - 719468


def civil_from_days(days: int) -> tuple[int, int, int]:
    days += 719468
    era = days // 146097
    day_of_era = days - era * 146097
    year_of_era = (
        day_of_era - day_of_era // 1460 + day_of_era // 36524 - day_of_era // 146096
    ) // 365
    day_of_year = day_of_era - (365 * year_of_era + year_of_era // 4 - year_of_era // 100)
    shifted = (5 * day_of_year + 2) // 153
    day = day_of_year - (153 * shifted + 2) // 5 + 1
    month = shifted + (3 if shifted < 10 else -9)
    return year_of_era + era * 400 + (month <= 2), month, day


def days_in_month(year: int, month: int) -> int:
    following = days_from_civil(year + (month == 12), month % 12 + 1, 1)
    return following - days_from_civil(year, month, 1)


def make_day(year: float, month: float, day: float) -> float:
    if not all(math.isfinite(value) for value in (year, month, day)):
        return math.nan
    whole_year, whole_month = math.trunc(year), math.trunc(month)
    shifted_year = whole_year + whole_month // 12
    if abs(shifted_year) > MAX_YEAR_SPAN:
        return math.nan
    first = days_from_civil(shifted_year, whole_month % 12 + 1, 1)
    return float(first + math.trunc(day) - 1)


def make_time(hours: float, minutes: float, seconds: float, milliseconds: float) -> float:
    parts = (hours, minutes, seconds, milliseconds)
    if not all(math.isfinite(value) for value in parts):
        return math.nan
    return (
        math.trunc(hours) * MS_PER_HOUR
        + math.trunc(minutes) * MS_PER_MINUTE
        + math.trunc(seconds) * MS_PER_SECOND
        + math.trunc(milliseconds)
    )


def make_date(day: float, within: float) -> float:
    if not (math.isfinite(day) and math.isfinite(within)):
        return math.nan
    return day * MS_PER_DAY + within


def time_clip(value: float) -> float:
    if not math.isfinite(value) or abs(value) > MAX_TIME:
        return math.nan
    return float(math.trunc(value)) + 0.0


def utc_from_local(value: float) -> float:
    if not math.isfinite(value):
        return math.nan
    return value - local_offset(value - local_offset(value))


def local_from_utc(value: float) -> float:
    return value + local_offset(value)


def components(value: float) -> list[int]:
    day = math.floor(value / MS_PER_DAY)
    within = int(value - day * MS_PER_DAY)
    year, month, date = civil_from_days(day)
    return [
        year,
        month - 1,
        date,
        within // 3_600_000,
        within // 60_000 % 60,
        within // 1000 % 60,
        within % 1000,
        (day + 4) % 7,
    ]


def compose(parts: list[float]) -> float:
    year, month, day, hours, minutes, seconds, milliseconds = parts[:7]
    return make_date(make_day(year, month, day), make_time(hours, minutes, seconds, milliseconds))


def _two_digit_year(year: int, digits: int) -> int:
    if digits > 2:
        return year
    return year + (2000 if year < 50 else 1900)


def _offset_text(offset: float) -> str:
    minutes = round(offset / MS_PER_MINUTE)
    sign = "-" if minutes < 0 else "+"
    return f"{sign}{abs(minutes) // 60:02d}{abs(minutes) % 60:02d}"


def _year_text(year: int) -> str:
    return f"{year:04d}" if year >= 0 else f"-{abs(year):06d}"


class DateObject(JSObject):
    def __init__(self, value: float) -> None:
        super().__init__()
        self.time = time_clip(value)

    def default_value(self) -> Any:
        return date_text(self.time)

    def number_value(self) -> Any:
        return self.time


def date_text(value: float) -> str:
    if math.isnan(value):
        return "Invalid Date"
    offset = local_offset(value)
    year, month, day, hours, minutes, seconds, _ms, weekday = components(value + offset)
    return (
        f"{DAYS[weekday][:3]} {MONTHS[month][:3]} {day:02d} {_year_text(year)} "
        f"{hours:02d}:{minutes:02d}:{seconds:02d} GMT{_offset_text(offset)}"
    )


def _utc_text(value: float) -> str:
    if math.isnan(value):
        return "Invalid Date"
    year, month, day, hours, minutes, seconds, _ms, weekday = components(value)
    return (
        f"{DAYS[weekday][:3]}, {day:02d} {MONTHS[month][:3]} {_year_text(year)} "
        f"{hours:02d}:{minutes:02d}:{seconds:02d} GMT"
    )


def _iso_text(value: float) -> str:
    if math.isnan(value):
        raise throw_error("RangeError", "invalid time value")
    year, month, day, hours, minutes, seconds, milliseconds, _weekday = components(value)
    year_text = f"{year:04d}" if 0 <= year <= 9999 else f"{'+' if year > 0 else '-'}{abs(year):06d}"
    return (
        f"{year_text}-{month + 1:02d}-{day:02d}T{hours:02d}:{minutes:02d}:{seconds:02d}"
        f".{milliseconds:03d}Z"
    )


def _local_parts(value: float) -> list[int]:
    return components(local_from_utc(value))


def _clock_text(parts: list[int]) -> str:
    hours = parts[3] % 12 or 12
    suffix = "AM" if parts[3] < 12 else "PM"
    return f"{hours}:{parts[4]:02d}:{parts[5]:02d} {suffix}"


def _valid_parts(year: int, month: int, day: int, hours: int, minutes: int, seconds: int) -> bool:
    return (
        1 <= month <= 12
        and 1 <= day <= days_in_month(year, month)
        and (hours < 24 or (hours == 24 and minutes == 0 and seconds == 0))
        and minutes < 60
        and seconds < 60
    )


def _iso_value(text: str) -> float | None:
    match = ISO_DATE.fullmatch(text)
    if match is None:
        return None
    year = int(match[1])
    month, day = int(match[2] or 1), int(match[3] or 1)
    hours, minutes = int(match[4] or 0), int(match[5] or 0)
    seconds, milliseconds = int(match[6] or 0), int((match[7] or "0").ljust(3, "0"))
    if not _valid_parts(year, month, day, hours, minutes, seconds):
        return math.nan
    local = compose([year, month - 1, day, hours, minutes, seconds, milliseconds])
    zone = match[8]
    if zone is None:
        return local if match[4] is None else utc_from_local(local)
    if zone == "Z":
        return local
    sign = -1 if zone[0] == "-" else 1
    return local - sign * (int(zone[1:3]) * MS_PER_HOUR + int(zone[4:6]) * MS_PER_MINUTE)


def _clock(hours: int, suffix: str | None) -> int:
    if suffix is None:
        return hours
    return hours % 12 + (12 if suffix.lower() == "pm" else 0)


def _us_value(text: str) -> float | None:
    match = US_DATE.fullmatch(text)
    if match is None:
        return None
    year = _two_digit_year(int(match[3]), len(match[3]))
    month, day = int(match[1]), int(match[2])
    hours = _clock(int(match[4] or 0), match[7])
    minutes, seconds = int(match[5] or 0), int(match[6] or 0)
    if match[7] is not None and not 1 <= int(match[4] or 0) <= 12:
        return math.nan
    if not _valid_parts(year, month, day, hours, minutes, seconds):
        return math.nan
    return utc_from_local(compose([year, month - 1, day, hours, minutes, seconds, 0]))


def _word_value(text: str) -> float | None:
    match = WORD_DATE.fullmatch(text)
    if match is None:
        return None
    name = (match[1] or match[4]).lower()[:3]
    if name not in MONTH_KEYS:
        return math.nan
    year, month, day = int(match[5]), MONTH_KEYS[name] + 1, int(match[2] or match[3])
    hours, minutes, seconds = int(match[6] or 0), int(match[7] or 0), int(match[8] or 0)
    if not _valid_parts(year, month, day, hours, minutes, seconds):
        return math.nan
    local = compose([year, month - 1, day, hours, minutes, seconds, 0])
    zone = match[9]
    zoned = "GMT" in text or "UTC" in text or zone is not None
    if not zoned:
        return utc_from_local(local)
    if zone is None:
        return local
    sign = -1 if zone[0] == "-" else 1
    return local - sign * (int(zone[1:3]) * MS_PER_HOUR + int(zone[3:5]) * MS_PER_MINUTE)


def parse_date(text: str) -> float:
    text = text.strip()
    if len(text) > MAX_PARSED_TEXT:
        return math.nan
    for reader in (_iso_value, _us_value, _word_value):
        value = reader(text)
        if value is not None:
            return time_clip(value)
    return math.nan


def _argument(args: list[Any], index: int) -> Any:
    return args[index] if index < len(args) else UNDEFINED


def _component_arguments(args: list[Any]) -> list[float]:
    defaults = [math.nan, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0]
    parts = [to_number(value) for value in args[:7]] + defaults[len(args[:7]) :]
    year = parts[0]
    if math.isfinite(year) and 0 <= math.trunc(year) <= 99:
        parts[0] = 1900.0 + math.trunc(year)
    return parts


def construct_date(args: list[Any]) -> DateObject:
    if not args:
        return DateObject(now_ms())
    if len(args) == 1:
        value = args[0]
        if isinstance(value, DateObject):
            return DateObject(value.time)
        primitive = to_primitive(value)
        if isinstance(primitive, str):
            return DateObject(parse_date(primitive))
        return DateObject(to_number(primitive))
    return DateObject(utc_from_local(compose(_component_arguments(args))))


def utc_date(args: list[Any]) -> float:
    return time_clip(compose(_component_arguments(args)))


def _getter(index: int, utc: bool) -> Callable[[DateObject, list[Any]], float]:
    def get(date: DateObject, _args: list[Any]) -> float:
        if math.isnan(date.time):
            return math.nan
        parts = components(date.time) if utc else _local_parts(date.time)
        return float(parts[index])

    return get


def _setter(first: int, count: int, utc: bool) -> Callable[[DateObject, list[Any]], float]:
    def set_parts(date: DateObject, args: list[Any]) -> float:
        current = date.time
        if math.isnan(current):
            if first != 0:
                return math.nan
            base = 0.0
        else:
            base = current if utc else local_from_utc(current)
        parts: list[float] = [float(part) for part in components(base)]
        values = [to_number(value) for value in args[:count]] or [math.nan]
        parts[first : first + len(values)] = values
        composed = compose(parts)
        date.time = time_clip(composed if utc else utc_from_local(composed))
        return date.time

    return set_parts


def _set_time(date: DateObject, args: list[Any]) -> float:
    date.time = time_clip(to_number(_argument(args, 0)))
    return date.time


def _set_year(date: DateObject, args: list[Any]) -> float:
    year = to_number(_argument(args, 0))
    if math.isfinite(year) and 0 <= math.trunc(year) <= 99:
        year = 1900.0 + math.trunc(year)
    return _setter(0, 1, False)(date, [year])


def _year_offset(date: DateObject, _args: list[Any]) -> float:
    if math.isnan(date.time):
        return math.nan
    return float(_local_parts(date.time)[0] - 1900)


def _timezone_offset(date: DateObject, _args: list[Any]) -> float:
    if math.isnan(date.time):
        return math.nan
    return -local_offset(date.time) / MS_PER_MINUTE + 0.0


def _date_part(date: DateObject, _args: list[Any]) -> str:
    text = date_text(date.time)
    return text if math.isnan(date.time) else text[:15]


def _time_part(date: DateObject, _args: list[Any]) -> str:
    text = date_text(date.time)
    return text if math.isnan(date.time) else text[16:]


def _locale_date(date: DateObject, _args: list[Any]) -> str:
    if math.isnan(date.time):
        return "Invalid Date"
    parts = _local_parts(date.time)
    return f"{parts[1] + 1}/{parts[2]}/{parts[0]}"


def _locale_time(date: DateObject, _args: list[Any]) -> str:
    if math.isnan(date.time):
        return "Invalid Date"
    return _clock_text(_local_parts(date.time))


def _locale_text(date: DateObject, args: list[Any]) -> str:
    if math.isnan(date.time):
        return "Invalid Date"
    return f"{_locale_date(date, args)}, {_locale_time(date, args)}"


def date_methods() -> dict[str, Callable[[DateObject, list[Any]], Any]]:
    methods: dict[str, Callable[[DateObject, list[Any]], Any]] = {
        "getTime": lambda date, _args: date.time,
        "valueOf": lambda date, _args: date.time,
        "setTime": _set_time,
        "getYear": _year_offset,
        "getTimezoneOffset": _timezone_offset,
        "toString": lambda date, _args: date_text(date.time),
        "toDateString": _date_part,
        "toTimeString": _time_part,
        "toUTCString": lambda date, _args: _utc_text(date.time),
        "toGMTString": lambda date, _args: _utc_text(date.time),
        "toISOString": lambda date, _args: _iso_text(date.time),
        "toJSON": lambda date, _args: None if math.isnan(date.time) else _iso_text(date.time),
        "toLocaleDateString": _locale_date,
        "toLocaleTimeString": _locale_time,
        "toLocaleString": _locale_text,
    }
    for index, (name, arity) in enumerate(SETTER_ARITY):
        for utc in (False, True):
            prefix = "UTC" if utc else ""
            methods[f"get{prefix}{name}"] = _getter(index, utc)
            methods[f"set{prefix}{name}"] = _setter(index, arity, utc)
    methods["getDay"] = _getter(7, False)
    methods["getUTCDay"] = _getter(7, True)
    methods["setYear"] = _set_year
    return methods


def picture_tokens(picture: str) -> list[str]:
    return PICTURE_TOKEN.findall(picture)


def print_date(picture: str, value: float, names: DateNames = ENGLISH) -> str:
    if math.isnan(value):
        return ""
    year, month, day, hours, minutes, seconds, _ms, weekday = _local_parts(value)
    twelve = hours % 12 or 12
    tokens = picture_tokens(picture)
    with_day = any(token in ("dd", "d") for token in tokens)
    fields = {
        "mmmm": names.month(month, with_day),
        "mmm": names.short_months[month],
        "mm": f"{month + 1:02d}",
        "m": str(month + 1),
        "dddd": names.days[weekday],
        "ddd": names.short_days[weekday],
        "dd": f"{day:02d}",
        "d": str(day),
        "yyyy": _year_text(year),
        "yy": f"{year % 100:02d}",
        "HH": f"{hours:02d}",
        "H": str(hours),
        "hh": f"{twelve:02d}",
        "h": str(twelve),
        "MM": f"{minutes:02d}",
        "M": str(minutes),
        "ss": f"{seconds:02d}",
        "s": str(seconds),
        "tt": "am" if hours < 12 else "pm",
        "t": "a" if hours < 12 else "p",
    }
    output = []
    for token in tokens:
        if token in fields:
            output.append(fields[token])
        elif len(token) == 2 and token[0] == "\\":
            output.append(token[1])
        else:
            output.append(token)
    return "".join(output)


class _Reader:
    def __init__(self, text: str) -> None:
        self.text = text
        self.index = 0

    def skip_spaces(self) -> None:
        while self.index < len(self.text) and self.text[self.index].isspace():
            self.index += 1

    def number(self, width: int) -> int | None:
        self.skip_spaces()
        match = DIGITS.match(self.text, self.index)
        if match is None:
            return None
        digits = match[0][:width]
        self.index += len(digits)
        return int(digits)

    def word(self) -> str | None:
        self.skip_spaces()
        match = LETTERS.match(self.text, self.index)
        if match is None:
            return None
        self.index = match.end()
        return match[0].lower()

    def choice(self, options: tuple[tuple[str, int], ...]) -> int | None:
        self.skip_spaces()
        for name, index in options:
            if self.text[self.index : self.index + len(name)].casefold() == name:
                self.index += len(name)
                return index
        return None

    def literal(self, expected: str) -> bool:
        if self.index < len(self.text) and self.text[self.index] == expected:
            self.index += 1
            return True
        if expected.isspace():
            return True
        if self.index < len(self.text) and not self.text[self.index].isalnum():
            self.index += 1
            return True
        return False


def scan_date(picture: str, text: str, names: DateNames = ENGLISH) -> float | None:
    if len(text) > MAX_PARSED_TEXT:
        return None
    today = _local_parts(now_ms())
    tokens = picture_tokens(picture)
    has_date = any(token in DATE_TOKENS for token in tokens)
    values: dict[str, int] = {}
    year_digits = 4
    suffix: str | None = None
    reader = _Reader(text)
    for token in tokens:
        if token in NUMERIC_WIDTHS:
            before = reader.index
            number = reader.number(NUMERIC_WIDTHS[token])
            if number is None:
                return None
            key = token[0] if token[0] not in "Hh" else "H"
            values[key if token not in ("yyyy", "yy") else "y"] = number
            if token[0] == "y":
                year_digits = reader.index - before
            if token in ("hh", "h"):
                values["twelve"] = 1
        elif token in ("mmmm", "mmm"):
            month = reader.choice(names.month_options)
            if month is None:
                word = reader.word()
                if word is None or word[:3] not in MONTH_KEYS:
                    return None
                month = MONTH_KEYS[word[:3]]
            values["m"] = month + 1
        elif token in ("dddd", "ddd"):
            if reader.choice(names.day_options) is None and reader.word() is None:
                return None
        elif token in ("tt", "t"):
            word = reader.word()
            if word is None or word[0] not in "ap":
                return None
            suffix = "am" if word[0] == "a" else "pm"
        elif not reader.literal(token[-1]):
            return None
    year = values.get("y", today[0])
    if "y" in values:
        year = _two_digit_year(year, year_digits)
    month = values.get("m", 1 if has_date else today[1] + 1)
    day = values.get("d", 1 if has_date else today[2])
    hours = values.get("H", 0)
    if "twelve" in values or suffix is not None:
        if not 1 <= hours <= 12:
            return None
        hours = _clock(hours, suffix or "am")
    minutes, seconds = values.get("M", 0), values.get("s", 0)
    if not _valid_parts(year, month, day, hours, minutes, seconds) or hours == 24:
        return None
    return time_clip(utc_from_local(compose([year, month - 1, day, hours, minutes, seconds, 0])))


def guess_date(picture: str, text: str, names: DateNames = ENGLISH) -> float | None:
    if len(text) > MAX_PARSED_TEXT:
        return None
    scanned = scan_date(picture, text, names)
    if scanned is not None:
        return scanned
    if any(token in DATE_TOKENS for token in picture_tokens(picture)):
        guessed = _guess_calendar(picture, text, names)
    else:
        guessed = next(
            (value for option in TIME_PICTURES if (value := scan_date(option, text)) is not None),
            None,
        )
    if guessed is not None:
        return guessed
    parsed = parse_date(text)
    return None if math.isnan(parsed) else parsed


def _guess_calendar(picture: str, text: str, names: DateNames) -> float | None:
    found = names.find_month(text)
    words = [word[:3].lower() for word in LETTERS.findall(text)]
    named = next((MONTH_KEYS[word] + 1 for word in words if word in MONTH_KEYS), None)
    if found is not None:
        named = found + 1
    digits = [match[0][:4] for match in DIGITS.finditer(text)][:3]
    fields: dict[str, str] = {} if named is None else {"m": str(named)}
    if named is None and digits and len(digits[0]) == 4:
        order = ["y", "m", "d"]
    else:
        order = _order(picture)
        year = next((index for index, group in enumerate(digits) if len(group) == 4), None)
        if year is not None:
            fields["y"] = digits.pop(year)
    order = [letter for letter in order if letter not in fields]
    fields.update(zip(order, digits, strict=False))
    if "m" not in fields or "d" not in fields:
        return None
    year = _local_parts(now_ms())[0]
    if "y" in fields:
        year = _two_digit_year(int(fields["y"]), len(fields["y"]))
    month, day = int(fields["m"]), int(fields["d"])
    if not _valid_parts(year, month, day, 0, 0, 0):
        return None
    return time_clip(utc_from_local(compose([year, month - 1, day, 0, 0, 0, 0])))


def _order(picture: str) -> list[str]:
    order: list[str] = []
    for token in picture_tokens(picture):
        letter = token[0]
        if token in DATE_TOKENS and letter not in order:
            order.append(letter)
    for letter in ("m", "d", "y"):
        if letter not in order:
            order.append(letter)
    return order


def printd_picture(value: Any) -> str:
    if isinstance(value, float) and to_integer(value) in PRINTD_PRESETS:
        return PRINTD_PRESETS[int(to_integer(value))]
    return to_string(value)
