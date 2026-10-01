import re
from collections import defaultdict
from collections.abc import Callable
from functools import cache

import pymupdf

from vivepdf.ops._objects import add_resource, set_key
from vivepdf.ops._to_unicode import cmap_entries
from vivepdf.ops.fonts import normalize_font_name

SIMPLE_FONT_TYPES = frozenset({"Type1", "TrueType", "MMType1"})
NAMED_GLYPH_TYPES = frozenset({"Type1", "MMType1"})
RESOURCE_NAME = re.compile(r"[A-Za-z0-9_.+-]+")
GLYPH_NAME = re.compile(r"[A-Za-z0-9_.]+")
REFERENCE_FONTS = {"symbol": "symb", "zapfdingbats": "zadb"}
PLAIN_REFERENCE = "helv"
UNICODE_CMAP = re.compile(r"/Uni[A-Za-z0-9]+-(UCS2|UTF16)-[HV]")
IDENTITY_CMAP = re.compile(r"/Identity-[HV]")
PROBE_SPACING = 10
SYMBOLIC_FLAG = 4
NONSYMBOLIC_FLAG = 32
LAST_EXTRA_CODE = 255
FREE_NAME_ATTEMPTS = 1000
REPLACEMENT = "\ufffd"
TEXT_FLAGS = pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_MEDIABOX_CLIP
UNREADABLE = (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase)

Encoder = Callable[[str], bytes | None]


def _graft(document: pymupdf.Document, scratch: pymupdf.Document, xref: int) -> int:
    source = pymupdf.mupdf.pdf_new_indirect(pymupdf._as_pdf_document(document), xref, 0)
    copied = pymupdf.mupdf.pdf_graft_object(pymupdf._as_pdf_document(scratch), source)
    return pymupdf.mupdf.pdf_to_num(copied)


def probe_codes(document: pymupdf.Document, xref: int, width: int) -> dict[str, bytes]:
    found: dict[str, bytes] = {}
    for code, char in sorted(_probe(document, xref, width).items()):
        found.setdefault(char, code.to_bytes(width, "big"))
    return found


def mixed_codes(document: pymupdf.Document, xref: int) -> dict[str, bytes]:
    single = _probe(document, xref, 1)
    double = {
        code: char
        for code, char in _probe(document, xref, 2).items()
        if single.get(code >> 8) != char
    }
    leads = {code >> 8 for code in double}
    found: dict[str, bytes] = {}
    for code, char in sorted(single.items()):
        if code not in leads:
            found.setdefault(char, bytes([code]))
    for code, char in sorted(double.items()):
        found.setdefault(char, code.to_bytes(2, "big"))
    return found


