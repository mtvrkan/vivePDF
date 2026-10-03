import html
import re

ORDERED_ITEM = re.compile(r"^\s*(\d{1,4})[.)]\s+(.*)$")
BULLET_ITEM = re.compile(r"^\s*[-*•–]\s+(.*)$")
HEADING_MAX_CHARS = 90
SHORT_LINE_CHARS = 60
MIN_HEADING_LETTERS = 2


def is_heading(line: str) -> bool:
    stripped = line.strip()
    if not stripped or len(stripped) > HEADING_MAX_CHARS or stripped.endswith((".", ",", ";")):
        return False
    letters = [char for char in stripped if char.isalpha()]
    if len(letters) < MIN_HEADING_LETTERS:
        return False
    return not any(char.islower() for char in letters)


def _list_html(lines: list[str]) -> str | None:
    ordered = ORDERED_ITEM.match(lines[0])
    bullet = BULLET_ITEM.match(lines[0])
    if not ordered and not bullet:
        return None
    pattern = ORDERED_ITEM if ordered else BULLET_ITEM
    items: list[list[str]] = []
    for line in lines:
        match = pattern.match(line)
        if match:
            items.append([match.group(match.lastindex or 1).strip()])
        else:
            items[-1].append(line.strip())
    body = "".join(f"<li>{html.escape(' '.join(item))}</li>" for item in items)
    if ordered:
        start = int(ordered.group(1))
        start_attribute = f' start="{start}"' if start != 1 else ""
        return f"<ol{start_attribute}>{body}</ol>"
    return f"<ul>{body}</ul>"


def _paragraph_html(lines: list[str]) -> str:
    stripped = [line.strip() for line in lines]
    if len(stripped) > 1 and all(len(line) <= SHORT_LINE_CHARS for line in stripped):
        return '<p class="lines">' + "<br/>".join(html.escape(line) for line in stripped) + "</p>"
    return "<p>" + html.escape(" ".join(stripped)) + "</p>"


def _is_item(line: str) -> bool:
    return bool(ORDERED_ITEM.match(line) or BULLET_ITEM.match(line))


def _block_html(lines: list[str]) -> list[str]:
    whole_list = len(lines) > 1 and all(_is_item(line) for line in lines)
    if not whole_list and is_heading(lines[0]):
        rest = lines[1:]
        return [f"<h2>{html.escape(lines[0].strip())}</h2>", *(_block_html(rest) if rest else [])]
    listing = _list_html(lines)
    if listing is not None:
        return [listing]
    return [_paragraph_html(lines)]


def plain_text_html(text: str) -> str:
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if line.strip():
            current.append(line.rstrip())
        elif current:
            blocks.append(current)
            current = []
    if current:
        blocks.append(current)
    parts: list[str] = []
    for block in blocks:
        parts.extend(_block_html(block))
    return "\n".join(parts)
