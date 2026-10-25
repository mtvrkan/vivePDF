import re

from vivepdf.ops._spreadsheet import clean_text

MARKDOWN_TAG = re.compile(
    r"</?(?:br|sup|u|mark)>|<!-- (?:Start|End) of picture text -->|<(?=[A-Za-z/!?])"
)
CODE_SPAN = re.compile(r"(`+)(?:.*?)\1")
EMPHASIS_GAP = re.compile(r"(?<=\S)(\*\*|\*|~~|_) +(?=[,.;:!?)])")
FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
PICTURE_TEXT_MARK = re.compile(r"(?:<br>)?<!-- (?:Start|End) of picture text -->")


def _inert_line(line: str) -> str:
    parts = []
    last = 0
    for match in CODE_SPAN.finditer(line):
        parts.append(_inert_text(line[last : match.start()]))
        parts.append(match.group(0))
        last = match.end()
    parts.append(_inert_text(line[last:]))
    return "".join(parts)


def _inert_text(text: str) -> str:
    inert = MARKDOWN_TAG.sub(
        lambda match: match.group(0) if len(match.group(0)) > 1 else "&lt;", text
    )
    return EMPHASIS_GAP.sub(r"\1", inert)


def _fenced(lines: list[str]):
    fence: str | None = None
    for line in lines:
        opening = FENCE.match(line)
        if fence is not None:
            if opening and opening.group(1)[0] == fence[0] and len(opening.group(1)) >= len(fence):
                fence = None
            yield line, True
        elif opening:
            fence = opening.group(1)
            yield line, True
        else:
            yield line, False


def inert_markdown(markdown: str) -> str:
    return "\n".join(
        line if fenced else _inert_line(line)
        for line, fenced in _fenced(clean_text(markdown).split("\n"))
    )


def tidy_markdown(markdown: str) -> str:
    lines: list[str] = []
    for line, fenced in _fenced(markdown.split("\n")):
        if not fenced and PICTURE_TEXT_MARK.search(line):
            line = PICTURE_TEXT_MARK.sub("", line)
            if not line.strip():
                continue
        if not fenced and not line.strip() and lines and not lines[-1].strip():
            continue
        lines.append(line)
    return "\n".join(lines)
