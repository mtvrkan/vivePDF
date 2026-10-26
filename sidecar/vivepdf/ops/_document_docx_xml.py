import re
from collections.abc import Iterable

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from lxml import etree

POINT_TWIPS = 20
HALF_POINTS = 2
EMU_PER_POINT = 12700
SPACE_SENSITIVE = re.compile(r"^\s|\s$|\s\s")
INVALID_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")


def twips(points: float) -> str:
    return str(round(points * POINT_TWIPS))


def half_points(points: float) -> str:
    return str(max(2, round(points * HALF_POINTS)))


def xml_text(text: str) -> str:
    return INVALID_XML.sub("", text)


def element(
    tag: str, attributes: dict[str, str] | None = None, children: Iterable = ()
) -> etree._Element:
    node = OxmlElement(tag)
    for key, value in (attributes or {}).items():
        node.set(qn(key), value)
    for child in children:
        if child is not None:
            node.append(child)
    return node


def text_run(text: str, properties: etree._Element | None = None) -> etree._Element:
    run = element("w:r", children=[properties])
    node = element("w:t")
    node.text = xml_text(text)
    if SPACE_SENSITIVE.search(node.text):
        node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    run.append(node)
    return run


def field_runs(instruction: str, shown: str, properties: etree._Element | None = None) -> list:
    def copied() -> etree._Element | None:
        return None if properties is None else etree.fromstring(etree.tostring(properties))

    instruction_run = element("w:r", children=[copied()])
    code = element("w:instrText")
    code.text = f" {instruction} "
    code.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    instruction_run.append(code)
    return [
        element("w:r", children=[copied(), element("w:fldChar", {"w:fldCharType": "begin"})]),
        instruction_run,
        element("w:r", children=[copied(), element("w:fldChar", {"w:fldCharType": "separate"})]),
        text_run(shown, copied()),
        element("w:r", children=[copied(), element("w:fldChar", {"w:fldCharType": "end"})]),
    ]


def field_start(instruction: str) -> list:
    code = element("w:instrText")
    code.text = f" {instruction} "
    code.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return [
        element("w:r", children=[element("w:fldChar", {"w:fldCharType": "begin"})]),
        element("w:r", children=[code]),
        element("w:r", children=[element("w:fldChar", {"w:fldCharType": "separate"})]),
    ]


def field_end() -> etree._Element:
    return element("w:r", children=[element("w:fldChar", {"w:fldCharType": "end"})])


def tab_run() -> etree._Element:
    return element("w:r", children=[element("w:tab")])


def break_run(kind: str | None = None) -> etree._Element:
    return element("w:r", children=[element("w:br", {"w:type": kind} if kind else None)])


def border(side: str, size_points: float, colour: str, space_points: float = 0) -> etree._Element:
    return element(
        f"w:{side}",
        {
            "w:val": "single",
            "w:sz": str(max(2, round(size_points * 8))),
            "w:space": str(round(space_points)),
            "w:color": colour.lstrip("#").upper(),
        },
    )


def shading(colour: str) -> etree._Element:
    return element(
        "w:shd", {"w:val": "clear", "w:color": "auto", "w:fill": colour.lstrip("#").upper()}
    )


def fonts(family: str) -> etree._Element:
    return element(
        "w:rFonts",
        {"w:ascii": family, "w:hAnsi": family, "w:cs": family, "w:eastAsia": family},
    )
