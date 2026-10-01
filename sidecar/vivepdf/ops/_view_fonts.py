import re
import time
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from functools import cache
from itertools import chain
from pathlib import Path

import pymupdf
from fontTools.agl import toUnicode
from fontTools.ttLib import TTFont

from vivepdf.ops._content import content_tokens
from vivepdf.ops._name_syntax import pdf_name
from vivepdf.ops._to_unicode import cmap_entries, cmap_stream
from vivepdf.ops.font_repair import _descendant_font, _xref_of
from vivepdf.ops.fonts import TEXTEDIT_FONT, TEXTEDIT_FONT_BOLD, style_of_name
from vivepdf.rpc.progress import Progress, silent_progress

RTL_RANGES = (
    (0x0590, 0x05FF),
    (0x0600, 0x06FF),
    (0x0750, 0x077F),
    (0x08A0, 0x08FF),
    (0xFB1D, 0xFDFF),
    (0xFE70, 0xFEFF),
)
FORM_TAGS = {
    "<isolated>": "isolated",
    "<final>": "final",
    "<initial>": "initial",
    "<medial>": "medial",
}
SIMPLE_SUBTYPES = {"TrueType", "Type1", "MMType1"}
IDENTITY_ENCODINGS = {"/Identity-H", "/Identity-V"}
BACKUP_KEY = "VivePdfViewBackup"
FORCE_BOLD = 1 << 18
SYMBOLIC = 4
NONSYMBOLIC = 32
BOLD_WEIGHT = 600
ANALYSIS_BUDGET_SECONDS = 0.6
DIRECTION_SAMPLE_PAGES = 3
SHOW_OPERATORS = {b"Tj", b"TJ", b"'", b'"'}
NEWLINE_OPERATORS = {b"T*", b"'", b'"'}
ESCAPED = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f"}
NUMBER = re.compile(rb"[+-]?(?:\d+\.?\d*|\.\d+)")
DESCRIPTOR_REFERENCE = re.compile(r"/FontDescriptor\s*\d+\s+\d+\s+R")
RTL_PATTERN = re.compile("[" + "".join(f"{chr(low)}-{chr(high)}" for low, high in RTL_RANGES) + "]")


@dataclass
class FontPlan:
    xref: int
    subtype: str
    descendant: int
    codes: dict[int, str]
    bold: bool
    rtl: bool
    two_byte: bool
    base_font: str


@dataclass
class Observations:
    forms: dict[int, Counter] = field(default_factory=dict)
    used: set[int] = field(default_factory=set)


def is_rtl(text: str) -> bool:
    return RTL_PATTERN.search(text) is not None


@cache
def presentation_forms() -> tuple[dict[tuple[str, str], str], dict[str, tuple[str, str]]]:
    forward: dict[tuple[str, str], str] = {}
    backward: dict[str, tuple[str, str]] = {}
    for code in chain(range(0xFE70, 0xFF00), range(0xFB50, 0xFE00)):
        parts = unicodedata.decomposition(chr(code)).split()
        if len(parts) < 2 or parts[0] not in FORM_TAGS:
            continue
        key = ("".join(chr(int(part, 16)) for part in parts[1:]), FORM_TAGS[parts[0]])
        forward.setdefault(key, chr(code))
        backward[chr(code)] = key
    return forward, backward


def joining_type(text: str) -> str:
    forward, backward = presentation_forms()
    base = backward.get(text, (text, ""))[0]
    if base in ("\u0640", "\u200d"):
        return "D"
    if len(base) == 1 and unicodedata.category(base) in ("Mn", "Me"):
        return "T"
    if (base, "initial") in forward or (base, "medial") in forward:
        return "D"
    if (base, "final") in forward:
        return "R"
    return "U"


def _neighbour(kinds: list[str], indices: range) -> str:
    return next((kinds[index] for index in indices if kinds[index] != "T"), "U")


