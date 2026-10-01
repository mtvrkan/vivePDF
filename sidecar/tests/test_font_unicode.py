from pathlib import Path

import pymupdf
import pytest
from fontTools.ttLib import TTFont

from vivepdf.ops import _font_unicode
from vivepdf.ops._font_unicode import (
    MUPDF_UNICODE_MARK,
    parse_unicode_map,
    subset_fonts,
    use_ascii_for_shared_glyphs,
    write_unicode_map,
)
from vivepdf.ops._output import save_document

DEJAVU = Path(_font_unicode.__file__).resolve().parents[1] / "assets" / "fonts" / "DejaVuSans.ttf"
TEXT = "Season 2024-2025; (draft) K"
SOFT_HYPHEN = chr(0xAD)
NO_BREAK_SPACE = chr(0xA0)
GREEK_QUESTION_MARK = chr(0x37E)


def _font_with_twins(tmp_path: Path, twins: dict[int, int]) -> Path:
    font = TTFont(DEJAVU)
    for table in font["cmap"].tables:
        if table.isUnicode():
            for twin, original in twins.items():
                table.cmap[twin] = table.cmap[original]
    path = tmp_path / "twins.ttf"
    font.save(path)
    return path


@pytest.fixture
def twin_font(tmp_path: Path) -> Path:
    return _font_with_twins(tmp_path, {0xAD: 0x2D, 0xA0: 0x20, 0x37E: 0x3B})


def _written(font: Path, text: str = TEXT) -> pymupdf.Document:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 90), text, fontsize=18, fontname="twin", fontfile=str(font))
    return document


def _text_after_saving(document: pymupdf.Document) -> str:
    with pymupdf.open("pdf", document.tobytes(garbage=3, deflate=True)) as saved:
        return saved[0].get_text().strip()


def _unicode_stream(document: pymupdf.Document) -> tuple[int, bytes]:
    font_xref = document[0].get_fonts(full=True)[0][0]
    unicode_xref = int(document.xref_get_key(font_xref, "ToUnicode")[1].split()[0])
    return unicode_xref, document.xref_stream(unicode_xref)


def test_the_twin_font_reproduces_the_broken_mapping(twin_font: Path):
    text = _text_after_saving(_written(twin_font))
    assert SOFT_HYPHEN in text
    assert NO_BREAK_SPACE in text
    assert GREEK_QUESTION_MARK in text


def test_saved_text_copies_and_searches_as_it_was_typed(twin_font: Path, tmp_path: Path):
    output = tmp_path / "out.pdf"
    save_document(_written(twin_font), output)
    with pymupdf.open(output) as saved:
        assert saved[0].get_text().strip() == TEXT
        assert saved[0].search_for("2024-2025; (draft)")


def test_subsetting_through_the_helper_keeps_the_repair(twin_font: Path):
    document = _written(twin_font)
    subset_fonts(document, fallback=False)
    assert _text_after_saving(document) == TEXT


def test_a_font_subset_before_the_repair_is_mended_from_its_unicode_map(twin_font: Path):
    document = _written(twin_font)
    document.subset_fonts(fallback=False)
    assert use_ascii_for_shared_glyphs(document) == 1
    assert _text_after_saving(document) == TEXT


def test_a_font_with_separate_glyphs_is_left_untouched():
    document = _written(DEJAVU)
    _xref, before = _unicode_stream(document)
    assert use_ascii_for_shared_glyphs(document) == 0
    assert _unicode_stream(document)[1] == before
    assert _text_after_saving(document) == TEXT


def test_a_unicode_map_another_program_wrote_is_left_alone(twin_font: Path):
    document = _written(twin_font)
    unicode_xref, stream = _unicode_stream(document)
    foreign = stream.replace(
        MUPDF_UNICODE_MARK,
        b"/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    )
    document.update_stream(unicode_xref, foreign)
    assert use_ascii_for_shared_glyphs(document) == 0
    assert SOFT_HYPHEN in _text_after_saving(document)


def test_letters_sharing_a_glyph_keep_the_mapping_mupdf_chose(tmp_path: Path):
    font = _font_with_twins(tmp_path, {0x61: 0x41})
    document = _written(font, "Aa")
    before = _text_after_saving(document)
    assert use_ascii_for_shared_glyphs(document) == 0
    assert _text_after_saving(document) == before


def test_the_unicode_map_round_trips_ranges_arrays_and_long_targets():
    cmap = (
        b"begincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n"
        b"2 beginbfrange\n<0003> <0006> <0041>\n<0010> <0012> [<0061> <00e9> <d835dc00>]\n"
        b"endbfrange\n2 beginbfchar\n<0020> <0066 0069>\n<0021> <00ad>\nendbfchar\n"
        b"endcmap\n"
    )
    mapping = parse_unicode_map(cmap)
    assert mapping[3] == "0041"
    assert mapping[6] == "0044"
    assert mapping[0x11] == "00E9"
    assert mapping[0x12] == "D835DC00"
    assert mapping[0x21] == "00AD"
    rewritten = write_unicode_map(cmap, mapping)
    assert parse_unicode_map(rewritten) == mapping
    assert rewritten.startswith(b"begincmap\n1 begincodespacerange")
    assert rewritten.rstrip().endswith(b"endcmap")
