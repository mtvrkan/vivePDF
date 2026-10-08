import re
import unicodedata
from dataclasses import dataclass

from vivepdf.ops._studio_cv_words import HEADINGS, MONTHS, PRESENT_WORDS

NAME_LIMIT = 200
TEXT_LIMIT = 4000

FOLDED = {
    "ı": "i",
    "’": "'",
    "‘": "'",
    "ʼ": "'",
    "´": "'",
    "–": "-",
    "—": "-",
    "‐": "-",
    "‑": "-",
    "‒": "-",
    "−": "-",
}


def _alternation(words: tuple[str, ...]) -> str:
    return "|".join(re.escape(word) for word in sorted(set(words), key=len, reverse=True))


MONTH = rf"(?:{_alternation(MONTHS)})\.?"
YEAR = r"(?:19|20)\d{2}"
DATE = (
    rf"(?:\b{MONTH}\s*,?\s*{YEAR}|\b\d{{1,2}}\s*[./]\s*{YEAR}"
    rf"|\b{YEAR}\s*[./]\s*\d{{1,2}}(?!\d)|\b{YEAR})(?!\d)"
)
PRESENT = rf"(?:{_alternation(PRESENT_WORDS)})\b"
RANGE = re.compile(
    rf"(?P<start>{DATE})\s*(?:-|~|\bto\b|\buntil\b|\bbis\b|\ba\b|\bal\b|\bau\b|\bate\b|\bhasta\b)"
    rf"\s*(?P<end>{DATE}|{PRESENT})"
)
SINCE = re.compile(rf"\b(?:since|seit|depuis|desde|dal|dalla|itibaren)\s+(?P<start>{DATE})")
SINGLE = re.compile(DATE)
PRESENT_ONLY = re.compile(rf"{PRESENT}$")
DURATION_UNIT = (
    r"(?:years?|yrs?|months?|mos?|yil|ay|jahre?|monate?|ans?|mois|anos?|meses?|anni|mesi)"
)
DURATION = re.compile(
    rf"\(\s*(?:less than a year|\d+\s*{DURATION_UNIT}\b[^)]*)\)"
    rf"|[·•]\s*\d+\s*{DURATION_UNIT}\b(?:\s*\d+\s*{DURATION_UNIT}\b)?"
)
FOOTER = re.compile(r"(?:page|sayfa|seite|pagina|pag)\.?\s*\d+\s*(?:of|/|von|de|sur|di)\s*\d+")
BULLET = re.compile(r"^\s*(?:[-•·▪■◦●○*►▸✓✔]|\d{1,2}[.)])\s+")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
URL = re.compile(
    r"(?:https?://|www\.)[^\s,;|()<>]+"
    r"|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|me|co|tr|de|fr|es|it|pt|uk|info|app|ai|eu"
    r"|us|ca|nl|be|ch|at)\b(?:/[^\s,;|()<>]*)?",
    re.IGNORECASE,
)
PHONE = re.compile(r"(?<![\w/])\+?\(?\d[\d\s().\-–]{5,}\d(?![\w/])")
LABEL = re.compile(
    r"\((?:linkedin|mobile|home|work|personal|company|portfolio|blog|other|cep|ev|iş)\)"
    r"|\b(?:e-?mail|tel|phone|telefon|mobile|gsm|cep|web|website|linkedin|github)\s*:",
    re.IGNORECASE,
)
LOCATION_PREFIX = re.compile(
    r"^(?:address|adres|location|konum|adresse|ort|wohnort|direccion|ubicacion|indirizzo"
    r"|endereco|localizacao)\s*:\s*"
)
LOCATION_WORDS = frozenset(
    (
        "remote",
        "uzaktan",
        "area",
        "bolgesi",
        "turkiye",
        "turkey",
        "germany",
        "deutschland",
        "france",
        "spain",
        "espana",
        "italy",
        "italia",
        "portugal",
        "brasil",
        "brazil",
        "usa",
        "uk",
        "netherlands",
        "remoto",
        "remote-first",
    )
)
SEPARATORS = " \t|,;·•-–—:()[]/"


@dataclass
class DateSpan:
    start: str
    end: str
    current: bool
    before: str
    after: str


SOFT_HYPHEN = "\u00ad"
LONE_SOFT_HYPHEN = re.compile(r"(?<!\S)\u00ad(?!\S)")


def fold(text: str) -> str:
    characters = []
    for character in text:
        mapped = FOLDED.get(character)
        if mapped is None:
            mapped = unicodedata.normalize("NFKD", character)[:1].lower() or character
            if len(mapped) != 1:
                mapped = character
        characters.append(mapped)
    return "".join(characters)


def plain_line(text: str) -> str:
    spaced = " ".join(text.split())
    return LONE_SOFT_HYPHEN.sub("-", spaced).replace(SOFT_HYPHEN, "")


def clip(text: str, limit: int = NAME_LIMIT) -> str:
    return text.strip()[:limit].rstrip()


def trimmed(text: str) -> str:
    return " ".join(text.split()).strip(SEPARATORS)


def heading_key(text: str) -> str:
    groups = []
    for group in re.split(r"\s{2,}", fold(text).strip()):
        tokens = group.split()
        groups.append(
            "".join(tokens) if len(tokens) >= 3 and all(len(t) == 1 for t in tokens) else group
        )
    cleaned = re.sub(r"[^\w&' ]+", " ", " ".join(groups)).replace("_", " ")
    return " ".join(cleaned.split())


