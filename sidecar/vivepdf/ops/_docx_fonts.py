import functools
import hashlib
import io
import re
import struct
import uuid
import zipfile
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

import pymupdf
from lxml import etree
from pymupdf import mupdf

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types"
FONT_RELATIONSHIP = f"{R}/font"
OBFUSCATED_FONT = "application/vnd.openxmlformats-officedocument.obfuscatedFont"
TEXT_PARTS = re.compile(r"word/(document|header\d*|footer\d*|footnotes|endnotes)\.xml")
FONT_TABLE = "word/fontTable.xml"
FONT_TABLE_RELS = "word/_rels/fontTable.xml.rels"
SETTINGS = "word/settings.xml"
CONTENT_TYPES_PART = "[Content_Types].xml"
STYLES = ((False, False), (True, False), (False, True), (True, True))
EMBED_TAGS = {
    (False, False): "embedRegular",
    (True, False): "embedBold",
    (False, True): "embedItalic",
    (True, True): "embedBoldItalic",
}
SUBFAMILIES = {
    (False, False): "Regular",
    (True, False): "Bold",
    (False, True): "Italic",
    (True, True): "Bold Italic",
}
SETTINGS_BEFORE_EMBEDDING = frozenset(
    f"{{{W}}}{name}"
    for name in (
        "writeProtection",
        "view",
        "zoom",
        "removePersonalInformation",
        "removeDateAndTime",
        "doNotDisplayPageBoundaries",
        "displayBackgroundShape",
        "printPostScriptOverText",
        "printFractionalCharacterWidth",
        "printFormsData",
    )
)
SYSTEM_FONTS = frozenset(
    {
        "aptos",
        "arial",
        "arialblack",
        "arialnarrow",
        "arialunicodems",
        "bahnschrift",
        "bookantiqua",
        "bookmanoldstyle",
        "calibri",
        "calibrilight",
        "cambria",
        "cambriamath",
        "candara",
        "centurygothic",
        "comicsansms",
        "consolas",
        "constantia",
        "corbel",
        "courier",
        "couriernew",
        "ebrima",
        "franklingothicmedium",
        "gabriola",
        "gadugi",
        "garamond",
        "georgia",
        "helvetica",
        "impact",
        "lucidaconsole",
        "lucidasansunicode",
        "malgungothic",
        "microsoftsansserif",
        "microsoftyahei",
        "msgothic",
        "msmincho",
        "mspgothic",
        "palatinolinotype",
        "segoeprint",
        "segoescript",
        "segoeui",
        "segoeuiemoji",
        "segoeuisymbol",
        "simsun",
        "sylfaen",
        "symbol",
        "tahoma",
        "times",
        "timesnewroman",
        "trebuchetms",
        "verdana",
        "webdings",
        "wingdings",
        "wingdings2",
        "wingdings3",
        "zapfdingbats",
    }
)
VENDOR_SUFFIXES = ("psmt", "mt", "ps")
REQUIRED_TABLES = ("glyf", "loca", "head", "hhea", "hmtx", "maxp", "OS/2")
MAX_FONT_BYTES = 8 * 1024 * 1024
BOLD_FLAG = 16
ITALIC_FLAG = 2
REPLACEMENT_CHARACTER = 0xFFFD
SURROGATES = range(0xD800, 0xE000)
ENGLISH_US = 0x409


def _w(name: str) -> str:
    return f"{{{W}}}{name}"


def _plain_key(name: str) -> str:
    key = re.sub(r"[\s_-]", "", name.split(",", 1)[0]).lower()
    for suffix in VENDOR_SUFFIXES:
        if key.endswith(suffix) and key[: -len(suffix)] in SYSTEM_FONTS:
            return key[: -len(suffix)]
    return key


def is_system_font(name: str) -> bool:
    return _plain_key(name) in SYSTEM_FONTS


def _switched_on(properties, tag: str) -> bool:
    element = properties.find(_w(tag))
    if element is None:
        return False
    return element.get(_w("val"), "true").lower() not in ("0", "false", "off")


