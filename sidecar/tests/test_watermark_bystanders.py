from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._watermark_style import WATERMARK_FONT_BOLD
from vivepdf.ops.watermark_removal import RemoveWatermarkParams, remove_watermark
from vivepdf.rpc.progress import silent_progress


def _body_lines(page: pymupdf.Page) -> list[str]:
    return sorted(line for line in page.get_text().splitlines() if line.startswith("Govde"))


def _build(path: Path, angle: float) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for index in range(30):
        page.insert_text(
            (60, 100 + index * 22), f"Govde satiri {index:02d} icerik metni.", fontsize=11
        )
    page.insert_text(
        (120, 620),
        "TASLAK",
        fontsize=64,
        fontname="wm",
        fontfile=str(WATERMARK_FONT_BOLD),
        color=(0.8, 0.8, 0.85),
        morph=(pymupdf.Point(300, 500), pymupdf.Matrix(angle)),
    )
    document.save(path)
    document.close()


def test_diagonal_watermark_leaves_the_body_text_alone(tmp_path: Path) -> None:
    source = tmp_path / "marked.pdf"
    _build(source, 45)
    with pymupdf.open(source) as document:
        expected = _body_lines(document[0])
    assert len(expected) == 30

    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source),
            output=str(tmp_path / "clean.pdf"),
            texts=["TASLAK"],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        page = document[0]
        assert "TASLAK" not in page.get_text()
        assert _body_lines(page) == expected


def test_a_watermark_is_counted_once_per_page(tmp_path: Path) -> None:
    source = tmp_path / "marked.pdf"
    _build(source, 0)
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source),
            output=str(tmp_path / "clean.pdf"),
            texts=["TASLAK"],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert result.removed_text == 1


def test_the_page_outside_the_watermark_is_untouched(tmp_path: Path) -> None:
    source = tmp_path / "marked.pdf"
    _build(source, 45)
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source),
            output=str(tmp_path / "clean.pdf"),
            texts=["TASLAK"],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    with pymupdf.open(source) as original, pymupdf.open(result.output) as cleaned:
        before = original[0].get_pixmap(dpi=72)
        after = cleaned[0].get_pixmap(dpi=72)
        assert (before.width, before.height) == (after.width, after.height)
        row_bytes = before.stride
        before_rows = bytes(before.samples)
        after_rows = bytes(after.samples)
        changed = [
            row
            for row in range(before.height)
            if before_rows[row * row_bytes : (row + 1) * row_bytes]
            != after_rows[row * row_bytes : (row + 1) * row_bytes]
        ]
        assert changed, "the watermark should have changed something"
        assert min(changed) > before.height * 0.4
        assert max(changed) < before.height * 0.92


def _mixed_page(path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    writer = pymupdf.TextWriter(page.rect)
    regular = pymupdf.Font("helv")
    bold = pymupdf.Font("hebo")
    y = 300
    for _ in range(8):
        x = 60.0
        for chunk, font in (
            ("Yani ", regular),
            ("kaydirma", bold),
            (" yok, sadece ", regular),
            ("baglantilari", bold),
            (" degistiriyoruz.", regular),
        ):
            writer.append((x, y), chunk, font=font, fontsize=12)
            x += font.text_length(chunk, fontsize=12)
        y += 26
    writer.write_text(page)
    page.insert_text(
        (150, 500),
        "TASLAK",
        fontsize=70,
        fontname="wm",
        fontfile=str(WATERMARK_FONT_BOLD),
        color=(0.85, 0.85, 0.9),
        morph=(pymupdf.Point(300, 400), pymupdf.Matrix(45)),
    )
    document.save(path)
    document.close()


def _overlapping_pairs(page: pymupdf.Page) -> int:
    rows: dict[int, list] = {}
    for word in page.get_text("words"):
        rows.setdefault(round(word[1]), []).append(word)
    pairs = 0
    for words in rows.values():
        words.sort(key=lambda word: word[0])
        pairs += sum(1 for a, b in zip(words, words[1:], strict=False) if b[0] < a[2] - 0.3)
    return pairs


def test_mixed_bold_and_regular_runs_keep_their_place(tmp_path: Path) -> None:
    source = tmp_path / "mixed.pdf"
    _mixed_page(source)
    with pymupdf.open(source) as document:
        expected = sorted(
            (word[4], round(word[0], 1), round(word[1], 1))
            for word in document[0].get_text("words")
            if word[4] != "TASLAK"
        )

    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source),
            output=str(tmp_path / "clean.pdf"),
            texts=["TASLAK"],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        page = document[0]
        assert _overlapping_pairs(page) == 0
        assert (
            sorted(
                (word[4], round(word[0], 1), round(word[1], 1)) for word in page.get_text("words")
            )
            == expected
        )


