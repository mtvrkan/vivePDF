import re
from typing import Literal

PRESET_NAMES: tuple[str, ...] = (
    "apiKey",
    "privateKey",
    "jwt",
    "connectionString",
    "password",
    "card",
    "iban",
    "crypto",
    "tckn",
    "taxNumber",
    "passport",
    "plate",
    "ssn",
    "email",
    "phone",
    "ip",
    "mac",
    "date",
)

IBAN_COUNTRIES = (
    "AL|AD|AT|AZ|BH|BE|BA|BR|BG|CR|HR|CY|CZ|DK|DO|EE|FO|FI|FR|GE|DE|GI|GR|GL|GT|HU|IS|IE|IL|IT"
    "|JO|KZ|XK|KW|LV|LB|LI|LT|LU|MK|MT|MR|MU|MD|MC|ME|NL|NO|PK|PS|PL|PT|QA|RO|SM|SA|RS|SK|SI"
    "|ES|SE|CH|TN|TR|AE|GB|VA"
)

PRESET_PATTERNS: dict[str, str] = {
    "apiKey": (
        r"(?<![A-Za-z0-9])(?:"
        r"(?-i:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[0-9A-Z]{16}"
        r"|(?-i:AIza)[0-9A-Za-z_\-]{35}"
        r"|(?-i:gh[pousr]_)[A-Za-z0-9]{30,}"
        r"|(?-i:github_pat_)[A-Za-z0-9_]{50,}"
        r"|(?-i:xox)[abprs]-[A-Za-z0-9-]{10,}"
        r"|(?-i:sk|pk|rk)_(?-i:live|test)_[A-Za-z0-9]{16,}"
        r"|(?-i:sk-ant-)[A-Za-z0-9_\-]{20,}"
        r"|(?-i:sk-)[A-Za-z0-9_\-]{32,}"
        r"|(?-i:SG\.)[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{30,}"
        r"|(?-i:npm_)[A-Za-z0-9]{36}"
        r"|(?-i:glpat-)[A-Za-z0-9_\-]{20,}"
        r"|(?-i:hf_)[A-Za-z0-9]{30,}"
        r"|(?-i:dop_v1_)[a-f0-9]{64}"
        r"|(?-i:AC|SK)[0-9a-f]{32}"
        r")(?![A-Za-z0-9])"
    ),
    "privateKey": (
        r"(?m:^-{5}(?:BEGIN|END)[A-Z0-9 ]* PRIVATE KEY-{5}$)"
        r"|(?m:^[A-Za-z0-9+/]{60,76}={0,2}$)"
        r"|(?-i:ssh-rsa|ssh-dss|ssh-ed25519|ecdsa-sha2-nistp\d{3}) AAAA[A-Za-z0-9+/=]{20,}"
        r"|(?-i:PuTTY-User-Key-File)"
    ),
    "jwt": r"(?-i:eyJ)[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}",
    "connectionString": (
        r"(?-i:[a-z][a-z0-9+.\-]{2,})://[^\s:@/]+:[^\s:@/]+@[^\s]+"
        r"|(?-i:AccountKey)=[A-Za-z0-9+/=]{30,}"
    ),
    "card": r"\b\d{4}([ -]?)\d{4}(?:\1\d{4}){2}(?:\1\d{1,3})?\b",
    "iban": rf"(?-i:\b(?:{IBAN_COUNTRIES})) ?\d{{2}}(?: ?[A-Z0-9]){{10,28}}(?![A-Z0-9])",
    "crypto": (
        r"(?-i:\b[13](?=[a-km-zA-HJ-NP-Z1-9]{25,34}\b)"
        r"(?=[a-km-zA-HJ-NP-Z1-9]*[a-z])(?=[a-km-zA-HJ-NP-Z1-9]*[A-Z])"
        r"(?=[a-km-zA-HJ-NP-Z1-9]*\d)[a-km-zA-HJ-NP-Z1-9]{25,34})"
        r"|(?-i:bc1)[023456789acdefghjklmnpqrstuvwxyz]{25,62}"
        r"|(?-i:0x)[0-9a-fA-F]{40}(?![0-9a-fA-F])"
        r"|(?-i:\bT)[1-9A-HJ-NP-Za-km-z]{33}(?![1-9A-HJ-NP-Za-km-z])"
    ),
    "tckn": r"\b[1-9]\d{10}\b",
    "plate": r"(?-i:\b(?:0[1-9]|[1-7]\d|8[01]) ?[A-Z]{1,3} ?\d{2,5}\b)",
    "ssn": r"\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b",
    "email": r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+",
    "phone": (
        r"(?<![\d(])(?:(?:\+90|0090)[\s-]?)?(?:\(0?\d{3}\)|0?\d{3})"
        r"[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)"
    ),
    "ip": (
        r"(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}"
        r"(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])"
        r"|\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b"
        r"|\b(?:[0-9A-Fa-f]{1,4}:){1,7}:(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?"
    ),
    "mac": r"(?<![0-9A-Fa-f:.-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:.-])",
    "date": r"\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b",
}