def used_slots(parts: Iterable[bytes]) -> set[tuple[str, bool, bool]]:
    slots = set()
    for part in parts:
        for properties in etree.fromstring(part).iter(_w("rPr")):
            fonts = properties.find(_w("rFonts"))
            name = fonts.get(_w("ascii")) if fonts is not None else None
            if name and not is_system_font(name):
                slots.add((name, _switched_on(properties, "b"), _switched_on(properties, "i")))
    return slots


@dataclass
class EmbeddedProgram:
    data: bytes
    glyphs: dict[int, int] = field(default_factory=dict)


class _TextFonts(mupdf.FzDevice2):
    def __init__(self) -> None:
        super().__init__()
        self.use_virtual_fill_text()
        self.use_virtual_stroke_text()
        self.use_virtual_clip_text()
        self.use_virtual_clip_stroke_text()
        self.use_virtual_ignore_text()
        self.spans: list[tuple[str, int, bytes]] = []
        self._programs: dict[int, bytes] = {}

    def _program(self, font) -> bytes:
        address = int(font.this)
        if address not in self._programs:
            buffer = font.buffer
            self._programs[address] = (
                mupdf.FzBuffer(mupdf.ll_fz_keep_buffer(buffer)).fz_buffer_extract_copy()
                if buffer
                else b""
            )
        return self._programs[address]

    def _record(self, text) -> None:
        span = text.head
        while span:
            name = mupdf.ll_fz_font_name(span.font)
            self.spans.append((name, span.len, self._program(span.font)))
            span = span.next

    def fill_text(self, ctx, text, *_):
        self._record(text)

    def stroke_text(self, ctx, text, *_):
        self._record(text)

    def clip_text(self, ctx, text, *_):
        self._record(text)

    def clip_stroke_text(self, ctx, text, *_):
        self._record(text)

    def ignore_text(self, ctx, text, *_):
        self._record(text)


def _page_spans(page: pymupdf.Page) -> list[tuple[dict, bytes]] | None:
    device = _TextFonts()
    try:
        mupdf.fz_run_page(page.this, device, mupdf.FzMatrix(), mupdf.FzCookie())
        trace = page.get_texttrace()
    except mupdf.FzErrorBase:
        return None
    if len(trace) != len(device.spans):
        return None
    paired = []
    for (name, length, program), span in zip(device.spans, trace, strict=True):
        if name.split("+", 1)[-1] != span["font"] or length != len(span["chars"]):
            return None
        paired.append((span, program))
    return paired


def collect_programs(
    document: pymupdf.Document,
    indices: Iterable[int],
    docx_name: Callable[[str], str],
    wanted: set[tuple[str, bool, bool]],
    stop: Callable[[], None],
) -> dict[tuple[str, bool, bool], list[EmbeddedProgram]]:
    families = {name for name, _, _ in wanted}
    found: dict[tuple[str, bool, bool], dict[str, EmbeddedProgram]] = {}
    for index in indices:
        stop()
        page = document[index]
        names = {font[3].split("+", 1)[-1] for font in page.get_fonts()}
        if not any(docx_name(name) in families for name in names):
            continue
        for span, program in _page_spans(page) or []:
            slot = (
                docx_name(span["font"]),
                bool(span["flags"] & BOLD_FLAG),
                bool(span["flags"] & ITALIC_FLAG),
            )
            if slot not in wanted or not program or len(program) > MAX_FONT_BYTES:
                continue
            digest = hashlib.sha1(program).hexdigest()
            entry = found.setdefault(slot, {}).setdefault(digest, EmbeddedProgram(program))
            for character in span["chars"]:
                entry.glyphs.setdefault(character[0], character[1])
    return {slot: list(programs.values()) for slot, programs in found.items()}


def embedding_allowed(fs_type: int) -> bool:
    restriction = fs_type & 0x000E
    bitmap_only = fs_type & 0x0200
    return not bitmap_only and (restriction == 0 or bool(restriction & 0x0008))


def _usable_unicode(character: int) -> bool:
    return character >= 0x20 and character != REPLACEMENT_CHARACTER and character not in SURROGATES


