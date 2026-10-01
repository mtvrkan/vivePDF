import base64
import functools
import os
import re
import sys
import zlib
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._appdata import user_data_dir
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
TEXTEDIT_FONT = FONT_DIR / "DejaVuSans.ttf"
TEXTEDIT_FONT_BOLD = FONT_DIR / "DejaVuSans-Bold.ttf"
_BASE14_FAMILIES: dict[str, tuple[str, str, str, str]] = {
    "helvetica": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"),
    "arial": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"),
    "times": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "times-roman": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "times new roman": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "timesnewroman": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "timesnewromanpsmt": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "timesnewromanps": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "arialmt": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"),
    "courier": ("Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"),
    "courier new": ("Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"),
    "couriernew": ("Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"),
    "couriernewpsmt": ("Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"),
    "nimbussans": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"),
    "nimbussanl": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"),
    "liberationsans": (
        "Helvetica",
        "Helvetica-Bold",
        "Helvetica-Oblique",
        "Helvetica-BoldOblique",
    ),
    "nimbusroman": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "nimbusromno9l": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "liberationserif": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "nimbusmonops": ("Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"),
    "nimbusmono": ("Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"),
    "liberationmono": ("Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"),
}


def _base14_variant(font_name: str | None, bold: bool, italic: bool) -> str | None:
    if not font_name:
        return None
    family = re.sub(r"^[A-Z]{6}\+", "", font_name).split("-")[0].split(",")[0].strip().lower()
    variants = _BASE14_FAMILIES.get(family)
    if variants is None:
        return None
    regular, bold_name, italic_name, bold_italic_name = variants
    if bold and italic:
        variant = bold_italic_name
    elif bold:
        variant = bold_name
    elif italic:
        variant = italic_name
    else:
        variant = regular
    return variant if variant in pymupdf.Base14_fontnames else None


FontSource = Literal["embedded", "system", "base14", "fallback"]
BASE14_NAMES = {
    "Helvetica",
    "Helvetica-Bold",
    "Helvetica-Oblique",
    "Helvetica-BoldOblique",
    "Times-Roman",
    "Times-Bold",
    "Times-Italic",
    "Times-BoldItalic",
    "Courier",
    "Courier-Bold",
    "Courier-Oblique",
    "Courier-BoldOblique",
    "Symbol",
    "ZapfDingbats",
}

SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")
STYLE_WORDS = ("bolditalic", "boldoblique", "bold", "italic", "oblique", "regular", "roman", "book")
NAME_SUFFIXES = ("psmt", "mt", "ps")
FONT_EXTENSIONS = {".ttf", ".otf"}
LOADABLE_EXTENSIONS = {"ttf", "otf", "cff", "pfb", "pfa", "ttc"}


def normalize_font_name(name: str) -> str:
    cleaned = SUBSET_PREFIX.sub("", name or "")
    return re.sub(r"[^a-z0-9]", "", cleaned.lower())


def family_key(name: str) -> str:
    key = normalize_font_name(name)
    for suffix in NAME_SUFFIXES:
        if key.endswith(suffix) and len(key) > len(suffix) + 2:
            key = key[: -len(suffix)]
    for word in STYLE_WORDS:
        key = key.replace(word, "")
    for suffix in NAME_SUFFIXES:
        if key.endswith(suffix) and len(key) > len(suffix) + 2:
            key = key[: -len(suffix)]
    return key


def style_of_name(name: str) -> tuple[bool, bool]:
    key = normalize_font_name(name)
    return "bold" in key, "italic" in key or "oblique" in key


def display_font_name(name: str) -> str:
    cleaned = SUBSET_PREFIX.sub("", name or "").split(",")[0].split("-")[0]
    for suffix in ("PSMT", "MT", "PS"):
        if cleaned.endswith(suffix) and len(cleaned) > len(suffix) + 2:
            cleaned = cleaned[: -len(suffix)]
    for word in ("BoldItalic", "BoldOblique", "Bold", "Italic", "Oblique", "Regular"):
        cleaned = cleaned.replace(word, "")
    return cleaned.strip()


