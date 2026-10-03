import os
from pathlib import Path

from vivepdf.ops._appdata import user_data_dir
from vivepdf.ops._output import unlink_patiently
from vivepdf.ops.fallback_fonts import fetch_font_file
from vivepdf.ops.font_library_catalog import FAMILIES, LIBRARY_RELEASE, LibraryFamily
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

DOWNLOAD_BASE = f"https://github.com/mtvrkan/vivePDF/releases/download/{LIBRARY_RELEASE}"
DIRECTORY_NAME = "font-library"
LICENSE_STYLE = "license"
STYLE_ORDER = {
    (True, True): ("boldItalic", "italic", "bold", "regular"),
    (False, True): ("italic", "regular"),
    (True, False): ("bold", "regular"),
    (False, False): ("regular",),
}
ITALIC_STYLES = frozenset({"italic", "boldItalic"})
STYLE_LABELS = {
    "regular": "Regular",
    "bold": "Bold",
    "italic": "Italic",
    "boldItalic": "Bold Italic",
}
LIBRARY: dict[str, LibraryFamily] = {family.id: family for family in FAMILIES}


def library_dir() -> Path:
    directory = user_data_dir() / DIRECTORY_NAME
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _download_base() -> str:
    return (os.environ.get("VIVEPDF_FONT_LIBRARY_URL") or DOWNLOAD_BASE).rstrip("/")


def family_bytes(family: LibraryFamily) -> int:
    return sum(entry.size for entry in family.files)


def is_installed(family: LibraryFamily, directory: Path | None = None) -> bool:
    folder = directory or library_dir()
    return all(
        (folder / entry.name).is_file() and (folder / entry.name).stat().st_size == entry.size
        for entry in family.files
    )


def styles_of(family: LibraryFamily) -> list[str]:
    return sorted(
        STYLE_LABELS[entry.style] for entry in family.files if entry.style in STYLE_LABELS
    )


def library_face(family_id: str, bold: bool, italic: bool) -> tuple[Path, bool] | None:
    family = LIBRARY.get(family_id)
    if family is None or not is_installed(family):
        return None
    files = {entry.style: entry for entry in family.files}
    for style in STYLE_ORDER[(bold, italic)]:
        entry = files.get(style)
        if entry is not None:
            return library_dir() / entry.name, style in ITALIC_STYLES
    return None


def _family(family_id: str) -> LibraryFamily:
    family = LIBRARY.get(family_id)
    if family is None:
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"unknown font family: {family_id}", {"family": family_id}
        )
    return family


class LibraryFamilyInfo(RpcModel):
    id: str
    name: str
    category: str
    bytes: int
    installed: bool
    styles: list[str]


class FontLibraryParams(RpcModel):
    pass


class FontLibraryResult(RpcModel):
    families: list[LibraryFamilyInfo]


def family_info(family: LibraryFamily, directory: Path) -> LibraryFamilyInfo:
    return LibraryFamilyInfo(
        id=f"library:{family.id}",
        name=family.name,
        category=family.category,
        bytes=family_bytes(family),
        installed=is_installed(family, directory),
        styles=styles_of(family),
    )


@op("fonts.library", FontLibraryParams)
def font_library(_params: FontLibraryParams, _progress: Progress) -> FontLibraryResult:
    directory = library_dir()
    return FontLibraryResult(families=[family_info(family, directory) for family in FAMILIES])


class FontLibraryFamilyParams(RpcModel):
    id: str


def _family_id(font_id: str) -> str:
    return font_id.removeprefix("library:")


@op("fonts.library_download", FontLibraryFamilyParams)
def font_library_download(params: FontLibraryFamilyParams, progress: Progress) -> LibraryFamilyInfo:
    family = _family(_family_id(params.id))
    directory = library_dir()
    total = family_bytes(family)
    done = 0
    for entry in family.files:
        target = directory / entry.name
        if not (target.is_file() and target.stat().st_size == entry.size):
            fetch_font_file(family.id, entry, directory, progress, done, total, _download_base())
        done += entry.size
    progress.report(1.0, "progress.downloading", {"received": total, "total": total})
    return family_info(family, directory)


@op("fonts.library_remove", FontLibraryFamilyParams)
def font_library_remove(params: FontLibraryFamilyParams, _progress: Progress) -> LibraryFamilyInfo:
    family = _family(_family_id(params.id))
    directory = library_dir()
    for entry in family.files:
        target = directory / entry.name
        if target.is_file():
            unlink_patiently(target)
    return family_info(family, directory)