def positional_forms(texts: list[str]) -> list[str | None]:
    kinds = [joining_type(text) for text in texts]
    forms: list[str | None] = []
    for index, kind in enumerate(kinds):
        if kind not in ("D", "R"):
            forms.append(None)
            continue
        joins_before = _neighbour(kinds, range(index - 1, -1, -1)) == "D"
        joins_after = kind == "D" and _neighbour(kinds, range(index + 1, len(kinds))) in ("D", "R")
        if joins_before and joins_after:
            forms.append("medial")
        elif joins_before:
            forms.append("final")
        elif joins_after:
            forms.append("initial")
        else:
            forms.append("isolated")
    return forms


def display_char(text: str, form: str | None) -> str:
    forward, backward = presentation_forms()
    if text in backward:
        return text
    if form and (text, form) in forward:
        return forward[(text, form)]
    if len(text) > 1 and (text, "isolated") in forward:
        return forward[(text, "isolated")]
    return text[:1]


def _name_of(value: str) -> str:
    raw = re.sub(
        r"#([0-9A-Fa-f]{2})", lambda match: chr(int(match.group(1), 16)), value.lstrip("/")
    )
    return raw.encode("latin-1", errors="ignore").decode("utf-8", errors="replace")


def _number_of(document: pymupdf.Document, xref: int, key: str) -> float:
    if not xref:
        return 0.0
    kind, value = document.xref_get_key(xref, key)
    try:
        return float(value) if kind in ("int", "float") else 0.0
    except ValueError:
        return 0.0


def _simple_codes(document: pymupdf.Document, xref: int) -> dict[int, str]:
    kind, value = document.xref_get_key(xref, "Encoding")
    base = value if kind == "name" else document.xref_get_key(xref, "Encoding/BaseEncoding")[1]
    codec = "mac_roman" if base == "/MacRomanEncoding" else "cp1252"
    codes = {code: bytes([code]).decode(codec, errors="ignore") for code in range(32, 256)}
    kind, differences = document.xref_get_key(xref, "Encoding/Differences")
    if kind != "array":
        return codes
    code = 0
    for token in re.findall(r"/[^\s/\[\]()<>]+|[+-]?\d+", differences):
        if not token.startswith("/"):
            code = int(token)
            continue
        text = toUnicode(_name_of(token))
        if text:
            codes[code] = text
        code += 1
    return codes


def _descriptor(document: pymupdf.Document, plan_owner: int) -> int:
    return _xref_of(document, plan_owner, "FontDescriptor")


def _unicode_map(
    document: pymupdf.Document, xref: int, parsed: dict[bytes, dict[int, str]]
) -> dict[int, str]:
    stream = _xref_of(document, xref, "ToUnicode")
    if not stream:
        return {}
    data = document.xref_stream(stream) or b""
    if data not in parsed:
        try:
            parsed[data] = cmap_entries(data)
        except Exception:  # noqa: BLE001
            parsed[data] = {}
    return parsed[data]


def _maps_rtl(codes: dict[int, str], known: dict[int, tuple[dict[int, str], bool]]) -> bool:
    entry = known.get(id(codes))
    if entry is None or entry[0] is not codes:
        entry = (codes, is_rtl("".join(codes.values())))
        known[id(codes)] = entry
    return entry[1]


def font_plan(
    document: pymupdf.Document,
    xref: int,
    subtype: str,
    parsed: dict[bytes, dict[int, str]] | None = None,
    rtl_known: dict[int, tuple[dict[int, str], bool]] | None = None,
) -> FontPlan | None:
    parsed = {} if parsed is None else parsed
    rtl_known = {} if rtl_known is None else rtl_known
    if subtype == "Type0":
        if document.xref_get_key(xref, "Encoding")[1] not in IDENTITY_ENCODINGS:
            return None
        descendant = _descendant_font(document, xref)
        if not descendant:
            return None
        codes = _unicode_map(document, xref, parsed)
    elif subtype in SIMPLE_SUBTYPES:
        descendant = 0
        codes = _unicode_map(document, xref, parsed) or _simple_codes(document, xref)
    else:
        return None
    if not codes or not _maps_rtl(codes, rtl_known):
        return None
    owner = descendant or xref
    descriptor = _descriptor(document, owner)
    base_font = _name_of(document.xref_get_key(xref, "BaseFont")[1])
    bold = (
        style_of_name(base_font)[0]
        or _number_of(document, descriptor, "FontWeight") >= BOLD_WEIGHT
        or int(_number_of(document, descriptor, "Flags")) & FORCE_BOLD != 0
    )
    return FontPlan(xref, subtype, descendant, codes, bold, True, subtype == "Type0", base_font)


