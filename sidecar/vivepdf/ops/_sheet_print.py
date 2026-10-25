import re
import shutil
import zipfile
from pathlib import Path

from lxml import etree

S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
WORKSHEET_PART = re.compile(r"^xl/worksheets/[^/]+\.xml$")
SHEET_EXTENSIONS = frozenset({"xlsx"})
PAPER_CODES = {"a4": "9", "letter": "1"}
WIDE_SHEET_COLUMNS = 6
MAX_SHEET_XML_BYTES = 64 * 1024 * 1024
MAX_SHEET_PARTS = 2000
CELL_COLUMN = re.compile(r"^\$?([A-Z]{1,3})")
SHEET_PROPERTIES_AFTER_FIT = frozenset({"tabColor", "outlinePr"})
AFTER_PAGE_SETUP = frozenset(
    {
        "headerFooter",
        "rowBreaks",
        "colBreaks",
        "customProperties",
        "cellWatches",
        "ignoredErrors",
        "smartTags",
        "drawing",
        "legacyDrawing",
        "legacyDrawingHF",
        "drawingHF",
        "picture",
        "oleObjects",
        "controls",
        "webPublishItems",
        "tableParts",
        "extLst",
    }
)


def _parser() -> etree.XMLParser:
    return etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=True)


def _local(element: etree._Element) -> str:
    return etree.QName(element).localname if isinstance(element.tag, str) else ""


def _column_number(letters: str) -> int:
    number = 0
    for letter in letters:
        number = number * 26 + ord(letter) - ord("A") + 1
    return number


def _column_count(root: etree._Element) -> int:
    dimension = root.find(f"{{{S}}}dimension")
    reference = (dimension.get("ref") if dimension is not None else "") or ""
    first, _, last = reference.upper().partition(":")
    start, end = CELL_COLUMN.match(first), CELL_COLUMN.match(last or first)
    if start is None or end is None:
        return 0
    return _column_number(end[1]) - _column_number(start[1]) + 1


def _fit_flag(root: etree._Element) -> etree._Element:
    properties = root.find(f"{{{S}}}sheetPr")
    if properties is None:
        properties = etree.Element(f"{{{S}}}sheetPr")
        root.insert(0, properties)
    flag = properties.find(f"{{{S}}}pageSetUpPr")
    if flag is None:
        flag = etree.Element(f"{{{S}}}pageSetUpPr")
        position = sum(1 for child in properties if _local(child) in SHEET_PROPERTIES_AFTER_FIT)
        properties.insert(position, flag)
    return flag


def _page_setup(root: etree._Element) -> etree._Element:
    setup = root.find(f"{{{S}}}pageSetup")
    if setup is not None:
        return setup
    setup = etree.Element(f"{{{S}}}pageSetup")
    following = next((child for child in root if _local(child) in AFTER_PAGE_SETUP), None)
    if following is None:
        root.append(setup)
    else:
        following.addprevious(setup)
    return setup


def print_ready_sheet(raw: bytes, paper: str | None, fallback: str, fit: bool) -> bytes:
    root = etree.fromstring(raw, _parser())
    if _local(root) != "worksheet":
        return raw
    setup = _page_setup(root)
    if paper is not None or setup.get("paperSize") is None:
        setup.set("paperSize", PAPER_CODES[paper or fallback])
    if fit:
        flag = _fit_flag(root)
        if flag.get("fitToPage") not in ("1", "true"):
            flag.set("fitToPage", "1")
            setup.set("fitToWidth", "1")
            setup.set("fitToHeight", "0")
        if setup.get("orientation") is None and _column_count(root) > WIDE_SHEET_COLUMNS:
            setup.set("orientation", "landscape")
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def print_ready_copy(
    source: Path, folder: Path, paper: str | None, fallback: str, fit: bool
) -> Path:
    if source.suffix.lower().lstrip(".") not in SHEET_EXTENSIONS or (paper is None and not fit):
        return source
    target = folder / source.name
    try:
        with zipfile.ZipFile(source) as package:
            members = package.infolist()
            if len(members) > MAX_SHEET_PARTS:
                return source
            folder.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as ready:
                for member in members:
                    if (
                        WORKSHEET_PART.match(member.filename)
                        and member.file_size <= MAX_SHEET_XML_BYTES
                    ):
                        ready.writestr(
                            member, print_ready_sheet(package.read(member), paper, fallback, fit)
                        )
                        continue
                    with package.open(member) as original, ready.open(member, "w") as written:
                        shutil.copyfileobj(original, written)
    except (zipfile.BadZipFile, OSError, etree.XMLSyntaxError, KeyError):
        target.unlink(missing_ok=True)
        return source
    return target
