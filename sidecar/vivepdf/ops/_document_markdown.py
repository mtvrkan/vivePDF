import re

from lxml import etree
from lxml import html as lxml_html

from vivepdf.ops._document_notes import note_bodies
from vivepdf.ops._studio_document_models import StudioDocumentContent

HEADINGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}
LISTS = frozenset({"ul", "ol"})
BLOCK_TAGS = frozenset(
    {"p", "li", "blockquote", "pre", "hr", "table", "div", "section", *LISTS, *HEADINGS}
)
DROPPED_TAGS = frozenset({"script", "style", "template", "head", "title"})
SKIPPED_CLASSES = frozenset({"page-break", "section-break"})
SPECIAL = re.compile(r"([\\`*_\[\]<>~|])")
ENTITY = re.compile(r"&(?=#?\w+;)")
LINE_START = re.compile(r"^( *)(?:([#+\-=])|(\d+)([.)]))(?= |$)", re.MULTILINE)
SPACES = re.compile(r"[ \t\r\n\f\v]+")
BACKTICKS = re.compile(r"`+")
NOTE_ID = re.compile(r"^fnref-(\d+)$")
IMAGE_TOKEN = re.compile(r"^vpimg-(\d+)$")
DATA_IMAGE = re.compile(r"^data:image/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$", re.IGNORECASE)
UNSAFE_DESTINATION = re.compile(r"[\s()<>]")
CHECKED = "☑"
UNCHECKED = "☐"
HARD_BREAK = "\\\n"
MAX_COLSPAN = 100


def _tag(element: etree._Element) -> str:
    return element.tag.lower() if isinstance(element.tag, str) else ""


def _classes(element: etree._Element) -> set[str]:
    return set((element.get("class") or "").split())


def _escaped(text: str) -> str:
    escaped = SPECIAL.sub(r"\\\1", SPACES.sub(" ", text))
    return ENTITY.sub(lambda _match: "\\&", escaped)


def _code_span(text: str) -> str:
    runs = [len(run) for run in BACKTICKS.findall(text)]
    fence = "`" * (max(runs, default=0) + 1)
    padded = f" {text} " if text.startswith(("`", " ")) or text.endswith(("`", " ")) else text
    return f"{fence}{padded}{fence}"


def _fenced(text: str) -> str:
    runs = [len(run) for run in BACKTICKS.findall(text)]
    fence = "`" * max(3, max(runs, default=0) + 1)
    return f"{fence}\n{text.rstrip(chr(10))}\n{fence}"


def _destination(href: str) -> str:
    if not UNSAFE_DESTINATION.search(href):
        return href
    return "<" + SPACES.sub("%20", href).replace("<", "%3C").replace(">", "%3E") + ">"


def _delimited(inner: str, mark: str) -> str:
    core = inner.strip(" ")
    if not core:
        return inner
    lead = inner[: len(inner) - len(inner.lstrip(" "))]
    trail = inner[len(inner.rstrip(" ")) :]
    return f"{lead}{mark}{core}{mark}{trail}"


def _escaped_start(match: re.Match) -> str:
    if match.group(2):
        return f"{match.group(1)}\\{match.group(2)}"
    return f"{match.group(1)}{match.group(3)}\\{match.group(4)}"


def _trimmed(text: str) -> str:
    text = text.strip(" ")
    while text.startswith(HARD_BREAK):
        text = text[len(HARD_BREAK) :].lstrip(" ")
    while text.endswith(HARD_BREAK):
        text = text[: -len(HARD_BREAK)].rstrip(" ")
    return LINE_START.sub(_escaped_start, text.replace(HARD_BREAK + " ", HARD_BREAK))


def _indented(text: str, width: int) -> str:
    pad = " " * width
    return "\n".join(pad + line if line else line for line in text.split("\n"))