def bold_marker_needed(document: pymupdf.Document, xref: int, subtype: str) -> bool:
    if subtype != "Type0":
        return False
    base_font = _name_of(document.xref_get_key(xref, "BaseFont")[1])
    if style_of_name(base_font)[0]:
        return False
    descendant = _descendant_font(document, xref)
    descriptor = _descriptor(document, descendant) if descendant else 0
    return (
        _number_of(document, descriptor, "FontWeight") >= BOLD_WEIGHT
        or int(_number_of(document, descriptor, "Flags")) & FORCE_BOLD != 0
    )


@dataclass
class DisplayFontScan:
    plans: list[FontPlan] = field(default_factory=list)
    bold_markers: list[int] = field(default_factory=list)
    page_fonts: list[list[tuple]] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.plans or self.bold_markers)


def scan_display_fonts(
    document: pymupdf.Document, progress: Progress | None = None
) -> DisplayFontScan:
    progress = progress or silent_progress()
    scan = DisplayFontScan()
    checked: set[int] = set()
    parsed: dict[bytes, dict[int, str]] = {}
    rtl_known: dict[int, tuple[dict[int, str], bool]] = {}
    for page in document:
        progress.check_cancelled()
        entries = page.get_fonts(full=True)
        scan.page_fonts.append(entries)
        for entry in entries:
            xref, ext, subtype = entry[0], entry[1], entry[2]
            if xref in checked or ext != "n/a":
                continue
            checked.add(xref)
            plan = font_plan(document, xref, subtype, parsed, rtl_known)
            if plan is not None:
                scan.plans.append(plan)
            elif bold_marker_needed(document, xref, subtype):
                scan.bold_markers.append(xref)
    return scan


def _literal_bytes(token: bytes) -> bytes:
    body = token[1:-1]
    output = bytearray()
    index = 0
    while index < len(body):
        byte = body[index : index + 1]
        if byte != b"\\":
            output += byte
            index += 1
            continue
        following = body[index + 1 : index + 2]
        if following in ESCAPED:
            output += ESCAPED[following]
            index += 2
        elif following.isdigit():
            digits = re.match(rb"[0-7]{1,3}", body[index + 1 : index + 4])
            width = len(digits.group(0)) if digits else 1
            output.append(int(digits.group(0), 8) & 0xFF if digits else 0)
            index += 1 + width
        elif following in (b"\r", b"\n"):
            index += 2
            if following == b"\r" and body[index : index + 1] == b"\n":
                index += 1
        else:
            output += following
            index += 2
    return bytes(output)


def string_bytes(token: bytes) -> bytes | None:
    if token.startswith(b"("):
        return _literal_bytes(token)
    if token.startswith(b"<") and not token.startswith(b"<<"):
        digits = re.sub(rb"[^0-9A-Fa-f]", b"", token)
        if len(digits) % 2:
            digits += b"0"
        return bytes.fromhex(digits.decode("ascii"))
    return None


def _codes_of(data: bytes, two_byte: bool) -> list[int]:
    if not two_byte:
        return list(data)
    return [int.from_bytes(data[index : index + 2], "big") for index in range(0, len(data) - 1, 2)]


class RunCollector:
    def __init__(self, plans: dict[int, FontPlan], observations: dict[int, Observations]):
        self.plans = plans
        self.observations = observations
        self.visual: dict[int, bool] = {}
        self.font = 0
        self.run: list[int] = []
        self.line_y: float | None = None

    def flush(self) -> None:
        plan = self.plans.get(self.font)
        if plan is not None and self.run:
            observed = self.observations.setdefault(self.font, Observations())
            observed.used.update(self.run)
            codes = self.run[::-1] if self.visual.get(self.font, True) else self.run
            texts = [plan.codes.get(code, "") for code in codes]
            for code, form in zip(codes, positional_forms(texts), strict=True):
                if form:
                    observed.forms.setdefault(code, Counter())[form] += 1
        self.run = []

    def select_font(self, xref: int) -> None:
        if xref != self.font:
            self.flush()
        self.font = xref

    def show(self, data: bytes) -> None:
        plan = self.plans.get(self.font)
        if plan is not None:
            self.run.extend(_codes_of(data, plan.two_byte))

    def move(self, y: float) -> None:
        if self.line_y is not None and abs(y - self.line_y) > 0.01:
            self.flush()
        self.line_y = y


