import shutil
from pathlib import Path

import pymupdf
import pytest
from fontTools.ttLib import TTFont

from vivepdf.ops._to_unicode import cmap_entries, cmap_stream
from vivepdf.ops._view_fonts import (
    BACKUP_KEY,
    display_char,
    observe_fonts,
    positional_forms,
    presentation_forms,
    scan_display_fonts,
)
from vivepdf.ops.font_repair import _descendant_font, _xref_of
from vivepdf.ops.fonts import FONT_DIR, TEXTEDIT_FONT
from vivepdf.ops.viewing import ViewPrepareParams, prepare_view, restore_view
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

ARABIC = "مرحبا بالعالم"
HEBREW = "שלום עולם"
CSS = "@font-face {font-family: dv; src: url(DejaVuSans.ttf);}"


@pytest.fixture(autouse=True)
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(tmp_path / "data"))


def _strip_embedding(document: pymupdf.Document) -> None:
    for xref in range(1, document.xref_length()):
        kind = document.xref_get_key(xref, "Type")[1]
        if kind == "/FontDescriptor":
            document.xref_set_key(xref, "FontFile2", "null")
            document.xref_set_key(xref, "FontName", "/Arial")
        elif kind == "/Font":
            document.xref_set_key(xref, "BaseFont", "/Arial")


def _base_letters(document: pymupdf.Document) -> None:
    _forward, backward = presentation_forms()
    for page in document:
        for entry in page.get_fonts(full=True):
            stream = _xref_of(document, entry[0], "ToUnicode")
            if not stream:
                continue
            entries = cmap_entries(document.xref_stream(stream))
            document.update_stream(
                stream,
                cmap_stream(
                    {code: backward.get(text, (text, ""))[0] for code, text in entries.items()}
                ),
            )


def _rtl_document(tmp_path: Path, name: str, base_letters: bool = False) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=400, height=260)
    archive = pymupdf.Archive(str(FONT_DIR))
    for top, text, direction in ((20, ARABIC, "rtl"), (100, HEBREW, "rtl"), (180, "Hello", "ltr")):
        page.insert_htmlbox(
            pymupdf.Rect(20, top, 380, top + 60),
            f'<p dir="{direction}" style="font-family: dv; font-size: 24px">{text}</p>',
            css=CSS,
            archive=archive,
        )
    _strip_embedding(document)
    if base_letters:
        _base_letters(document)
    path = tmp_path / name
    document.save(path, garbage=3)
    document.close()
    return path


def _glyph_forms(document: pymupdf.Document) -> dict[int, list[int]]:
    tables: dict[int, list[int]] = {}
    for entry in document[0].get_fonts(full=True):
        descendant = _descendant_font(document, entry[0])
        table = _xref_of(document, descendant, "CIDToGIDMap")
        if table:
            data = document.xref_stream(table)
            tables[entry[0]] = [
                int.from_bytes(data[index : index + 2], "big") for index in range(0, len(data), 2)
            ]
    return tables


def test_forms_follow_arabic_joining_rules() -> None:
    assert positional_forms(list("مرحبا")) == ["initial", "final", "initial", "medial", "final"]
    assert positional_forms(["ل", "ا"]) == ["initial", "final"]
    assert positional_forms(["ب", "َ", "ب"]) == ["initial", None, "final"]
    assert positional_forms(["ب", "ـ", "ب"]) == ["initial", "medial", "final"]
    assert positional_forms(["ب", " ", "ب"]) == ["isolated", None, "isolated"]
    assert display_char("لا", "final") == "ﻼ"
    assert display_char("لا", None) == "ﻻ"
    assert display_char("ﺑ", "final") == "ﺑ"
    assert display_char("A", "initial") == "A"


def test_non_embedded_arabic_and_hebrew_get_a_renderable_copy(tmp_path: Path) -> None:
    source = _rtl_document(tmp_path, "arapça ş.pdf")
    before = source.read_bytes()
    with pymupdf.open(source) as original:
        original_text = original[0].get_text()
        assert all(entry[1] == "n/a" for entry in original[0].get_fonts(full=True))
    result = prepare_view(ViewPrepareParams(path=str(source)), silent_progress())
    assert source.read_bytes() == before
    assert result.view_path is not None
    assert result.fonts == 2
    with pymupdf.open(result.view_path) as copy:
        embedded = {entry[0]: entry[1] != "n/a" for entry in copy[0].get_fonts(full=True)}
        assert sorted(embedded.values()) == [False, True, True]
        assert copy[0].get_text() == original_text


