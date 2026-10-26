import hashlib
from dataclasses import dataclass, field

from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml.ns import nsdecls, qn
from docx.parts.document import DocumentPart
from lxml import etree

from vivepdf.ops._document_docx_xml import element, text_run

FOOTNOTES_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"
COMMENTS_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"
COMMENTS_EXTENDED_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"
)
COMMENTS_EXTENDED_RELATION = (
    "http://schemas.microsoft.com/office/2011/relationships/commentsExtended"
)
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"
W15 = "http://schemas.microsoft.com/office/word/2012/wordml"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
PARA_ID_LIMIT = 0x7FFFFFFF


class RelatedPart(Part):
    def __init__(self, partname: PackURI, content_type: str, root: etree._Element, package) -> None:
        super().__init__(partname, content_type, package=package)
        self.root = root

    @property
    def blob(self) -> bytes:
        return etree.tostring(self.root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _root(tag: str, extra: str = "") -> etree._Element:
    return etree.fromstring(f"<{tag} {nsdecls('w', 'r', 'wp', 'a', 'pic')}{extra}/>")


def footnotes_part(document_part: DocumentPart) -> RelatedPart:
    root = _root("w:footnotes")
    for kind, number, mark in (
        ("separator", "-1", "w:separator"),
        ("continuationSeparator", "0", "w:continuationSeparator"),
    ):
        note = element("w:footnote", {"w:type": kind, "w:id": number})
        note.append(element("w:p", children=[element("w:r", children=[element(mark)])]))
        root.append(note)
    part = RelatedPart(PackURI("/word/footnotes.xml"), FOOTNOTES_TYPE, root, document_part.package)
    document_part.relate_to(part, RT.FOOTNOTES)
    return part


def footnote(number: int, paragraph: etree._Element) -> etree._Element:
    note = element("w:footnote", {"w:id": str(number)})
    mark = element(
        "w:r",
        children=[
            element("w:rPr", children=[element("w:rStyle", {"w:val": "FootnoteReference"})]),
            element("w:footnoteRef"),
        ],
    )
    properties = paragraph.find(qn("w:pPr"))
    position = 0 if properties is None else 1
    paragraph.insert(position, text_run(" "))
    paragraph.insert(position, mark)
    note.append(paragraph)
    return note


def footnote_reference(number: int) -> etree._Element:
    return element(
        "w:r",
        children=[
            element("w:rPr", children=[element("w:rStyle", {"w:val": "FootnoteReference"})]),
            element("w:footnoteReference", {"w:id": str(number)}),
        ],
    )


@dataclass
class CommentEntry:
    author: str
    initials: str
    date: str
    text: str
    resolved: bool = False
    parent: int | None = None
    para_id: str = ""


@dataclass
class CommentBook:
    entries: list[CommentEntry] = field(default_factory=list)

    def add(self, entry: CommentEntry) -> int:
        number = len(self.entries)
        seed = hashlib.sha1(f"{number}:{entry.author}:{entry.date}".encode()).digest()
        entry.para_id = f"{int.from_bytes(seed[:4], 'big') % PARA_ID_LIMIT + 1:08X}"
        self.entries.append(entry)
        return number


def _comment(number: int, entry: CommentEntry) -> etree._Element:
    node = element(
        "w:comment",
        {"w:id": str(number), "w:author": entry.author, "w:initials": entry.initials},
    )
    if entry.date:
        node.set(qn("w:date"), entry.date)
    lines = entry.text.split("\n") or [""]
    for index, line in enumerate(lines):
        paragraph = element("w:p")
        if index == len(lines) - 1:
            paragraph.set(f"{{{W14}}}paraId", entry.para_id)
        if index == 0:
            paragraph.append(element("w:r", children=[element("w:annotationRef")]))
        paragraph.append(text_run(line))
        node.append(paragraph)
    return node


def comment_parts(document_part: DocumentPart, book: CommentBook) -> None:
    if not book.entries:
        return
    comments = _root("w:comments", f' xmlns:w14="{W14}"')
    for number, entry in enumerate(book.entries):
        comments.append(_comment(number, entry))
    part = RelatedPart(
        PackURI("/word/comments.xml"), COMMENTS_TYPE, comments, document_part.package
    )
    document_part.relate_to(part, RT.COMMENTS)
    extended = etree.Element(f"{{{W15}}}commentsEx", nsmap={"w15": W15, "mc": MC})
    extended.set(f"{{{MC}}}Ignorable", "w15")
    for entry in book.entries:
        item = etree.SubElement(extended, f"{{{W15}}}commentEx")
        item.set(f"{{{W15}}}paraId", entry.para_id)
        if entry.parent is not None:
            item.set(f"{{{W15}}}paraIdParent", book.entries[entry.parent].para_id)
        item.set(f"{{{W15}}}done", "1" if entry.resolved else "0")
    linked = RelatedPart(
        PackURI("/word/commentsExtended.xml"),
        COMMENTS_EXTENDED_TYPE,
        extended,
        document_part.package,
    )
    document_part.relate_to(linked, COMMENTS_EXTENDED_RELATION)


def anchor_comment(number: int, first: etree._Element, last: etree._Element) -> None:
    first.addprevious(element("w:commentRangeStart", {"w:id": str(number)}))
    end = element("w:commentRangeEnd", {"w:id": str(number)})
    last.addnext(end)
    end.addnext(
        element(
            "w:r",
            children=[
                element("w:rPr", children=[element("w:rStyle", {"w:val": "CommentReference"})]),
                element("w:commentReference", {"w:id": str(number)}),
            ],
        )
    )
