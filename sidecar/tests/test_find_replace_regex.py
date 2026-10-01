from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.textedit import (
    FindPreviewParams,
    FindReplaceParams,
    find_preview,
    find_replace,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)

LINES = [
    "Fatura no: 2026-0041",
    "Fatura no: 2026-0042",
    "Musteri: Ornek Sirketi",
    "musteri: kucuk harf",
    "Toplam 1.250,00 TL",
]


@pytest.fixture
def invoice(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for index, line in enumerate(LINES):
        page.insert_text(
            (60, 100 + index * 40), line, fontsize=12, fontname="dejavu", fontfile=FONT
        )
    path = tmp_path / "invoice.pdf"
    document.save(path)
    document.close()
    return path


def _text(path: Path) -> str:
    document = pymupdf.open(path)
    value = document[0].get_text()
    document.close()
    return value


def test_a_regular_expression_matches_what_a_literal_search_cannot(invoice: Path, tmp_path: Path):
    target = tmp_path / "masked.pdf"
    result = find_replace(
        FindReplaceParams(
            path=str(invoice),
            output=str(target),
            find=r"2026-\d{4}",
            replace="GIZLI",
            regex=True,
        ),
        silent_progress(),
    )
    assert result.replaced == 2
    text = _text(target)
    assert "2026-0041" not in text
    assert "2026-0042" not in text
    assert text.count("GIZLI") == 2


def test_a_group_can_be_reused_in_the_replacement(invoice: Path, tmp_path: Path):
    target = tmp_path / "grouped.pdf"
    find_replace(
        FindReplaceParams(
            path=str(invoice),
            output=str(target),
            find=r"Fatura no: (\d{4})-(\d{4})",
            replace=r"Belge \2/\1",
            regex=True,
        ),
        silent_progress(),
    )
    text = _text(target)
    assert "Belge 0041/2026" in text
    assert "Belge 0042/2026" in text


def test_without_the_regex_switch_the_pattern_is_taken_literally(invoice: Path, tmp_path: Path):
    target = tmp_path / "literal.pdf"
    with pytest.raises(OpError) as error:
        find_replace(
            FindReplaceParams(
                path=str(invoice), output=str(target), find=r"2026-\d{4}", replace="X"
            ),
            silent_progress(),
        )
    assert error.value.data == {"reason": "noMatches"}
    assert not target.exists()


def test_case_sensitivity_still_applies_to_a_pattern(invoice: Path, tmp_path: Path):
    target = tmp_path / "cased.pdf"
    result = find_replace(
        FindReplaceParams(
            path=str(invoice),
            output=str(target),
            find="Musteri",
            replace="Alici",
            case_sensitive=True,
        ),
        silent_progress(),
    )
    assert result.replaced == 1
    assert "musteri: kucuk harf" in _text(target)


def test_whole_word_does_not_match_inside_a_longer_word(invoice: Path, tmp_path: Path):
    target = tmp_path / "word.pdf"
    with pytest.raises(OpError) as error:
        find_replace(
            FindReplaceParams(
                path=str(invoice), output=str(target), find="Sirket", replace="XX", whole_word=True
            ),
            silent_progress(),
        )
    assert error.value.data == {"reason": "noMatches"}


def test_a_broken_pattern_is_refused_with_a_reason(invoice: Path, tmp_path: Path):
    with pytest.raises(OpError) as error:
        find_replace(
            FindReplaceParams(
                path=str(invoice),
                output=str(tmp_path / "bad.pdf"),
                find="(unclosed",
                replace="x",
                regex=True,
            ),
            silent_progress(),
        )
    assert "invalid search pattern" in error.value.message


def test_the_preview_lists_the_hits_with_their_surroundings(invoice: Path):
    result = find_preview(
        FindPreviewParams(path=str(invoice), find=r"\d{4}-\d{4}", regex=True), silent_progress()
    )
    assert result.total == 2
    assert result.pages_searched == 1
    assert [hit.text for hit in result.hits] == ["2026-0041", "2026-0042"]
    assert "Fatura no: " in result.hits[0].context


def test_the_preview_counts_more_than_it_lists(invoice: Path):
    result = find_preview(
        FindPreviewParams(path=str(invoice), find="a", limit=1), silent_progress()
    )
    assert result.total > 1
    assert len(result.hits) == 1
