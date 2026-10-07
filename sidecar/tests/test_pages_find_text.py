from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.pages import FindTextParams, find_text
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _find(path: Path, query: str, **values: object) -> list[int]:
    params = FindTextParams.model_validate({"path": str(path), "query": query, **values})
    return find_text(params, silent_progress()).pages


@pytest.fixture
def text_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    lines = [
        "Invoice total due",
        "The Cat sat down",
        "concatenate strings",
        "",
        "Café ÜBER",
    ]
    for line in lines:
        page = document.new_page(width=595, height=842)
        if line:
            page.insert_text((72, 72), line)
    path = tmp_path / "text.pdf"
    document.save(path)
    document.close()
    return path


def test_finds_pages_ascending(text_pdf: Path) -> None:
    assert _find(text_pdf, "cat") == [2, 3]


def test_match_case_narrows_results(text_pdf: Path) -> None:
    assert _find(text_pdf, "Cat", matchCase=True) == [2]


def test_whole_word_skips_embedded_matches(text_pdf: Path) -> None:
    assert _find(text_pdf, "cat", wholeWord=True) == [2]


def test_unicode_letters_count_as_word_characters(text_pdf: Path) -> None:
    assert _find(text_pdf, "CAFÉ über") == [5]
    assert _find(text_pdf, "caf", wholeWord=True) == []


def test_text_split_across_a_line_break_matches(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 72), "grand total")
    page.insert_text((72, 100), "due today")
    path = tmp_path / "broken.pdf"
    document.save(path)
    document.close()

    assert _find(path, "total   due") == [1]


def test_page_without_text_is_never_reported(text_pdf: Path) -> None:
    assert 4 not in _find(text_pdf, " ".join(["e"]))
    assert _find(text_pdf, "absent phrase") == []


def test_wrong_or_missing_password_is_rejected(encrypted_pdf: Path) -> None:
    for password in (None, "wrong"):
        with pytest.raises(OpError) as raised:
            _find(encrypted_pdf, "Page", password=password)
        assert raised.value.code == ErrorCode.NEEDS_PASSWORD
    assert _find(encrypted_pdf, "Page", password="secret") == [1, 2, 3]


def test_whitespace_only_query_is_rejected(text_pdf: Path) -> None:
    with pytest.raises(OpError) as raised:
        _find(text_pdf, "  \n ")
    assert raised.value.code == ErrorCode.INVALID_PARAMS
    assert raised.value.data == {"reason": "emptyQuery"}
