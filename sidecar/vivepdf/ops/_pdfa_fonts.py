import io
import re
from dataclasses import dataclass, field
from functools import cache

import pymupdf
from fontTools.agl import UV2AGL
from fontTools.cffLib import CFFFontSet
from fontTools.encodings.StandardEncoding import StandardEncoding
from fontTools.pens.basePen import NullPen

from vivepdf.ops._name_syntax import pdf_name

FONT_FLAG_FIXED = 1
FONT_FLAG_SERIF = 2
FONT_FLAG_SYMBOLIC = 4
FONT_FLAG_NONSYMBOLIC = 32
FONT_FLAG_ITALIC = 64
SIMPLE_SUBTYPES = {"/Type1", "/TrueType", "/MMType1"}
EMBEDDED_KEYS = ("FontFile", "FontFile2", "FontFile3")
REFERENCE = re.compile(r"(\d+)\s+0\s+R")
LATIN_FACES = {
    "helvetica": ("helv", "hebo", "heit", "hebi", 0),
    "arial": ("helv", "hebo", "heit", "hebi", 0),
    "times": ("tiro", "tibo", "tiit", "tibi", FONT_FLAG_SERIF),
    "timesroman": ("tiro", "tibo", "tiit", "tibi", FONT_FLAG_SERIF),
    "timesnewroman": ("tiro", "tibo", "tiit", "tibi", FONT_FLAG_SERIF),
    "courier": ("cour", "cobo", "coit", "cobi", FONT_FLAG_FIXED),
    "couriernew": ("cour", "cobo", "coit", "cobi", FONT_FLAG_FIXED),
}
SYMBOL_FACES = {"symbol": "symb", "zapfdingbats": "zadb", "dingbats": "zadb"}
STYLE_WORDS = ("bolditalic", "boldoblique", "bold", "italic", "oblique", "regular", "roman")
NAME_NOISE = ("psmt", "mt", "ps", ",", "-", " ", "_")


@dataclass(frozen=True)
class StandardFace:
    code: str
    flags: int

    @property
    def symbolic(self) -> bool:
        return bool(self.flags & FONT_FLAG_SYMBOLIC)


@dataclass
class FontProblems:
    replaceable: list[int] = field(default_factory=list)
    stuck: list[str] = field(default_factory=list)
    missing_cid_maps: list[int] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.replaceable) + len(self.stuck) + len(self.missing_cid_maps)


@dataclass(frozen=True)
class CffProgram:
    data: bytes
    builtin: tuple[str, ...]
    widths: dict[str, int]
    bbox: tuple[int, int, int, int]
    ascent: int
    descent: int


def _key(document: pymupdf.Document, xref: int, key: str) -> tuple[str, str]:
    try:
        return document.xref_get_key(xref, key)
    except (RuntimeError, ValueError):
        return ("null", "null")


def standard_face(name: str) -> StandardFace | None:
    bare = name.lstrip("/").split("+", 1)[-1].lower()
    for noise in NAME_NOISE:
        bare = bare.replace(noise, "")
    if bare in SYMBOL_FACES:
        return StandardFace(SYMBOL_FACES[bare], FONT_FLAG_SYMBOLIC)
    for family, faces in sorted(LATIN_FACES.items(), key=lambda item: -len(item[0])):
        if not bare.startswith(family):
            continue
        rest = bare[len(family) :]
        if rest and not any(rest.startswith(word) for word in STYLE_WORDS):
            continue
        bold = "bold" in rest
        slanted = "italic" in rest or "oblique" in rest
        regular, bold_face, italic_face, bold_italic_face, flags = faces
        if bold and slanted:
            code = bold_italic_face
        elif bold:
            code = bold_face
        elif slanted:
            code = italic_face
        else:
            code = regular
        return StandardFace(code, flags | (FONT_FLAG_ITALIC if slanted else 0))
    return None


@cache
def cff_program(code: str) -> CffProgram:
    data = pymupdf.Font(code).buffer
    fonts = CFFFontSet()
    fonts.decompile(io.BytesIO(data), None)
    top = fonts[fonts.fontNames[0]]
    widths: dict[str, int] = {}
    for name in top.CharStrings.charStrings:
        charstring = top.CharStrings[name]
        charstring.draw(NullPen())
        widths[name] = round(charstring.width)
    encoding = top.Encoding
    builtin = tuple(encoding) if isinstance(encoding, list) else tuple(StandardEncoding)
    x0, y0, x1, y1 = (round(value) for value in top.FontBBox)
    return CffProgram(
        data=bytes(data),
        builtin=builtin,
        widths=widths,
        bbox=(x0, y0, x1, y1),
        ascent=max(y1, 0),
        descent=min(y0, 0),
    )


def _codec_names(codec: str) -> list[str]:
    names = [".notdef"] * 256
    for code in range(32, 256):
        try:
            character = bytes([code]).decode(codec)
        except UnicodeDecodeError:
            continue
        names[code] = UV2AGL.get(ord(character), ".notdef")
    return names