TURKISH_I = "[iıİI]"
TURKISH_S = "[sşSŞ]"
LABEL_TAIL = r"[^\d\n]{0,14}"
LABEL_GAP = r"[^\S\n]*\n?[^\S\n]*"
SECRET_GAP = r"[^\S\n]*[:=][^\S\n]*[\"']?"
PRESET_LABELLED: dict[str, str] = {
    "tckn": (
        rf"\b(?:tckn|t\.? ?c\.? ?k\.? ?n\.?|(?:t\.? ?c\.? ?)?k{TURKISH_I}ml{TURKISH_I}k)"
        + LABEL_TAIL
        + LABEL_GAP
        + r"(?P<value>\d[\d ]{6,16}\d)"
    ),
    "iban": (
        rf"\b{TURKISH_I}ban"
        + LABEL_TAIL
        + LABEL_GAP
        + rf"(?P<value>(?-i:{IBAN_COUNTRIES}) ?\d[\dA-Z ]{{8,30}}[\dA-Z])"
    ),
    "taxNumber": (
        rf"\b(?:vkn|verg{TURKISH_I}[^\d\n]{{0,12}}no|tax[^\d\n]{{0,10}}(?:no|id))"
        + LABEL_TAIL
        + LABEL_GAP
        + r"(?P<value>\d[\d ]{7,14}\d)"
    ),
    "passport": (
        r"\b(?:pasaport|passport)"
        + LABEL_TAIL
        + LABEL_GAP
        + r"(?P<value>(?-i:[A-Z]{1,3}) ?\d{6,9})"
    ),
    "password": (
        rf"\b(?:password|passwd|pwd|parola|{TURKISH_S}{TURKISH_I}fre|secret"
        rf"|cl{TURKISH_I}ent[_ \-]?secret|ap{TURKISH_I}[_ \-]?key|apikey|access[_ \-]?key"
        rf"|auth[_ \-]?token|token|g{TURKISH_I}zl{TURKISH_I} anahtar)"
        + SECRET_GAP
        + r"(?P<value>(?=[^\s\"'<>,;]*[\d_\-+/=!@#$%^&*.?])[^\s\"'<>,;]{6,})"
    ),
}

PresetName = Literal[
    "apiKey",
    "privateKey",
    "jwt",
    "connectionString",
    "password",
    "card",
    "iban",
    "crypto",
    "tckn",
    "taxNumber",
    "passport",
    "plate",
    "ssn",
    "email",
    "phone",
    "ip",
    "mac",
    "date",
]


def _tckn_valid(value: str) -> bool:
    digits = [int(char) for char in value]
    if len(digits) != 11 or digits[0] == 0:
        return False
    odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8]
    even = digits[1] + digits[3] + digits[5] + digits[7]
    return (odd * 7 - even) % 10 == digits[9] and sum(digits[:10]) % 10 == digits[10]


def _luhn_valid(value: str) -> bool:
    digits = [int(char) for char in re.sub(r"\D", "", value)]
    if not 13 <= len(digits) <= 19:
        return False
    checksum = 0
    for position, digit in enumerate(reversed(digits)):
        if position % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit
    return checksum % 10 == 0


def _phone_valid(value: str) -> bool:
    compact = re.sub(r"[\s.()-]", "", value)
    if compact.startswith("+90"):
        compact = compact[3:]
    elif compact.startswith("0090"):
        compact = compact[4:]
    elif compact.startswith("0"):
        compact = compact[1:]
    elif re.fullmatch(r"\d{10}", value):
        return False
    return bool(re.fullmatch(r"[2-5]\d{9}", compact))


PRESET_VALIDATORS = {"tckn": _tckn_valid, "card": _luhn_valid, "phone": _phone_valid}

PRIVATE_KEY_BLOCK = re.compile(
    r"-{5}BEGIN[A-Z0-9 ]* PRIVATE KEY-{5}.{0,16000}?-{5}END[A-Z0-9 ]* PRIVATE KEY-{5}",
    re.DOTALL,
)


def private_key_blocks(text: str) -> list[str]:
    return [match.group() for match in PRIVATE_KEY_BLOCK.finditer(text)]


def preset_matches(
    text: str, presets: list[str], flags: int = re.IGNORECASE
) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for preset in presets:
        validator = PRESET_VALIDATORS.get(preset)
        taken: set[tuple[int, int]] = set()
        sources = [(PRESET_PATTERNS[preset], True)] if preset in PRESET_PATTERNS else []
        if preset in PRESET_LABELLED:
            sources.append((PRESET_LABELLED[preset], False))
        for source, strict in sources:
            for match in re.finditer(source, text, flags):
                span = match.span("value") if "value" in match.groupdict() else match.span()
                needle = text[span[0] : span[1]].strip()
                if len(needle) < 2 or span in taken:
                    continue
                if strict and validator is not None and not validator(needle):
                    continue
                taken.add(span)
                found.append((preset, needle))
    return found
