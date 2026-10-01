import io
import re

import pymupdf
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
from fontTools.ttLib.tables.O_S_2f_2 import Panose

from vivepdf.ops._to_unicode import cmap_entries
from vivepdf.ops.fonts import style_of_name

SUBSET_TAG = re.compile(r"^[A-Z]{6}\+")
STYLE_SUFFIX = re.compile(
    r"[-,]?(BoldItalic|BoldOblique|Bold|Italic|Oblique|Regular|Roman|Book|Medium)?(MT|PS)*$"
)
REPAIRABLE_EXTENSIONS = {"ttf", "otf"}
UNICODE_SUBTABLES = {(3, 1), (3, 10), (0, 3), (0, 4)}
PANOSE_FIELDS = (
    "bFamilyType",
    "bSerifStyle",
    "bWeight",
    "bProportion",
    "bContrast",
    "bStrokeVariation",
    "bArmStyle",
    "bLetterForm",
    "bMidline",
    "bXHeight",
)


def family_and_style(base_name: str) -> tuple[str, str, bool, bool]:
    name = SUBSET_TAG.sub("", base_name.strip().lstrip("/")) or "Embedded"
    bold, italic = style_of_name(name)
    family = STYLE_SUFFIX.sub("", name).rstrip("-,") or name
    style = (
        "Bold Italic" if bold and italic else "Bold" if bold else "Italic" if italic else "Regular"
    )
    return family, style, bold, italic


def _xref_of(document: pymupdf.Document, xref: int, key: str) -> int:
    try:
        kind, value = document.xref_get_key(xref, key)
    except Exception:  # noqa: BLE001
        return 0
    found = re.search(r"(\d+)\s+\d+\s+R", value) if kind in ("xref", "array") else None
    return int(found.group(1)) if found else 0


def _descendant_font(document: pymupdf.Document, xref: int) -> int:
    target = _xref_of(document, xref, "DescendantFonts")
    if not target:
        return 0
    found = re.match(r"\s*\[\s*(\d+)\s+\d+\s+R", document.xref_object(target))
    return int(found.group(1)) if found else target


def _to_unicode(document: pymupdf.Document, xref: int) -> dict[int, str]:
    stream_xref = _xref_of(document, xref, "ToUnicode")
    if not stream_xref:
        return {}
    try:
        return cmap_entries(document.xref_stream(stream_xref) or b"")
    except Exception:  # noqa: BLE001
        return {}


def _cid_to_gid(document: pymupdf.Document, descendant: int) -> dict[int, int] | None:
    try:
        kind, value = document.xref_get_key(descendant, "CIDToGIDMap")
    except Exception:  # noqa: BLE001
        return None
    if kind in ("null", "name") and value in ("null", "/Identity"):
        return None
    if kind != "xref":
        return None
    data = document.xref_stream(int(value.split()[0])) or b""
    return {
        index // 2: int.from_bytes(data[index : index + 2], "big")
        for index in range(0, len(data) - 1, 2)
    }


def _simple_code_to_gid(font: TTFont) -> dict[int, int]:
    mapping: dict[int, int] = {}
    if "cmap" not in font:
        return mapping
    order = {name: gid for gid, name in enumerate(font.getGlyphOrder())}
    for table in font["cmap"].tables:
        for code, glyph in table.cmap.items():
            gid = order.get(glyph)
            if gid is None:
                continue
            if (table.platformID, table.platEncID) == (3, 0) and 0xF000 <= code <= 0xF0FF:
                mapping.setdefault(code - 0xF000, gid)
            elif code <= 0xFF:
                mapping.setdefault(code, gid)
    return mapping


def unicode_glyph_map(document: pymupdf.Document, xref: int, font: TTFont) -> dict[int, int]:
    to_unicode = _to_unicode(document, xref)
    if not to_unicode:
        return {}
    subtype = document.xref_get_key(xref, "Subtype")[1]
    if subtype == "/Type0":
        encoding = document.xref_get_key(xref, "Encoding")[1]
        if encoding not in ("/Identity-H", "/Identity-V"):
            return {}
        descendant = _descendant_font(document, xref)
        mapping = _cid_to_gid(document, descendant) if descendant else None
        code_to_gid = {
            code: mapping.get(code, 0) if mapping is not None else code for code in to_unicode
        }
    else:
        code_to_gid = _simple_code_to_gid(font)
    glyphs = len(font.getGlyphOrder())
    result: dict[int, int] = {}
    for code, text in to_unicode.items():
        gid = code_to_gid.get(code)
        if gid is None or not 0 < gid < glyphs or len(text) != 1:
            continue
        result.setdefault(ord(text), gid)
    return result


def _has_unicode_cmap(font: TTFont) -> bool:
    if "cmap" not in font:
        return False
    return any(
        (table.platformID, table.platEncID) in UNICODE_SUBTABLES and table.cmap
        for table in font["cmap"].tables
    )


def _cmap_subtable(fmt: int, platform: int, encoding: int, mapping: dict[int, str]) -> CmapSubtable:
    table = CmapSubtable.newSubtable(fmt)
    table.platformID, table.platEncID, table.language = platform, encoding, 0
    table.cmap = mapping
    return table


