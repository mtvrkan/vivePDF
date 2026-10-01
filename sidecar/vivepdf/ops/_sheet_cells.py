import calendar
import datetime as dt
import re

DATE_TOKEN = re.compile(r"yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am/pm|a/p", re.IGNORECASE)
BRACKETS = re.compile(r"\[[^\]]*\]")
NUMBER_BODY = re.compile(r"[#0,]*0(?:\.[0#]+)?|#[#,]*(?:\.[0#]+)?")
LOCALE_SHORT_DATES = {"", "general", "mm-dd-yy", "m/d/yy", "m/d/yyyy"}
MINUTE_TOKENS = ("m", "mm")
HOUR_TOKENS = ("h", "hh")
SECOND_TOKENS = ("s", "ss")


def _section(number_format: str | None) -> str:
    return BRACKETS.sub("", (number_format or "").split(";")[0])


def _iso(value: dt.date | dt.datetime | dt.time) -> str:
    if isinstance(value, dt.datetime):
        if value.time() == dt.time(0):
            return value.date().isoformat()
        return value.strftime("%Y-%m-%d %H:%M:%S" if value.second else "%Y-%m-%d %H:%M")
    if isinstance(value, dt.time):
        return value.strftime("%H:%M:%S" if value.second else "%H:%M")
    return value.isoformat()


def _tokens(section: str) -> list[tuple[bool, str]]:
    parts: list[tuple[bool, str]] = []
    index = 0
    while index < len(section):
        character = section[index]
        if character == '"':
            end = section.find('"', index + 1)
            end = len(section) if end < 0 else end
            parts.append((False, section[index + 1 : end]))
            index = end + 1
            continue
        if character == "\\" and index + 1 < len(section):
            parts.append((False, section[index + 1]))
            index += 2
            continue
        if character in "_*" and index + 1 < len(section):
            index += 2
            continue
        match = DATE_TOKEN.match(section, index)
        if match:
            parts.append((True, match[0].lower()))
            index = match.end()
            continue
        parts.append((False, character))
        index += 1
    return parts


def _is_minute(parts: list[tuple[bool, str]], position: int) -> bool:
    before = [text for is_token, text in parts[:position] if is_token]
    after = [text for is_token, text in parts[position + 1 :] if is_token]
    return bool(before and before[-1] in HOUR_TOKENS) or bool(after and after[0] in SECOND_TOKENS)


def _date_part(token: str, moment: dt.datetime, twelve_hour: bool, minute: bool) -> str:
    hour = (moment.hour % 12 or 12) if twelve_hour else moment.hour
    values = {
        "yyyy": f"{moment.year:04d}",
        "yy": f"{moment.year % 100:02d}",
        "mmmm": calendar.month_name[moment.month],
        "mmm": calendar.month_abbr[moment.month],
        "mm": f"{moment.minute:02d}" if minute else f"{moment.month:02d}",
        "m": str(moment.minute) if minute else str(moment.month),
        "dddd": calendar.day_name[moment.weekday()],
        "ddd": calendar.day_abbr[moment.weekday()],
        "dd": f"{moment.day:02d}",
        "d": str(moment.day),
        "hh": f"{hour:02d}",
        "h": str(hour),
        "ss": f"{moment.second:02d}",
        "s": str(moment.second),
        "am/pm": "AM" if moment.hour < 12 else "PM",
        "a/p": "A" if moment.hour < 12 else "P",
    }
    return values[token]


def date_text(value: dt.date | dt.datetime | dt.time, number_format: str | None) -> str:
    section = _section(number_format)
    if section.strip().lower() in LOCALE_SHORT_DATES:
        return _iso(value)
    parts = _tokens(section)
    if not any(is_token for is_token, _text in parts):
        return _iso(value)
    if isinstance(value, dt.datetime):
        moment = value
    elif isinstance(value, dt.time):
        moment = dt.datetime.combine(dt.date(1899, 12, 30), value)
    else:
        moment = dt.datetime.combine(value, dt.time(0))
    twelve_hour = any(is_token and text in ("am/pm", "a/p") for is_token, text in parts)
    pieces = []
    for position, (is_token, text) in enumerate(parts):
        if not is_token:
            pieces.append(text)
            continue
        minute = text in MINUTE_TOKENS and _is_minute(parts, position)
        pieces.append(_date_part(text, moment, twelve_hour, minute))
    return "".join(pieces).strip()


def number_text(value: int | float, number_format: str | None) -> str:
    section = _section(number_format)
    if section.strip() == "@":
        return str(value)
    percent = "%" in section
    shown = value * 100 if percent else value
    body = NUMBER_BODY.search(section) if section.strip().lower() != "general" else None
    decimals: int | None = None
    width = 0
    if body:
        whole, dot, fraction = body[0].partition(".")
        width = whole.count("0")
        if dot:
            decimals = len(fraction)
    if decimals is not None:
        text = f"{shown:.{decimals}f}"
    elif isinstance(shown, int) or (float(shown).is_integer() and abs(shown) < 1e15):
        text = str(int(shown))
    else:
        text = format(shown, ".15g")
    if width > 1:
        sign = "-" if text.startswith("-") else ""
        digits = text.lstrip("-")
        whole, dot, fraction = digits.partition(".")
        text = sign + whole.zfill(width) + dot + fraction
    return text + ("%" if percent else "")


def cell_text(value: object, number_format: str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, dt.datetime | dt.date | dt.time):
        return date_text(value, number_format)
    if isinstance(value, int | float):
        return number_text(value, number_format)
    return str(value)