def _number(token: bytes) -> float:
    return float(token) if NUMBER.fullmatch(token) else 0.0


def collect_runs(data: bytes, fonts: dict[bytes, int], collector: RunCollector) -> None:
    operands: list[bytes] = []
    for _start, _end, token in content_tokens(data):
        if token[:1] in b"(<[]/+-.0123456789" or token in (b"true", b"false", b"null"):
            operands.append(token)
            continue
        if token == b"BT":
            collector.flush()
            collector.line_y = None
        elif token == b"ET":
            collector.flush()
        elif token == b"Tf" and len(operands) >= 2:
            collector.select_font(fonts.get(operands[-2].lstrip(b"/"), 0))
        elif token in (b"Td", b"TD") and operands:
            collector.move((collector.line_y or 0.0) + _number(operands[-1]))
        elif token == b"Tm" and operands:
            collector.move(_number(operands[-1]))
        if token in NEWLINE_OPERATORS:
            collector.flush()
        if token in SHOW_OPERATORS:
            for operand in operands if token == b"TJ" else operands[-1:]:
                shown = string_bytes(operand)
                if shown is not None:
                    collector.show(shown)
        operands = []
    collector.flush()


def _stream_bytes(document: pymupdf.Document, xrefs: list[int]) -> bytes:
    return b"\n".join(document.xref_stream(xref) or b"" for xref in xrefs)


def _draws_left_to_right(page: pymupdf.Page, names: set[str]) -> dict[str, bool]:
    votes: dict[str, int] = {}
    for span in page.get_texttrace():
        name = str(span.get("font", ""))
        if name not in names:
            continue
        origins = [char[2][0] for char in span["chars"] if is_rtl(chr(char[0]))]
        for left, right in zip(origins, origins[1:], strict=False):
            votes[name] = votes.get(name, 0) + (1 if right > left else -1)
    return {name: vote >= 0 for name, vote in votes.items()}


def observe_fonts(
    document: pymupdf.Document,
    plans: list[FontPlan],
    progress: Progress,
    page_fonts: list[list[tuple]] | None = None,
) -> dict[int, Observations]:
    known_fonts = page_fonts if page_fonts and len(page_fonts) == document.page_count else None
    by_xref = {plan.xref: plan for plan in plans}
    observations: dict[int, Observations] = {}
    collector = RunCollector(by_xref, observations)
    names = {plan.base_font for plan in plans}
    direction: dict[str, bool] = {}
    sampled = 0
    done: set[tuple[int, ...]] = set()
    deadline = time.perf_counter() + ANALYSIS_BUDGET_SECONDS
    for page in document:
        progress.check_cancelled()
        contexts: dict[tuple[int, ...], dict[bytes, int]] = {}
        entries = known_fonts[page.number] if known_fonts else page.get_fonts(full=True)
        for entry in entries:
            if entry[0] not in by_xref:
                continue
            referencer = entry[6]
            streams = (
                tuple(page.get_contents())
                if referencer in (0, page.xref) or not document.xref_is_stream(referencer)
                else (referencer,)
            )
            contexts.setdefault(streams, {})[entry[4].encode("latin-1")] = entry[0]
        if not contexts:
            continue
        if sampled < DIRECTION_SAMPLE_PAGES and names - direction.keys():
            direction.update(_draws_left_to_right(page, names - direction.keys()))
            sampled += 1
            collector.visual = {plan.xref: direction.get(plan.base_font, True) for plan in plans}
        for streams, fonts in contexts.items():
            if streams in done:
                continue
            done.add(streams)
            collector.font = 0
            collect_runs(_stream_bytes(document, list(streams)), fonts, collector)
        if time.perf_counter() > deadline:
            break
    return observations