def _dense_page(path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for index in range(40):
        page.insert_text(
            (40, 80 + index * 16),
            "e-posta ve-ya iki-uc kelime - tire; x-y-z a-b-c-d-e-f-g-h-i",
            fontsize=13,
            fontname="tiro",
        )
    mark = {
        "fontsize": 110,
        "fontname": "wm",
        "fontfile": str(WATERMARK_FONT_BOLD),
        "color": (0.8, 0.8, 0.85),
    }
    for row in range(4):
        page.insert_text((30, 200 + row * 170), "TASLAK", **mark)
    page.insert_text((-260, 150), "TASLAK", **mark)
    document.save(path)
    document.close()


def test_only_the_words_under_the_mark_are_rewritten_and_edge_tiles_go(tmp_path: Path) -> None:
    source = tmp_path / "dense.pdf"
    _dense_page(source)
    with pymupdf.open(source) as document:
        original = document[0]
        expected = sorted(
            word[4] for word in original.get_text("words") if word[4] not in ("TASLAK", "LAK")
        )
        original_fonts = {trace["font"] for trace in original.get_texttrace()}
        original_basefonts = {entry[3] for entry in original.get_fonts(full=True)}
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source),
            output=str(tmp_path / "clean.pdf"),
            texts=["TASLAK"],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    outside = pymupdf.Rect(-1000, -1000, 1600, 1900)
    with pymupdf.open(result.output) as document:
        page = document[0]
        everything = page.get_text(
            clip=outside, flags=pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_MEDIABOX_CLIP
        )
        assert "TASLAK" not in everything and "LAK" not in everything
        assert sorted(word[4] for word in page.get_text("words")) == expected
        traces = page.get_texttrace()
        rewritten = sum(
            len(trace["chars"]) for trace in traces if trace["font"] not in original_fonts
        )
        fonts = {entry[3] for entry in page.get_fonts(full=True)}
    assert rewritten == 0
    assert fonts <= original_basefonts


def test_rewritten_glyphs_keep_their_original_code_points() -> None:
    from vivepdf.ops._to_unicode import cmap_entries
    from vivepdf.ops.watermark_restore import _keep_code_points

    font_file = Path("C:/Windows/Fonts/arial.ttf")
    if not font_file.exists():
        font_file = Path(WATERMARK_FONT_BOLD)
    document = pymupdf.open()
    page = document.new_page()
    font = pymupdf.Font(fontfile=str(font_file))
    before = {entry[0] for entry in page.get_fonts(full=True)}
    writer = pymupdf.TextWriter(page.rect)
    writer.append((100, 100), "a-b", font=font, fontsize=12)
    writer.write_text(page)
    fresh = sorted({entry[0] for entry in page.get_fonts(full=True)} - before)
    assert fresh
    cmap = int(document.xref_get_key(fresh[0], "ToUnicode")[1].split()[0])
    entries = cmap_entries(document.xref_stream(cmap))
    hyphen = font.has_glyph(ord("-"))
    entries[hyphen] = "\u2010"
    from vivepdf.ops._to_unicode import cmap_stream

    document.update_stream(cmap, cmap_stream(entries))
    reopened = pymupdf.open("pdf", document.tobytes())
    assert "a-b" not in reopened[0].get_text()
    _keep_code_points(page, fresh, {hyphen: "-"})
    reopened = pymupdf.open("pdf", document.tobytes())
    assert reopened[0].get_text().strip() == "a-b"


def _font_dictionary(document: pymupdf.Document, page: pymupdf.Page) -> tuple[int, str]:
    kind, value = document.xref_get_key(page.xref, "Resources")
    holder, prefix = (int(value.split()[0]), "") if kind == "xref" else (page.xref, "Resources/")
    kind, value = document.xref_get_key(holder, f"{prefix}Font")
    if kind == "xref":
        return int(value.split()[0]), ""
    return holder, f"{prefix}Font/"