def _probe(document: pymupdf.Document, xref: int, width: int) -> dict[int, str]:
    side = 16**width
    extent = (side + 2) * PROBE_SPACING
    produced: dict[int, list[str]] = defaultdict(list)
    with pymupdf.open() as scratch:
        page = scratch.new_page(width=extent, height=extent)
        try:
            font = _graft(document, scratch, xref)
        except UNREADABLE:
            return {}
        scratch.xref_set_key(page.xref, "Resources", f"<< /Font << /P {font} 0 R >> >>")
        lines = ["BT /P 1 Tf"]
        for code in range(1, 256**width):
            x = PROBE_SPACING * (1 + code % side)
            y = PROBE_SPACING * (1 + code // side)
            lines.append(f"1 0 0 1 {x} {y} Tm <{code:0{2 * width}x}> Tj")
        lines.append("ET")
        contents = scratch.get_new_xref()
        scratch.update_object(contents, "<<>>")
        scratch.update_stream(contents, "\n".join(lines).encode("ascii"))
        scratch.xref_set_key(page.xref, "Contents", f"{contents} 0 R")
        for block in page.get_text("rawdict", flags=TEXT_FLAGS)["blocks"]:
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    for char in span.get("chars", []):
                        x, y = char["origin"]
                        column = round(x / PROBE_SPACING) - 1
                        row = round((extent - y) / PROBE_SPACING) - 1
                        produced[column + side * row].append(char["c"])
    return {
        code: chars[0]
        for code, chars in produced.items()
        if len(chars) == 1 and chars[0] != REPLACEMENT and 0 < code < 256**width
    }


def pen_offsets(
    document: pymupdf.Document, xref: int, codes: list[bytes], size: float
) -> list[pymupdf.Point] | None:
    spacing = 4 * size + PROBE_SPACING
    extent = spacing * (len(codes) + 2)
    pens = [pymupdf.Point(spacing, spacing * (index + 1)) for index in range(len(codes))]
    with pymupdf.open() as scratch:
        page = scratch.new_page(width=extent, height=extent)
        try:
            font = _graft(document, scratch, xref)
        except UNREADABLE:
            return None
        scratch.xref_set_key(page.xref, "Resources", f"<< /Font << /P {font} 0 R >> >>")
        lines = [f"BT /P {size:g} Tf"]
        for pen, code in zip(pens, codes, strict=True):
            lines.append(f"1 0 0 1 {pen.x:g} {extent - pen.y:g} Tm <{code.hex()}> Tj")
        lines.append("ET")
        contents = scratch.get_new_xref()
        scratch.update_object(contents, "<<>>")
        scratch.update_stream(contents, "\n".join(lines).encode("ascii"))
        scratch.xref_set_key(page.xref, "Contents", f"{contents} 0 R")
        origins = [
            pymupdf.Point(char["origin"])
            for block in page.get_text("rawdict", flags=TEXT_FLAGS)["blocks"]
            for line in block.get("lines", [])
            for span in line.get("spans", [])
            for char in span.get("chars", [])
        ]
    offsets: list[pymupdf.Point] = []
    for pen in pens:
        near = [origin for origin in origins if abs(origin - pen) < spacing / 2]
        if len(near) != 1:
            return None
        offsets.append(near[0] - pen)
    return offsets


def _reverse_cmap(data: bytes) -> dict[str, bytes]:
    found: dict[str, int] = {}
    for code, text in cmap_entries(data).items():
        if len(text) == 1 and text != REPLACEMENT and 0 < code <= 0xFFFF:
            found[text] = min(found.get(text, code), code)
    return {char: code.to_bytes(2, "big") for char, code in found.items()}


def _utf16(char: str) -> bytes | None:
    return char.encode("utf-16-be")


def _ucs2(char: str) -> bytes | None:
    return char.encode("utf-16-be") if ord(char) <= 0xFFFF else None


class FontCodes:
    def __init__(self, document: pymupdf.Document) -> None:
        self.document = document
        self.encoders: dict[int, Encoder | None] = {}

    def encoder(self, xref: int, kind: str) -> Encoder | None:
        if xref not in self.encoders:
            self.encoders[xref] = self._encoder(xref, kind)
        return self.encoders[xref]

    def _encoder(self, xref: int, kind: str) -> Encoder | None:
        if kind in SIMPLE_FONT_TYPES:
            return probe_codes(self.document, xref, 1).get
        if kind != "Type0":
            return None
        encoding_kind, encoding = self.document.xref_get_key(xref, "Encoding")
        if encoding_kind == "xref":
            return mixed_codes(self.document, xref).get
        if encoding_kind != "name":
            return None
        cmap = UNICODE_CMAP.fullmatch(encoding)
        if cmap is not None:
            return _utf16 if cmap.group(1) == "UTF16" else _ucs2
        if not IDENTITY_CMAP.fullmatch(encoding):
            return mixed_codes(self.document, xref).get
        unicode_kind, unicode = self.document.xref_get_key(xref, "ToUnicode")
        if unicode_kind == "xref":
            return _reverse_cmap(self.document.xref_stream(int(unicode.split()[0])) or b"").get
        return probe_codes(self.document, xref, 2).get


class _Extra:
    def __init__(self, name: str, xref: int) -> None:
        self.name = name
        self.xref = xref
        self.codes: dict[str, int] = {}
        self.glyphs: list[str] = []


class PageFonts:
    def __init__(self, page: pymupdf.Page, codes: FontCodes) -> None:
        self.page = page
        self.document = page.parent
        self.codes = codes
        self.names: dict[int, str] = {}
        self.extras: dict[int, _Extra] = {}
        self.added: list[tuple[int, int, str]] = []

    def show(self, span: dict, chars: list[str]) -> list[tuple[str, bytes]] | None:
        found = self._font(span)
        if found is None:
            return None
        xref, kind = found
        encode = self.codes.encoder(xref, kind)
        shown: list[tuple[str, bytes]] = []
        for char in chars:
            code = None if encode is None else encode(char)
            if code is not None:
                name = self._name(xref)
                if name is None:
                    return None
                shown.append((name, code))
                continue
            extra = self._extra_code(xref, kind, char)
            if extra is None:
                return None
            shown.append(extra)
        return shown

    def commit(self) -> None:
        self.added = []

    def rollback(self) -> None:
        for xref, holder, key in reversed(self.added):
            self.document.xref_set_key(holder, key, "null")
            self.names.pop(xref, None)
            self.extras = {
                original: extra for original, extra in self.extras.items() if extra.xref != xref
            }
        self.added = []

    def _font(self, span: dict) -> tuple[int, str] | None:
        wanted = normalize_font_name(span["font"] or "")
        found = None
        for entry in self.page.get_fonts(full=True):
            xref, ext, kind, basefont, name, referencer = (*entry[:5], entry[-1])
            if xref != span["xref"] or ext != "n/a" or normalize_font_name(basefont) != wanted:
                continue
            if kind not in SIMPLE_FONT_TYPES and kind != "Type0":
                continue
            if referencer == 0 and RESOURCE_NAME.fullmatch(name):
                self.names.setdefault(xref, name)
            found = xref, kind
        return found

    def _name(self, xref: int) -> str | None:
        if xref not in self.names:
            name = self._free_name()
            if name is None:
                return None
            self._add(xref, name)
        return self.names[xref]

    def _free_name(self) -> str | None:
        taken = {entry[4] for entry in self.page.get_fonts(full=True)}
        for number in range(1, FREE_NAME_ATTEMPTS):
            name = f"VPo{number}"
            if name in taken:
                continue
            if self.document.xref_get_key(self.page.xref, f"Resources/Font/{name}")[0] == "null":
                return name
        return None

    def _add(self, xref: int, name: str) -> None:
        holder, key = add_resource(
            self.document, self.page.xref, "Font", name, xref, self.page.xref
        )
        self.names[xref] = name
        self.added.append((xref, holder, key))

    def _extra_code(self, xref: int, kind: str, char: str) -> tuple[str, bytes] | None:
        extra = self.extras.get(xref) or self._new_extra(xref, kind)
        if extra is None:
            return None
        if char not in extra.codes:
            glyph = _glyph_name(char, self.document.xref_get_key(xref, "BaseFont")[1])
            if glyph is None or len(extra.glyphs) >= LAST_EXTRA_CODE:
                return None
            extra.glyphs.append(glyph)
            extra.codes[char] = len(extra.glyphs)
            names = " ".join(f"/{item}" for item in extra.glyphs)
            self.document.xref_set_key(extra.xref, "Encoding", f"<< /Differences [1 {names}] >>")
        return extra.name, bytes([extra.codes[char]])

    def _new_extra(self, xref: int, kind: str) -> _Extra | None:
        if kind not in SIMPLE_FONT_TYPES:
            return None
        flags_kind, flags = self.document.xref_get_key(xref, "FontDescriptor/Flags")
        symbolic = flags_kind == "int" and int(flags) & SYMBOLIC_FLAG
        name = self._free_name()
        if name is None:
            return None
        created = self.document.get_new_xref()
        self.document.update_object(created, "<< /Type /Font >>")
        for key in ("Subtype", "BaseFont", "FontDescriptor"):
            value_kind, value = self.document.xref_get_key(xref, key)
            if value_kind != "null":
                self.document.xref_set_key(created, key, value)
        if symbolic and kind not in NAMED_GLYPH_TYPES:
            self._plain_descriptor(created, (int(flags) & ~SYMBOLIC_FLAG) | NONSYMBOLIC_FLAG)
        self._add(created, name)
        extra = _Extra(name, created)
        self.extras[xref] = extra
        return extra

    def _plain_descriptor(self, font: int, flags: int) -> None:
        kind, value = self.document.xref_get_key(font, "FontDescriptor")
        if kind == "xref":
            copy = self.document.get_new_xref()
            self.document.update_object(copy, self.document.xref_object(int(value.split()[0])))
            self.document.xref_set_key(font, "FontDescriptor", f"{copy} 0 R")
        set_key(self.document, font, ["FontDescriptor", "Flags"], str(flags))


@cache
def _reference_font(code: str) -> pymupdf.Font:
    return pymupdf.Font(code)


def _glyph_name(char: str, basefont: str) -> str | None:
    reference = _reference_font(REFERENCE_FONTS.get(normalize_font_name(basefont), PLAIN_REFERENCE))
    glyph = reference.has_glyph(ord(char))
    if not glyph:
        return None
    name = pymupdf.mupdf.fz_get_glyph_name2(reference.this, glyph)
    return name if GLYPH_NAME.fullmatch(name) else None
