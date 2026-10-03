import base64
import hashlib
import re
from pathlib import Path

import pytest

from vivepdf.ops import font_library, fonts
from vivepdf.ops.font_library import (
    FontLibraryFamilyParams,
    FontLibraryParams,
    font_library_download,
    font_library_remove,
)
from vivepdf.ops.font_library_catalog import FAMILIES, LibraryFamily, LibraryFile
from vivepdf.ops.fonts import FONT_DIR, FontFileParams, font_file, resolve_choice, resolve_face
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

TURKISH = "ÇçĞğİıÖöŞşÜüÂâÎîÛû"
DEJAVU = FONT_DIR / "DejaVuSans.ttf"
DEJAVU_BOLD = FONT_DIR / "DejaVuSans-Bold.ttf"


def test_the_catalogue_is_complete_and_pinned():
    ids = [family.id for family in FAMILIES]
    assert len(ids) == len(set(ids)) >= 20
    names = [entry.name for family in FAMILIES for entry in family.files]
    assert len(names) == len(set(names))
    for family in FAMILIES:
        assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", family.id)
        assert family.category in {"sans", "serif", "display", "script", "handwriting"}
        styles = [entry.style for entry in family.files]
        assert "regular" in styles and "license" in styles
        for entry in family.files:
            assert entry.size > 0
            assert re.fullmatch(r"[0-9a-f]{64}", entry.sha256)


def _release(folder: Path, corrupt: bool = False) -> LibraryFamily:
    folder.mkdir(parents=True, exist_ok=True)
    files = []
    for style, source in (("regular", DEJAVU), ("bold", DEJAVU_BOLD)):
        data = source.read_bytes()
        name = f"Fake-{style.title()}.ttf"
        (folder / name).write_bytes(data[:-10] if corrupt and style == "bold" else data)
        files.append(LibraryFile(style, name, len(data), hashlib.sha256(data).hexdigest()))
    licence = b"SIL Open Font License"
    (folder / "Fake-OFL.txt").write_bytes(licence)
    files.append(
        LibraryFile("license", "Fake-OFL.txt", len(licence), hashlib.sha256(licence).hexdigest())
    )
    return LibraryFamily("fake", "Fake Sans", "sans", tuple(files))


@pytest.fixture
def library(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    def install(corrupt: bool = False) -> LibraryFamily:
        family = _release(tmp_path / "release", corrupt)
        monkeypatch.setenv("VIVEPDF_DATA_DIR", str(tmp_path / "appdata"))
        monkeypatch.setenv("VIVEPDF_FONT_LIBRARY_URL", (tmp_path / "release").as_uri())
        monkeypatch.setattr(font_library, "LIBRARY", {family.id: family})
        monkeypatch.setattr(font_library, "FAMILIES", (family,))
        monkeypatch.setattr(fonts, "FAMILIES", (family,))
        return family

    return install


def test_a_family_downloads_and_serves_its_faces(library):
    library()
    assert resolve_choice("library:fake", False) == DEJAVU

    info = font_library_download(FontLibraryFamilyParams(id="library:fake"), silent_progress())

    assert info.installed is True
    assert info.styles == ["Bold", "Regular"]
    directory = font_library.library_dir()
    assert resolve_choice("library:fake", True) == directory / "Fake-Bold.ttf"
    assert resolve_face("library:fake", True, True) == (directory / "Fake-Bold.ttf", False)
    served = font_file(FontFileParams(id="library:fake", bold=True), silent_progress())
    assert base64.b64decode(served.base64) == DEJAVU_BOLD.read_bytes()
    listed = [choice for choice in fonts.font_catalogue() if choice.source == "library"]
    assert [(choice.id, choice.installed) for choice in listed] == [("library:fake", True)]
    assert (directory / "Fake-OFL.txt").is_file()


def test_a_damaged_download_is_refused_and_leaves_nothing(library):
    library(corrupt=True)

    with pytest.raises(OpError) as caught:
        font_library_download(FontLibraryFamilyParams(id="fake"), silent_progress())

    assert caught.value.code == ErrorCode.NETWORK
    assert caught.value.data["reason"] == "fontChecksum"
    leftovers = [path.name for path in font_library.library_dir().iterdir()]
    assert "Fake-Bold.ttf" not in leftovers
    assert not any(name.endswith(".part") for name in leftovers)


def test_removing_a_family_falls_back_to_the_bundled_font(library):
    library()
    font_library_download(FontLibraryFamilyParams(id="fake"), silent_progress())

    info = font_library_remove(FontLibraryFamilyParams(id="library:fake"), silent_progress())

    assert info.installed is False
    assert resolve_choice("library:fake", False) == DEJAVU
    assert (
        font_library.font_library(FontLibraryParams(), silent_progress()).families[0].installed
        is False
    )


def test_unknown_families_are_refused(library):
    library()
    with pytest.raises(OpError) as caught:
        font_library_download(FontLibraryFamilyParams(id="library:nope"), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PARAMS


@pytest.mark.skipif(
    not (Path(__file__).resolve().parents[1] / "build" / "fonts-2").is_dir(),
    reason="the fonts-2 release files are built by scripts/gen_font_library.py",
)
def test_built_release_files_match_the_catalogue_and_cover_turkish():
    import pymupdf

    folder = Path(__file__).resolve().parents[1] / "build" / "fonts-2"
    for family in FAMILIES:
        for entry in family.files:
            data = (folder / entry.name).read_bytes()
            assert hashlib.sha256(data).hexdigest() == entry.sha256, entry.name
            if entry.style != "license":
                font = pymupdf.Font(fontbuffer=data)
                assert all(font.has_glyph(ord(char)) for char in TURKISH), entry.name