def _character_map(font, glyphs: dict[int, int]):
    from fontTools.ttLib import newTable
    from fontTools.ttLib.tables._c_m_a_p import cmap_classes

    order = font.getGlyphOrder()
    mapping = dict(font["cmap"].getBestCmap() or {}) if "cmap" in font else {}
    for character, glyph in glyphs.items():
        if _usable_unicode(character) and 0 < glyph < len(order):
            mapping[character] = order[glyph]
    if not mapping:
        return None
    table = newTable("cmap")
    table.tableVersion = 0
    table.tables = []
    basic = cmap_classes[4](4)
    basic.platformID, basic.platEncID, basic.language = 3, 1, 0
    basic.cmap = {character: name for character, name in mapping.items() if character <= 0xFFFF}
    table.tables.append(basic)
    if any(character > 0xFFFF for character in mapping):
        full = cmap_classes[12](12)
        full.platformID, full.platEncID, full.language = 3, 10, 0
        full.cmap = mapping
        table.tables.append(full)
    return table


def _names(font, family: str, style: tuple[bool, bool]):
    from fontTools.ttLib import newTable

    subfamily = SUBFAMILIES[style]
    full = family if style == (False, False) else f"{family} {subfamily}"
    postscript = re.sub(r"[^A-Za-z0-9-]", "", f"{family}-{subfamily}")[:63]
    kept = {}
    if "name" in font:
        for record_id in (0, 7, 13, 14):
            text = font["name"].getDebugName(record_id)
            if text:
                kept[record_id] = text
    table = newTable("name")
    table.names = []
    records = {
        **kept,
        1: family,
        2: subfamily,
        3: f"vivePDF: {full}",
        4: full,
        5: "Version 1.000",
        6: postscript or "Embedded",
    }
    for record_id, text in sorted(records.items()):
        table.setName(text, record_id, 3, 1, ENGLISH_US)
        if text.isascii():
            table.setName(text, record_id, 1, 0, 0)
    return table


def _postscript_table():
    from fontTools.ttLib import newTable

    table = newTable("post")
    table.formatType = 3.0
    table.italicAngle = 0
    table.underlinePosition = -100
    table.underlineThickness = 50
    table.isFixedPitch = 0
    table.minMemType42 = table.maxMemType42 = table.minMemType1 = table.maxMemType1 = 0
    return table


def _mark_style(font, style: tuple[bool, bool]) -> None:
    bold, italic = style
    font["head"].macStyle = (font["head"].macStyle & ~0x3) | int(bold) | int(italic) << 1
    selection = font["OS/2"].fsSelection & ~0x61
    if bold:
        selection |= 0x20
    if italic:
        selection |= 0x01
    if not bold and not italic:
        selection |= 0x40
    font["OS/2"].fsSelection = selection


def rebuilt_program(
    program: bytes, glyphs: dict[int, int], family: str, style: tuple[bool, bool]
) -> bytes | None:
    from fontTools.ttLib import TTFont, TTLibError

    try:
        font = TTFont(io.BytesIO(program))
        if any(tag not in font for tag in REQUIRED_TABLES):
            return None
        if not embedding_allowed(font["OS/2"].fsType):
            return None
        character_map = _character_map(font, glyphs)
        if character_map is None:
            return None
        font["cmap"] = character_map
        font["name"] = _names(font, family, style)
        if "post" not in font:
            font["post"] = _postscript_table()
        _mark_style(font, style)
        font["OS/2"].recalcUnicodeRanges(font)
        if font["OS/2"].version >= 1:
            font["OS/2"].recalcCodePageRanges(font)
        buffer = io.BytesIO()
        font.save(buffer)
    except (TTLibError, AssertionError, KeyError, IndexError, ValueError, TypeError, struct.error):
        return None
    return buffer.getvalue()


def obfuscated(program: bytes, key: str) -> bytes:
    secret = bytes.fromhex(key.strip("{}").replace("-", ""))[::-1]
    head = bytes(byte ^ secret[index % len(secret)] for index, byte in enumerate(program[:32]))
    return head + program[32:]


def best_program(
    family: str, style: tuple[bool, bool], programs: list[EmbeddedProgram]
) -> bytes | None:
    for candidate in sorted(programs, key=lambda entry: len(entry.glyphs), reverse=True):
        rebuilt = rebuilt_program(candidate.data, candidate.glyphs, family, style)
        if rebuilt is not None:
            return rebuilt
    return None


