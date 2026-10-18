import html
import re
from collections.abc import Callable, Sequence

from lxml import etree
from lxml import html as lxml_html

INLINE_TAGS = frozenset(
    {"b", "strong", "i", "em", "u", "s", "sub", "sup", "code", "a", "br", "img"}
)
DROPPED_TAGS = frozenset(
    {
        "script",
        "style",
        "iframe",
        "object",
        "embed",
        "noscript",
        "template",
        "head",
        "title",
        "textarea",
        "select",
        "svg",
        "math",
    }
)
RUN_IN_TAGS = frozenset(
    {"span", "font", "mark", "small", "big", "abbr", "cite", "q", "dfn", "kbd", "samp", "var"}
    | {"time", "bdi", "bdo", "ins", "del", "label", "data"}
)
SAFE_LINK = re.compile(r"^(?:https?://|mailto:)", re.IGNORECASE)
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
SPACES = re.compile(r"\s+")
BREAKS = re.compile(r"\s*<br>\s*")
EDGE_BREAKS = re.compile(r"^(?:<br>)+|(?:<br>)+$")
IMAGE_TOKEN = re.compile(r"^vpimg-(\d{1,4})$")
PICTURE_URL = re.compile(r"^data:image/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$", re.IGNORECASE)
MAX_NOTE_LINES = 12
MAX_NOTE_PICTURES = 4
MAX_NOTE_PICTURE_CHARS = 200_000
MAX_ALT_CHARS = 200

Picture = Callable[[str], bool]


def embedded_picture(source: str) -> bool:
    return len(source) <= MAX_NOTE_PICTURE_CHARS and PICTURE_URL.match(source) is not None


def archived_pictures(images: Sequence[str]) -> Picture:
    def accepted(source: str) -> bool:
        match = IMAGE_TOKEN.match(source)
        if match is None or int(match.group(1)) >= len(images):
            return False
        return embedded_picture(images[int(match.group(1))])

    return accepted


def _picture(element: lxml_html.HtmlElement, picture: Picture | None) -> None:
    source = (element.get("src") or "").strip()
    alt = SPACES.sub(" ", CONTROL.sub("", element.get("alt") or "")).strip()[:MAX_ALT_CHARS]
    element.attrib.clear()
    if picture is None or not picture(source):
        element.drop_tree()
        return
    element.set("src", source)
    if alt:
        element.set("alt", alt)


def _limit(root: lxml_html.HtmlElement, tag: str, count: int) -> None:
    for element in list(root.iter(tag))[count:]:
        element.tail = " " + (element.tail or "")
        element.drop_tree()


def _clean(root: lxml_html.HtmlElement, picture: Picture | None) -> None:
    for element in reversed(list(root.iterdescendants())):
        tag = element.tag if isinstance(element.tag, str) else ""
        if not tag or tag.lower() in DROPPED_TAGS:
            element.drop_tree()
            continue
        tag = tag.lower()
        if tag not in INLINE_TAGS:
            if tag not in RUN_IN_TAGS:
                element.tail = " " + (element.tail or "")
            element.drop_tag()
            continue
        if tag == "img":
            _picture(element, picture)
            continue
        href = (element.get("href") or "").strip() if tag == "a" else ""
        element.attrib.clear()
        if tag != "a":
            continue
        if SAFE_LINK.match(href) and not CONTROL.search(href):
            element.set("href", href)
        else:
            element.drop_tag()


def inline_html(fragment: str, picture: Picture | None = None) -> str:
    source = CONTROL.sub("", fragment).strip()
    if not source:
        return ""
    try:
        root = lxml_html.fragment_fromstring(source, create_parent="div")
    except (etree.ParserError, ValueError):
        return ""
    _clean(root, picture)
    _limit(root, "br", MAX_NOTE_LINES - 1)
    _limit(root, "img", MAX_NOTE_PICTURES)
    written = etree.tostring(root, encoding="unicode", method="html")
    inner = written[len("<div>") : -len("</div>")]
    return EDGE_BREAKS.sub("", BREAKS.sub("<br>", SPACES.sub(" ", inner).strip()))


def text_body(text: str) -> str:
    lines = [SPACES.sub(" ", line).strip() for line in text.splitlines()]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    if len(lines) > MAX_NOTE_LINES:
        lines = [*lines[: MAX_NOTE_LINES - 1], " ".join(lines[MAX_NOTE_LINES - 1 :])]
    return "<br>".join(html.escape(line) for line in lines)


def note_body(text: str, markup: str, picture: Picture | None = None) -> str:
    cleaned = inline_html(markup, picture) if markup else ""
    return cleaned or text_body(text)
