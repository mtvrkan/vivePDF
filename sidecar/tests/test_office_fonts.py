import zipfile
from pathlib import Path

import pytest

from vivepdf.ops import office_fonts
from vivepdf.ops.office_fonts import OfficeFontsParams, document_fonts, missing_fonts
from vivepdf.rpc.progress import silent_progress

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
THEME = (
    f"<a:theme {A}><a:themeElements><a:fontScheme>"
    '<a:majorFont><a:latin typeface="Nesibe Display"/></a:majorFont>'
    '<a:minorFont><a:latin typeface="Esma Serif"/></a:minorFont>'
    "</a:fontScheme></a:themeElements></a:theme>"
)


def _package(tmp_path: Path, name: str, parts: dict[str, str]) -> Path:
    path = tmp_path / name
    with zipfile.ZipFile(path, "w") as archive:
        for part, text in parts.items():
            archive.writestr(part, text)
    return path


def test_word_fonts_include_theme_fonts_but_not_east_asian_ones(tmp_path: Path) -> None:
    source = _package(
        tmp_path,
        "rapor.docx",
        {
            "word/document.xml": f"<w:document {W}><w:body><w:p><w:r><w:rPr>"
            '<w:rFonts w:ascii="Beril Sans" w:hAnsi="Beril Sans" w:eastAsia="MS Mincho"/>'
            "</w:rPr></w:r></w:p></w:body></w:document>",
            "word/styles.xml": f"<w:styles {W}><w:docDefaults><w:rPrDefault><w:rPr>"
            '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/>'
            "</w:rPr></w:rPrDefault></w:docDefaults></w:styles>",
            "word/theme/theme1.xml": THEME,
        },
    )

    assert document_fonts(source) == {"Beril Sans", "Esma Serif"}


def test_slide_theme_references_resolve_to_the_theme_fonts(tmp_path: Path) -> None:
    source = _package(
        tmp_path,
        "sunum.pptx",
        {
            "ppt/slides/slide1.xml": f'<p:sld xmlns:p="p" {A}><a:r><a:rPr>'
            '<a:latin typeface="+mj-lt"/></a:rPr></a:r><a:r><a:rPr>'
            '<a:latin typeface="Batuhan Mono"/></a:rPr></a:r></p:sld>',
            "ppt/theme/theme1.xml": THEME,
            "ppt/notesSlides/notesSlide1.xml": f'<p:notes xmlns:p="p" {A}>'
            '<a:latin typeface="Only In Notes"/></p:notes>',
        },
    )

    assert document_fonts(source) == {"Nesibe Display", "Batuhan Mono"}


def test_sheet_and_open_document_fonts_are_read(tmp_path: Path) -> None:
    sheet = _package(
        tmp_path,
        "tablo.xlsx",
        {
            "xl/styles.xml": '<styleSheet xmlns="http://schemas.openxmlformats.org/'
            'spreadsheetml/2006/main"><fonts><font><name val="Mehmet Grotesk"/></font>'
            "</fonts></styleSheet>"
        },
    )
    text = _package(
        tmp_path,
        "metin.odt",
        {
            "content.xml": '<office:document-content xmlns:office="o" '
            'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
            'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0">'
            '<office:font-face-decls><style:font-face style:name="Beril1" '
            "svg:font-family=\"'Beril Serif'\"/>"
            '<style:font-face style:name="Unused" svg:font-family="Never Used"/>'
            "</office:font-face-decls><style:style>"
            '<style:text-properties style:font-name="Beril1"/>'
            "</style:style></office:document-content>"
        },
    )

    assert document_fonts(sheet) == {"Mehmet Grotesk"}
    assert document_fonts(text) == {"Beril Serif"}


def test_installed_fonts_and_metric_twins_are_not_reported() -> None:
    installed = frozenset({"arial", "carlito", "berilsans"})

    missing = missing_fonts(
        ["Arial", "Calibri", "Cambria", "Beril Sans", "geist", "Geist", "Aptos"], installed
    )

    assert missing == ["Aptos", "Cambria", "geist"]


@pytest.mark.parametrize(
    ("name", "content"),
    [("bozuk.docx", b"not a zip"), ("eski.doc", b"\xd0\xcf\x11\xe0"), ("bos.pptx", None)],
)
def test_unreadable_or_binary_files_report_no_fonts(
    tmp_path: Path, name: str, content: bytes | None
) -> None:
    source = tmp_path / name
    if content is None:
        _package(tmp_path, name, {"ppt/slides/slide1.xml": "<broken"})
    else:
        source.write_bytes(content)

    assert document_fonts(source) == set()


def test_the_operation_lists_only_fonts_this_computer_lacks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = _package(
        tmp_path,
        "rapor.docx",
        {
            "word/document.xml": f'<w:document {W}><w:rFonts w:ascii="Beril Sans"/>'
            '<w:rFonts w:ascii="Calibri"/><w:rFonts w:ascii="Arial"/></w:document>'
        },
    )
    monkeypatch.setattr(office_fonts, "installed_families", lambda: frozenset({"arial", "carlito"}))

    result = office_fonts.office_fonts(OfficeFontsParams(path=str(source)), silent_progress())

    assert result.missing == ["Beril Sans"]