def family_label(name: str) -> str:
    cleaned = re.sub(r"[-_]+", " ", SUBSET_PREFIX.sub("", name or "").split(",")[0])
    for word in ("BoldItalic", "BoldOblique", "Bold", "Italic", "Oblique", "Regular"):
        cleaned = cleaned.replace(word, " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    for suffix in ("PSMT", "PS", "MT"):
        if cleaned.endswith(suffix) and len(cleaned) > len(suffix) + 2:
            cleaned = cleaned[: -len(suffix)].strip()
    return re.sub(r"^[^\w]+|[^\w)]+$", "", cleaned).strip()


def _font_directories() -> list[Path]:
    home = Path.home()
    if sys.platform == "win32":
        windir = Path(os.environ.get("WINDIR", r"C:\Windows"))
        local = Path(os.environ.get("LOCALAPPDATA", str(home / "AppData" / "Local")))
        return [windir / "Fonts", local / "Microsoft" / "Windows" / "Fonts"]
    if sys.platform == "darwin":
        return [
            Path("/System/Library/Fonts"),
            Path("/Library/Fonts"),
            home / "Library" / "Fonts",
        ]
    return [
        Path("/usr/share/fonts"),
        Path("/usr/local/share/fonts"),
        home / ".fonts",
        home / ".local" / "share" / "fonts",
    ]


class SystemFont:
    __slots__ = ("bold", "family", "italic", "label", "path")

    def __init__(self, path: Path, name: str, bold: bool, italic: bool) -> None:
        self.path = path
        self.family = family_key(name)
        self.label = family_label(name) or family_label(path.stem) or path.stem
        self.bold = bold
        self.italic = italic


@functools.lru_cache(maxsize=1)
def system_font_index() -> dict[str, list[SystemFont]]:
    index: dict[str, list[SystemFont]] = {}
    for directory in _font_directories():
        if not directory.is_dir():
            continue
        for path in directory.rglob("*"):
            if path.suffix.lower() not in FONT_EXTENSIONS or not path.is_file():
                continue
            try:
                font = pymupdf.Font(fontfile=str(path))
                name = font.name
                flags = font.flags
                bold = bool(flags.get("bold")) or "bold" in name.lower()
                italic = bool(flags.get("italic")) or "italic" in name.lower()
            except Exception:
                continue
            entry = SystemFont(path, name, bold, italic)
            index.setdefault(entry.family, []).append(entry)
            index.setdefault(normalize_font_name(name), []).append(entry)
    return index


def find_system_font(name: str | None, bold: bool, italic: bool) -> Path | None:
    if not name:
        return None
    index = system_font_index()
    candidates = index.get(family_key(name)) or index.get(normalize_font_name(name)) or []
    for entry in candidates:
        if entry.bold == bold and entry.italic == italic:
            return entry.path
    return None


def font_covers(text: str, *, fontfile: str | None = None, fontbuffer: bytes | None = None) -> bool:
    try:
        font = pymupdf.Font(fontfile=fontfile, fontbuffer=fontbuffer)
    except Exception:
        return False
    return all(font.has_glyph(ord(char)) for char in text if not char.isspace())


def embedded_font(document: pymupdf.Document, xref: int) -> tuple[str, str, bytes] | None:
    try:
        kind = document.xref_get_key(xref, "Type")
    except Exception:
        return None
    if kind != ("name", "/Font"):
        return None
    try:
        name, ext, _font_type, buffer = document.extract_font(xref)
    except Exception:
        return None
    if not buffer or ext not in LOADABLE_EXTENSIONS:
        return None
    return str(name), str(ext), bytes(buffer)


def page_font_xrefs(page: pymupdf.Page) -> dict[str, tuple[int, str]]:
    found: dict[str, tuple[int, str]] = {}

    def register(key: str, xref: int, ext: str) -> None:
        if not key:
            return
        current = found.get(key)
        if current is None or (ext != "n/a" and current[1] == "n/a"):
            found[key] = (xref, ext)

    document = page.parent
    for entry in page.get_fonts(full=True):
        xref, ext, basefont = int(entry[0]), str(entry[1]), str(entry[3])
        register(normalize_font_name(basefont), xref, ext)
        register("~" + family_key(basefont), xref, ext)
        if ext == "n/a" or document is None:
            continue
        extracted = embedded_font(document, xref)
        if extracted is None:
            continue
        try:
            loaded = pymupdf.Font(fontbuffer=extracted[2]).name
        except Exception:
            continue
        register(normalize_font_name(loaded), xref, ext)
        register("~" + family_key(loaded), xref, ext)
    return found


def lookup_font_xref(fonts: dict[str, tuple[int, str]], span_font: str) -> tuple[int, str]:
    direct = fonts.get(normalize_font_name(span_font))
    if direct is not None:
        return direct
    return fonts.get("~" + family_key(span_font), (0, ""))


def page_font_siblings(
    page: pymupdf.Page, family: str, exclude_xref: int | None = None
) -> list[tuple[int, bool, bool]]:
    if not family:
        return []
    found: list[tuple[int, bool, bool]] = []
    seen: set[int] = set()
    for entry in page.get_fonts(full=True):
        xref, ext, basefont = int(entry[0]), str(entry[1]), str(entry[3])
        if ext == "n/a" or xref in seen or xref == exclude_xref:
            continue
        if family_key(basefont) != family:
            continue
        seen.add(xref)
        bold, italic = style_of_name(basefont)
        found.append((xref, bold, italic))
    return found


def latin1(text: str) -> bool:
    try:
        text.encode("latin-1")
    except UnicodeEncodeError:
        return False
    return True


class ResolvedFont:
    __slots__ = ("fontbuffer", "fontfile", "fontname", "source_name")

    def __init__(
        self,
        fontname: str,
        fontfile: str | None,
        fontbuffer: bytes | None,
        source_name: str | None = None,
    ) -> None:
        self.fontname = fontname
        self.fontfile = fontfile
        self.fontbuffer = fontbuffer
        self.source_name = source_name


def resolve_font(
    document: pymupdf.Document,
    text: str,
    *,
    font_name: str | None,
    font_xref: int | None,
    bold: bool,
    italic: bool,
    page: pymupdf.Page | None = None,
) -> ResolvedFont:
    if font_xref:
        extracted = embedded_font(document, font_xref)
        style_matches = True
        if extracted is not None:
            origin_bold, origin_italic = style_of_name(extracted[0])
            style_matches = origin_bold == bold and origin_italic == italic
            if style_matches and font_covers(text, fontbuffer=extracted[2]):
                return ResolvedFont(f"vpf{font_xref}", None, extracted[2], extracted[0])
        if page is not None:
            family = family_key(font_name or (extracted[0] if extracted else ""))
            siblings = page_font_siblings(page, family, exclude_xref=font_xref)
            siblings.sort(key=lambda entry: (entry[1] != bold, entry[2] != italic))
            for xref, _sbold, _sitalic in siblings:
                candidate = embedded_font(document, xref)
                if candidate and font_covers(text, fontbuffer=candidate[2]):
                    return ResolvedFont(f"vpf{xref}", None, candidate[2], candidate[0])
        if extracted is not None and font_covers(text, fontbuffer=extracted[2]):
            return ResolvedFont(f"vpf{font_xref}", None, extracted[2], extracted[0])
    system = find_system_font(font_name, bold, italic)
    if system and font_covers(text, fontfile=str(system)):
        return ResolvedFont(f"vps{zlib.crc32(str(system).encode()):08x}", str(system), None)
    variant = _base14_variant(font_name, bold, italic) if latin1(text) else None
    if variant:
        return ResolvedFont(variant, None, None)
    if bold:
        return ResolvedFont("vivepdf-te-bold", str(TEXTEDIT_FONT_BOLD), None)
    return ResolvedFont("vivepdf-te", str(TEXTEDIT_FONT), None)


CANONICAL_CODEPOINTS = (0x20, 0x2D)
BFCHAR_SECTION = re.compile(r"beginbfchar(.*?)endbfchar", re.S)


def prefer_canonical_unicode(
    document: pymupdf.Document, font_xref: int, font: ResolvedFont
) -> None:
    loaded = load_font(font)
    if loaded is None or not font_xref:
        return
    try:
        kind, value = document.xref_get_key(font_xref, "ToUnicode")
    except Exception:  # noqa: BLE001
        return
    if kind != "xref":
        return
    stream_xref = int(value.split()[0])
    original = document.xref_stream(stream_xref).decode("latin-1")
    glyphs = {loaded.has_glyph(codepoint): codepoint for codepoint in CANONICAL_CODEPOINTS}
    glyphs.pop(0, None)
    if not glyphs:
        return

    def canonical_entry(match: re.Match[str]) -> str:
        glyph = int(match.group(1), 16)
        codepoint = glyphs.get(glyph)
        if codepoint is None:
            return match.group(0)
        return f"<{match.group(1)}> <{codepoint:04x}>"

    def rewrite_section(section: re.Match[str]) -> str:
        body = re.sub(r"<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>", canonical_entry, section.group(1))
        return f"beginbfchar{body}endbfchar"

    updated = BFCHAR_SECTION.sub(rewrite_section, original)
    if updated != original:
        document.update_stream(stream_xref, updated.encode("latin-1"))


def ensure_font(page: pymupdf.Page, font: ResolvedFont) -> None:
    if font.fontbuffer is None and font.fontfile is None:
        return
    font_xref = page.insert_font(
        fontname=font.fontname, fontfile=font.fontfile, fontbuffer=font.fontbuffer
    )
    if page.parent is not None:
        name_unnamed_font(page.parent, font_xref, font)
        prefer_canonical_unicode(page.parent, font_xref, font)


UNNAMED_BASEFONTS = {"", "(null)", "#28null#29", "null"}
PDF_NAME_UNSAFE = re.compile(r"[^A-Za-z0-9+\-_.]")


def pdf_font_name(font: ResolvedFont) -> str:
    candidates = [font.source_name or ""]
    loaded = load_font(font)
    if loaded is not None:
        candidates.append(str(loaded.name or ""))
    candidates.append(font.fontname)
    for candidate in candidates:
        cleaned = PDF_NAME_UNSAFE.sub("", candidate.strip().lstrip("/"))
        if cleaned.lower() not in UNNAMED_BASEFONTS:
            return cleaned
    return "vivePDF-Font"


def _name_value(document: pymupdf.Document, xref: int, key: str) -> str | None:
    try:
        kind, value = document.xref_get_key(xref, key)
    except Exception:  # noqa: BLE001
        return None
    if kind != "name":
        return None
    return value.lstrip("/")


def _referenced_xref(document: pymupdf.Document, xref: int, key: str) -> int:
    try:
        kind, value = document.xref_get_key(xref, key)
    except Exception:  # noqa: BLE001
        return 0
    if kind == "xref":
        return int(value.split()[0])
    if kind == "array":
        found = re.match(r"\[\s*(\d+)\s+\d+\s+R", value)
        return int(found.group(1)) if found else 0
    return 0


def name_unnamed_font(document: pymupdf.Document, font_xref: int, font: ResolvedFont) -> None:
    if not font_xref:
        return
    current = _name_value(document, font_xref, "BaseFont")
    if current is not None and current.lower() not in UNNAMED_BASEFONTS:
        return
    name = pdf_font_name(font)
    targets: list[tuple[int, str]] = [(font_xref, "BaseFont")]
    descendant = _referenced_xref(document, font_xref, "DescendantFonts")
    if descendant:
        targets.append((descendant, "BaseFont"))
    descriptor = _referenced_xref(document, descendant or font_xref, "FontDescriptor")
    if descriptor:
        targets.append((descriptor, "FontName"))
    for xref, key in targets:
        existing = _name_value(document, xref, key)
        if existing is None or existing.lower() in UNNAMED_BASEFONTS:
            document.xref_set_key(xref, key, f"/{name}")


def resolution_source(font: ResolvedFont) -> FontSource:
    if font.fontname.startswith("vpf"):
        return "embedded"
    if font.fontname.startswith("vps"):
        return "system"
    if font.fontname in BASE14_NAMES:
        return "base14"
    return "fallback"


def load_font(font: ResolvedFont) -> pymupdf.Font | None:
    try:
        return pymupdf.Font(
            fontfile=font.fontfile,
            fontbuffer=font.fontbuffer,
            fontname=font.fontname if font.fontfile is None and font.fontbuffer is None else None,
        )
    except Exception:  # noqa: BLE001
        return None


def missing_glyphs(font: ResolvedFont, text: str) -> str:
    loaded = load_font(font)
    if loaded is None:
        return "".join(sorted({char for char in text if not char.isspace()}))
    return "".join(
        sorted({char for char in text if not char.isspace() and not loaded.has_glyph(ord(char))})
    )


class FontResolution(RpcModel):
    family: str
    source: FontSource
    missing_glyphs: str = Field(default="")
    font_id: str | None = None


def system_font_display_name(fontfile: str) -> str:
    stem = Path(fontfile).stem
    try:
        loaded = pymupdf.Font(fontfile=fontfile)
    except Exception:
        return display_font_name(stem) or stem
    return display_font_name(loaded.name) or display_font_name(stem) or stem


def describe_resolution(font: ResolvedFont, font_name: str | None, text: str) -> FontResolution:
    source = resolution_source(font)
    if source == "embedded":
        family = display_font_name(font_name or font.fontname)
    elif source == "system" and font.fontfile:
        family = system_font_display_name(font.fontfile)
    elif source == "base14":
        family = font.fontname
    else:
        family = "DejaVu Sans"
    return FontResolution(
        family=family,
        source=source,
        missing_glyphs=missing_glyphs(font, text),
        font_id=f"file:{font.fontfile}" if source == "system" and font.fontfile else None,
    )


class SystemFontsParams(RpcModel):
    pass


class SystemFontFamily(RpcModel):
    family: str
    styles: list[str]


class SystemFontsResult(RpcModel):
    families: list[SystemFontFamily]


def _style_label(bold: bool, italic: bool) -> str:
    if bold and italic:
        return "Bold Italic"
    if bold:
        return "Bold"
    if italic:
        return "Italic"
    return "Regular"


@op("editor.system_fonts", SystemFontsParams)
def system_fonts(_params: SystemFontsParams, _progress: Progress) -> SystemFontsResult:
    return SystemFontsResult(
        families=[
            SystemFontFamily(family=label, styles=sorted(styles))
            for _, label, styles in system_families()
        ]
    )


BUNDLED_FONTS: dict[str, tuple[str, str, str]] = {
    "dejavu-sans": ("DejaVu Sans", "DejaVuSans.ttf", "DejaVuSans-Bold.ttf"),
}
IMPORT_EXTENSIONS = {".ttf", ".otf"}
IMPORT_MAX_BYTES = 30 * 1024 * 1024
SAFE_STEM = re.compile(r"[^A-Za-z0-9._-]+")
FontSourceKind = Literal["bundled", "system", "imported"]


def imported_font_dir() -> Path:
    directory = user_data_dir() / "fonts"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _safe_stem(name: str) -> str:
    cleaned = SAFE_STEM.sub("-", name).strip("-.")
    return (cleaned or "font")[:64]


def font_label(path: Path) -> str:
    try:
        internal = pymupdf.Font(fontfile=str(path)).name
    except Exception:  # noqa: BLE001
        internal = ""
    return display_font_name(internal) or path.stem.replace("-", " ").strip() or path.stem


def imported_fonts() -> dict[str, Path]:
    found: dict[str, Path] = {}
    for path in sorted(imported_font_dir().glob("*")):
        if path.suffix.lower() in IMPORT_EXTENSIONS and path.is_file():
            found[path.stem] = path
    return found


class ImportedFace:
    def __init__(self, stem: str, path: Path, name: str, bold: bool, italic: bool) -> None:
        self.stem = stem
        self.path = path
        self.name = name
        self.bold = bold
        self.italic = italic


def _face_of(stem: str, path: Path) -> ImportedFace:
    try:
        font = pymupdf.Font(fontfile=str(path))
        name, flags = font.name, font.flags
    except Exception:  # noqa: BLE001
        return ImportedFace(stem, path, path.stem, False, False)
    return ImportedFace(stem, path, name, bool(flags.get("bold")), bool(flags.get("italic")))


def imported_faces() -> list[ImportedFace]:
    return [_face_of(stem, path) for stem, path in imported_fonts().items()]


def imported_families() -> dict[str, list[ImportedFace]]:
    grouped: dict[str, list[ImportedFace]] = {}
    for face in imported_faces():
        grouped.setdefault(family_key(face.name) or face.stem, []).append(face)
    return grouped


def _family_of(stem: str) -> list[ImportedFace]:
    for faces in imported_families().values():
        if any(face.stem == stem for face in faces):
            return faces
    return []


class FontChoice(RpcModel):
    id: str
    name: str
    source: FontSourceKind
    styles: list[str]


def system_families() -> list[tuple[str, str, set[str]]]:
    grouped: dict[str, tuple[set[str], set[str]]] = {}
    seen: set[Path] = set()
    for key, entries in system_font_index().items():
        for entry in entries:
            if key != entry.family or entry.path in seen:
                continue
            seen.add(entry.path)
            labels, styles = grouped.setdefault(entry.family, (set(), set()))
            labels.add(entry.label)
            styles.add(_style_label(entry.bold, entry.italic))
    by_label: dict[str, tuple[str, set[str]]] = {}
    for family, (labels, styles) in grouped.items():
        if not family or not any(labels):
            continue
        label = max(
            (item for item in labels if item), key=lambda item: (item.count(" "), -len(item))
        )
        key_so_far, styles_so_far = by_label.get(label, ("", set()))
        winner = family if len(styles) > len(styles_so_far) else (key_so_far or family)
        by_label[label] = (winner, styles_so_far | styles)
    return sorted(
        ((family, label, styles) for label, (family, styles) in by_label.items()),
        key=lambda item: item[1].lower(),
    )


def font_catalogue() -> list[FontChoice]:
    choices = [
        FontChoice(
            id=f"bundled:{key}",
            name=label,
            source="bundled",
            styles=["Bold", "Regular"],
        )
        for key, (label, _, _) in BUNDLED_FONTS.items()
    ]
    for faces in imported_families().values():
        lead = next((face for face in faces if not face.bold and not face.italic), faces[0])
        choices.append(
            FontChoice(
                id=f"imported:{lead.stem}",
                name=family_label(lead.name) or font_label(lead.path),
                source="imported",
                styles=sorted({_style_label(face.bold, face.italic) for face in faces}),
            )
        )
    choices.extend(
        FontChoice(id=f"system:{family}", name=label, source="system", styles=sorted(styles))
        for family, label, styles in system_families()
    )
    return choices


def resolve_choice(font_id: str | None, bold: bool) -> Path:
    fallback = FONT_DIR / (BUNDLED_FONTS["dejavu-sans"][2 if bold else 1])
    if not font_id:
        return fallback
    kind, _, value = font_id.partition(":")
    if kind == "bundled":
        entry = BUNDLED_FONTS.get(value)
        return FONT_DIR / entry[2 if bold else 1] if entry else fallback
    if kind == "imported":
        faces = _family_of(value)
        if not faces:
            path = imported_fonts().get(value)
            return path if path is not None else fallback
        wanted = [face for face in faces if face.bold == bold and not face.italic]
        chosen = wanted or [face for face in faces if face.stem == value] or faces
        return chosen[0].path
    if kind == "system":
        found = find_system_font(value, bold, False) or find_system_font(value, False, False)
        if found is None:
            entries = system_font_index().get(value) or []
            found = entries[0].path if entries else None
        return found if found is not None else fallback
    return fallback


def font_name_for(path: Path) -> str:
    return f"vivepdf-{_safe_stem(path.stem).lower()[:24]}"


def uncovered_glyphs(path: Path, text: str) -> str:
    try:
        font = pymupdf.Font(fontfile=str(path))
    except Exception:  # noqa: BLE001
        return ""
    missing = [
        char for char in dict.fromkeys(text) if not char.isspace() and not font.has_glyph(ord(char))
    ]
    return "".join(missing)


class FontCatalogueParams(RpcModel):
    pass


class FontCatalogueResult(RpcModel):
    fonts: list[FontChoice]


@op("fonts.catalogue", FontCatalogueParams)
def catalogue(_params: FontCatalogueParams, _progress: Progress) -> FontCatalogueResult:
    return FontCatalogueResult(fonts=font_catalogue())


class FontAddParams(RpcModel):
    path: str


@op("fonts.add", FontAddParams)
def add_font(params: FontAddParams, _progress: Progress) -> FontChoice:
    source = Path(params.path)
    if source.suffix.lower() not in IMPORT_EXTENSIONS:
        raise OpError(ErrorCode.INVALID_PARAMS, "only .ttf and .otf files can be added")
    if not source.is_file():
        raise OpError(ErrorCode.FILE_NOT_FOUND, f"font not found: {source.name}")
    if source.stat().st_size > IMPORT_MAX_BYTES:
        raise OpError(ErrorCode.INVALID_PARAMS, "font file is too large")
    try:
        loaded = pymupdf.Font(fontfile=str(source))
        readable = bool(loaded.name)
    except Exception as error:  # noqa: BLE001
        raise OpError(ErrorCode.INVALID_PARAMS, f"cannot read font: {source.name}") from error
    if not readable:
        raise OpError(ErrorCode.INVALID_PARAMS, f"cannot read font: {source.name}")
    directory = imported_font_dir()
    stem = _safe_stem(source.stem)
    target = (directory / f"{stem}{source.suffix.lower()}").resolve()
    if target.parent != directory.resolve():
        raise OpError(ErrorCode.INVALID_PARAMS, "invalid font name")
    counter = 2
    while target.exists() and target.read_bytes() != source.read_bytes():
        target = (directory / f"{stem}-{counter}{source.suffix.lower()}").resolve()
        counter += 1
    target.write_bytes(source.read_bytes())
    faces = _family_of(target.stem) or [_face_of(target.stem, target)]
    lead = next((face for face in faces if not face.bold and not face.italic), faces[0])
    return FontChoice(
        id=f"imported:{lead.stem}",
        name=family_label(lead.name) or font_label(lead.path),
        source="imported",
        styles=sorted({_style_label(face.bold, face.italic) for face in faces}),
    )


class FontRemoveParams(RpcModel):
    id: str


class FontRemoveResult(RpcModel):
    removed: bool


@op("fonts.remove", FontRemoveParams)
def remove_font(params: FontRemoveParams, _progress: Progress) -> FontRemoveResult:
    kind, _, value = params.id.partition(":")
    if kind != "imported":
        raise OpError(ErrorCode.INVALID_PARAMS, "only added fonts can be removed")
    faces = _family_of(value)
    if not faces:
        path = imported_fonts().get(value)
        if path is None:
            return FontRemoveResult(removed=False)
        path.unlink()
        return FontRemoveResult(removed=True)
    for face in faces:
        face.path.unlink(missing_ok=True)
    return FontRemoveResult(removed=True)


FONT_FILE_MAX_BYTES = 30 * 1024 * 1024


class FontFileParams(RpcModel):
    id: str = Field(min_length=1, max_length=4096)
    bold: bool = False


class FontFileResult(RpcModel):
    name: str
    ext: str
    base64: str


def _same_file(left: Path, right: Path) -> bool:
    try:
        return left.resolve() == right.resolve()
    except OSError:
        return False


def known_font_file(path: Path) -> bool:
    if path.suffix.lower() not in FONT_EXTENSIONS or not path.is_file():
        return False
    for directory in (FONT_DIR, imported_font_dir()):
        if _same_file(path.parent, directory):
            return True
    installed = (entry.path for entries in system_font_index().values() for entry in entries)
    return any(_same_file(candidate, path) for candidate in installed)


def font_file_path(font_id: str, bold: bool) -> Path:
    kind, _, value = font_id.partition(":")
    if kind != "file":
        return resolve_choice(font_id, bold)
    path = Path(value)
    if not known_font_file(path):
        raise OpError(ErrorCode.INVALID_PARAMS, "not an installed font", {"reason": "fontFile"})
    return path


@op("fonts.file", FontFileParams)
def font_file(params: FontFileParams, _progress: Progress) -> FontFileResult:
    path = font_file_path(params.id, params.bold)
    if path.stat().st_size > FONT_FILE_MAX_BYTES:
        raise OpError(ErrorCode.INVALID_PARAMS, "font file too large", {"reason": "fontSize"})
    data = path.read_bytes()
    return FontFileResult(
        name=font_label(path),
        ext=path.suffix.lower().lstrip("."),
        base64=base64.b64encode(data).decode("ascii"),
    )
