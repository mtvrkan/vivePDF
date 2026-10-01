import re
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._redact_presets import (
    PRESET_LABELLED,
    PRESET_NAMES,
    PRESET_PATTERNS,
    preset_matches,
)
from vivepdf.ops._watermark_style import WATERMARK_FONT
from vivepdf.ops.edit import ScanPresetsParams, scan_presets
from vivepdf.rpc.progress import silent_progress

ALL = list(PRESET_NAMES)

POSITIVE = [
    ("apiKey", "AKIAIOSFODNN7EXAMPLE"),
    ("apiKey", "AIzaSyDmoJEXAMPLEkeyABCDEFGHIJKLMNOPQRS"),
    ("apiKey", "ghp_16CharsAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    ("apiKey", "xoxb-1234567890-abcdefghij"),
    ("apiKey", "sk_live_51H0abcdefgHIJKLMNOP1234"),
    ("apiKey", "sk-ant-api03-AbCdEf0123456789_-xyz"),
    ("apiKey", "npm_abcdefghijklmnopqrstuvwxyz0123456789"),
    ("privateKey", "-----BEGIN RSA PRIVATE KEY-----"),
    ("privateKey", "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ user@host"),
    ("jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r"),
    ("connectionString", "postgres://admin:s3cr3t@db.internal:5432/app"),
    ("connectionString", "AccountKey=abcdefghijklmnopqrstuvwxyz0123456789ABCDEF=="),
    ("password", "Şifre: Deneme123!"),
    ("password", "API_KEY=abcdef123456"),
    ("card", "4111 1111 1111 1111"),
    ("iban", "TR33 0006 1005 1978 6457 8413 26"),
    ("iban", "DE89 3704 0044 0532 0130 00"),
    ("crypto", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"),
    ("crypto", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"),
    ("crypto", "0x52908400098527886E0F7030069857D2E4169EE7"),
    ("tckn", "10000000146"),
    ("taxNumber", "Vergi No: 1234567890"),
    ("passport", "Pasaport No: U12345678"),
    ("plate", "34 ABC 123"),
    ("ssn", "123-45-6789"),
    ("email", "ali.veli@ornek.com"),
    ("phone", "Tel: 0531 203 73 63"),
    ("ip", "Sunucu: 192.168.1.42"),
    ("ip", "fe80::1ff:fe23:4567:890a"),
    ("mac", "00:1A:2B:3C:4D:5E"),
]

QUIET = [
    "Bilgisayar Mühendisi Mehmet Türkan raporu hazırladı.",
    "Sürüm 1.2.3 yayınlandı",
    "Toplam 1.250,00 TL ödendi",
    "Sipariş no: 4221235878",
    "Fatura no: 2024123456",
    "Toplantı 09:00 - 17:00 arasında",
    "Renk kodu #1A2B3C",
    "Bu bir secret değil, sadece bir cümle.",
    "Şifre: en az 8 karakter olmalı",
    "kimlik bilgileri iki sayfada verilmiştir",
    "12 Mart 2024 ile 15 Nisan 2024",
    "GIZLILIK VE GUVENLIK POLITIKASI",
    "2020 2024 yılları arasında 45 kişi",
]


def _kinds(text: str) -> set[str]:
    return {preset for preset, _ in preset_matches(text, ALL)}


def test_every_preset_name_has_a_pattern():
    for name in PRESET_NAMES:
        assert name in PRESET_PATTERNS or name in PRESET_LABELLED


def test_every_pattern_compiles():
    for name in PRESET_NAMES:
        for source in (PRESET_PATTERNS.get(name), PRESET_LABELLED.get(name)):
            if source:
                re.compile(source, re.IGNORECASE)


@pytest.mark.parametrize(("preset", "text"), POSITIVE)
def test_a_known_secret_is_recognised(preset: str, text: str):
    assert preset in _kinds(text)


@pytest.mark.parametrize("text", QUIET)
def test_ordinary_prose_is_left_alone(text: str):
    assert _kinds(text) - {"date"} == set()


def test_the_scan_reports_only_the_kinds_that_are_present(tmp_path: Path):
    lines = [
        "T.C. Kimlik Numarası: 4221235878",
        "Tel: 0531 203 73 63",
        "TR16 2045 6548 1564 4561 12",
        "AKIAIOSFODNN7EXAMPLE",
        "Sunucu: 192.168.1.42",
    ]
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for index, line in enumerate(lines):
        page.insert_text(
            (60, 100 + index * 26), line, fontsize=11, fontname="s", fontfile=str(WATERMARK_FONT)
        )
    path = tmp_path / "mixed.pdf"
    document.save(path)
    document.close()

    result = scan_presets(ScanPresetsParams(path=str(path)), silent_progress())
    assert set(result.counts) == {"apiKey", "iban", "tckn", "phone", "ip"}
    assert all(count > 0 for count in result.counts.values())
    assert result.pages_scanned == 1 and result.page_count == 1


def test_the_scan_returns_nothing_for_a_plain_document(tmp_path: Path):
    document = pymupdf.open()
    document.new_page(width=595, height=842).insert_text(
        (60, 100), "Bu sayfada hassas bir sey yok", fontsize=11
    )
    path = tmp_path / "plain.pdf"
    document.save(path)
    document.close()

    result = scan_presets(ScanPresetsParams(path=str(path)), silent_progress())
    assert result.counts == {}


def test_the_scan_keeps_the_risk_order(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((60, 100), "ali@ornek.com", fontsize=11)
    page.insert_text((60, 130), "AKIAIOSFODNN7EXAMPLE", fontsize=11)
    path = tmp_path / "order.pdf"
    document.save(path)
    document.close()

    result = scan_presets(ScanPresetsParams(path=str(path)), silent_progress())
    assert list(result.counts) == ["apiKey", "email"]
