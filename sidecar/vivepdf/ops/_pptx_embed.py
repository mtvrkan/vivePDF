import io
import struct
import zipfile
from collections.abc import Callable, Iterable

import pymupdf
from lxml import etree

from vivepdf.ops._docx_fonts import best_program, collect_programs, is_system_font

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types"
FONT_RELATIONSHIP = f"{R}/font"
FONT_DATA = "application/x-fontdata"
PRESENTATION = "ppt/presentation.xml"
PRESENTATION_RELS = "ppt/_rels/presentation.xml.rels"
CONTENT_TYPES_PART = "[Content_Types].xml"
SLIDE_PART = "ppt/slides/slide"
EMBED_TAGS = {
    (False, False): "regular",
    (True, False): "bold",
    (False, True): "italic",
    (True, True): "boldItalic",
}
BEFORE_FONT_LIST = frozenset(
    f"{{{P}}}{name}"
    for name in (
        "sldMasterIdLst",
        "notesMasterIdLst",
        "handoutMasterIdLst",
        "sldIdLst",
        "sldSz",
        "notesSz",
        "smartTags",
    )
)
EOT_VERSION = 0x00020001
EOT_MAGIC = 0x504C
DEFAULT_CHARSET = 1
EOT_NAMES = (1, 2, 5, 4)


def _switched_on(properties, name: str) -> bool:
    return properties.get(name) in ("1", "true")


def used_slots(parts: Iterable[bytes]) -> set[tuple[str, bool, bool]]:
    slots = set()
    for part in parts:
        for properties in etree.fromstring(part).iter(f"{{{A}}}rPr"):
            latin = properties.find(f"{{{A}}}latin")
            name = latin.get("typeface") if latin is not None else None
            if name and not is_system_font(name):
                slots.add((name, _switched_on(properties, "b"), _switched_on(properties, "i")))
    return slots


def _eot_name(font, record_id: int) -> bytes:
    text = (font["name"].getDebugName(record_id) or "").encode("utf-16-le")
    return struct.pack("<2H", 0, len(text)) + text


def embedded_open_type(program: bytes) -> bytes:
    from fontTools.ttLib import TTFont

    font = TTFont(io.BytesIO(program), lazy=True)
    metrics = font["OS/2"]
    panose = metrics.panose
    header = (
        bytes(
            (
                panose.bFamilyType,
                panose.bSerifStyle,
                panose.bWeight,
                panose.bProportion,
                panose.bContrast,
                panose.bStrokeVariation,
                panose.bArmStyle,
                panose.bLetterForm,
                panose.bMidline,
                panose.bXHeight,
            )
        )
        + struct.pack(
            "<2BL2H",
            DEFAULT_CHARSET,
            metrics.fsSelection & 1,
            metrics.usWeightClass,
            metrics.fsType,
            EOT_MAGIC,
        )
        + struct.pack(
            "<6L",
            metrics.ulUnicodeRange1,
            metrics.ulUnicodeRange2,
            metrics.ulUnicodeRange3,
            metrics.ulUnicodeRange4,
            getattr(metrics, "ulCodePageRange1", 0),
            getattr(metrics, "ulCodePageRange2", 0),
        )
        + struct.pack("<5L", font["head"].checkSumAdjustment, 0, 0, 0, 0)
        + b"".join(_eot_name(font, record_id) for record_id in EOT_NAMES)
        + struct.pack("<2H", 0, 0)
    )
    size = 16 + len(header) + len(program)
    return struct.pack("<4L", size, len(program), EOT_VERSION, 0) + header + program


def _serialised(root) -> bytes:
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _font_list(presentation):
    found = presentation.find(f"{{{P}}}embeddedFontLst")
    if found is not None:
        return found
    position = 0
    for index, child in enumerate(presentation):
        if child.tag in BEFORE_FONT_LIST:
            position = index + 1
    font_list = etree.Element(f"{{{P}}}embeddedFontLst")
    presentation.insert(position, font_list)
    return font_list


def _with_font_type(content_types: bytes) -> bytes:
    root = etree.fromstring(content_types)
    tag = f"{{{CONTENT_TYPES}}}Default"
    if any(entry.get("Extension") == "fntdata" for entry in root.iter(tag)):
        return content_types
    root.insert(0, etree.Element(tag, Extension="fntdata", ContentType=FONT_DATA))
    return _serialised(root)


def _with_fonts(
    parts: dict[str, bytes], fonts: dict[tuple[str, bool, bool], bytes]
) -> dict[str, bytes]:
    presentation = etree.fromstring(parts[PRESENTATION])
    relationships = etree.fromstring(parts[PRESENTATION_RELS])
    font_list = _font_list(presentation)
    added = {}
    for number, family in enumerate(sorted({slot[0] for slot in fonts}), start=1):
        entry = etree.SubElement(font_list, f"{{{P}}}embeddedFont")
        etree.SubElement(entry, f"{{{P}}}font", typeface=family)
        for style_number, (style, tag) in enumerate(EMBED_TAGS.items()):
            program = fonts.get((family, *style))
            if program is None:
                continue
            relationship = f"rIdVivePdfFont{number}x{style_number}"
            target = f"fonts/font{number}x{style_number}.fntdata"
            etree.SubElement(
                relationships,
                f"{{{PACKAGE}}}Relationship",
                Id=relationship,
                Type=FONT_RELATIONSHIP,
                Target=target,
            )
            etree.SubElement(entry, f"{{{P}}}{tag}", {f"{{{R}}}id": relationship})
            added[f"ppt/{target}"] = embedded_open_type(program)
    presentation.set("embedTrueTypeFonts", "1")
    presentation.set("saveSubsetFonts", "1")
    return {
        **parts,
        PRESENTATION: _serialised(presentation),
        PRESENTATION_RELS: _serialised(relationships),
        CONTENT_TYPES_PART: _with_font_type(parts[CONTENT_TYPES_PART]),
        **added,
    }


def embed_slide_fonts(
    data: bytes,
    document: pymupdf.Document,
    indices: Iterable[int],
    names: Callable[[str], str],
    stop: Callable[[], None],
) -> bytes:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    wanted = used_slots(
        content
        for name, content in parts.items()
        if name.startswith(SLIDE_PART) and name.endswith(".xml")
    )
    if not wanted:
        return data
    found = collect_programs(document, indices, names, wanted, stop)
    fonts = {}
    for slot, programs in found.items():
        program = best_program(slot[0], (slot[1], slot[2]), programs)
        if program is not None:
            fonts[slot] = program
    if not fonts:
        return data
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in _with_fonts(parts, fonts).items():
            archive.writestr(name, content)
    return buffer.getvalue()