def _add_cmap(font: TTFont, unicode_to_gid: dict[int, int]) -> None:
    order = font.getGlyphOrder()
    mapping = {code: order[gid] for code, gid in unicode_to_gid.items()}
    if "cmap" not in font:
        cmap = newTable("cmap")
        cmap.tableVersion = 0
        cmap.tables = []
        font["cmap"] = cmap
    tables = [
        table
        for table in font["cmap"].tables
        if (table.platformID, table.platEncID) not in UNICODE_SUBTABLES
    ]
    tables.append(
        _cmap_subtable(4, 3, 1, {code: glyph for code, glyph in mapping.items() if code <= 0xFFFF})
    )
    if any(code > 0xFFFF for code in mapping):
        tables.append(_cmap_subtable(12, 3, 10, mapping))
    font["cmap"].tables = tables


def _add_name(font: TTFont, family: str, style: str) -> None:
    table = newTable("name")
    table.names = []
    postscript = re.sub(r"[^A-Za-z0-9-]", "", f"{family}-{style}") or "Embedded-Regular"
    for name_id, value in (
        (1, family),
        (2, style),
        (3, postscript),
        (4, f"{family} {style}"),
        (5, "Version 1.000"),
        (6, postscript),
    ):
        table.setName(value, name_id, 3, 1, 0x409)
    font["name"] = table


def _add_os2(font: TTFont, bold: bool, italic: bool) -> None:
    head, hhea = font["head"], font["hhea"]
    em = head.unitsPerEm
    table = newTable("OS/2")
    table.version = 4
    table.xAvgCharWidth = 0
    table.usWeightClass = 700 if bold else 400
    table.usWidthClass = 5
    table.fsType = 0
    table.ySubscriptXSize = table.ySuperscriptXSize = round(em * 0.65)
    table.ySubscriptYSize = table.ySuperscriptYSize = round(em * 0.6)
    table.ySubscriptXOffset = table.ySuperscriptXOffset = 0
    table.ySubscriptYOffset = round(em * 0.075)
    table.ySuperscriptYOffset = round(em * 0.35)
    table.yStrikeoutSize = round(em * 0.05)
    table.yStrikeoutPosition = round(em * 0.26)
    table.sFamilyClass = 0
    panose = Panose()
    for field in PANOSE_FIELDS:
        setattr(panose, field, 0)
    table.panose = panose
    table.ulUnicodeRange1 = table.ulUnicodeRange2 = 0
    table.ulUnicodeRange3 = table.ulUnicodeRange4 = 0
    table.achVendID = "NONE"
    table.fsSelection = (0x01 if italic else 0) | (0x20 if bold else 0) or 0x40
    table.usFirstCharIndex = table.usLastCharIndex = 0
    table.sTypoAscender = hhea.ascent
    table.sTypoDescender = hhea.descent
    table.sTypoLineGap = hhea.lineGap
    table.usWinAscent = max(0, hhea.ascent, head.yMax)
    table.usWinDescent = max(0, -hhea.descent, -head.yMin)
    table.ulCodePageRange1 = 1
    table.ulCodePageRange2 = 0
    table.sxHeight = round(em * 0.5)
    table.sCapHeight = round(em * 0.7)
    table.usDefaultChar = 0
    table.usBreakChar = 32
    table.usMaxContext = 0
    font["OS/2"] = table
    table.recalcAvgCharWidth(font)
    if "cmap" in font:
        table.updateFirstAndLastCharIndex(font)
        table.recalcUnicodeRanges(font)


def _add_post(font: TTFont, italic: bool) -> None:
    em = font["head"].unitsPerEm
    table = newTable("post")
    table.formatType = 3.0
    table.italicAngle = -12.0 if italic else 0.0
    table.underlinePosition = -round(em * 0.1)
    table.underlineThickness = round(em * 0.05)
    table.isFixedPitch = 0
    table.minMemType42 = table.maxMemType42 = 0
    table.minMemType1 = table.maxMemType1 = 0
    font["post"] = table


def repair_font_program(
    buffer: bytes,
    base_name: str,
    unicode_to_gid: dict[int, int] | None = None,
) -> bytes:
    font = TTFont(io.BytesIO(buffer))
    family, style, bold, italic = family_and_style(base_name)
    changed = False
    if not _has_unicode_cmap(font) and unicode_to_gid:
        _add_cmap(font, unicode_to_gid)
        changed = True
    if "name" not in font:
        _add_name(font, family, style)
        changed = True
    if "OS/2" not in font:
        _add_os2(font, bold, italic)
        changed = True
    if "post" not in font:
        _add_post(font, italic)
        changed = True
    if not changed:
        return buffer
    output = io.BytesIO()
    font.save(output)
    return output.getvalue()


def repaired_embedded_font(
    document: pymupdf.Document, xref: int, name: str, ext: str, buffer: bytes
) -> bytes:
    if ext not in REPAIRABLE_EXTENSIONS:
        return buffer
    try:
        font = TTFont(io.BytesIO(buffer))
        mapping = unicode_glyph_map(document, xref, font) if not _has_unicode_cmap(font) else {}
        return repair_font_program(buffer, name, mapping)
    except Exception:  # noqa: BLE001
        return buffer
