import io

import pymupdf
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

from vivepdf.ops.fonts import TEXTEDIT_FONT, ResolvedFont, ensure_font, pdf_font_name


def nameless_subset(text: str) -> bytes:
    font = TTFont(str(TEXTEDIT_FONT))
    options = Options()
    options.name_IDs = []
    subsetter = Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    if "name" in font:
        del font["name"]
    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue()


def font_names(document: pymupdf.Document, page: pymupdf.Page) -> list[str]:
    names: list[str] = []
    for entry in page.get_fonts(full=True):
        xref = int(entry[0])
        names.append(document.xref_get_key(xref, "BaseFont")[1])
        descendant = document.xref_get_key(xref, "DescendantFonts")[1]
        child = int(descendant.strip("[] ").split()[0])
        names.append(document.xref_get_key(child, "BaseFont")[1])
        descriptor = int(document.xref_get_key(child, "FontDescriptor")[1].split()[0])
        names.append(document.xref_get_key(descriptor, "FontName")[1])
    return names


def test_nameless_subset_gets_the_source_font_name():
    buffer = nameless_subset("Merhaba şğı")
    assert pymupdf.Font(fontbuffer=buffer).name == "(null)"
    document = pymupdf.open()
    page = document.new_page()
    font = ResolvedFont("vpf12", None, buffer, "ABCDEF+Calibri-Bold")
    ensure_font(page, font)
    page.insert_text((40, 60), "Merhaba şğı", fontname="vpf12")
    assert font_names(document, page) == ["/ABCDEF+Calibri-Bold"] * 3
    reloaded = pymupdf.open("pdf", document.tobytes())
    assert "ABCDEF+Calibri-Bold" in [entry[3] for entry in reloaded[0].get_fonts()]


def test_nameless_subset_without_source_name_uses_a_real_name():
    font = ResolvedFont("vpf7", None, nameless_subset("abc"))
    assert pdf_font_name(font) == "vpf7"
    font.source_name = "Times New Roman,Bold (x)"
    assert pdf_font_name(font) == "TimesNewRomanBoldx"
    font.source_name = "(null)"
    assert pdf_font_name(font) == "vpf7"


def test_named_font_keeps_its_own_name():
    document = pymupdf.open()
    page = document.new_page()
    font = ResolvedFont("vivepdf-te", str(TEXTEDIT_FONT), None, "Ignored")
    ensure_font(page, font)
    assert font_names(document, page)[0] == "/DejaVu Sans Book"