def test_words_in_a_font_that_is_not_embedded_go_back_in_that_font() -> None:
    from vivepdf.ops._original_fonts import FontCodes, PageFonts

    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((50, 50), "abc", fontname="tiro")
    times = page.get_fonts(full=True)[0][0]
    plain = document.get_new_xref()
    document.update_object(plain, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    symbol = document.get_new_xref()
    document.update_object(symbol, "<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>")
    custom = document.get_new_xref()
    document.update_object(
        custom,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding << /Differences [65 /B] >> >>",
    )
    holder, prefix = _font_dictionary(document, page)
    for name, xref in (("F7", plain), ("F8", symbol), ("F9", custom)):
        document.xref_set_key(holder, f"{prefix}{name}", f"{xref} 0 R")
    fonts = PageFonts(page, FontCodes(document))
    assert fonts.show({"font": "Times-Roman", "xref": times}, ["é"]) == [("tiro", b"\xe9")]
    assert fonts.show({"font": "Helvetica", "xref": plain}, ["a", "'", "’"]) == [
        ("F7", b"a"),
        ("F7", b"\xa9"),
        ("F7", b"'"),
    ]
    assert fonts.show({"font": "Symbol", "xref": symbol}, ["α", "∑"]) == [
        ("F8", b"a"),
        ("F8", b"\xe5"),
    ]
    assert fonts.show({"font": "Courier", "xref": custom}, ["B", "A"]) == [
        ("F9", b"A"),
        ("VPo1", b"\x01"),
    ]
    assert fonts.show({"font": "Times-Bold", "xref": times}, ["a"]) is None
    fonts.rollback()
    assert document.xref_get_key(holder, f"{prefix}VPo1")[0] == "null"
    document.close()


def _body_in_font(font_object: str, codes: bytes, *, in_form: bool = False) -> pymupdf.Document:
    from vivepdf.ops._objects import add_resource

    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text(
        (40, 500),
        "TASLAK",
        fontsize=150,
        fontname="wm",
        fontfile=str(WATERMARK_FONT_BOLD),
        color=(0.8, 0.8, 0.85),
    )
    font = document.get_new_xref()
    document.update_object(font, font_object)
    rows = " ".join(f"1 0 0 1 60 {760 - row * 20} Tm <{codes.hex()}> Tj" for row in range(34))
    body = f"BT /B 12 Tf {rows} ET".encode("ascii")
    drawn = document.get_new_xref()
    document.update_object(drawn, "<<>>")
    if in_form:
        document.update_object(
            drawn,
            "<< /Type /XObject /Subtype /Form /BBox [0 0 595 842]"
            f" /Resources << /Font << /B {font} 0 R >> >> >>",
        )
        document.update_stream(drawn, body)
        add_resource(document, page.xref, "XObject", "Body", drawn, page.xref)
        drawn = document.get_new_xref()
        document.update_object(drawn, "<<>>")
        document.update_stream(drawn, b"q /Body Do Q")
    else:
        document.update_stream(drawn, body)
        add_resource(document, page.xref, "Font", "B", font, page.xref)
    listing = " ".join(f"{xref} 0 R" for xref in [drawn, *page.get_contents()])
    document.xref_set_key(page.xref, "Contents", f"[{listing}]")
    return document


UCS2_FONT = (
    "<< /Type /Font /Subtype /Type0 /BaseFont /MSMincho /Encoding /UniJIS-UCS2-H"
    " /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /MSMincho"
    " /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >>"
    " /FontDescriptor << /Type /FontDescriptor /FontName /MSMincho /Flags 4"
    " /FontBBox [0 -141 1000 859] /ItalicAngle 0 /Ascent 859 /Descent -141"
    " /CapHeight 700 /StemV 80 >> >>] >>"
)


@pytest.mark.parametrize(
    ("font_object", "codes", "in_form"),
    [
        ("<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>", b"abgd pq 123 abgd", False),
        (
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /BaseEncoding"
            " /WinAnsiEncoding /Differences [128 /scedilla /gbreve /idotless /Scedilla] >> >>",
            b"\x80\x81\x82 kalem ve \x83\x82k satirlari \x80\x81\x82",
            False,
        ),
        (
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
            b"Govde satiri icerik metni \xe9t\xe9 burada",
            True,
        ),
        (UCS2_FONT, "日本語の本文テキスト日本語".encode("utf-16-be"), False),
    ],
    ids=["symbol", "differences", "form-xobject", "cid-ucs2"],
)
def test_words_in_other_non_embedded_fonts_go_back_in_that_font(
    tmp_path: Path, font_object: str, codes: bytes, in_form: bool
) -> None:
    source = tmp_path / "marked.pdf"
    with _body_in_font(font_object, codes, in_form=in_form) as document:
        document.save(source)
        page = document[0]
        expected = [line for line in page.get_text().splitlines() if "TASLAK" not in line]
        body_fonts = {entry[3] for entry in page.get_fonts(full=True) if entry[1] == "n/a"}
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source),
            output=str(tmp_path / "clean.pdf"),
            texts=["TASLAK"],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        page = document[0]
        assert "TASLAK" not in page.get_text()
        assert sorted(page.get_text().splitlines()) == sorted(expected)
        used = {trace["font"] for trace in page.get_texttrace()}
        embedded = [entry for entry in page.get_fonts(full=True) if entry[1] != "n/a"]
    assert len(expected) == 34
    assert used <= body_fonts
    assert embedded == []


