import re
from dataclasses import dataclass

import pymupdf
from docx.document import Document as WordDocument
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn
from lxml import etree

from vivepdf.ops._document_docx_style import ParagraphLook, RunLook
from vivepdf.ops._document_docx_xml import element, field_runs, tab_run, text_run, twips
from vivepdf.ops._studio_document_models import StudioDocumentSettings
from vivepdf.ops.font_library import LIBRARY
from vivepdf.ops.fonts import BUNDLED_FONTS, _family_of, family_label, system_font_index

POINTS_PER_MM = 72 / 25.4
DEFAULT_FAMILY = "DejaVu Sans"
BODY_COLOUR = "#1a1a1a"
FURNITURE_COLOUR = "#666666"
FURNITURE_PT = 8.5
MIDDLE_DOT = "  ·  "
HEADING_SCALES = {1: 2.0, 2: 1.55, 3: 1.25, 4: 1.08, 5: 1.08, 6: 1.08}
HEADING_BEFORE = {1: 1.0, 2: 1.0, 3: 0.8, 4: 0.7, 5: 0.7, 6: 0.7}
HEADING_AFTER = {1: 0.6, 2: 0.5, 3: 0.4}
BULLETS = ("•", "◦", "▪")
LEVELS = 9
LIST_STEP = 18.0
LANGUAGE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
NUMBER_TOKEN = re.compile(r"(\{n\}|\{total\})")
WORD_2013 = "15"


def font_family(font_id: str) -> str:
    kind, _, value = font_id.partition(":")
    if kind == "bundled" and value in BUNDLED_FONTS:
        return BUNDLED_FONTS[value][0]
    if kind == "library" and value in LIBRARY:
        return LIBRARY[value].name
    if kind == "system":
        entries = system_font_index().get(value) or []
        return entries[0].label if entries else value
    if kind == "imported":
        faces = _family_of(value)
        return family_label(faces[0].name) if faces else value
    return DEFAULT_FAMILY


def content_width(settings: StudioDocumentSettings) -> float:
    paper = pymupdf.paper_rect(settings.paper)
    width = paper.height if settings.landscape else paper.width
    gutter = settings.gutter_mm if settings.gutter_side == "left" else 0
    margins = settings.margin_left_mm + settings.margin_right_mm + gutter
    return width - margins * POINTS_PER_MM


def _restyle(style, paragraph: ParagraphLook | None, run: RunLook | None) -> None:
    node = style.element
    for tag in ("w:pPr", "w:rPr"):
        for old in node.findall(qn(tag)):
            node.remove(old)
    if paragraph is not None:
        node.append(paragraph.element())
    if run is not None:
        properties = run.element()
        if properties is not None:
            node.append(properties)


def _style(document: WordDocument, name: str, kind=WD_STYLE_TYPE.PARAGRAPH):
    try:
        return document.styles[name]
    except KeyError:
        return document.styles.add_style(name, kind)


def setup_styles(
    document: WordDocument, settings: StudioDocumentSettings, families: list[str], language: str
) -> None:
    size = settings.font_size
    body, heading = families[0], families[1] if len(families) > 1 else families[0]
    defaults = document.styles.element.find(qn("w:docDefaults"))
    run_defaults = RunLook(family=body, size=size, colour=BODY_COLOUR).element()
    if language and LANGUAGE.match(language):
        run_defaults.append(element("w:lang", {"w:val": language, "w:bidi": language}))
    if defaults is not None:
        defaults.getparent().remove(defaults)
    document.styles.element.insert(
        0,
        element(
            "w:docDefaults",
            children=[
                element("w:rPrDefault", children=[run_defaults]),
                element(
                    "w:pPrDefault",
                    children=[ParagraphLook(after=size * 0.6, line=settings.line_height).element()],
                ),
            ],
        ),
    )
    _restyle(document.styles["Normal"], None, None)
    for level in range(1, 7):
        _restyle(
            document.styles[f"Heading {level}"],
            ParagraphLook(
                keep_next=True,
                before=size * HEADING_BEFORE[level],
                after=size * HEADING_AFTER.get(level, 0.25),
                line=1.0,
                outline=level - 1,
            ),
            RunLook(
                family=heading, bold=True, colour=settings.accent, size=size * HEADING_SCALES[level]
            ),
        )
    _restyle(
        document.styles["Caption"],
        ParagraphLook(align="center", before=size * 0.3, after=size * 0.8),
        RunLook(size=size * 0.9),
    )
    _restyle(
        document.styles["TOC Heading"],
        ParagraphLook(after=size, keep_next=True, outline=9),
        RunLook(family=heading, bold=True, size=size * 1.7),
    )
    for level in range(1, 4):
        toc = _style(document, f"toc {level}")
        toc.base_style = document.styles["Normal"]
        _restyle(
            toc,
            ParagraphLook(
                left=(level - 1) * 12.0,
                before=4.0 if level == 1 else 0,
                after=2.0,
                tabs=(("right", content_width(settings)),),
            ),
            RunLook(bold=level == 1),
        )
    figures = _style(document, "table of figures")
    figures.base_style = document.styles["Normal"]
    _restyle(figures, ParagraphLook(after=2.0, tabs=(("right", content_width(settings)),)), None)
    notes = _style(document, "footnote text")
    notes.base_style = document.styles["Normal"]
    _restyle(notes, ParagraphLook(after=2.0, line=1.0), RunLook(size=size * 0.8))
    mark = _style(document, "footnote reference", WD_STYLE_TYPE.CHARACTER)
    _restyle(mark, None, RunLook(script="superscript"))
    reference = _style(document, "annotation reference", WD_STYLE_TYPE.CHARACTER)
    _restyle(reference, None, RunLook(size=8))
    for name, style_id in (
        ("footnote text", "FootnoteText"),
        ("footnote reference", "FootnoteReference"),
        ("annotation reference", "CommentReference"),
        ("toc 1", "TOC1"),
        ("toc 2", "TOC2"),
        ("toc 3", "TOC3"),
        ("table of figures", "TableofFigures"),
    ):
        document.styles[name].element.set(qn("w:styleId"), style_id)


