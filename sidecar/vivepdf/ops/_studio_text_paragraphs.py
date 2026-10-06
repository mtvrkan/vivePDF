import unicodedata

from vivepdf.ops._studio_models import StudioTextItem
from vivepdf.ops._studio_text import REGULAR_WEIGHT, Paragraph, Style, base_style, run_style
from vivepdf.ops.create_bulk import PLACEHOLDER, fill_placeholders

DOTLESS_LANGUAGES = {"tr", "az"}
DEFAULT_FONT_ID = "bundled:dejavu-sans"
BULLETS = {"bullet": "•", "dash": "–", "check": "✓"}
WORD_MARKS = {"'", "’", "ʼ"}
ROMAN = (
    (1000, "m"),
    (900, "cm"),
    (500, "d"),
    (400, "cd"),
    (100, "c"),
    (90, "xc"),
    (50, "l"),
    (40, "xl"),
    (10, "x"),
    (9, "ix"),
    (5, "v"),
    (4, "iv"),
    (1, "i"),
)


def _dotless(language: str) -> bool:
    return language.split("-")[0].lower() in DOTLESS_LANGUAGES


def _upper_char(char: str, language: str) -> str:
    return "İ" if char == "i" and _dotless(language) else char.upper()


def _lower_char(char: str, language: str) -> str:
    if _dotless(language) and char in ("I", "İ"):
        return "ı" if char == "I" else "i"
    return char.lower()


def _inside_word(char: str) -> bool:
    return bool(char) and (unicodedata.category(char)[0] in "LNM" or char in WORD_MARKS)


def case_texts(texts: list[str], mode: str, language: str) -> list[str]:
    if mode == "none":
        return texts
    previous = ""
    result: list[str] = []
    for text in texts:
        chars: list[str] = []
        for char in text:
            if mode == "upper":
                chars.append(_upper_char(char, language))
            elif mode == "lower":
                chars.append(_lower_char(char, language))
            elif unicodedata.category(char).startswith("L") and not _inside_word(previous):
                chars.append(_upper_char(char, language))
            else:
                chars.append(char)
            previous = char
        result.append("".join(chars))
    return result


def upper(text: str, language: str) -> str:
    return case_texts([text], "upper", language)[0]


def _alpha(count: int) -> str:
    label = ""
    while count > 0:
        count -= 1
        label = chr(97 + count % 26) + label
        count //= 26
    return label


def _roman(count: int) -> str:
    label = ""
    for amount, symbol in ROMAN:
        while count >= amount:
            label += symbol
            count -= amount
    return label


def marker_text(kind: str, count: int) -> str | None:
    if kind == "none":
        return None
    if kind in BULLETS:
        return BULLETS[kind]
    if kind == "decimal":
        return f"{count}."
    if kind == "alpha":
        return f"{_alpha(count)})"
    return f"{_roman(count)}."


def list_markers(paragraphs: list[tuple[str, int]]) -> list[str | None]:
    counters: list[tuple[str, int]] = []
    markers: list[str | None] = []
    for kind, level in paragraphs:
        if kind == "none":
            counters = []
            markers.append(None)
            continue
        counters = counters[: level + 1]
        while len(counters) <= level:
            counters.append(("none", 0))
        current_kind, current_count = counters[level]
        count = current_count + 1 if current_kind == kind else 1
        counters[level] = (kind, count)
        markers.append(marker_text(kind, count))
    return markers


def has_placeholders(item: StudioTextItem) -> bool:
    return any(PLACEHOLDER.search(run.text) for run in item.runs)


def item_language(item: StudioTextItem, language: str) -> str:
    return item.language or language


def _lines_of(text: str) -> list[str]:
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


Split = list[tuple[tuple[str, int], list[tuple[str, Style]]]]


def _split(item: StudioTextItem) -> Split:
    def attributes(index: int) -> tuple[str, int]:
        if index < len(item.paragraphs):
            paragraph = item.paragraphs[index]
            return paragraph.list, paragraph.level
        return "none", 0

    split: Split = [(attributes(0), [])]
    for run in item.runs:
        style = run_style(item, run)
        for index, part in enumerate(_lines_of(run.text)):
            if index:
                split.append((attributes(len(split)), []))
            if part:
                split[-1][1].append((part, style))
    return split


def _filled(split: Split, values: dict[str, str]) -> Split:
    filled: Split = []
    for attributes, pieces in split:
        current: Split = [(attributes, [])]
        for part, style in pieces:
            for index, chunk in enumerate(_lines_of(fill_placeholders(part, values))):
                if index:
                    current.append((attributes, []))
                if chunk:
                    current[-1][1].append((chunk, style))
        filled.extend(current)
    return filled


def _marker_style(item: StudioTextItem, kind: str, pieces: list[tuple[str, Style]]) -> Style:
    first = pieces[0][1] if pieces else base_style(item)
    if kind == "check":
        return Style(
            DEFAULT_FONT_ID, REGULAR_WEIGHT, False, False, False, first.color, item.font_size
        )
    return Style(first.font_id, first.weight, False, False, False, first.color, item.font_size)


def text_paragraphs(item: StudioTextItem, values: dict[str, str], language: str) -> list[Paragraph]:
    split = _split(item)
    if values:
        split = _filled(split, values)
    markers = list_markers([attributes for attributes, _ in split])
    if len(split) > 1 and not split[-1][1]:
        split, markers = split[:-1], markers[:-1]
    texts: list[str] = []
    for _, pieces in split:
        texts.extend(part for part, _ in pieces)
        texts.append("\n")
    cased = iter(case_texts(texts, item.case, item_language(item, language)))
    paragraphs: list[Paragraph] = []
    for ((kind, level), pieces), marker in zip(split, markers, strict=True):
        styled = [(next(cased), style) for _, style in pieces]
        next(cased)
        paragraphs.append(Paragraph(kind, level, styled, marker, _marker_style(item, kind, pieces)))
    return paragraphs