@cache
def _face(path: Path) -> tuple[bytes, dict[int, int]]:
    data = path.read_bytes()
    font = TTFont(path, lazy=True)
    order = {name: gid for gid, name in enumerate(font.getGlyphOrder())}
    cmap = {code: order[name] for code, name in font.getBestCmap().items() if name in order}
    font.close()
    return data, cmap


def _chosen_form(observed: Observations | None, code: int) -> str | None:
    votes = observed.forms.get(code) if observed else None
    return votes.most_common(1)[0][0] if votes else None


def _new_stream(
    document: pymupdf.Document, data: bytes, entries: str = "", compress: bool = True
) -> int:
    xref = document.get_new_xref()
    document.update_object(xref, f"<<{entries}>>")
    document.update_stream(xref, data, compress=compress)
    return xref


def _put_reference(
    document: pymupdf.Document, xref: int, key: str, target: int, in_array: bool = False
) -> None:
    pdf = pymupdf._as_pdf_document(document)
    holder = pymupdf.mupdf.pdf_load_object(pdf, xref)
    value = pymupdf.mupdf.pdf_new_indirect(pdf, target, 0)
    if in_array:
        array = pymupdf.mupdf.pdf_new_array(pdf, 1)
        pymupdf.mupdf.pdf_array_push(array, value)
        value = array
    pymupdf.mupdf.pdf_dict_puts(holder, key, value)


def _back_up(document: pymupdf.Document, xref: int, saved: set[int]) -> None:
    if xref in saved or not xref:
        return
    original = document.xref_object(xref, compressed=True).encode("utf-8")
    backup = _new_stream(document, original, compress=False)
    _put_reference(document, xref, BACKUP_KEY, backup)
    saved.add(xref)


def _own_descendant(document: pymupdf.Document, plan: FontPlan) -> int:
    descendant = document.get_new_xref()
    document.update_object(descendant, document.xref_object(plan.descendant, compressed=True))
    document.xref_set_key(plan.xref, "DescendantFonts", f"[{descendant} 0 R]")
    return descendant


def _own_descriptor(document: pymupdf.Document, owner: int, base_font: str) -> int:
    shared = _descriptor(document, owner)
    name = re.sub(r"[^A-Za-z0-9+-]", "", base_font) or "Substitute"
    source = (
        document.xref_object(shared, compressed=True)
        if shared
        else f"<</Type/FontDescriptor/FontName/{name}/Flags {NONSYMBOLIC}"
        "/FontBBox[-1021 -463 1793 1232]/ItalicAngle 0/Ascent 928/Descent -236"
        "/CapHeight 729/StemV 80>>"
    )
    descriptor = document.get_new_xref()
    document.update_object(descriptor, source)
    document.xref_set_key(owner, "FontDescriptor", f"{descriptor} 0 R")
    return descriptor


def _glyph_map(
    plan: FontPlan, observed: Observations | None, cmap: dict[int, int]
) -> dict[int, str]:
    chosen: dict[int, str] = {}
    for code, text in plan.codes.items():
        if not text:
            continue
        char = display_char(text, _chosen_form(observed, code))
        if ord(char) not in cmap:
            char = text[:1]
        chosen[code] = char
    return chosen


@dataclass
class EmbedState:
    files: dict[Path, int] = field(default_factory=dict)
    saved: set[int] = field(default_factory=set)
    tables: dict[tuple, int] = field(default_factory=dict)
    descendants: dict[tuple, int] = field(default_factory=dict)


def _glyph_table(chosen: dict[int, str], cmap: dict[int, int]) -> bytes:
    table = bytearray((max(chosen, default=0) + 1) * 2)
    for code, char in chosen.items():
        table[code * 2 : code * 2 + 2] = cmap.get(ord(char), 0).to_bytes(2, "big")
    return bytes(table)


def _table_key(plan: FontPlan, observed: Observations | None, path: Path) -> tuple:
    forms = tuple(
        sorted((code, _chosen_form(observed, code)) for code in observed.forms) if observed else ()
    )
    return id(plan.codes), forms, path


def _descendant_signature(document: pymupdf.Document, plan: FontPlan, table_key: tuple) -> tuple:
    body = DESCRIPTOR_REFERENCE.sub("", document.xref_object(plan.descendant, compressed=True))
    descriptor = _descriptor(document, plan.descendant)
    described = document.xref_object(descriptor, compressed=True) if descriptor else ""
    return body, described, table_key


