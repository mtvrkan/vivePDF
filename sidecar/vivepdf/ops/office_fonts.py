import functools
import re
import zipfile
from collections.abc import Iterable
from pathlib import Path

from fontTools.ttLib import TTCollection, TTFont, TTLibError
from lxml import etree

from vivepdf.external import libreoffice
from vivepdf.ops.fonts import font_directories
from vivepdf.rpc.paths import ReadPath
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
STYLE = "urn:oasis:names:tc:opendocument:xmlns:style:1.0"
SVG = "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
FONT_FILE_EXTENSIONS = {".ttf", ".otf", ".ttc", ".otc"}
FAMILY_NAME_IDS = (1, 4, 16)
MAX_PART_BYTES = 32 * 1024 * 1024
MAX_PARTS = 4000
WORD_PARTS = re.compile(
    r"word/(document|styles|numbering|footnotes|endnotes|header\d*|footer\d*)\.xml"
)
SLIDE_PARTS = re.compile(
    r"ppt/(slides/slide|slideLayouts/slideLayout|slideMasters/slideMaster)\d+\.xml"
)
SHEET_PARTS = re.compile(r"xl/(styles|sharedStrings)\.xml")
ODF_PARTS = ("content.xml", "styles.xml")
WORD_EXTENSIONS = {"docx", "dotx", "docm", "dotm"}
SLIDE_EXTENSIONS = {"pptx", "potx", "ppsx", "pptm"}
SHEET_EXTENSIONS = {"xlsx", "xltx", "xlsm"}
ODF_EXTENSIONS = {"odt", "ott", "ods", "ots", "odp", "otp", "odg"}
METRIC_TWINS = {
    "calibri": "carlito",
    "cambria": "caladea",
    "arial": "liberationsans",
    "arialnarrow": "liberationsansnarrow",
    "timesnewroman": "liberationserif",
    "couriernew": "liberationmono",
    "georgia": "gelasio",
}


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _parser() -> etree.XMLParser:
    return etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)


def _parts(archive: zipfile.ZipFile, pattern: re.Pattern[str]) -> Iterable[etree._Element]:
    names = [info for info in archive.infolist()[:MAX_PARTS] if pattern.fullmatch(info.filename)]
    for info in names:
        if info.file_size > MAX_PART_BYTES:
            continue
        try:
            yield etree.fromstring(archive.read(info), _parser())
        except (etree.XMLSyntaxError, zipfile.BadZipFile, KeyError, OSError, ValueError):
            continue


def _theme_fonts(archive: zipfile.ZipFile, pattern: re.Pattern[str]) -> dict[str, str]:
    fonts: dict[str, str] = {}
    for root in _parts(archive, pattern):
        for kind in ("major", "minor"):
            latin = root.find(f".//{{{A}}}{kind}Font/{{{A}}}latin")
            if latin is not None and latin.get("typeface") and kind not in fonts:
                fonts[kind] = latin.get("typeface")
    return fonts


def _word_fonts(archive: zipfile.ZipFile) -> set[str]:
    found: set[str] = set()
    themed: set[str] = set()
    for root in _parts(archive, WORD_PARTS):
        for element in root.iter(f"{{{W}}}rFonts"):
            for side in ("ascii", "hAnsi"):
                if name := element.get(f"{{{W}}}{side}"):
                    found.add(name)
                if theme := element.get(f"{{{W}}}{side}Theme"):
                    themed.add("major" if theme.startswith("major") else "minor")
    theme = _theme_fonts(archive, re.compile(r"word/theme/theme\d*\.xml"))
    return found | {theme[kind] for kind in themed if kind in theme}


def _slide_fonts(archive: zipfile.ZipFile) -> set[str]:
    found: set[str] = set()
    for root in _parts(archive, SLIDE_PARTS):
        for element in root.iter(f"{{{A}}}latin"):
            if name := element.get("typeface"):
                found.add(name)
    theme = _theme_fonts(archive, re.compile(r"ppt/theme/theme\d*\.xml"))
    references = {"+mj-lt": "major", "+mn-lt": "minor"}
    resolved = {theme.get(references[name], "") for name in found if name in references}
    return {name for name in found if not name.startswith("+")} | (resolved - {""})


