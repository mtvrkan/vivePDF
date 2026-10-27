import re

SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")
UNNAMED = re.compile(r"^(?:unnamed|t3font|type3)", re.IGNORECASE)
STYLE_PART = re.compile(
    r"(?:(?:semi|demi|extra|ultra)?(?:bold|light|black|heavy|thin|medium|regular|roman|book"
    r"|italic|ital|oblique|condensed|narrow|regu|medi|it|bd|bi|lt|md|rg|bk))+(?:psmt|mt|ps)?",
    re.IGNORECASE,
)
CAMEL_STYLE = re.compile(r"(?<=[a-z0-9])(?:Bold|Italic|Oblique|Regular|Medium|Light)+$")
TRAILING_WORDS = {
    "book",
    "regular",
    "bold",
    "italic",
    "oblique",
    "light",
    "medium",
    "semibold",
    "demibold",
    "black",
    "heavy",
    "thin",
    "condensed",
    "narrow",
    "tur",
    "cyr",
    "ce",
    "greek",
    "baltic",
}
SCRIPT_SUFFIX = re.compile(r"(?<=[a-z])(?:Tur|Cyr|CE)$")
FONT_SUFFIXES = ("PSMT", "MT", "PS")
NON_ALNUM = re.compile(r"[^a-z0-9]")
TIMES = "Times New Roman"
ARIAL = "Arial"
ALIASES = {
    **dict.fromkeys(
        (
            "timesnewroman",
            "times",
            "timesroman",
            "timesten",
            "timesltstd",
            "timesltpro",
            "timesnrmt",
            "nimbusromno9l",
            "nimbusroman",
            "nimbusromanno9l",
            "nimbusromd",
            "texgyretermes",
            "texgyretermesx",
            "termes",
            "liberationserif",
            "tinos",
            "freeserif",
            "ptmr",
            "ptmr8r",
            "utmr8a",
        ),
        TIMES,
    ),
    **dict.fromkeys(
        (
            "arial",
            "helvetica",
            "nimbussans",
            "nimbussansl",
            "nimbussanl",
            "texgyreheros",
            "liberationsans",
            "arimo",
            "freesans",
            "phvr",
            "phvr8r",
            "uhvr8a",
        ),
        ARIAL,
    ),
    **dict.fromkeys(
        ("couriernew", "courier", "nimbusmonl", "nimbusmono", "liberationmono", "cousine"),
        "Courier New",
    ),
}
PATTERNS = (
    (re.compile(r"^(?:cm|sf|ec)[a-z]{1,4}\d{1,4}$"), "Computer Modern"),
    (re.compile(r"^lmroman\d*"), "Latin Modern Roman"),
    (re.compile(r"^lmsans\d*"), "Latin Modern Sans"),
)


def _base(font: str) -> str:
    parts = re.split(r"[-,_]", SUBSET_PREFIX.sub("", font.strip()))
    kept = parts[:1]
    for part in parts[1:]:
        if not part or STYLE_PART.fullmatch(part):
            break
        kept.append(part)
    base = " ".join(kept).strip()
    for suffix in FONT_SUFFIXES:
        if base.endswith(suffix) and len(base) > len(suffix):
            base = base[: -len(suffix)]
            break
    base = SCRIPT_SUFFIX.sub("", CAMEL_STYLE.sub("", base))
    words = base.split(" ")
    while len(words) > 1 and words[-1].lower() in TRAILING_WORDS:
        words.pop()
    return " ".join(words)


def family_name(font: str) -> str:
    if not font or not font.strip() or UNNAMED.match(font.strip()):
        return ""
    base = _base(font)
    key = NON_ALNUM.sub("", base.lower())
    if key in ALIASES:
        return ALIASES[key]
    for pattern, name in PATTERNS:
        if pattern.match(key):
            return name
    return base


def family_key(font: str) -> str:
    return NON_ALNUM.sub("", family_name(font).lower())