def _embed(
    document: pymupdf.Document,
    plan: FontPlan,
    observed: Observations | None,
    state: EmbedState,
) -> None:
    path = TEXTEDIT_FONT_BOLD if plan.bold else TEXTEDIT_FONT
    data, cmap = _face(path)
    if path not in state.files:
        state.files[path] = _new_stream(document, data, f"/Length1 {len(data)}")
    _back_up(document, plan.xref, state.saved)
    signature = (
        _descendant_signature(document, plan, _table_key(plan, observed, path))
        if plan.descendant
        else None
    )
    if signature is not None and signature in state.descendants:
        _put_reference(
            document, plan.xref, "DescendantFonts", state.descendants[signature], in_array=True
        )
        return
    owner = _own_descendant(document, plan) if plan.descendant else plan.xref
    descriptor = _own_descriptor(document, owner, plan.base_font)
    for key in ("FontFile", "FontFile3"):
        document.xref_set_key(descriptor, key, "null")
    document.xref_set_key(descriptor, "FontFile2", f"{state.files[path]} 0 R")
    if plan.descendant:
        key = _table_key(plan, observed, path)
        if key not in state.tables:
            table = _glyph_table(_glyph_map(plan, observed, cmap), cmap)
            state.tables[key] = _new_stream(document, table)
        document.xref_set_key(owner, "Subtype", "/CIDFontType2")
        document.xref_set_key(owner, "CIDToGIDMap", f"{state.tables[key]} 0 R")
        if signature is not None:
            state.descendants[signature] = owner
        return
    chosen = _glyph_map(plan, observed, cmap)
    flags = int(_number_of(document, descriptor, "Flags"))
    document.xref_set_key(descriptor, "Flags", str((flags & ~SYMBOLIC) | NONSYMBOLIC))
    if document.xref_get_key(plan.xref, "ToUnicode")[0] == "null":
        unicode_map = _new_stream(document, cmap_stream(plan.codes))
        document.xref_set_key(plan.xref, "ToUnicode", f"{unicode_map} 0 R")
    differences = " ".join(
        f"{code} /uni{ord(char):04X}"
        for code, char in sorted(chosen.items())
        if ord(char) <= 0xFFFF
    )
    document.xref_set_key(plan.xref, "Subtype", "/TrueType")
    document.xref_set_key(
        plan.xref,
        "Encoding",
        f"<</Type/Encoding/BaseEncoding/WinAnsiEncoding/Differences[{differences}]>>",
    )


def _mark_bold(document: pymupdf.Document, xref: int, saved: set[int]) -> None:
    descendant = _descendant_font(document, xref)
    for target in (xref, descendant):
        if not target:
            continue
        _back_up(document, target, saved)
        name = _name_of(document.xref_get_key(target, "BaseFont")[1])
        marked = f"{name},Bold" if "," not in name else name.replace(",", ",Bold", 1)
        document.xref_set_key(target, "BaseFont", pdf_name(marked))


def substitute_display_fonts(
    document: pymupdf.Document, scan: DisplayFontScan, progress: Progress | None = None
) -> int:
    progress = progress or silent_progress()
    observations = (
        observe_fonts(document, scan.plans, progress, scan.page_fonts) if scan.plans else {}
    )
    state = EmbedState()
    changed = 0
    for plan in scan.plans:
        progress.check_cancelled()
        observed = observations.get(plan.xref)
        if observed is not None and not any(
            is_rtl(plan.codes.get(code, "")) for code in observed.used
        ):
            continue
        _embed(document, plan, observed, state)
        changed += 1
    for xref in scan.bold_markers:
        _mark_bold(document, xref, state.saved)
        changed += 1
    return changed


def restore_display_fonts(document: pymupdf.Document) -> int:
    restored = 0
    for xref in range(1, document.xref_length()):
        kind, value = document.xref_get_key(xref, BACKUP_KEY)
        if kind != "xref":
            continue
        backup = int(value.split()[0])
        original = (document.xref_stream(backup) or b"").decode("utf-8")
        if not original.strip().startswith("<<"):
            continue
        document.update_object(xref, original)
        restored += 1
    return restored