class MarkdownWriter:
    def __init__(self, images: list[str], note_count: int) -> None:
        self.images = images
        self.note_count = note_count
        self.notes: list[int] = []
        self.in_cell = False

    def picture(self, element: etree._Element) -> str:
        match = IMAGE_TOKEN.match(element.get("src") or "")
        if match is None or int(match.group(1)) >= len(self.images):
            return ""
        source = self.images[int(match.group(1))]
        if not DATA_IMAGE.match(source):
            return ""
        alt = SPECIAL.sub(r"\\\1", SPACES.sub(" ", element.get("alt") or "").strip())
        return f"![{alt}]({source})"

    def reference(self, element: etree._Element) -> str:
        match = NOTE_ID.match(element.get("id") or "")
        if match is None or not 1 <= int(match.group(1)) <= self.note_count:
            return ""
        number = int(match.group(1))
        if number not in self.notes:
            self.notes.append(number)
        return f"[^{number}]"

    def inline_children(self, element: etree._Element) -> str:
        parts = [_escaped(element.text or "")]
        for child in element:
            parts.append(self.inline(child))
            parts.append(_escaped(child.tail or ""))
        return "".join(parts)

    def inline(self, element: etree._Element) -> str:
        tag = _tag(element)
        if not tag or tag in DROPPED_TAGS:
            return ""
        if tag in ("strong", "b"):
            return _delimited(self.inline_children(element), "**")
        if tag in ("em", "i"):
            return _delimited(self.inline_children(element), "*")
        if tag in ("s", "del", "strike"):
            return _delimited(self.inline_children(element), "~~")
        if tag == "code":
            return _code_span(SPACES.sub(" ", element.text_content()))
        if tag == "sup" and "fn-ref" in _classes(element):
            return self.reference(element)
        if tag in ("u", "sub", "sup"):
            inner = self.inline_children(element)
            return f"<{tag}>{inner}</{tag}>" if inner.strip() else inner
        if tag == "a":
            inner = self.inline_children(element)
            href = (element.get("href") or "").strip()
            if not href or not inner.strip():
                return inner
            return f"[{inner}]({_destination(href)})"
        if tag == "br":
            return "<br>" if self.in_cell else HARD_BREAK
        if tag == "img":
            return self.picture(element)
        if tag in BLOCK_TAGS:
            return " ".join(self.blocks(element))
        return self.inline_children(element)

    def blocks(self, parent: etree._Element, kinds: list[str] | None = None) -> list[str]:
        found: list[str] = []
        pending: list[str] = [_escaped(parent.text or "")]

        def flush() -> None:
            text = _trimmed("".join(pending))
            pending.clear()
            if text.strip():
                found.append(text)
                if kinds is not None:
                    kinds.append("text")

        for child in parent:
            tag = _tag(child)
            if tag in BLOCK_TAGS:
                flush()
                written = self.block(child)
                found.extend(written)
                if kinds is not None:
                    kinds.extend(["list" if tag in LISTS else tag] * len(written))
            elif tag:
                pending.append(self.inline(child))
            pending.append(_escaped(child.tail or ""))
        flush()
        return found

    def block(self, element: etree._Element) -> list[str]:
        tag = _tag(element)
        if tag in HEADINGS:
            text = _trimmed(self.inline_children(element).replace(HARD_BREAK, " "))
            return [f"{'#' * HEADINGS[tag]} {text}"] if text else []
        if tag in LISTS:
            listed = self.listed(element)
            return [listed] if listed else []
        if tag == "blockquote":
            inner = "\n\n".join(self.blocks(element))
            if not inner:
                return []
            return ["\n".join(f"> {line}" if line else ">" for line in inner.split("\n"))]
        if tag == "pre":
            return [_fenced(element.text_content())]
        if tag == "hr":
            return ["---"]
        if tag == "table":
            table = self.table(element)
            return [table] if table else []
        if _classes(element) & SKIPPED_CLASSES:
            return []
        return self.blocks(element)

    def listed(self, element: etree._Element) -> str:
        ordered = _tag(element) == "ol"
        tasks = "tasks" in _classes(element)
        try:
            number = max(0, int(element.get("start") or 1)) if ordered else 1
        except ValueError:
            number = 1
        items: list[str] = []
        for item in element:
            if _tag(item) != "li":
                continue
            kinds: list[str] = []
            parts = self.blocks(item, kinds)
            marker = f"{number}." if ordered else "-"
            number += 1
            if tasks and parts and kinds[0] != "list" and parts[0][:1] in (CHECKED, UNCHECKED):
                marker = f"- [{'x' if parts[0][0] == CHECKED else ' '}]"
                parts[0] = parts[0][1:].lstrip()
            body = ""
            for index, part in enumerate(parts):
                if index:
                    body += "\n" if kinds[index] == "list" else "\n\n"
                body += part
            width = len(marker) + 1
            items.append(f"{marker} {_indented(body, width)[width:]}".rstrip())
        return "\n".join(items)

    def cell(self, element: etree._Element) -> str:
        self.in_cell = True
        try:
            parts = self.blocks(element)
        finally:
            self.in_cell = False
        return "<br>".join(part.replace("\n", "<br>") for part in parts)

    def table(self, element: etree._Element) -> str:
        rows: list[list[str]] = []
        for row in element.iter("tr"):
            cells: list[str] = []
            for cell in row:
                if _tag(cell) not in ("td", "th"):
                    continue
                cells.append(self.cell(cell))
                try:
                    span = int(cell.get("colspan") or 1)
                except ValueError:
                    span = 1
                cells.extend([""] * (min(max(span, 1), MAX_COLSPAN) - 1))
            if cells:
                rows.append(cells)
        if not rows:
            return ""
        width = max(len(row) for row in rows)
        lines = []
        for index, row in enumerate(rows):
            lines.append("| " + " | ".join(row + [""] * (width - len(row))) + " |")
            if index == 0:
                lines.append("|" + "|".join([" --- "] * width) + "|")
        return "\n".join(lines)

    def note(self, body: str) -> str:
        root = lxml_html.fragment_fromstring(body, create_parent="span")
        return _trimmed(self.inline_children(root)).replace(HARD_BREAK, " ")


def document_markdown(content: StudioDocumentContent) -> str:
    bodies = note_bodies(content.footnotes, content.footnote_html)
    writer = MarkdownWriter(content.images, len(bodies))
    try:
        root = lxml_html.fragment_fromstring(content.html, create_parent="div")
    except (etree.ParserError, ValueError):
        return "\n"
    text = "\n\n".join(writer.blocks(root))
    definitions = [f"[^{number}]: {writer.note(bodies[number - 1])}" for number in writer.notes]
    if definitions:
        text += "\n\n" + "\n".join(definitions)
    return text.strip() + "\n"
