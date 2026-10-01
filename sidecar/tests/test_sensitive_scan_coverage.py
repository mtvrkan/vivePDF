import base64
import threading
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import edit
from vivepdf.ops.edit import (
    RedactParams,
    ScanPresetsParams,
    SearchParams,
    redact,
    redact_preview,
    scan_order,
    scan_presets,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress

IBAN_LINE = "IBAN: TR16 2045 6548 1564 4561 12"


def _long_document(path: Path, pages: int, special: int) -> None:
    document = pymupdf.open()
    for index in range(pages):
        page = document.new_page(width=300, height=300)
        page.insert_text((30, 60), f"Sayfa {index + 1} sıradan metin", fontsize=10)
        if index == special:
            page.insert_text((30, 90), IBAN_LINE, fontsize=10)
    document.save(path)
    document.close()


def _unsampled_index(pages: int) -> int:
    order = scan_order(list(range(pages)))
    spread = set(order[: edit.SCAN_SPREAD_PAGES])
    return next(index for index in range(pages) if index not in spread)


def test_a_kind_on_a_page_outside_the_old_sample_is_found(tmp_path: Path) -> None:
    pages = 200
    special = _unsampled_index(pages)
    path = tmp_path / "uzun belge.pdf"
    _long_document(path, pages, special)
    result = scan_presets(ScanPresetsParams(path=str(path)), silent_progress())
    assert result.counts.get("iban") == 1
    assert result.pages_scanned == pages
    assert result.pages_selected == pages
    assert result.complete is True


def test_the_scan_order_starts_spread_and_covers_every_page_once() -> None:
    order = scan_order(list(range(500)))
    assert sorted(order) == list(range(500))
    assert order[0] == 0
    assert max(order[: edit.SCAN_SPREAD_PAGES]) > 400


def test_the_scan_reports_when_the_time_budget_cut_it_short(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "b.pdf"
    _long_document(path, 30, 29)
    monkeypatch.setattr(edit, "SCAN_TIME_BUDGET", 0.0)
    result = scan_presets(ScanPresetsParams(path=str(path)), silent_progress())
    assert result.complete is False
    assert result.pages_scanned == 1
    assert result.pages_selected == 30


def test_the_scan_can_be_cancelled(tmp_path: Path) -> None:
    path = tmp_path / "c.pdf"
    _long_document(path, 5, 0)
    event = threading.Event()
    event.set()
    with pytest.raises(OpError) as caught:
        scan_presets(ScanPresetsParams(path=str(path)), Progress(lambda *_: None, event))
    assert caught.value.code == ErrorCode.CANCELLED


def _key_body(width: int) -> list[str]:
    raw = base64.b64encode(bytes(range(256)) * 3).decode("ascii")
    return [raw[start : start + width] for start in range(0, len(raw), width)]


def _key_page(path: Path, width: int) -> list[str]:
    lines = [
        "Sunucu anahtarı aşağıdadır:",
        "-----BEGIN PRIVATE KEY-----",
        *_key_body(width),
        "-----END PRIVATE KEY-----",
        "Bitti.",
    ]
    document = pymupdf.open()
    page = document.new_page(width=420, height=842)
    for index, line in enumerate(lines):
        page.insert_text((30, 40 + index * 12), line, fontsize=8, fontname="cour")
    document.save(path)
    document.close()
    return lines


def test_a_private_key_rewrapped_to_short_lines_is_redacted_whole(tmp_path: Path) -> None:
    source = tmp_path / "anahtar.pdf"
    body = _key_page(source, 28)[2:-2]
    output = tmp_path / "out.pdf"
    redact(
        RedactParams(path=str(source), output=str(output), presets=["privateKey"]),
        silent_progress(),
    )
    with pymupdf.open(output) as document:
        text = document[0].get_text()
    assert "PRIVATE KEY" not in text
    assert all(line not in text for line in body)
    assert "Sunucu" in text and "Bitti." in text


def test_the_preview_lists_every_short_line_of_a_key_once(tmp_path: Path) -> None:
    source = tmp_path / "anahtar.pdf"
    lines = _key_page(source, 28)
    result = redact_preview(
        SearchParams(path=str(source), presets=["privateKey"]), silent_progress()
    )
    texts = [hit.text for hit in result.hits]
    assert len(texts) == len(lines) - 2
    assert set(lines[1:-1]) == set(texts)


def test_a_standard_key_is_still_matched_without_duplicate_preview_hits(tmp_path: Path) -> None:
    source = tmp_path / "standart.pdf"
    lines = _key_page(source, 64)
    result = redact_preview(
        SearchParams(path=str(source), presets=["privateKey"]), silent_progress()
    )
    rows = {(round(hit.y0), round(hit.x0)) for hit in result.hits}
    assert len(rows) == len(result.hits) == len(lines) - 2
