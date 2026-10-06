import re
import unicodedata

import pymupdf

MUPDF_UNICODE_MARK = b"/CIDSystemInfo <</Registry(Adobe)/Ordering(UCS)/Supplement 0>> def"
PRINTABLE_ASCII = range(0x20, 0x7F)
BLOCK_SIZE = 100
BLOCK = re.compile(rb"\d+\s+begin(bfchar|bfrange)(.*?)end\1", re.S)
TOKEN = re.compile(rb"<[0-9A-Fa-f\s]*>|\[|\]")
WHITESPACE = re.compile(rb"\s+")
PROGRAM_KEYS = ("FontFile2", "FontFile3", "FontFile")
SHARED_CODE_POINTS = {
    0x20: (0x00A0,),
    0x28: (0xFD3E,),
    0x29: (0xFD3F,),
    0x2D: (0x00AD, 0x2010, 0x2011),
    0x3B: (0x037E,),
    0x4B: (0x212A,),
}
LIGATURE_LETTERS = {
    f"{code:04X}": "".join(
        f"{ord(letter):04X}" for letter in unicodedata.normalize("NFKC", chr(code))
    )
    for code in range(0xFB00, 0xFB07)
}


def _xref_value(document: pymupdf.Document, xref: int, key: str) -> int:
    kind, value = document.xref_get_key(xref, key)
    if kind != "xref":
        return 0
    try:
        return int(value.split()[0])
    except (ValueError, IndexError):
        return 0


def _descendant(document: pymupdf.Document, font_xref: int) -> int:
    kind, value = document.xref_get_key(font_xref, "DescendantFonts")
    if kind == "xref":
        array = document.xref_object(int(value.split()[0]))
    elif kind == "array":
        array = value
    else:
        return 0
    found = re.search(r"(\d+)\s+0\s+R", array)
    return int(found.group(1)) if found else 0


def _font_program(document: pymupdf.Document, descendant: int) -> bytes | None:
    if document.xref_get_key(descendant, "CIDToGIDMap") not in (
        ("name", "/Identity"),
        ("null", "null"),
    ):
        return None
    descriptor = _xref_value(document, descendant, "FontDescriptor")
    if not descriptor:
        return None
    for key in PROGRAM_KEYS:
        program = _xref_value(document, descriptor, key)
        if program:
            return document.xref_stream(program)
    return None


def _ascii_glyphs(program: bytes) -> dict[int, int]:
    try:
        font = pymupdf.Font(fontbuffer=program)
    except (RuntimeError, ValueError):
        return {}
    glyphs: dict[int, int] = {}
    for code in PRINTABLE_ASCII:
        glyph = font.has_glyph(code)
        if glyph and glyph not in glyphs:
            glyphs[glyph] = code
    return glyphs


def _is_printable_ascii(target: str) -> bool:
    return len(target) == 4 and int(target, 16) in PRINTABLE_ASCII


def _claimed_ascii_glyphs(mapping: dict[int, str]) -> dict[int, int]:
    glyphs_by_code: dict[str, list[int]] = {}
    for glyph, target in mapping.items():
        glyphs_by_code.setdefault(target, []).append(glyph)
    claimed: dict[int, int] = {}
    for code, shadows in SHARED_CODE_POINTS.items():
        if f"{code:04X}" in glyphs_by_code:
            continue
        holders = [glyph for shadow in shadows for glyph in glyphs_by_code.get(f"{shadow:04X}", [])]
        in_sequence = [
            glyph
            for glyph in holders
            if mapping.get(glyph - 1) == f"{code - 1:04X}"
            or mapping.get(glyph + 1) == f"{code + 1:04X}"
        ]
        chosen = holders if len(holders) == 1 else in_sequence
        if len(chosen) == 1:
            claimed[chosen[0]] = code
    return claimed


def _hex(token: bytes) -> bytes:
    return WHITESPACE.sub(b"", token)


