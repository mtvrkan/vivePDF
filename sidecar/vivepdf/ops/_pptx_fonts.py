import functools
import io
import re
from collections.abc import Callable

import pymupdf

from vivepdf.ops._pptx_runs import font_family

SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")
UNREADABLE = ("n/a", "cff")
POSTSCRIPT_NAME = 6

KNOWN_FAMILIES = (
    "Aptos",
    "Arial Black",
    "Arial Narrow",
    "Arial Unicode MS",
    "Book Antiqua",
    "Bookman Old Style",
    "Calibri Light",
    "Cambria Math",
    "Century Gothic",
    "Comic Sans MS",
    "Courier New",
    "Franklin Gothic Book",
    "Franklin Gothic Medium",
    "Liberation Mono",
    "Liberation Sans",
    "Liberation Serif",
    "Lucida Console",
    "Lucida Sans Unicode",
    "Maiandra GD",
    "Malgun Gothic",
    "Microsoft Sans Serif",
    "Microsoft YaHei",
    "MS Gothic",
    "MS Mincho",
    "MS PGothic",
    "Noto Sans",
    "Noto Serif",
    "Open Sans",
    "Palatino Linotype",
    "Segoe Print",
    "Segoe Script",
    "Segoe UI",
    "Segoe UI Emoji",
    "Segoe UI Light",
    "Segoe UI Semibold",
    "Segoe UI Symbol",
    "Times New Roman",
    "Trebuchet MS",
    "Wingdings 2",
    "Wingdings 3",
)


def _compact(name: str) -> str:
    return "".join(name.split()).lower()


KNOWN_NAMES = {_compact(name): name for name in KNOWN_FAMILIES}


def _program_names(buffer: bytes) -> tuple[str | None, str | None]:
    from fontTools.ttLib import TTFont

    try:
        names = TTFont(io.BytesIO(buffer), lazy=True)["name"]
        return names.getBestFamilyName(), names.getDebugName(POSTSCRIPT_NAME)
    except Exception:
        return None, None


def _program_families(document: pymupdf.Document) -> dict[str, str]:
    families: dict[str, str] = {}
    seen: set[int] = set()
    for page in document:
        for xref, ext, _kind, base_font, *_rest in page.get_fonts():
            if xref in seen or ext in UNREADABLE:
                continue
            seen.add(xref)
            family, postscript = _program_names(document.extract_font(xref)[3])
            if not family:
                continue
            for key in (SUBSET_PREFIX.sub("", base_font), postscript):
                if key:
                    families.setdefault(key, family)
    return families


def slide_font_names(document: pymupdf.Document) -> Callable[[str], str]:
    families = _program_families(document)

    @functools.cache
    def slide_name(name: str) -> str:
        family = font_family(families.get(name, name))
        return KNOWN_NAMES.get(_compact(family), family)

    return slide_name
