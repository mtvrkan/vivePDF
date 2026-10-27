from dataclasses import dataclass, field, replace

from lxml import etree

from vivepdf.ops._document_docx_xml import border, element, fonts, half_points, shading, twips

ALIGNMENTS = {"left": "left", "center": "center", "right": "right", "justify": "both"}


@dataclass(frozen=True)
class RunLook:
    style: str = ""
    family: str = ""
    bold: bool = False
    italic: bool = False
    strike: bool = False
    colour: str = ""
    position: float = 0
    size: float = 0
    underline: bool = False
    background: str = ""
    script: str = ""
    rtl: bool = False
    comments: frozenset[str] = frozenset()
    link: str = ""
    inserted: tuple[str, str] | None = None
    deleted: tuple[str, str] | None = None

    def with_(self, **changes) -> "RunLook":
        return replace(self, **changes)

    def element(self) -> etree._Element | None:
        children = []
        if self.style:
            children.append(element("w:rStyle", {"w:val": self.style}))
        if self.family:
            children.append(fonts(self.family))
        if self.bold:
            children += [element("w:b"), element("w:bCs")]
        if self.italic:
            children += [element("w:i"), element("w:iCs")]
        if self.strike:
            children.append(element("w:strike"))
        if self.colour:
            children.append(element("w:color", {"w:val": self.colour.lstrip("#").upper()}))
        if self.position:
            children.append(element("w:position", {"w:val": str(round(self.position * 2))}))
        if self.size:
            children += [
                element("w:sz", {"w:val": half_points(self.size)}),
                element("w:szCs", {"w:val": half_points(self.size)}),
            ]
        if self.underline:
            children.append(element("w:u", {"w:val": "single"}))
        if self.background:
            children.append(shading(self.background))
        if self.script:
            children.append(element("w:vertAlign", {"w:val": self.script}))
        if self.rtl:
            children.append(element("w:rtl"))
        return element("w:rPr", children=children) if children else None


@dataclass(frozen=True)
class ParagraphLook:
    style: str = ""
    keep_next: bool = False
    page_break_before: bool = False
    numbering: tuple[int, int] | None = None
    borders: tuple[tuple[str, float, str, float], ...] = ()
    background: str = ""
    tabs: tuple[tuple[str, float], ...] = ()
    bidi: bool = False
    before: float | None = None
    after: float | None = None
    line: float | None = None
    left: float | None = None
    right: float | None = None
    first_line: float | None = None
    align: str = ""
    outline: int | None = None
    run: RunLook = field(default_factory=RunLook)
    mark_revision: tuple[str, str, str] | None = None

    def with_(self, **changes) -> "ParagraphLook":
        return replace(self, **changes)

    def element(self, section: etree._Element | None = None) -> etree._Element:
        children = []
        if self.style:
            children.append(element("w:pStyle", {"w:val": self.style}))
        if self.keep_next:
            children.append(element("w:keepNext"))
        if self.page_break_before:
            children.append(element("w:pageBreakBefore"))
        if self.numbering:
            level, number = self.numbering
            children.append(
                element(
                    "w:numPr",
                    children=[
                        element("w:ilvl", {"w:val": str(level)}),
                        element("w:numId", {"w:val": str(number)}),
                    ],
                )
            )
        if self.borders:
            children.append(element("w:pBdr", children=[border(*edge) for edge in self.borders]))
        if self.background:
            children.append(shading(self.background))
        if self.tabs:
            children.append(
                element(
                    "w:tabs",
                    children=[
                        element("w:tab", {"w:val": kind, "w:pos": twips(position)})
                        for kind, position in self.tabs
                    ],
                )
            )
        if self.bidi:
            children.append(element("w:bidi"))
        spacing = {}
        if self.before is not None:
            spacing["w:before"] = twips(self.before)
        if self.after is not None:
            spacing["w:after"] = twips(self.after)
        if self.line is not None:
            spacing["w:line"] = str(round(self.line * 240))
            spacing["w:lineRule"] = "auto"
        if spacing:
            children.append(element("w:spacing", spacing))
        indent = {}
        if self.left is not None:
            indent["w:left"] = twips(self.left)
        if self.right is not None:
            indent["w:right"] = twips(self.right)
        if self.first_line is not None:
            key = "w:firstLine" if self.first_line >= 0 else "w:hanging"
            indent[key] = twips(abs(self.first_line))
        if indent:
            children.append(element("w:ind", indent))
        if self.align in ALIGNMENTS:
            children.append(element("w:jc", {"w:val": ALIGNMENTS[self.align]}))
        if self.outline is not None:
            children.append(element("w:outlineLvl", {"w:val": str(self.outline)}))
        if section is not None:
            children.append(section)
        return element("w:pPr", children=children)