def _sheet_fonts(archive: zipfile.ZipFile) -> set[str]:
    found: set[str] = set()
    for root in _parts(archive, SHEET_PARTS):
        for tag in ("name", "rFont"):
            for element in root.iter(f"{{{S}}}{tag}"):
                if name := element.get("val"):
                    found.add(name)
    return found


def _odf_fonts(archive: zipfile.ZipFile) -> set[str]:
    roots = list(_parts(archive, re.compile("|".join(re.escape(part) for part in ODF_PARTS))))
    families: dict[str, str] = {}
    used: set[str] = set()
    for root in roots:
        for face in root.iter(f"{{{STYLE}}}font-face"):
            name = face.get(f"{{{STYLE}}}name")
            family = (face.get(f"{{{SVG}}}font-family") or "").strip("'\" ")
            if name and family:
                families[name] = family
        for properties in root.iter(f"{{{STYLE}}}text-properties"):
            if name := properties.get(f"{{{STYLE}}}font-name"):
                used.add(name)
    return {families.get(name, name) for name in used}


def document_fonts(path: Path) -> set[str]:
    extension = path.suffix.lower().lstrip(".")
    readers = (
        (WORD_EXTENSIONS, _word_fonts),
        (SLIDE_EXTENSIONS, _slide_fonts),
        (SHEET_EXTENSIONS, _sheet_fonts),
        (ODF_EXTENSIONS, _odf_fonts),
    )
    for extensions, reader in readers:
        if extension in extensions:
            try:
                with zipfile.ZipFile(path) as archive:
                    return {name.strip() for name in reader(archive) if name.strip()}
            except (zipfile.BadZipFile, OSError, ValueError):
                return set()
    return set()


def _face_names(font: TTFont) -> set[str]:
    names = set()
    if "name" in font:
        for record_id in FAMILY_NAME_IDS:
            if text := font["name"].getDebugName(record_id):
                names.add(_key(text))
    return names


def _file_names(path: Path) -> set[str]:
    try:
        if path.suffix.lower() in (".ttc", ".otc"):
            collection = TTCollection(str(path), lazy=True)
            return set().union(*(_face_names(font) for font in collection.fonts))
        return _face_names(TTFont(str(path), lazy=True, fontNumber=0))
    except (TTLibError, OSError, ValueError, KeyError, AssertionError):
        return set()


def _font_folders() -> list[Path]:
    folders = font_directories()
    soffice = libreoffice.find_soffice()
    if soffice is not None:
        folders.append(libreoffice.bundled_font_folder(soffice))
    return folders


@functools.lru_cache(maxsize=1)
def installed_families() -> frozenset[str]:
    names: set[str] = set()
    for folder in _font_folders():
        if not folder.is_dir():
            continue
        for path in folder.rglob("*"):
            if path.suffix.lower() in FONT_FILE_EXTENSIONS and path.is_file():
                names |= _file_names(path)
    return frozenset(names)


def missing_fonts(names: Iterable[str], installed: frozenset[str]) -> list[str]:
    missing = {}
    for name in names:
        key = _key(name)
        if not key or key in installed or METRIC_TWINS.get(key) in installed:
            continue
        missing.setdefault(key, name)
    return sorted(missing.values(), key=str.casefold)


class OfficeFontsParams(RpcModel):
    path: ReadPath


class OfficeFontsResult(RpcModel):
    missing: list[str]


@op("convert.office_fonts", OfficeFontsParams)
def office_fonts(params: OfficeFontsParams, _progress: Progress) -> OfficeFontsResult:
    names = document_fonts(Path(params.path))
    if not names:
        return OfficeFontsResult(missing=[])
    return OfficeFontsResult(missing=missing_fonts(names, installed_families()))
