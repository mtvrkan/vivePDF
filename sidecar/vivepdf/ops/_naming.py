import datetime
import re

INVALID_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
TOKEN = re.compile(r"\{([^{}]+)\}")
MAX_NAME_LENGTH = 120
MAX_NAME_BYTES = 180
FALLBACK_NAME = "output"
PORT_DIGITS = "0123456789¹²³"
RESERVED_NAMES = {
    "con",
    "prn",
    "aux",
    "nul",
    "conin$",
    "conout$",
    *(f"com{digit}" for digit in PORT_DIGITS),
    *(f"lpt{digit}" for digit in PORT_DIGITS),
}


def _clip_bytes(text: str, limit: int) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= limit:
        return text
    return encoded[:limit].decode("utf-8", errors="ignore")


def sanitize_file_name(value: str) -> str:
    text = INVALID_CHARS.sub("-", value)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"(?:\s*-\s*)+", "-", text)
    text = re.sub(r"(?:\s*_\s*){2,}", "_", text)
    text = text.strip(" ._-")
    text = _clip_bytes(text[:MAX_NAME_LENGTH], MAX_NAME_BYTES).rstrip(" .")
    head, dot, tail = text.partition(".")
    if head.rstrip(" ").lower() in RESERVED_NAMES:
        text = f"{head}-file{dot}{tail}"
    return text or FALLBACK_NAME


def render_name(pattern: str, values: dict[str, object]) -> str:
    enriched = dict(values)
    now = datetime.datetime.now()
    enriched.setdefault("date", now.date().isoformat())
    enriched.setdefault("time", now.strftime("%H-%M-%S"))
    enriched.setdefault("year", now.year)
    text = TOKEN.sub(
        lambda match: str(enriched[match[1]]) if match[1] in enriched else match[0], pattern
    )
    return sanitize_file_name(text)


def unique_name(name: str, taken: set[str]) -> str:
    candidate = name
    counter = 2
    while candidate.lower() in taken:
        candidate = f"{name}-{counter}"
        counter += 1
    taken.add(candidate.lower())
    return candidate
