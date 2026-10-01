import pymupdf
import pytest

from vivepdf.ops._name_syntax import pdf_name


def test_a_plain_name_is_written_as_it_is():
    assert pdf_name("Helvetica-Bold") == "/Helvetica-Bold"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Times New Roman,Bold", "/Times#20New#20Roman,Bold"),
        ("application/pdf", "/application#2Fpdf"),
        ("a#b(c)", "/a#23b#28c#29"),
        ("Şık", "/#C5#9E#C4#B1k"),
    ],
)
def test_spaces_delimiters_and_non_ascii_bytes_are_escaped(text: str, expected: str):
    assert pdf_name(text) == expected


def test_an_escaped_name_reads_back_as_the_original_text():
    document = pymupdf.open()
    page = document.new_page()
    document.xref_set_key(page.xref, "Probe", pdf_name("Öğrenci Notu #1"))

    kind, value = document.xref_get_key(page.xref, "Probe")

    assert kind == "name"
    assert value == "/Öğrenci Notu #1"
    document.close()


def test_an_empty_name_is_just_the_slash():
    assert pdf_name("") == "/"
