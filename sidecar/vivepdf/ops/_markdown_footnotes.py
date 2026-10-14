import html
import re

from vivepdf.ops._html_clean import visible_text
from vivepdf.ops._studio_document_models import MAX_FOOTNOTE_CHARS, MAX_FOOTNOTES

DEFINITION = re.compile(r"^ {0,3}\[\^(?P<label>[^\]\s]{1,100})\]:[ \t]?(?P<text>.*)$")
FENCE = re.compile(r"^ {0,3}(?P<fence>`{3,}|~{3,})")
HEADING = re.compile(r"^ {0,3}#{1,6}(?:[ \t]|$)")
INDENTED = re.compile(r"^(?: {4}|\t)")
REFERENCE = re.compile(r"\[\^(?P<label>[^\]\s]{1,100})\]")
TAG = re.compile(r"(<[^>]*>)")
VERBATIM_OPEN = re.compile(r"^<(code|pre)\b", re.IGNORECASE)
VERBATIM_CLOSE = re.compile(r"^</(code|pre)\s*>", re.IGNORECASE)
SPACES = re.compile(r"\s+")


def _key(label: str) -> str:
    return SPACES.sub(" ", label).strip().casefold()


def _plain(raw: str) -> str:
    from markdown_it import MarkdownIt

    rendered = MarkdownIt("commonmark").renderInline(raw)
    text = html.unescape(visible_text(rendered))
    return SPACES.sub(" ", text).strip()[:MAX_FOOTNOTE_CHARS]


def _fence_closes(line: str, fence: str) -> bool:
    match = FENCE.match(line)
    if match is None:
        return False
    found = match.group("fence")
    rest = line[match.end() :].strip()
    return found[0] == fence[0] and len(found) >= len(fence) and not rest


def split_definitions(text: str) -> tuple[str, dict[str, str]]:
    lines = text.replace("\r\n", "\n").split("\n")
    kept: list[str] = []
    raw: dict[str, list[list[str]]] = {}
    fence: str | None = None
    current: list[list[str]] | None = None
    after_blank = False
    for line in lines:
        if fence is not None:
            kept.append(line)
            if _fence_closes(line, fence):
                fence = None
            continue
        if current is not None:
            if not line.strip():
                after_blank = True
                continue
            starts_block = (
                DEFINITION.match(line) or FENCE.match(line) or HEADING.match(line)
            ) is not None
            if after_blank and INDENTED.match(line):
                current.append([line.strip()])
                after_blank = False
                continue
            if not after_blank and not starts_block:
                current[-1].append(line.strip())
                continue
            current = None
            if after_blank:
                kept.append("")
            after_blank = False
        definition = DEFINITION.match(line)
        if definition is not None:
            paragraphs: list[list[str]] = [[definition.group("text").strip()]]
            key = _key(definition.group("label"))
            if key not in raw:
                raw[key] = paragraphs
            current = paragraphs
            after_blank = False
            continue
        opening = FENCE.match(line)
        if opening is not None:
            fence = opening.group("fence")
        kept.append(line)
    notes = {
        key: _plain(" ".join(" ".join(part for part in block if part) for block in paragraphs))
        for key, paragraphs in raw.items()
    }
    return "\n".join(kept), notes


def with_footnotes(body: str, notes: dict[str, str]) -> str:
    if not notes:
        return body
    parts = TAG.split(body)
    verbatim = 0
    used = 0

    def replace(match: re.Match) -> str:
        nonlocal used
        note = notes.get(_key(html.unescape(match.group("label"))))
        if note is None or used >= MAX_FOOTNOTES:
            return match.group(0)
        used += 1
        return f'<sup data-footnote="{html.escape(note, quote=True)}"></sup>'

    for index, part in enumerate(parts):
        if index % 2 == 1:
            if VERBATIM_OPEN.match(part):
                verbatim += 1
            elif VERBATIM_CLOSE.match(part):
                verbatim = max(0, verbatim - 1)
            continue
        if verbatim == 0 and "[^" in part:
            parts[index] = REFERENCE.sub(replace, part)
    return "".join(parts)
