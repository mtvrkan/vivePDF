import html
import re

from lxml import etree
from lxml import html as lxml_html

INLINE_TAGS = frozenset({"b", "strong", "i", "em", "u", "s", "sub", "sup", "code", "a"})
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


def _clean(root: lxml_html.HtmlElement) -> None:
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
        href = (element.get("href") or "").strip() if tag == "a" else ""
        element.attrib.clear()
        if tag != "a":
            continue
        if SAFE_LINK.match(href) and not CONTROL.search(href):
            element.set("href", href)
        else:
            element.drop_tag()


def inline_html(fragment: str) -> str:
    source = CONTROL.sub("", fragment).strip()
    if not source:
        return ""
    try:
        root = lxml_html.fragment_fromstring(source, create_parent="div")
    except (etree.ParserError, ValueError):
        return ""
    _clean(root)
    written = etree.tostring(root, encoding="unicode", method="html")
    inner = written[len("<div>") : -len("</div>")]
    return SPACES.sub(" ", inner).strip()


def note_body(text: str, markup: str) -> str:
    cleaned = inline_html(markup) if markup else ""
    return cleaned or html.escape(text)