_HEADING_INDEX = {
    heading_key(phrase): key for key, phrases in HEADINGS.items() for phrase in phrases
}


def heading_of(text: str) -> str | None:
    if len(text) > 60:
        return None
    return _HEADING_INDEX.get(heading_key(text))


def _without(text: str, folded: str, pattern: re.Pattern[str]) -> str:
    kept = list(text)
    for match in pattern.finditer(folded):
        kept[match.start() : match.end()] = " " * (match.end() - match.start())
    return "".join(kept)


def without_duration(text: str) -> str:
    return _without(text, fold(text), DURATION)


def find_range(text: str) -> DateSpan | None:
    folded = fold(text)
    match = RANGE.search(folded)
    if match is not None:
        start = text[match.start("start") : match.end("start")]
        end = text[match.start("end") : match.end("end")]
        current = PRESENT_ONLY.match(folded[match.start("end") : match.end("end")]) is not None
    else:
        match = SINCE.search(folded)
        if match is None:
            return None
        start = text[match.start("start") : match.end("start")]
        end, current = "", True
    before = trimmed(without_duration(text[: match.start()]))
    after = trimmed(without_duration(text[match.end() :]))
    return DateSpan(clip(start), clip(end), current, before, after)


def find_single(text: str) -> DateSpan | None:
    match = SINGLE.search(fold(text))
    if match is None:
        return None
    before = trimmed(text[: match.start()])
    after = trimmed(text[match.end() :])
    return DateSpan("", clip(text[match.start() : match.end()]), False, before, after)


def url_kind(url: str) -> str:
    folded = fold(url)
    if "linkedin.com" in folded:
        return "linkedin"
    if "github.com" in folded:
        return "github"
    return "website"


def contacts_in(text: str) -> tuple[list[tuple[str, str]], str]:
    found: list[tuple[int, str, str]] = []
    remaining = text
    for match in EMAIL.finditer(remaining):
        found.append((match.start(), "email", match.group()))
    remaining = EMAIL.sub(lambda match: " " * len(match.group()), remaining)
    for match in URL.finditer(remaining):
        value = match.group().rstrip(".,;:)-")
        found.append((match.start(), url_kind(value), value))
    remaining = URL.sub(lambda match: " " * len(match.group()), remaining)
    for match in PHONE.finditer(remaining):
        digits = sum(character.isdigit() for character in match.group())
        if 7 <= digits <= 15 and RANGE.search(fold(match.group())) is None:
            found.append((match.start(), "phone", " ".join(match.group().split())))
            remaining = remaining.replace(match.group(), " " * len(match.group()), 1)
    found.sort()
    rest = trimmed(LABEL.sub(" ", remaining))
    return [(kind, clip(value)) for _, kind, value in found], rest


def location_value(text: str) -> str:
    folded = fold(text).strip()
    prefix = LOCATION_PREFIX.match(folded)
    if prefix is not None:
        return clip(trimmed(text.strip()[prefix.end() :]))
    words = folded.replace(",", " ").split()
    if (
        not words
        or len(text) > 60
        or len(words) > 6
        or any(character.isdigit() for character in text)
        or text.rstrip().endswith(".")
    ):
        return ""
    if "," in text or LOCATION_WORDS.intersection(words):
        return clip(trimmed(text))
    return ""


LEVELS: tuple[tuple[re.Pattern[str], int], ...] = tuple(
    (re.compile(rf"\b(?:{pattern})\b"), level)
    for pattern, level in (
        (
            r"native|bilingual|mother tongue|ana ?dil|muttersprache|langue maternelle|nativ[oa]"
            r"|madrelingua|lengua materna|lingua materna|bilingue",
            5,
        ),
        (r"full professional", 4),
        (r"professional working|upper intermediate|orta ileri", 3),
        (r"limited working", 2),
        (
            r"elementary|beginner|basic|baslangic|temel|grundkenntnisse|debutant|basico"
            r"|principiante|elementare",
            1,
        ),
        (
            r"fluent|advanced|ileri|akici|fliessend|fließend|verhandlungssicher|courant|avance"
            r"|avanzado|avanzato|avancado|fluido|fluente",
            4,
        ),
        (r"intermediate|orta|gut|intermediaire|intermedio|intermediario|conversational", 3),
        (r"c1|c2", 4),
        (r"b2", 3),
        (r"b1|a2", 2),
        (r"a1", 1),
    )
)
LEVEL_FILLER = re.compile(
    r"\b(?:proficiency|level|seviye|seviyesi|niveau|nivel|livello|or|and|ve)\b"
)
PARENS = re.compile(r"\([^)]*\)")


def language_level(text: str) -> tuple[str, int]:
    folded = fold(text)
    level = next((value for pattern, value in LEVELS if pattern.search(folded)), 0)
    kept = list(text)
    for match in PARENS.finditer(folded):
        if any(pattern.search(match.group()) for pattern, _ in LEVELS):
            kept[match.start() : match.end()] = " " * (match.end() - match.start())
    name = "".join(kept)
    for pattern, _ in LEVELS:
        name = _without(name, fold(name), pattern)
    if level:
        name = _without(name, fold(name), LEVEL_FILLER)
    name = trimmed(re.sub(r"\(\s*\)", " ", name))
    return clip(name), level
