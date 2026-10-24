import io
import zipfile
from pathlib import Path

import pymupdf
import pytest
from fontTools.ttLib import TTFont
from lxml import etree

from vivepdf.ops._docx_fonts import embedding_allowed, is_system_font, obfuscated
from vivepdf.ops.convert import DocxParams, to_docx
from vivepdf.rpc.progress import silent_progress

FONT = Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _variant(family: str, *, bold: bool = False, fs_type: int = 0) -> bytes:
    font = TTFont(FONT)
    style = "Bold" if bold else "Regular"
    names = font["name"]
    names.names = [record for record in names.names if record.nameID not in (1, 2, 4, 6, 16, 17)]
    for record_id, text in {
        1: family,
        2: style,
        4: f"{family} {style}",
        6: f"{family.replace(' ', '')}-{style}",
    }.items():
        names.setName(text, record_id, 3, 1, 0x409)
        names.setName(text, record_id, 1, 0, 0)
    if bold:
        font["head"].macStyle |= 1
        font["OS/2"].fsSelection = 0x20
        font["OS/2"].usWeightClass = 700
    font["OS/2"].fsType = fs_type
    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue()


def _without_character_map(program: bytes) -> bytes:
    font = TTFont(io.BytesIO(program))
    del font["cmap"]
    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue()


def _font_files(document: pymupdf.Document) -> list[int]:
    found = []
    for xref in range(1, document.xref_length()):
        kind, value = document.xref_get_key(xref, "FontFile2")
        if kind == "xref":
            found.append(int(value.split()[0]))
    return found


def _pdf(tmp_path: Path, fonts: dict[str, bytes], lines: list[tuple[str, str]]) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    for name, program in fonts.items():
        page.insert_font(fontname=name, fontbuffer=program)
    for index, (name, text) in enumerate(lines):
        page.insert_text((60, 100 + index * 24), text, fontname=name, fontsize=14)
    path = tmp_path / "fonts.pdf"
    document.save(path)
    document.close()
    return path


def _convert(source: Path, tmp_path: Path) -> Path:
    target = tmp_path / "out.docx"
    to_docx(DocxParams(path=str(source), output=str(target)), silent_progress())
    return target


def _embedded(target: Path) -> dict[tuple[str, str], TTFont]:
    with zipfile.ZipFile(target) as archive:
        names = archive.namelist()
        if "word/_rels/fontTable.xml.rels" not in names:
            return {}
        relationships = {
            relationship.get("Id"): relationship.get("Target")
            for relationship in etree.fromstring(archive.read("word/_rels/fontTable.xml.rels"))
        }
        found = {}
        for entry in etree.fromstring(archive.read("word/fontTable.xml")).iter(f"{W}font"):
            for embed in entry:
                if not embed.tag.startswith(f"{W}embed"):
                    continue
                data = archive.read(f"word/{relationships[embed.get(f'{R}id')]}")
                program = obfuscated(data, embed.get(f"{W}fontKey"))
                found[(entry.get(f"{W}name"), embed.tag[len(W) :])] = TTFont(io.BytesIO(program))
        return found


def test_a_font_word_lacks_is_embedded_for_each_style(tmp_path: Path):
    source = _pdf(
        tmp_path,
        {"reg": _variant("Beril Sans"), "bold": _variant("Beril Sans", bold=True)},
        [("bold", "Rapor Özeti"), ("reg", "Şafak ışığında güzel bir gün")],
    )

    target = _convert(source, tmp_path)

    embedded = _embedded(target)
    assert set(embedded) == {("Beril Sans", "embedRegular"), ("Beril Sans", "embedBold")}
    regular = embedded[("Beril Sans", "embedRegular")]
    bold = embedded[("Beril Sans", "embedBold")]
    assert regular["name"].getDebugName(1) == bold["name"].getDebugName(1) == "Beril Sans"
    assert bold["head"].macStyle & 1 and not regular["head"].macStyle & 1
    assert all(ord(character) in regular.getBestCmap() for character in "Şafakışığında")
    with zipfile.ZipFile(target) as archive:
        assert b"embedTrueTypeFonts" in archive.read("word/settings.xml")
        assert b'Extension="odttf"' in archive.read("[Content_Types].xml")


def test_a_subset_without_a_character_map_gets_one_from_the_text(tmp_path: Path):
    program = _variant("Esma Sans")
    source = _pdf(tmp_path, {"esma": program}, [("esma", "Çağrı ölçüm")])
    with pymupdf.open(source) as document:
        for xref in _font_files(document):
            document.update_stream(xref, _without_character_map(program))
        document.save(tmp_path / "stripped.pdf")
    original = TTFont(io.BytesIO(program)).getBestCmap()

    target = _convert(tmp_path / "stripped.pdf", tmp_path)

    rebuilt = _embedded(target)[("Esma Sans", "embedRegular")].getBestCmap()
    assert {character: rebuilt.get(ord(character)) for character in "Çağrıölçüm"} == {
        character: original[ord(character)] for character in "Çağrıölçüm"
    }


def test_fonts_licensed_for_viewing_only_are_left_out(tmp_path: Path):
    source = _pdf(
        tmp_path,
        {"open": _variant("Nesibe Sans"), "shut": _variant("Batuhan Sans", fs_type=4)},
        [("open", "Açık yazı tipi"), ("shut", "Yalnızca görüntüleme")],
    )

    target = _convert(source, tmp_path)

    assert set(_embedded(target)) == {("Nesibe Sans", "embedRegular")}


def test_system_fonts_are_not_embedded(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((60, 100), "Plain Helvetica text", fontname="helv", fontsize=14)
    document.save(tmp_path / "plain.pdf")
    document.close()

    target = _convert(tmp_path / "plain.pdf", tmp_path)

    with zipfile.ZipFile(target) as archive:
        assert not any(name.startswith("word/fonts/") for name in archive.namelist())


@pytest.mark.parametrize(
    ("fs_type", "allowed"),
    [(0, True), (8, True), (4, False), (2, False), (0x000A, True), (0x0200, False)],
)
def test_embedding_follows_the_font_licence_bits(fs_type: int, allowed: bool):
    assert embedding_allowed(fs_type) is allowed


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Times New Roman,Bold", True),
        ("TimesNewRomanPSMT", True),
        ("Calibri", True),
        ("Geist", False),
        ("OpenSans", False),
    ],
)
def test_fonts_every_windows_pc_has_are_recognised(name: str, expected: bool):
    assert is_system_font(name) is expected


def test_obfuscation_scrambles_only_the_head_and_undoes_itself():
    program = bytes(range(256)) * 4
    key = "{6C3C9A2B-1F0E-4D5C-8B7A-0123456789AB}"

    scrambled = obfuscated(program, key)

    assert scrambled[:32] != program[:32]
    assert scrambled[32:] == program[32:]
    assert obfuscated(scrambled, key) == program