def test_base_letter_unicode_maps_are_shaped_from_the_content(tmp_path: Path) -> None:
    shaped = prepare_view(
        ViewPrepareParams(path=str(_rtl_document(tmp_path, "shaped.pdf"))), silent_progress()
    )
    plain = prepare_view(
        ViewPrepareParams(path=str(_rtl_document(tmp_path, "plain.pdf", base_letters=True))),
        silent_progress(),
    )
    assert shaped.view_path and plain.view_path
    with pymupdf.open(tmp_path / "plain.pdf") as source:
        scan = scan_display_fonts(source)
        used = {
            xref: observed.used
            for xref, observed in observe_fonts(source, scan.plans, silent_progress()).items()
        }
        source_text = source[0].get_text()
    with pymupdf.open(shaped.view_path) as left, pymupdf.open(plain.view_path) as right:
        expected, actual = _glyph_forms(left), _glyph_forms(right)
        assert expected.keys() == actual.keys() and expected
        for xref, table in actual.items():
            assert used[xref]
            assert [table[code] for code in used[xref]] == [
                expected[xref][code] for code in used[xref]
            ]
        assert right[0].get_text() == source_text


def _visual_order_arabic(tmp_path: Path) -> Path:
    letters = [("ا", "final"), ("ب", "medial"), ("ح", "initial"), ("ر", "final"), ("م", "initial")]
    document = pymupdf.open()
    page = document.new_page(width=300, height=100)
    unicode_map = document.get_new_xref()
    document.update_object(unicode_map, "<<>>")
    document.update_stream(
        unicode_map, cmap_stream({cid: text for cid, (text, _form) in enumerate(letters, 1)})
    )
    descriptor = document.get_new_xref()
    document.update_object(
        descriptor,
        "<</Type/FontDescriptor/FontName/Arial/Flags 32/FontBBox[-665 -325 2000 1040]"
        "/ItalicAngle 0/Ascent 905/Descent -212/CapHeight 716/StemV 80>>",
    )
    descendant = document.get_new_xref()
    document.update_object(
        descendant,
        "<</Type/Font/Subtype/CIDFontType2/BaseFont/Arial/CIDSystemInfo<</Registry(Adobe)"
        "/Ordering(Identity)/Supplement 0>>/DW 500/CIDToGIDMap/Identity"
        f"/FontDescriptor {descriptor} 0 R>>",
    )
    font = document.get_new_xref()
    document.update_object(
        font,
        f"<</Type/Font/Subtype/Type0/BaseFont/Arial/Encoding/Identity-H"
        f"/DescendantFonts[{descendant} 0 R]/ToUnicode {unicode_map} 0 R>>",
    )
    document.xref_set_key(page.xref, "Resources", f"<</Font<</F1 {font} 0 R>>>>")
    contents = document.get_new_xref()
    document.update_object(contents, "<<>>")
    document.update_stream(contents, b"BT /F1 24 Tf 40 50 Td <00010002000300040005> Tj ET")
    document.xref_set_key(page.xref, "Contents", f"{contents} 0 R")
    path = tmp_path / "visual.pdf"
    document.save(path)
    document.close()
    return path


def test_visual_order_producers_get_the_right_forms(tmp_path: Path) -> None:
    result = prepare_view(
        ViewPrepareParams(path=str(_visual_order_arabic(tmp_path))), silent_progress()
    )
    assert result.view_path and result.fonts == 1
    face = TTFont(TEXTEDIT_FONT, lazy=True)
    cmap = face.getBestCmap()
    expected = [face.getGlyphID(cmap[ord(char)]) for char in ("ﺎ", "ﺒ", "ﺣ", "ﺮ", "ﻣ")]
    with pymupdf.open(result.view_path) as copy, pymupdf.open(tmp_path / "visual.pdf") as source:
        table = next(iter(_glyph_forms(copy).values()))
        assert table[1:6] == expected
        assert copy[0].get_text() == source[0].get_text()


def _hebrew_simple_font(tmp_path: Path) -> Path:
    names = " ".join(f"/afii{57664 + index}" for index in range(27))
    document = pymupdf.open()
    page = document.new_page(width=300, height=100)
    font = document.get_new_xref()
    document.update_object(
        font,
        "<</Type/Font/Subtype/TrueType/BaseFont/Arial/Encoding<</Type/Encoding"
        f"/BaseEncoding/WinAnsiEncoding/Differences[224 {names}]>>>>",
    )
    document.xref_set_key(page.xref, "Resources", f"<</Font<</H1 {font} 0 R>>>>")
    shown = bytes(0xE0 + ord(char) - 0x5D0 if char != " " else 32 for char in HEBREW[::-1])
    contents = document.get_new_xref()
    document.update_object(contents, "<<>>")
    document.update_stream(contents, b"BT /H1 24 Tf 40 50 Td <" + shown.hex().encode() + b"> Tj ET")
    document.xref_set_key(page.xref, "Contents", f"{contents} 0 R")
    path = tmp_path / "ibranice.pdf"
    document.save(path)
    document.close()
    return path


def test_simple_hebrew_fonts_are_embedded_with_unicode_names(tmp_path: Path) -> None:
    source = _hebrew_simple_font(tmp_path)
    with pymupdf.open(source) as original:
        original_text = original[0].get_text()
    result = prepare_view(ViewPrepareParams(path=str(source)), silent_progress())
    assert result.view_path and result.fonts == 1
    with pymupdf.open(result.view_path) as copy:
        entry = copy[0].get_fonts(full=True)[0]
        assert entry[1] == "ttf"
        encoding = copy.xref_get_key(entry[0], "Encoding/Differences")[1]
        assert "/uni05D0" in encoding
        assert copy.xref_get_key(entry[0], "ToUnicode")[0] == "xref"
        assert copy[0].get_text() == original_text