class ListNumbers:
    def __init__(self, document: WordDocument) -> None:
        self.root = document.part.numbering_part.element
        abstract = [
            int(node.get(qn("w:abstractNumId"))) for node in self.root.findall(qn("w:abstractNum"))
        ]
        numbers = [int(node.get(qn("w:numId"))) for node in self.root.findall(qn("w:num"))]
        self.next_abstract = max(abstract, default=0) + 1
        self.next_number = max(numbers, default=0) + 1
        self.bullet_abstract = self._abstract(ordered=False)
        self.ordered_abstract = self._abstract(ordered=True)
        self.bullet = self._number(self.bullet_abstract)

    def _abstract(self, ordered: bool) -> int:
        identifier = self.next_abstract
        self.next_abstract += 1
        node = element("w:abstractNum", {"w:abstractNumId": str(identifier)})
        node.append(element("w:multiLevelType", {"w:val": "hybridMultilevel"}))
        for level in range(LEVELS):
            node.append(
                element(
                    "w:lvl",
                    {"w:ilvl": str(level)},
                    [
                        element("w:start", {"w:val": "1"}),
                        element("w:numFmt", {"w:val": "decimal" if ordered else "bullet"}),
                        element(
                            "w:lvlText",
                            {
                                "w:val": f"%{level + 1}."
                                if ordered
                                else BULLETS[level % len(BULLETS)]
                            },
                        ),
                        element("w:lvlJc", {"w:val": "left"}),
                        ParagraphLook(
                            left=LIST_STEP * (level + 1), first_line=-LIST_STEP
                        ).element(),
                    ],
                )
            )
        first_number = self.root.find(qn("w:num"))
        if first_number is not None:
            first_number.addprevious(node)
        else:
            self.root.append(node)
        return identifier

    def _number(self, abstract: int, level: int = 0, start: int | None = None) -> int:
        identifier = self.next_number
        self.next_number += 1
        node = element("w:num", {"w:numId": str(identifier)})
        node.append(element("w:abstractNumId", {"w:val": str(abstract)}))
        if start is not None:
            node.append(
                element(
                    "w:lvlOverride",
                    {"w:ilvl": str(level)},
                    [element("w:startOverride", {"w:val": str(start)})],
                )
            )
        self.root.append(node)
        return identifier

    def ordered(self, level: int, start: int) -> int:
        return self._number(self.ordered_abstract, level, start)


@dataclass
class SectionSpec:
    columns: int = 1
    continuous: bool = False
    number_format: str | None = None
    number_start: int | None = None
    title_page: bool = False
    centred: bool = False
    headers: tuple[tuple[str, str, str], ...] = ()


def section_properties(spec: SectionSpec, settings: StudioDocumentSettings) -> etree._Element:
    paper = pymupdf.paper_rect(settings.paper)
    width, height = (
        (paper.height, paper.width) if settings.landscape else (paper.width, paper.height)
    )
    children = [
        element(f"w:{kind}Reference", {"w:type": slot, "r:id": relation})
        for kind, slot, relation in spec.headers
    ]
    if spec.continuous:
        children.append(element("w:type", {"w:val": "continuous"}))
    size = {"w:w": twips(width), "w:h": twips(height)}
    if settings.landscape:
        size["w:orient"] = "landscape"
    children.append(element("w:pgSz", size))
    children.append(
        element(
            "w:pgMar",
            {
                "w:top": twips(settings.margin_top_mm * POINTS_PER_MM),
                "w:right": twips(settings.margin_right_mm * POINTS_PER_MM),
                "w:bottom": twips(settings.margin_bottom_mm * POINTS_PER_MM),
                "w:left": twips(settings.margin_left_mm * POINTS_PER_MM),
                "w:header": twips(settings.margin_top_mm * POINTS_PER_MM / 2),
                "w:footer": twips(settings.margin_bottom_mm * POINTS_PER_MM / 2),
                "w:gutter": twips(settings.gutter_mm * POINTS_PER_MM),
            },
        )
    )
    if spec.number_format or spec.number_start is not None:
        numbering = {}
        if spec.number_format:
            numbering["w:fmt"] = spec.number_format
        if spec.number_start is not None:
            numbering["w:start"] = str(spec.number_start)
        children.append(element("w:pgNumType", numbering))
    columns = {"w:space": twips(settings.column_gap_mm * POINTS_PER_MM)}
    if spec.columns > 1:
        columns["w:num"] = str(spec.columns)
    children.append(element("w:cols", columns))
    if spec.centred:
        children.append(element("w:vAlign", {"w:val": "center"}))
    if spec.title_page:
        children.append(element("w:titlePg"))
    return element("w:sectPr", children=children)