def glyph_names(
    document: pymupdf.Document, xref: int, program: CffProgram, symbolic: bool
) -> list[str]:
    kind, value = _key(document, xref, "Encoding")
    base = value if kind == "name" else _key(document, xref, "Encoding/BaseEncoding")[1]
    if symbolic:
        names = list(program.builtin)
    elif base == "/WinAnsiEncoding":
        names = _codec_names("cp1252")
    elif base == "/MacRomanEncoding":
        names = _codec_names("mac_roman")
    else:
        names = list(StandardEncoding)
    differences_kind, differences = _key(document, xref, "Encoding/Differences")
    if differences_kind == "array":
        code = 0
        for token in re.findall(r"\d+|/[^\s/\[\]]+", differences):
            if token.isdigit():
                code = int(token)
            elif 0 <= code < 256:
                names[code] = token[1:]
                code += 1
    return names


def _explicit_encoding(names: list[str]) -> str:
    listed = " ".join(
        f"{code} /{name}" for code, name in enumerate(names) if name and name != ".notdef"
    )
    return f"<< /Type /Encoding /Differences [{listed}] >>"


def _embedded(document: pymupdf.Document, xref: int) -> bool:
    return any(_key(document, xref, f"FontDescriptor/{key}")[0] != "null" for key in EMBEDDED_KEYS)


def _descendant(document: pymupdf.Document, xref: int) -> int | None:
    kind, value = _key(document, xref, "DescendantFonts")
    if kind == "xref":
        value = document.xref_object(int(value.split()[0]))
    match = REFERENCE.search(value)
    return int(match.group(1)) if match else None


def font_problems(document: pymupdf.Document) -> FontProblems:
    problems = FontProblems()
    for xref in range(1, document.xref_length()):
        if _key(document, xref, "Type")[1] != "/Font":
            continue
        subtype = _key(document, xref, "Subtype")[1]
        basefont = _key(document, xref, "BaseFont")[1].lstrip("/")
        if subtype in SIMPLE_SUBTYPES and not _embedded(document, xref):
            if standard_face(basefont):
                problems.replaceable.append(xref)
            elif basefont not in problems.stuck:
                problems.stuck.append(basefont)
        elif subtype == "/Type0":
            descendant = _descendant(document, xref)
            if descendant is None:
                continue
            if not _embedded(document, descendant):
                if basefont not in problems.stuck:
                    problems.stuck.append(basefont)
            elif (
                _key(document, descendant, "Subtype")[1] == "/CIDFontType2"
                and _key(document, descendant, "CIDToGIDMap")[0] == "null"
            ):
                problems.missing_cid_maps.append(descendant)
    problems.stuck.sort()
    return problems


def embed_standard_font(document: pymupdf.Document, xref: int) -> None:
    basefont = _key(document, xref, "BaseFont")[1]
    face = standard_face(basefont) or StandardFace("helv", 0)
    program = cff_program(face.code)
    names = glyph_names(document, xref, program, face.symbolic)
    notdef = program.widths.get(".notdef", 0)
    widths = [program.widths.get(name, notdef) for name in names]
    stream = document.get_new_xref()
    document.update_object(stream, "<< /Subtype /Type1C >>")
    document.update_stream(stream, program.data, compress=True)
    descriptor = document.get_new_xref()
    flags = face.flags | (0 if face.symbolic else FONT_FLAG_NONSYMBOLIC)
    x0, y0, x1, y1 = program.bbox
    italic_angle = -12 if face.flags & FONT_FLAG_ITALIC else 0
    cap_height = round(program.ascent * 0.7)
    font_name = pdf_name(basefont.removeprefix("/"))
    document.update_object(
        descriptor,
        f"<< /Type /FontDescriptor /FontName {font_name} /Flags {flags}"
        f" /FontBBox [{x0} {y0} {x1} {y1}] /ItalicAngle {italic_angle}"
        f" /Ascent {program.ascent} /Descent {program.descent} /CapHeight {cap_height}"
        f" /StemV 80 /FontFile3 {stream} 0 R >>",
    )
    document.xref_set_key(xref, "Subtype", "/Type1")
    document.xref_set_key(xref, "FontDescriptor", f"{descriptor} 0 R")
    document.xref_set_key(xref, "FirstChar", "0")
    document.xref_set_key(xref, "LastChar", "255")
    document.xref_set_key(xref, "Widths", "[" + " ".join(str(width) for width in widths) + "]")
    if face.symbolic:
        document.xref_set_key(xref, "Encoding", _explicit_encoding(names))


def fix_fonts(document: pymupdf.Document) -> None:
    problems = font_problems(document)
    for xref in problems.replaceable:
        embed_standard_font(document, xref)
    for xref in problems.missing_cid_maps:
        document.xref_set_key(xref, "CIDToGIDMap", "/Identity")