def _cjk_document(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=300, height=200)
    page.insert_text((20, 60), "日本語", fontname="japan", fontsize=20)
    font = page.get_fonts()[0][0]
    descriptor = _xref_of(document, _descendant_font(document, font), "FontDescriptor")
    document.xref_set_key(descriptor, "FontWeight", "700")
    path = tmp_path / "cjk.pdf"
    document.save(path)
    document.close()
    return path


def test_bold_cjk_fonts_named_regular_are_marked_bold(tmp_path: Path) -> None:
    result = prepare_view(ViewPrepareParams(path=str(_cjk_document(tmp_path))), silent_progress())
    assert result.view_path and result.fonts == 1
    with pymupdf.open(result.view_path) as copy:
        font = copy[0].get_fonts()[0][0]
        assert copy.xref_get_key(font, "BaseFont")[1] == "/Gothic,Bold"
        descendant = _descendant_font(copy, font)
        assert copy.xref_get_key(descendant, "BaseFont")[1] == "/Gothic,Bold"


def test_latin_only_documents_need_no_copy(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Plain Helvetica text")
    path = tmp_path / "latin.pdf"
    document.save(path)
    result = prepare_view(ViewPrepareParams(path=str(path)), silent_progress())
    assert result.view_path is None and result.fonts == 0


def test_restore_puts_the_original_fonts_back_after_a_save(tmp_path: Path) -> None:
    source = _rtl_document(tmp_path, "restore.pdf", base_letters=True)
    result = prepare_view(ViewPrepareParams(path=str(source)), silent_progress())
    assert result.view_path
    saved = tmp_path / "kaydedilen ğ.pdf"
    shutil.copy(result.view_path, saved)
    grown = saved.stat().st_size
    restored = restore_view(ViewPrepareParams(path=str(saved)), silent_progress())
    assert restored.restored > 0
    assert saved.stat().st_size < grown
    with pymupdf.open(source) as original, pymupdf.open(saved) as back:
        assert [entry[:6] for entry in original[0].get_fonts(full=True)] == [
            entry[:6] for entry in back[0].get_fonts(full=True)
        ]
        assert back[0].get_text() == original[0].get_text()
        assert all(
            back.xref_get_key(xref, BACKUP_KEY)[0] == "null"
            for xref in range(1, back.xref_length())
        )
    untouched = saved.read_bytes()
    again = restore_view(ViewPrepareParams(path=str(saved)), silent_progress())
    assert again.restored == 0
    assert saved.read_bytes() == untouched


def test_restore_keeps_encryption_and_needs_the_password(tmp_path: Path) -> None:
    source = _rtl_document(tmp_path, "plain.pdf")
    locked = tmp_path / "kilitli.pdf"
    with pymupdf.open(source) as document:
        document.save(locked, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="gizli", owner_pw="o")
    result = prepare_view(ViewPrepareParams(path=str(locked), password="gizli"), silent_progress())
    assert result.view_path and result.fonts == 2
    saved = tmp_path / "saved.pdf"
    shutil.copy(result.view_path, saved)
    with pytest.raises(OpError) as refused:
        restore_view(ViewPrepareParams(path=str(saved)), silent_progress())
    assert refused.value.code == ErrorCode.NEEDS_PASSWORD
    assert restore_view(
        ViewPrepareParams(path=str(saved), password="gizli"), silent_progress()
    ).restored
    with pymupdf.open(saved) as back:
        assert back.needs_pass and back.authenticate("gizli")
        assert all(entry[1] == "n/a" for entry in back[0].get_fonts(full=True))


def test_identical_duplicate_fonts_share_one_rewritten_descendant(tmp_path: Path) -> None:
    document = pymupdf.open()
    archive = pymupdf.Archive(str(FONT_DIR))
    for _ in range(4):
        page = document.new_page(width=400, height=120)
        page.insert_htmlbox(
            pymupdf.Rect(20, 20, 380, 80),
            f'<p dir="rtl" style="font-family: dv; font-size: 24px">{ARABIC}</p>',
            css=CSS,
            archive=archive,
        )
    _strip_embedding(document)
    source = tmp_path / "kopya.pdf"
    document.save(source, garbage=3)
    document.close()
    with pymupdf.open(source) as original:
        fonts = {entry[0] for page in original for entry in page.get_fonts(full=True)}
        texts = [page.get_text() for page in original]
    assert len(fonts) == 4
    result = prepare_view(ViewPrepareParams(path=str(source)), silent_progress())
    assert result.view_path is not None
    assert result.fonts == 4
    with pymupdf.open(result.view_path) as copy:
        descendants = {_descendant_font(copy, xref) for xref in fonts}
        assert len(descendants) == 1
        assert all(entry[1] != "n/a" for page in copy for entry in page.get_fonts(full=True))
        assert [page.get_text() for page in copy] == texts
