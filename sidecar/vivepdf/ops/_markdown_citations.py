import html
import json
import re
from dataclasses import dataclass, field

from vivepdf.ops._html_clean import visible_text

FRONT_MATTER = re.compile(
    r"\A﻿?---[ \t]*\r?\n(?P<block>.*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|\Z)", re.DOTALL
)
META_KEY = re.compile(r"^(?P<key>[A-Za-z_][\w-]*):(?:[ \t]+(?P<value>.*?))?[ \t]*$")
LIST_ITEM = re.compile(r"^[ \t]+-[ \t]+(?P<value>.*?)[ \t]*$")
NAMED = re.compile(r"^name:[ \t]*(?P<value>.*)$")
TAG = re.compile(r"(<[^>]*>)")
VERBATIM_OPEN = re.compile(r"^<(code|pre)\b", re.IGNORECASE)
VERBATIM_CLOSE = re.compile(r"^</(code|pre)\s*>", re.IGNORECASE)
GROUP = re.compile(r"\[(?P<inner>[^\[\]\n]{0,800}?@[^\[\]\n]{0,800}?)\](?![(\[:])")
ITEM = re.compile(
    r"^\s*(?:.*?\s)?-?@(?:\{(?P<braced>[^{}]{1,200})\}|(?P<key>\w(?:[\w:.#$%&+?<>~/-]{0,198}\w)?))"
    r"\s*(?:,\s*(?P<suffix>.*?))?\s*$",
    re.DOTALL,
)
PAGE_LABEL = re.compile(r"^(?:pp?\.|pages?|ss?\.|sayfa|seite|pág\.|página)\s*", re.IGNORECASE)
HEADING = re.compile(r"<h(?P<level>[1-6])\b[^>]*>(?P<title>.*?)</h(?P=level)>", re.DOTALL)
REFS_DIV = re.compile(r"<div\s+id=\"refs\"\s*>\s*</div>")
BIBLIOGRAPHY_BLOCK = '<div data-bibliography=""></div>'
REFERENCE_WORDS = re.compile(
    r"reference|bibliograph|works cited|literatur|kaynak|référence|referencia|referência"
    r"|bibliografía|المراجع",
    re.IGNORECASE,
)
MAX_ITEMS = 50
MAX_LOCATOR = 40
MAX_META_VALUES = 20
MAX_TITLE = 100


@dataclass
class FrontMatter:
    values: dict[str, list[str]] = field(default_factory=dict)

    def first(self, key: str, limit: int) -> str:
        found = self.values.get(key, [])
        return found[0][:limit] if found else ""

    def joined(self, key: str, limit: int) -> str:
        return ", ".join(self.values.get(key, []))[:limit]


def _scalar(raw: str) -> str:
    text = raw.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        text = text[1:-1]
    named = NAMED.match(text)
    return (named.group("value").strip().strip("\"'") if named else text).strip()


def _inline_list(raw: str) -> list[str]:
    if raw.startswith("[") and raw.endswith("]"):
        return [_scalar(part) for part in raw[1:-1].split(",") if part.strip()]
    return [_scalar(raw)]


def split_front_matter(text: str) -> tuple[FrontMatter, str]:
    match = FRONT_MATTER.match(text)
    if match is None:
        return FrontMatter(), text
    meta = FrontMatter()
    current: str | None = None
    for line in match.group("block").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        item = LIST_ITEM.match(line)
        if item and current is not None:
            values = meta.values.setdefault(current, [])
            if len(values) < MAX_META_VALUES and item.group("value"):
                values.append(_scalar(item.group("value")))
            continue
        if line[0] in " \t":
            continue
        entry = META_KEY.match(line)
        if entry is None:
            return FrontMatter(), text
        current = entry.group("key").lower()
        value = (entry.group("value") or "").strip()
        meta.values[current] = (
            [] if value in ("", "|", ">") else _inline_list(value)[:MAX_META_VALUES]
        )
    if not meta.values:
        return FrontMatter(), text
    return meta, text[match.end() :]


def _locator(suffix: str | None) -> str:
    text = (suffix or "").strip()
    unlabelled = PAGE_LABEL.sub("", text)
    if unlabelled[:1].isdigit():
        text = unlabelled
    return text[:MAX_LOCATOR]


def _items(inner: str) -> list[dict[str, str]] | None:
    found: list[dict[str, str]] = []
    for part in inner.split(";"):
        match = ITEM.match(part)
        if match is None:
            return None
        key = match.group("braced") or match.group("key")
        found.append({"key": key.strip(), "locator": _locator(match.group("suffix"))})
    return found[:MAX_ITEMS] if found else None


def _cite(match: re.Match) -> str:
    items = _items(html.unescape(match.group("inner")))
    if items is None:
        return match.group(0)
    payload = html.escape(json.dumps(items, ensure_ascii=False), quote=True)
    return f'<span data-citation="{payload}"></span>'


def with_citations(body: str) -> tuple[str, bool, str]:
    parts = TAG.split(body)
    verbatim = 0
    cited = False
    for index, part in enumerate(parts):
        if index % 2 == 1:
            if VERBATIM_OPEN.match(part):
                verbatim += 1
            elif VERBATIM_CLOSE.match(part):
                verbatim = max(0, verbatim - 1)
            continue
        if verbatim == 0 and "@" in part:
            replaced = GROUP.sub(_cite, part)
            cited = cited or replaced != part
            parts[index] = replaced
    written = "".join(parts)
    if not cited:
        return written, False, ""
    if REFS_DIV.search(written):
        return REFS_DIV.sub(BIBLIOGRAPHY_BLOCK, written, count=1), True, ""
    headings = list(HEADING.finditer(written))
    trailing = headings[-1] if headings else None
    if trailing is not None and not written[trailing.end() :].strip():
        title = html.unescape(visible_text(trailing.group("title"))).strip()[:MAX_TITLE]
        if REFERENCE_WORDS.search(title):
            return written[: trailing.start()] + BIBLIOGRAPHY_BLOCK, True, title
    return written + BIBLIOGRAPHY_BLOCK, True, ""
