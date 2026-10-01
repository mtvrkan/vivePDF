from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.edit import RedactParams, SearchParams, redact, redact_preview
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


def _turkish_pdf(tmp_path: Path, line: str) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.insert_text((50, 100), f"Adres: {line} sonu", fontsize=12, fontname="dv", fontfile=FONT)
    document.set_metadata({"title": f"Rapor {line}", "subject": line})
    path = tmp_path / "turkish.pdf"
    document.save(path)
    document.close()
    return path


CASES = [
    ("İSTANBUL", "istanbul"),
    ("istanbul", "İSTANBUL"),
    ("IŞIK", "ışık"),
    ("ışık", "IŞIK"),
]


@pytest.mark.parametrize(("written", "term"), CASES)
def test_turkish_letters_match_their_other_case(tmp_path: Path, written: str, term: str) -> None:
    source = _turkish_pdf(tmp_path, written)
    output = tmp_path / "out.pdf"
    result = redact(
        RedactParams(path=str(source), output=str(output), search_text=[term]),
        silent_progress(),
    )
    assert result.redactions == 1
    with pymupdf.open(output) as document:
        text = document[0].get_text()
        assert written not in text
        assert "Adres" in text
        assert "sonu" in text
        assert written not in document.metadata["title"]
        assert written not in document.metadata["subject"]


@pytest.mark.parametrize(("written", "term"), CASES)
def test_preview_finds_the_other_case(tmp_path: Path, written: str, term: str) -> None:
    source = _turkish_pdf(tmp_path, written)
    result = redact_preview(SearchParams(path=str(source), search_text=[term]), silent_progress())
    assert len(result.hits) == 1


def test_case_sensitive_keeps_turkish_letters_apart(tmp_path: Path) -> None:
    source = _turkish_pdf(tmp_path, "İSTANBUL")
    result = redact_preview(
        SearchParams(path=str(source), search_text=["istanbul"], case_sensitive=True),
        silent_progress(),
    )
    assert result.hits == []


def test_whole_word_still_applies_to_turkish_letters(tmp_path: Path) -> None:
    source = _turkish_pdf(tmp_path, "IŞIKLAR")
    result = redact_preview(
        SearchParams(path=str(source), search_text=["ışık"], whole_word=True),
        silent_progress(),
    )
    assert result.hits == []