def test_a_character_outside_the_encoding_goes_back_in_a_copy_of_the_font() -> None:
    from vivepdf.ops._original_fonts import FontCodes, PageFonts
    from vivepdf.ops._watermark_text_removal import _page_characters
    from vivepdf.ops.watermark_restore import _write_original

    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((100, 100), "ab", fontname="helv", fontsize=40)
    span = _page_characters(page)[0]
    chars = [{**span["chars"][0], "c": "ş"}, {**span["chars"][1], "c": "b"}]
    for char in chars:
        char["origin"] = (char["origin"][0], char["origin"][1] + 100)
        char["bbox"] = pymupdf.Rect(char["bbox"]) + (0, 100, 0, 100)
    fonts = PageFonts(page, FontCodes(document))
    assert _write_original(page, {"span": span, "chars": chars}, fonts)
    written = [trace for trace in page.get_texttrace() if trace["chars"][0][2][1] > 150]
    assert "".join(chr(char[0]) for trace in written for char in trace["chars"]) == "şb"
    assert {trace["font"] for trace in written} == {"Helvetica"}
    ink = page.get_pixmap(clip=chars[0]["bbox"], dpi=72, colorspace=pymupdf.csGRAY)
    assert min(ink.samples) < 128
    assert [entry for entry in page.get_fonts(full=True) if entry[1] != "n/a"] == []
    document.close()


def test_only_the_character_the_original_font_cannot_draw_goes_to_the_substitute() -> None:
    from vivepdf.ops._watermark_text_removal import _page_characters
    from vivepdf.ops.watermark_restore import _put_back, _restore_plan

    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((100, 100), "abc", fontname="helv", fontsize=40)
    span = _page_characters(page)[0]
    chars = [{**char} for char in span["chars"]]
    chars[1]["c"] = "✓"
    span = {**span, "text": "a✓c", "chars": chars}
    for char in chars:
        char["origin"] = (char["origin"][0], char["origin"][1] + 100)
        char["bbox"] = pymupdf.Rect(char["bbox"]) + (0, 100, 0, 100)
    plan = _restore_plan(page, [{"span": span, "chars": chars}])
    _put_back(page, plan, [span], [])
    written = [trace for trace in page.get_texttrace() if trace["chars"][0][2][1] > 150]
    fonts = {chr(char[0]): trace["font"] for trace in written for char in trace["chars"]}
    assert set(fonts) == {"a", "✓", "c"}
    assert fonts["a"] == fonts["c"] == "Helvetica"
    assert fonts["✓"] != "Helvetica"
    assert [word[4] for word in page.get_text("words", clip=(0, 150, 600, 250))] == ["a✓c"]
    document.close()


def test_a_font_the_restore_cannot_encode_is_left_for_the_substitute() -> None:
    from vivepdf.ops._objects import add_resource
    from vivepdf.ops._original_fonts import FontCodes, PageFonts

    document = pymupdf.open()
    page = document.new_page()
    listed = document.get_new_xref()
    document.update_object(listed, UCS2_FONT.replace("/UniJIS-UCS2-H", "[/UniJIS-UCS2-H]"))
    add_resource(document, page.xref, "Font", "V", listed, page.xref)
    fonts = PageFonts(page, FontCodes(document))
    assert fonts.show({"font": "MSMincho", "xref": listed}, ["日"]) is None
    assert fonts.show({"font": "MSMincho", "xref": listed + 1000}, ["日"]) is None
    document.close()