def _font_entry(table, family: str):
    for entry in table.iter(_w("font")):
        if entry.get(_w("name")) == family:
            return entry
    entry = etree.SubElement(table, _w("font"), {_w("name"): family})
    etree.SubElement(entry, _w("charset"), {_w("val"): "00"})
    etree.SubElement(entry, _w("family"), {_w("val"): "auto"})
    etree.SubElement(entry, _w("pitch"), {_w("val"): "variable"})
    return entry


def _with_embedding_settings(settings: bytes) -> bytes:
    root = etree.fromstring(settings)
    if root.find(_w("embedTrueTypeFonts")) is not None:
        return settings
    position = 0
    for index, child in enumerate(root):
        if child.tag in SETTINGS_BEFORE_EMBEDDING:
            position = index + 1
    root.insert(position, etree.Element(_w("saveSubsetFonts")))
    root.insert(position, etree.Element(_w("embedTrueTypeFonts")))
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _with_font_type(content_types: bytes) -> bytes:
    root = etree.fromstring(content_types)
    tag = f"{{{CONTENT_TYPES}}}Default"
    if any(entry.get("Extension") == "odttf" for entry in root.iter(tag)):
        return content_types
    root.insert(0, etree.Element(tag, Extension="odttf", ContentType=OBFUSCATED_FONT))
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _with_fonts(
    parts: dict[str, bytes], fonts: dict[tuple[str, bool, bool], bytes]
) -> dict[str, bytes]:
    table = etree.fromstring(parts[FONT_TABLE])
    relationships = (
        etree.fromstring(parts[FONT_TABLE_RELS])
        if FONT_TABLE_RELS in parts
        else etree.Element(f"{{{PACKAGE}}}Relationships", nsmap={None: PACKAGE})
    )
    added = {}
    for number, family in enumerate(sorted({slot[0] for slot in fonts}), start=1):
        entry = _font_entry(table, family)
        for tag in EMBED_TAGS.values():
            for old in entry.findall(_w(tag)):
                entry.remove(old)
        for style_number, style in enumerate(STYLES):
            program = fonts.get((family, *style))
            if program is None:
                continue
            key = "{" + str(uuid.uuid4()).upper() + "}"
            relationship = f"rIdVivePdfFont{number}x{style_number}"
            target = f"fonts/font{number}x{style_number}.odttf"
            etree.SubElement(
                relationships,
                f"{{{PACKAGE}}}Relationship",
                Id=relationship,
                Type=FONT_RELATIONSHIP,
                Target=target,
            )
            etree.SubElement(
                entry, _w(EMBED_TAGS[style]), {f"{{{R}}}id": relationship, _w("fontKey"): key}
            )
            added[f"word/{target}"] = obfuscated(program, key)
    return {
        **parts,
        FONT_TABLE: etree.tostring(table, xml_declaration=True, encoding="UTF-8", standalone=True),
        FONT_TABLE_RELS: etree.tostring(
            relationships, xml_declaration=True, encoding="UTF-8", standalone=True
        ),
        SETTINGS: _with_embedding_settings(parts[SETTINGS]),
        CONTENT_TYPES_PART: _with_font_type(parts[CONTENT_TYPES_PART]),
        **added,
    }


def docx_font_names(document: pymupdf.Document) -> Callable[[str], str]:
    from pdf2docx.font.Fonts import Fonts

    fonts = Fonts.extract(document)

    @functools.cache
    def docx_name(name: str) -> str:
        found = fonts.get(name)
        return found.name if found else name

    return docx_name


def embed_fonts(
    data: bytes, document: pymupdf.Document, indices: Iterable[int], stop: Callable[[], None]
) -> bytes:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    if FONT_TABLE not in parts or SETTINGS not in parts:
        return data
    wanted = used_slots(content for name, content in parts.items() if TEXT_PARTS.fullmatch(name))
    if not wanted:
        return data
    found = collect_programs(document, indices, docx_font_names(document), wanted, stop)
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
