import re

from lxml import etree
from lxml import html as lxml_html

from vivepdf.ops._document_docx_style import ParagraphLook, RunLook
from vivepdf.ops._document_docx_xml import element, field_end, field_start, text_run
from vivepdf.ops._studio_document_models import StudioDocumentSettings

SPACES = re.compile(r"\s+")
HEADING_TAGS = {f"h{level}": level for level in range(1, 7)}
SEQUENCES = {"figure": "Figure", "table": "Table"}


def _plain(node: etree._Element) -> str:
    return SPACES.sub(" ", node.text_content()).strip()


def outline(root: lxml_html.HtmlElement, depth: int) -> list[tuple[int, str]]:
    found = []
    for node in root.iter(*HEADING_TAGS):
        level = HEADING_TAGS[node.tag]
        title = _plain(node)
        if level <= depth and title:
            found.append((level, title))
    return found


def captions(root: lxml_html.HtmlElement, kind: str) -> list[str]:
    return [
        _plain(node)
        for node in root.iter("p")
        if "caption" in (node.get("class") or "").split() and node.get("data-caption") == kind
    ]


def _paragraph(look: ParagraphLook, runs: list) -> etree._Element:
    return element("w:p", children=[look.element(), *runs])


def _listing(title: str, instruction: str, rows: list[tuple[str, str]]) -> list[etree._Element]:
    paragraphs = []
    if title.strip():
        paragraphs.append(
            _paragraph(ParagraphLook(style="TOCHeading", outline=9), [text_run(title.strip())])
        )
    if not rows:
        paragraphs.append(_paragraph(ParagraphLook(), [*field_start(instruction), field_end()]))
        return paragraphs
    for index, (style, text) in enumerate(rows):
        runs = [text_run(text)]
        if index == 0:
            runs = [*field_start(instruction), *runs]
        if index == len(rows) - 1:
            runs.append(field_end())
        paragraphs.append(_paragraph(ParagraphLook(style=style), runs))
    return paragraphs


def front_matter(settings: StudioDocumentSettings, root: lxml_html.HtmlElement) -> list[list]:
    parts = []
    entries = outline(root, settings.toc_depth)
    if settings.toc and entries:
        rows = [(f"TOC{level}", title) for level, title in entries]
        parts.append(
            _listing(settings.toc_title, f'TOC \\o "1-{settings.toc_depth}" \\h \\z \\u', rows)
        )
    for kind, wanted, title in (
        ("figure", settings.figure_list, settings.figure_list_title),
        ("table", settings.table_list, settings.table_list_title),
    ):
        listed = captions(root, kind)
        if wanted and listed:
            rows = [("TableofFigures", text) for text in listed]
            parts.append(_listing(title, f'TOC \\h \\z \\c "{SEQUENCES[kind]}"', rows))
    return parts


def cover(
    settings: StudioDocumentSettings, title: str, heading_family: str
) -> list[etree._Element]:
    size = settings.font_size
    lines = [
        (
            settings.title.strip() or title,
            RunLook(family=heading_family, bold=True, size=size * 2.6, colour=settings.accent),
            size * 1.2,
        ),
        (settings.subtitle.strip(), RunLook(family=heading_family, size=size * 1.5), size * 3),
        (settings.author.strip(), RunLook(size=size * 1.15), size * 0.4),
        (settings.date.strip(), RunLook(size=size, colour="#555555"), 0),
    ]
    return [
        _paragraph(
            ParagraphLook(align="center", after=after, line=1.1), [text_run(text, look.element())]
        )
        for text, look, after in lines
        if text
    ]