def test_identity_fonts_follow_their_unicode_map_and_ligatures_are_not_split() -> None:
    from vivepdf.ops._objects import add_resource
    from vivepdf.ops._original_fonts import FontCodes, PageFonts, probe_codes
    from vivepdf.ops._to_unicode import cmap_stream

    document = pymupdf.open()
    page = document.new_page()
    identity = document.get_new_xref()
    document.update_object(identity, UCS2_FONT.replace("UniJIS-UCS2-H", "Identity-H"))
    unicode_map = document.get_new_xref()
    document.update_object(unicode_map, "<<>>")
    document.update_stream(unicode_map, cmap_stream({0x0101: "日", 0x0202: "本", 0x0303: "日"}))
    document.xref_set_key(identity, "ToUnicode", f"{unicode_map} 0 R")
    add_resource(document, page.xref, "Font", "J", identity, page.xref)
    ligature = document.get_new_xref()
    document.update_object(ligature, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    ligature_map = document.get_new_xref()
    document.update_object(ligature_map, "<<>>")
    document.update_stream(ligature_map, cmap_stream({0x41: "fi", 0x42: "x"}))
    document.xref_set_key(ligature, "ToUnicode", f"{ligature_map} 0 R")
    fonts = PageFonts(page, FontCodes(document))
    assert fonts.show({"font": "MSMincho", "xref": identity}, ["日", "本"]) == [
        ("J", b"\x01\x01"),
        ("J", b"\x02\x02"),
    ]
    assert fonts.show({"font": "MSMincho", "xref": identity}, ["語"]) is None
    codes = probe_codes(document, ligature, 1)
    assert codes["x"] == b"B"
    assert codes.get("f") != b"A" and codes.get("i") != b"A"
    document.close()


EMBEDDED_CMAP = (
    b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Custom def"
    b" /CMapType 1 def 2 begincodespacerange <00> <7F> <8000> <FFFF> endcodespacerange"
    b" 2 begincidrange <41> <5A> 34 <8141> <815A> 842 endcidrange"
    b" endcmap CMapName currentdict /CMap defineresource pop end end"
)


def _cid_font(document: pymupdf.Document, encoding: str) -> int:
    font = document.get_new_xref()
    if encoding == "embedded":
        cmap = document.get_new_xref()
        document.update_object(
            cmap,
            "<< /Type /CMap /CMapName /Custom /CIDSystemInfo"
            " << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> >>",
        )
        document.update_stream(cmap, EMBEDDED_CMAP)
        document.update_object(font, UCS2_FONT.replace("/UniJIS-UCS2-H", f"{cmap} 0 R"))
    else:
        document.update_object(font, UCS2_FONT.replace("UniJIS-UCS2-H", encoding))
    return font


def _dark(page: pymupdf.Page, area: pymupdf.Rect) -> list[bool]:
    pixmap = page.get_pixmap(clip=area, dpi=144, colorspace=pymupdf.csGRAY)
    return [value < 128 for value in pixmap.samples]


@pytest.mark.parametrize(
    ("encoding", "codes", "rotation"),
    [
        ("UniJIS-UCS2-V", "日本語の本".encode("utf-16-be"), 0),
        ("UniJIS-UCS2-V", "日本語の本".encode("utf-16-be"), 90),
        ("Identity-V", bytes.fromhex("0101020203030404"), 0),
        ("90ms-RKSJ-V", "日本語の本".encode("cp932"), 0),
        ("90ms-RKSJ-H", "Abc 日本語 xyz".encode("cp932"), 0),
        ("90ms-RKSJ-H", "Abc 日本語 xyz".encode("cp932"), 270),
        ("EUC-H", "日本語 AB".encode("euc_jp"), 0),
        ("embedded", b"ABC\x81\x41\x81\x42Z", 0),
    ],
    ids=[
        "ucs2-vertical",
        "ucs2-vertical-turned",
        "identity-vertical",
        "rksj-vertical",
        "rksj",
        "rksj-turned",
        "euc",
        "embedded-cmap",
    ],
)
def test_cid_words_in_vertical_and_other_cmaps_go_back_in_their_own_font(
    encoding: str, codes: bytes, rotation: int
) -> None:
    from vivepdf.ops._objects import add_resource
    from vivepdf.ops._original_fonts import FontCodes, PageFonts
    from vivepdf.ops._watermark_text_removal import _page_characters
    from vivepdf.ops.watermark_restore import _write_original

    shift = 250
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    add_resource(document, page.xref, "Font", "B", _cid_font(document, encoding), page.xref)
    body = document.get_new_xref()
    document.update_object(body, "<<>>")
    document.update_stream(body, f"BT /B 20 Tf 1 0 0 1 60 760 Tm <{codes.hex()}> Tj ET".encode())
    document.xref_set_key(page.xref, "Contents", f"{body} 0 R")
    page.set_rotation(rotation)
    spans = _page_characters(page)
    source = [char for span in spans for char in span["chars"]]
    moved = {
        id(char): {
            **char,
            "origin": (char["origin"][0] + shift, char["origin"][1]),
            "bbox": pymupdf.Rect(char["bbox"]) + (shift, 0, shift, 0),
        }
        for char in source
    }
    fonts = PageFonts(page, FontCodes(document))
    for span in spans:
        chars = [moved[id(char)] for char in span["chars"]]
        assert _write_original(page, {"span": span, "chars": chars}, fonts)
    area = pymupdf.Rect(source[0]["bbox"])
    for char in source[1:]:
        area |= pymupdf.Rect(char["bbox"])
    area += (-4, -4, 4, 4)
    turn = page.rotation_matrix
    original = _dark(page, area * turn)
    assert sum(original) > 100
    assert _dark(page, (area + (shift, 0, shift, 0)) * turn) == original
    assert [entry for entry in page.get_fonts(full=True) if entry[1] != "n/a"] == []
    document.close()


def test_mixed_width_cmaps_keep_single_byte_codes_apart_from_lead_bytes() -> None:
    from vivepdf.ops._original_fonts import mixed_codes

    document = pymupdf.open()
    document.new_page()
    codes = mixed_codes(document, _cid_font(document, "90ms-RKSJ-H"))
    assert codes["A"] == b"A"
    assert codes["日"] == "日".encode("cp932")
    assert all(len(code) == 2 for code in codes.values() if code[0] in range(0x81, 0xA0))
    embedded = mixed_codes(document, _cid_font(document, "embedded"))
    assert embedded["ぁ"] == b"\x81\x41"
    assert len(embedded["A"]) == 1
    document.close()


@pytest.mark.parametrize("inline", [False, True], ids=["descriptor-object", "inline-descriptor"])
def test_a_character_outside_a_symbolic_truetype_encoding_goes_back_in_a_plain_copy(
    inline: bool,
) -> None:
    from vivepdf.ops._objects import add_resource
    from vivepdf.ops._original_fonts import FontCodes, PageFonts
    from vivepdf.ops._watermark_text_removal import _page_characters
    from vivepdf.ops.watermark_restore import _write_original

    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    descriptor = (
        "<< /Type /FontDescriptor /FontName /Arial /Flags 4 /FontBBox [-665 -325 2000 1040]"
        " /ItalicAngle 0 /Ascent 905 /Descent -212 /CapHeight 716 /StemV 80 >>"
    )
    if not inline:
        held = document.get_new_xref()
        document.update_object(held, descriptor)
        descriptor = f"{held} 0 R"
    font = document.get_new_xref()
    document.update_object(
        font, f"<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FontDescriptor {descriptor} >>"
    )
    add_resource(document, page.xref, "Font", "O", font, page.xref)
    body = document.get_new_xref()
    document.update_object(body, "<<>>")
    document.update_stream(body, b"BT /O 40 Tf 1 0 0 1 60 200 Tm (ab) Tj ET")
    document.xref_set_key(page.xref, "Contents", f"{body} 0 R")
    span = _page_characters(page)[0]
    chars = [{**span["chars"][0], "c": "ş"}, {**span["chars"][1], "c": "b"}]
    for char in chars:
        char["origin"] = (char["origin"][0], char["origin"][1] + 100)
        char["bbox"] = pymupdf.Rect(char["bbox"]) + (0, 100, 0, 100)
    fonts = PageFonts(page, FontCodes(document))
    assert _write_original(page, {"span": span, "chars": chars}, fonts)
    written = [trace for trace in page.get_texttrace() if trace["chars"][0][2][1] > 150]
    assert "".join(chr(char[0]) for trace in written for char in trace["chars"]) == "şb"
    assert {trace["font"] for trace in written} == {"Arial"}
    assert any(_dark(page, pymupdf.Rect(chars[0]["bbox"])))
    assert document.xref_get_key(font, "FontDescriptor/Flags") == ("int", "4")
    assert [entry for entry in page.get_fonts(full=True) if entry[1] != "n/a"] == []
    document.close()
