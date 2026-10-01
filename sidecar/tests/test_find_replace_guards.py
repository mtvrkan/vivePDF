import re
import threading
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._safe_pattern import MAX_LINE_LENGTH, MatchClock
from vivepdf.ops._text_match import compile_text_pattern
from vivepdf.ops.fonts import TEXTEDIT_FONT, ResolvedFont
from vivepdf.ops.textedit import (
    FindPreviewParams,
    FindReplaceParams,
    TextEdit,
    _hex_to_color,
    find_preview,
    find_replace,
    substituted_font,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import Progress, silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


def _pdf(tmp_path: Path, lines: list[tuple[float, float, str, int]], pages: int = 1) -> Path:
    document = pymupdf.open()
    for _ in range(pages):
        document.new_page(width=595, height=842)
    page = document[pages - 1]
    for x, y, text, mode in lines:
        page.insert_text(
            (x, y), text, fontsize=12, fontname="dejavu", fontfile=FONT, render_mode=mode
        )
    path = tmp_path / "source.pdf"
    document.save(path)
    document.close()
    return path


def _preview(path: Path, find: str, **options) -> list[str]:
    result = find_preview(
        FindPreviewParams(path=str(path), find=find, **options), silent_progress()
    )
    return [hit.text for hit in result.hits]


def _replace(tmp_path: Path, path: Path, find: str, replace: str, **options):
    return find_replace(
        FindReplaceParams(
            path=str(path), output=str(tmp_path / "out.pdf"), find=find, replace=replace, **options
        ),
        silent_progress(),
    )


def test_dotless_and_dotted_i_are_kept_apart(tmp_path: Path):
    source = _pdf(tmp_path, [(60, 100, "sık sik SIK", 0), (60, 140, "İstanbul istanbul", 0)])
    assert _preview(source, "sik") == ["sik", "SIK"]
    assert _preview(source, "sık") == ["sık", "SIK"]
    assert _preview(source, "istanbul") == ["İstanbul", "istanbul"]
    assert _preview(source, "sik", case_sensitive=True) == ["sik"]


def test_whole_word_applies_to_every_alternative(tmp_path: Path):
    source = _pdf(tmp_path, [(60, 100, "category dog cat", 0)])
    assert _preview(source, "cat|dog", regex=True, whole_word=True) == ["dog", "cat"]


def test_hidden_text_is_counted_but_never_replaced(tmp_path: Path):
    source = _pdf(tmp_path, [(60, 100, "gizli metin", 3), (60, 140, "görünen metin", 0)])
    result = find_preview(FindPreviewParams(path=str(source), find="metin"), silent_progress())
    assert (result.total, result.hidden) == (1, 1)
    with pytest.raises(OpError) as refused:
        _replace(tmp_path, source, "gizli", "açık")
    assert refused.value.data == {"reason": "onlyHiddenMatches", "hidden": 1}


def test_ligatures_are_found_by_their_letters(tmp_path: Path):
    source = _pdf(tmp_path, [(60, 100, "the ﬁle is here", 0)])
    assert _preview(source, "file") == ["file"]


def test_a_slow_pattern_is_refused(tmp_path: Path):
    source = _pdf(tmp_path, [(60, 100, "aaaa", 0)])
    with pytest.raises(OpError) as refused:
        _preview(source, "(a+)+$", regex=True)
    assert refused.value.data["reason"] == "patternNested"


def test_a_longer_value_stops_at_the_next_column(tmp_path: Path):
    source = _pdf(tmp_path, [(60, 100, "Ad: Ali", 0), (300, 100, "Tutar: 5", 0)])
    result = _replace(tmp_path, source, "Ali", "Alican Uzunsoyadlıoğlu Mehmetoğulları")
    assert result.replaced == 1
    with pymupdf.open(result.output) as document:
        words = document[0].get_text("words")
    left = [word for word in words if word[0] < 290]
    assert left
    assert max(word[2] for word in left) <= 301
    assert [word[4] for word in words if word[0] >= 290] == ["Tutar:", "5"]


def test_progress_is_reported_on_pages_without_matches(tmp_path: Path):
    source = _pdf(tmp_path, [(60, 100, "son sayfa", 0)], pages=3)
    seen: list[dict] = []
    progress = Progress(
        lambda _value, message, detail: (
            seen.append(detail) if message == "progress.replacing" else None
        ),
        threading.Event(),
    )
    find_replace(
        FindReplaceParams(
            path=str(source), output=str(tmp_path / "o.pdf"), find="son", replace="ilk"
        ),
        progress,
    )
    assert [detail["current"] for detail in seen] == [1, 2, 3]


def test_located_matches_keep_their_place_in_the_whole_text():
    text = "ab\ncab\n" + "x" * (MAX_LINE_LENGTH + 5) + "ab"
    starts = [match.start() for match in MatchClock().located(re.compile("ab"), text)]
    assert starts == [0, 4, len(text) - 2]


def test_shared_text_patterns_refuse_nested_repeats():
    with pytest.raises(OpError) as refused:
        compile_text_pattern("(a+)+")
    assert refused.value.data["reason"] == "patternNested"
    assert compile_text_pattern(r"Fatura (\d+)").search("fatura 12")


def test_a_bad_colour_names_its_reason():
    with pytest.raises(OpError) as refused:
        _hex_to_color("#12")
    assert refused.value.data == {"reason": "badColour"}


def test_only_the_bundled_fallback_counts_as_a_substitution():
    edit = TextEdit(bbox=[0, 0, 10, 10], text="x", size=10, color="#000000", font="Garamond")
    assert substituted_font(edit, ResolvedFont("vivepdf-te", str(TEXTEDIT_FONT), None))
    assert substituted_font(edit, ResolvedFont("vpf12", None, b"", "Garamond")) is None
    unnamed = TextEdit(bbox=[0, 0, 10, 10], text="x", size=10, color="#000000")
    assert substituted_font(unnamed, ResolvedFont("vivepdf-te", str(TEXTEDIT_FONT), None)) is None


def test_errors_name_a_reason_the_ui_can_explain(tmp_path: Path):
    source = _pdf(tmp_path, [(72, 100, "Fatura", 0)])
    with pytest.raises(OpError) as same:
        find_replace(
            FindReplaceParams(path=str(source), output=str(source), find="Fatura", replace="F"),
            silent_progress(),
        )
    assert same.value.data["reason"] == "sameAsInput"
    with pytest.raises(OpError) as broken:
        compile_text_pattern("(")
    assert broken.value.data["reason"] == "badPattern"
    with pytest.raises(OpError) as preview:
        find_preview(FindPreviewParams(path=str(source), find="[a", regex=True), silent_progress())
    assert preview.value.data["reason"] == "badPattern"