def _instruction(text: str, look: RunLook) -> etree._Element:
    run = element("w:r", children=[look.element()])
    code = element("w:instrText")
    code.text = text
    code.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    run.append(code)
    return run


def _total(shift: int, look: RunLook) -> list:
    if not shift:
        return field_runs("NUMPAGES", "1", look.element())
    outer = field_runs("=", "1", look.element())
    inner = field_runs("NUMPAGES", "1", look.element())
    return [
        outer[0],
        _instruction(" = ", look),
        *inner,
        _instruction(f" + {shift} ", look),
        *outer[2:],
    ]


def _number_text(settings: StudioDocumentSettings, look: RunLook) -> list:
    runs = []
    for piece in NUMBER_TOKEN.split(settings.page_number_format):
        if piece == "{n}":
            runs += field_runs("PAGE", "1", look.element())
        elif piece == "{total}":
            runs += _total(settings.page_number_start - 1, look)
        elif piece:
            runs.append(text_run(piece, look.element()))
    return runs


def _line(settings: StudioDocumentSettings, odd: bool, header: bool) -> list:
    look = RunLook(size=FURNITURE_PT, colour=FURNITURE_COLOUR)
    slots: dict[str, list] = {}
    if header and settings.header.strip():
        slots[settings.header_align] = [text_run(settings.header.strip(), look.element())]
    if not header:
        if settings.footer.strip():
            slots[settings.footer_align] = [text_run(settings.footer.strip(), look.element())]
        if settings.page_numbers != "none":
            place = settings.page_numbers
            if place == "outside":
                place = "right" if odd else "left"
            pieces = slots.setdefault(place, [])
            if pieces:
                pieces.append(text_run(MIDDLE_DOT, look.element()))
            pieces += _number_text(settings, look)
    if not slots:
        return []
    width = content_width(settings)
    paragraph = element(
        "w:p",
        children=[
            ParagraphLook(
                after=0, line=1.0, tabs=(("center", width / 2), ("right", width))
            ).element()
        ],
    )
    for index, place in enumerate(("left", "center", "right")):
        if index:
            paragraph.append(tab_run())
        for run in slots.get(place, []):
            paragraph.append(run)
    return [paragraph]


def _part(document: WordDocument, header: bool, paragraphs: list) -> str:
    part, relation = document.part.add_header_part() if header else document.part.add_footer_part()
    root = part.element
    for child in list(root):
        root.remove(child)
    for paragraph in paragraphs or [element("w:p")]:
        root.append(paragraph)
    return relation


def furniture(document: WordDocument, settings: StudioDocumentSettings, empty_first: bool) -> tuple:
    references = []
    outside = settings.page_numbers == "outside"
    for header in (True, False):
        kind = "header" if header else "footer"
        references.append((kind, "default", _part(document, header, _line(settings, True, header))))
        if outside:
            references.append(
                (kind, "even", _part(document, header, _line(settings, False, header)))
            )
        if empty_first:
            references.append((kind, "first", _part(document, header, [])))
    return tuple(references)


def blank_furniture(document: WordDocument) -> tuple:
    return tuple(
        (kind, "default", _part(document, kind == "header", [])) for kind in ("header", "footer")
    )


def finish_settings(document: WordDocument, even_odd: bool, footnotes: bool) -> None:
    root = document.settings.element
    for tag in ("w:updateFields", "w:evenAndOddHeaders", "w:footnotePr"):
        for old in root.findall(qn(tag)):
            root.remove(old)
    tab_stop = root.find(qn("w:defaultTabStop"))
    if even_odd and tab_stop is not None:
        tab_stop.addnext(element("w:evenAndOddHeaders"))
    compat = root.find(qn("w:compat"))
    for setting in root.iter(qn("w:compatSetting")):
        if setting.get(qn("w:name")) == "compatibilityMode":
            setting.set(qn("w:val"), WORD_2013)
    additions = [element("w:updateFields", {"w:val": "true"})]
    if footnotes:
        additions.append(
            element(
                "w:footnotePr",
                children=[
                    element("w:footnote", {"w:id": "-1"}),
                    element("w:footnote", {"w:id": "0"}),
                ],
            )
        )
    for addition in additions:
        if compat is not None:
            compat.addprevious(addition)
        else:
            root.append(addition)
