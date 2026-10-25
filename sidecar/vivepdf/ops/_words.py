import bisect
import re
import unicodedata
from collections.abc import Callable, Iterable

COMPATIBILITY_RANGES = ((0xFB00, 0xFDFF), (0xFE70, 0xFEFF), (0xFF00, 0xFFEF), (0x1D400, 0x1D7FF))
COMPATIBLE_LETTERS = {
    code: unicodedata.normalize("NFKC", chr(code))
    for start, end in COMPATIBILITY_RANGES
    for code in range(start, end + 1)
    if unicodedata.normalize("NFKC", chr(code)) != chr(code)
}
LINE_BREAK = "﷐"
SOFT_HYPHEN = "­"
HYPHENS = "-‐­"
SUFFIX_PROBE = 3
LETTERS = r"[^\W\d_]+"
WORD = re.compile(LETTERS)
TRAILING_HYPHEN = re.compile(rf"[^\W\d_][{HYPHENS}]$")
PLAIN_BREAK = re.compile(rf"({LETTERS})([{HYPHENS}])\n[ \t]*({LETTERS})(\S*)[ \t]*(\n?)")
HTML_BREAK = re.compile(rf"({LETTERS})([{HYPHENS}]){LINE_BREAK}((?:<[^>]*>)*)({LETTERS})")
MARKDOWN_BREAK = re.compile(rf"({LETTERS})([{HYPHENS}]){LINE_BREAK}([*_~` ]*)({LETTERS})")
TAG = re.compile(r"<[^>]*>")


def plain_letters(text: str) -> str:
    return text.translate(COMPATIBLE_LETTERS)


def breaks_word(previous: str, following: str) -> bool:
    return bool(TRAILING_HYPHEN.search(previous.rstrip())) and following.lstrip()[:1].isalpha()


class Vocabulary:
    def __init__(self, texts: Iterable[str]) -> None:
        self._words = {word.lower() for text in texts for word in WORD.findall(text)}
        self._ordered = sorted(self._words)

    def joins(self, left: str, mark: str, right: str) -> bool:
        if mark == SOFT_HYPHEN:
            return True
        if not right[:1].islower():
            return False
        if (left + right).lower() in self._words:
            return True
        probe = (left + right[:SUFFIX_PROBE]).lower()
        at = bisect.bisect_left(self._ordered, probe)
        return at < len(self._ordered) and self._ordered[at].startswith(probe)


def join_plain_lines(text: str, vocabulary: Vocabulary) -> str:
    def moved(match: re.Match) -> str:
        left, mark, right, tail, ending = match.groups()
        word = left + right if vocabulary.joins(left, mark, right) else left + mark + right
        last = not ending and match.end() == len(match.string)
        return word + tail + ("" if last else "\n")

    return PLAIN_BREAK.sub(moved, text)


def _join_marked(
    pattern: re.Pattern, text: str, vocabulary: Vocabulary, glue: Callable[[str], str]
) -> str:
    def joined(match: re.Match) -> str:
        left, mark, between, right = match.groups()
        if vocabulary.joins(left, mark, right):
            return left + glue(between) + right
        return left + mark + glue(between) + right

    return pattern.sub(joined, text).replace(LINE_BREAK, "")


def join_marked_html(text: str, vocabulary: Vocabulary) -> str:
    return _join_marked(HTML_BREAK, text, vocabulary, lambda between: between)


def join_marked_markdown(text: str, vocabulary: Vocabulary) -> str:
    return _join_marked(MARKDOWN_BREAK, text, vocabulary, lambda between: between.replace(" ", ""))


def html_words(markup: str) -> str:
    return TAG.sub(" ", markup)
