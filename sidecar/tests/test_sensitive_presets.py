from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._redact_presets import PRESET_PATTERNS, preset_matches
from vivepdf.ops._watermark_style import WATERMARK_FONT
from vivepdf.ops.privacy import InspectParams, inspect
from vivepdf.rpc.progress import silent_progress

PRESETS = [name for name in PRESET_PATTERNS if name != "date"]
CARD_PAGE = """T.C. Kimlik Numarası: 4221235878
Tel: 0531 203 73 63
Mehmet Türkan
Ahmet Türkan

Bilgisayar Mühendisi

TR16 2045 6548 1564 4561 12
"""


def _hits(text: str) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for preset, needle in preset_matches(text, PRESETS):
        found.setdefault(preset, []).append(needle)
    return found


def test_a_business_card_page_reports_one_of_each():
    found = _hits(CARD_PAGE)
    assert found["tckn"] == ["4221235878"]
    assert found["phone"] == ["0531 203 73 63"]
    assert found["iban"] == ["TR16 2045 6548 1564 4561 12"]


@pytest.mark.parametrize(
    "text",
    [
        "TCKN: 12345678901",
        "T.C. KİMLİK NO: 4221235878",
        "T.C. Kimlik Numarası:\n4221235878",
        "kimlik no 10000000146",
    ],
)
def test_a_labelled_identity_number_is_found_however_it_is_written(text: str):
    assert "tckn" in _hits(text)


@pytest.mark.parametrize(
    "text",
    ["Sipariş no: 4221235878", "Fatura no: 2024123456", "Barkod: 8690000000001", "2020 2024"],
)
def test_a_bare_number_run_is_not_reported_as_a_phone(text: str):
    assert "phone" not in _hits(text)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Tel: 0531 203 73 63", "0531 203 73 63"),
        ("Tel: (0212) 123 45 67", "(0212) 123 45 67"),
        ("+905312037363", "+905312037363"),
        ("05312037363", "05312037363"),
        ("531 203 73 63", "531 203 73 63"),
    ],
)
def test_a_turkish_phone_number_is_captured_whole(text: str, expected: str):
    assert _hits(text)["phone"] == [expected]


@pytest.mark.parametrize(
    "text",
    [
        "TR16 2045 6548 1564 4561 12",
        "TR33 0006 1005 1978 6457 8413 26",
        "IBAN: TR16 2045 6548",
        "iban no: TR160000000000000000",
    ],
)
def test_a_partial_or_full_iban_is_found(text: str):
    assert "iban" in _hits(text)


def test_an_identity_number_is_no_longer_counted_as_a_phone_number(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for index, line in enumerate(CARD_PAGE.splitlines()):
        page.insert_text(
            (60, 100 + index * 24),
            line,
            fontsize=11,
            fontname="card",
            fontfile=str(WATERMARK_FONT),
        )
    path = tmp_path / "card.pdf"
    document.save(path)
    document.close()

    report = inspect(InspectParams(path=str(path)), silent_progress())
    assert report.sensitive.get("phone") == 1
    assert report.sensitive.get("tckn") == 1
    assert report.sensitive.get("iban") == 1
