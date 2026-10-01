import base64
import io
from pathlib import Path

import pymupdf
import pytest
from fontTools.ttLib import TTFont

from vivepdf.ops.editor_blocks import FontParams, font
from vivepdf.ops.font_repair import family_and_style, repair_font_program, repaired_embedded_font
from vivepdf.ops.fonts import TEXTEDIT_FONT
from vivepdf.rpc.progress import silent_progress

TEXT = "Şişli ğüç"
STRIPPED_TABLES = ("name", "OS/2", "post", "cmap")


def stripped_program(drop: tuple[str, ...] = STRIPPED_TABLES) -> bytes:
    program = TTFont(str(TEXTEDIT_FONT))
    for tag in drop:
        if tag in program:
            del program[tag]
    output = io.BytesIO()
    program.save(output)
    return output.getvalue()


def font_file_xref(document: pymupdf.Document, font_xref: int) -> int:
    descendant = document.xref_get_key(font_xref, "DescendantFonts")[1]
    child = int(descendant.strip("[] ").split()[0])
    descriptor = int(document.xref_get_key(child, "FontDescriptor")[1].split()[0])
    return int(document.xref_get_key(descriptor, "FontFile2")[1].split()[0])


@pytest.fixture
def broken_font_pdf(tmp_path: Path) -> tuple[Path, int]:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((40, 80), TEXT, fontname="djv", fontfile=str(TEXTEDIT_FONT), fontsize=20)
    font_xref = int(page.get_fonts()[0][0])
    document.update_stream(font_file_xref(document, font_xref), stripped_program())
    document.xref_set_key(font_xref, "BaseFont", "/ABCDEF+DejaVuSans-Bold")
    path = tmp_path / "kırık yazı tipi.pdf"
    document.save(path)
    document.close()
    return path, font_xref


def test_family_and_style_strip_subset_tag_and_style():
    assert family_and_style("BCDFEE+Calibri-Bold") == ("Calibri", "Bold", True, False)
    assert family_and_style("/MGVKHP+ArialMT") == ("Arial", "Regular", False, False)
    assert family_and_style("Georgia,BoldItalic") == ("Georgia", "Bold Italic", True, True)
    assert family_and_style("") == ("Embedded", "Regular", False, False)


def test_font_op_rebuilds_missing_tables_and_cmap_from_to_unicode(broken_font_pdf):
    path, font_xref = broken_font_pdf
    result = font(FontParams(path=str(path), xref=font_xref), silent_progress())
    program = TTFont(io.BytesIO(base64.b64decode(result.base64)))
    for tag in STRIPPED_TABLES:
        assert tag in program
    assert program["name"].getDebugName(1) == "DejaVuSans"
    assert program["name"].getDebugName(2) == "Bold"
    assert program["OS/2"].usWeightClass == 700
    assert program["post"].formatType == 3.0
    reference = TTFont(str(TEXTEDIT_FONT)).getBestCmap()
    repaired = program.getBestCmap()
    for char in TEXT.replace(" ", ""):
        assert repaired[ord(char)] == reference[ord(char)]
    assert pymupdf.Font(fontbuffer=base64.b64decode(result.base64)).has_glyph(ord("ş"))


def test_complete_program_is_returned_unchanged(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((40, 80), TEXT, fontname="djv", fontfile=str(TEXTEDIT_FONT))
    font_xref = int(page.get_fonts()[0][0])
    name, ext, _type, buffer = document.extract_font(font_xref)
    assert repaired_embedded_font(document, font_xref, name, ext, buffer) == buffer
    assert repaired_embedded_font(document, font_xref, name, "cff", b"junk") == b"junk"
    assert repaired_embedded_font(document, font_xref, name, "ttf", b"junk") == b"junk"


def test_program_without_to_unicode_still_gains_required_tables():
    repaired = TTFont(
        io.BytesIO(repair_font_program(stripped_program(("name", "post")), "ABCDEF+Serif-Italic"))
    )
    assert repaired["name"].getDebugName(1) == "Serif"
    assert repaired["post"].italicAngle < 0
    assert "cmap" in repaired and "OS/2" in repaired
