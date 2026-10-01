from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.textedit import (
    FindPreviewParams,
    FindReplaceParams,
    find_preview,
    find_replace,
    searchable,
)
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)
NO_BREAK_SPACE = chr(0x00A0)
NARROW_NO_BREAK_SPACE = chr(0x202F)


def _document(tmp_path: Path, lines: list[str]) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for index, line in enumerate(lines):
        page.insert_text(
            (60, 100 + index * 40), line, fontsize=12, fontname="dejavu", fontfile=FONT
        )
    path = tmp_path / "spaces.pdf"
    document.save(path)
    document.close()
    return path


def _text(path: Path) -> str:
    document = pymupdf.open(path)
    value = document[0].get_text()
    document.close()
    return value


def test_searchable_maps_unicode_spaces_one_to_one():
    text = f"a{NO_BREAK_SPACE}b{NARROW_NO_BREAK_SPACE}c{chr(0x3000)}d\ne"
    assert searchable(text) == "a b c d\ne"
    assert len(searchable(text)) == len(text)


def test_typed_space_finds_words_joined_by_a_no_break_space(tmp_path: Path):
    source = _document(tmp_path, [f"alpha{NO_BREAK_SPACE}marker 1", "other line"])
    target = tmp_path / "out.pdf"

    preview = find_preview(
        FindPreviewParams(path=str(source), find="alpha marker"), silent_progress()
    )
    result = find_replace(
        FindReplaceParams(
            path=str(source), output=str(target), find="alpha marker", replace="omega marker"
        ),
        silent_progress(),
    )

    assert preview.total == 1
    assert result.replaced == 1
    text = searchable(_text(target))
    assert "omega marker 1" in text
    assert "alpha" not in text
    assert "other line" in text


def test_pasted_no_break_space_in_the_search_matches_a_plain_space(tmp_path: Path):
    source = _document(tmp_path, ["Toplam tutar"])

    preview = find_preview(
        FindPreviewParams(path=str(source), find=f"Toplam{NO_BREAK_SPACE}tutar"),
        silent_progress(),
    )

    assert preview.total == 1


@pytest.mark.parametrize(("whole_word", "expected"), [(False, 2), (True, 1)])
def test_no_break_space_still_separates_whole_words(
    tmp_path: Path, whole_word: bool, expected: int
):
    source = _document(tmp_path, [f"ve{NO_BREAK_SPACE}universite"])

    preview = find_preview(
        FindPreviewParams(path=str(source), find="ve", whole_word=whole_word),
        silent_progress(),
    )

    assert preview.total == expected