def parse_unicode_map(cmap: bytes) -> dict[int, str]:
    mapping: dict[int, str] = {}
    for kind, body in BLOCK.findall(cmap):
        tokens = [_hex(match.group(0)) for match in TOKEN.finditer(body)]
        index = 0
        while index < len(tokens):
            if kind == b"bfchar":
                if index + 1 >= len(tokens):
                    break
                mapping[int(tokens[index][1:-1], 16)] = tokens[index + 1][1:-1].decode().upper()
                index += 2
                continue
            if index + 2 >= len(tokens):
                break
            first = int(tokens[index][1:-1], 16)
            last = int(tokens[index + 1][1:-1], 16)
            if tokens[index + 2] == b"[":
                closing = tokens.index(b"]", index + 3)
                for offset, target in enumerate(tokens[index + 3 : closing]):
                    mapping[first + offset] = target[1:-1].decode().upper()
                index = closing + 1
                continue
            start = tokens[index + 2][1:-1].decode().upper()
            head, tail = start[:-4], int(start[-4:], 16)
            for offset in range(last - first + 1):
                mapping[first + offset] = f"{head}{tail + offset:04X}"
            index += 3
    return mapping


def _runs(mapping: dict[int, str]) -> list[tuple[int, int, str]]:
    runs: list[tuple[int, int, str]] = []
    for source in sorted(mapping):
        target = mapping[source]
        if runs:
            first, last, start = runs[-1]
            follows = (
                source == last + 1
                and source >> 8 == first >> 8
                and len(target) == len(start) == 4
                and int(target, 16) == int(start, 16) + (source - first)
                and int(target, 16) >> 8 == int(start, 16) >> 8
            )
            if follows:
                runs[-1] = (first, source, start)
                continue
        runs.append((source, source, target))
    return runs


def _blocks(entries: list[bytes], kind: bytes) -> bytes:
    written = b""
    for offset in range(0, len(entries), BLOCK_SIZE):
        chunk = entries[offset : offset + BLOCK_SIZE]
        written += b"%d begin%s\n%s\nend%s\n" % (len(chunk), kind, b"\n".join(chunk), kind)
    return written


def write_unicode_map(template: bytes, mapping: dict[int, str]) -> bytes:
    blocks = list(BLOCK.finditer(template))
    head = template[: blocks[0].start()] if blocks else template
    tail = template[blocks[-1].end() :] if blocks else b""
    runs = _runs(mapping)
    ranges = [
        b"<%04x> <%04x> <%s>" % (first, last, start.encode())
        for first, last, start in runs
        if last > first
    ]
    chars = [
        b"<%04x> <%s>" % (first, start.encode()) for first, last, start in runs if last == first
    ]
    return head + _blocks(ranges, b"bfrange") + _blocks(chars, b"bfchar") + tail.lstrip(b"\n")


def _use_ascii(mapping: dict[int, str], program: bytes | None) -> bool:
    if not program:
        return False
    glyphs = _ascii_glyphs(program) or _claimed_ascii_glyphs(mapping)
    changed = False
    for glyph, code in glyphs.items():
        target = f"{code:04X}"
        current = mapping.get(glyph)
        if current is not None and current != target and not _is_printable_ascii(current):
            mapping[glyph] = target
            changed = True
    return changed


def _split_ligatures(mapping: dict[int, str]) -> bool:
    changed = False
    for glyph, target in mapping.items():
        letters = LIGATURE_LETTERS.get(target)
        if letters:
            mapping[glyph] = letters
            changed = True
    return changed


def _repair_font(document: pymupdf.Document, font_xref: int) -> bool:
    if document.xref_get_key(font_xref, "Subtype") != ("name", "/Type0"):
        return False
    if document.xref_get_key(font_xref, "Encoding") != ("name", "/Identity-H"):
        return False
    unicode_xref = _xref_value(document, font_xref, "ToUnicode")
    if not unicode_xref:
        return False
    cmap = document.xref_stream(unicode_xref)
    if not cmap or MUPDF_UNICODE_MARK not in cmap:
        return False
    descendant = _descendant(document, font_xref)
    program = _font_program(document, descendant) if descendant else None
    mapping = parse_unicode_map(cmap)
    changed = _use_ascii(mapping, program)
    changed = _split_ligatures(mapping) or changed
    if changed:
        document.update_stream(unicode_xref, write_unicode_map(cmap, mapping))
    return changed


def repair_unicode_maps(document: pymupdf.Document) -> int:
    if not document.is_pdf or document.is_encrypted:
        return 0
    seen: set[int] = set()
    repaired = 0
    for page in document:
        for entry in page.get_fonts(full=True):
            font_xref = entry[0]
            if font_xref in seen or font_xref <= 0:
                continue
            seen.add(font_xref)
            if _repair_font(document, font_xref):
                repaired += 1
    return repaired


def subset_fonts(document: pymupdf.Document, **options: object) -> None:
    repair_unicode_maps(document)
    document.subset_fonts(**options)
