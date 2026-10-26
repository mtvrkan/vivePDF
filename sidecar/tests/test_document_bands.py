from pathlib import Path

import pymupdf

from vivepdf.ops._document_flow import sectioned
from vivepdf.ops._studio_document_models import (
    StudioDocumentPreviewParams,
    StudioDocumentRenderParams,
)
from vivepdf.ops.studio_document import preview_document, render_document
from vivepdf.rpc.progress import silent_progress

LINE = 16


def _section(columns: int, kind: str = "continuous") -> str:
    return f'<div class="section-break" data-columns="{columns}" data-kind="{kind}"></div>'


def _filler(words: int, word: str = "word") -> str:
    return "<p>" + " ".join(f"{word}{index}" for index in range(words)) + "</p>"


def _render(tmp_path: Path, body: str, **extra) -> pymupdf.Document:
    payload = {"html": body, "output": str(tmp_path / "out.pdf"), "title": "Bands"}
    payload.update(extra)
    result = render_document(StudioDocumentRenderParams.model_validate(payload), silent_progress())
    return pymupdf.open(result.output)


def _words(page: pymupdf.Page, prefix: str) -> list:
    return [
        word
        for word in page.get_text("words")
        if word[4].startswith(prefix) and word[4][len(prefix) :].isdigit()
    ]


def _span(words: list) -> float:
    return max(word[2] for word in words) - min(word[0] for word in words)


def _bottoms(words: list, middle: float) -> tuple[float, float]:
    left = [word[3] for word in words if word[2] < middle]
    right = [word[3] for word in words if word[0] > middle]
    assert left and right
    return max(left), max(right)


def test_a_continuous_break_starts_its_columns_on_the_same_page(tmp_path: Path):
    body = f"{_filler(30, 'intro')}{_section(2)}<p>Columned</p>{_filler(300)}"

    with _render(tmp_path, body) as document:
        page = document[0]
        intro, columned = _words(page, "intro"), _words(page, "word")
        width = page.rect.width
        middle = width / 2
        text = page.get_text()

    assert "Columned" in text
    assert _span(intro) > width * 0.6
    assert min(word[1] for word in columned) > max(word[3] for word in intro)
    assert not [word for word in columned if word[0] < middle < word[2]]
    assert any(word[0] > middle for word in columned)


def test_a_section_above_a_continuous_break_is_balanced(tmp_path: Path):
    body = f"{_section(2)}{_filler(150)}{_section(1)}<p>After</p>{_filler(40, 'tail')}"

    with _render(tmp_path, body) as document:
        count = document.page_count
        page = document[0]
        width = page.rect.width
        middle = width / 2
        columned, tail = _words(page, "word"), _words(page, "tail")
        after = page.search_for("After")[0]

    left, right = _bottoms(columned, middle)
    assert count == 1
    assert abs(left - right) <= LINE * 1.5
    assert after.y0 >= max(left, right)
    assert min(word[1] for word in tail) > max(left, right)
    assert _span(tail) > width * 0.6


def test_one_three_and_one_columns_share_a_page(tmp_path: Path):
    body = (
        f"{_filler(60, 'one')}{_section(3)}{_filler(120, 'three')}"
        f"{_section(1)}{_filler(30, 'wide')}{_section(2)}{_filler(120, 'two')}"
    )

    with _render(tmp_path, body) as document:
        count = document.page_count
        page = document[0]
        one, three = _words(page, "one"), _words(page, "three")
        wide, two = _words(page, "wide"), _words(page, "two")
        width = page.rect.width

    assert count == 1
    assert {int(word[0] // (width / 3)) for word in three} == {0, 1, 2}
    assert _span(one) > width * 0.6
    assert max(word[3] for word in one) < min(word[1] for word in three)
    assert max(word[3] for word in three) < min(word[1] for word in wide)
    assert max(word[3] for word in wide) < min(word[1] for word in two)
    assert _span(wide) > width * 0.6
    left, right = _bottoms(two, width / 2)
    assert left > right + LINE


def test_notes_under_bands_sit_full_width_at_the_page_foot(tmp_path: Path):
    marker = '<sup class="fn-ref" id="fnref-1">1</sup>'
    body = f"{_filler(30, 'intro')}{_section(2)}<p>Columned{marker}</p>{_filler(120)}"
    note = " ".join(f"note{index}" for index in range(40))

    with _render(tmp_path, body, footnotes=[note]) as document:
        count = document.page_count
        page = document[0]
        notes = _words(page, "note")
        body_words = _words(page, "word") + _words(page, "intro")
        width, height = page.rect.width, page.rect.height

    assert count == 1
    assert notes
    assert min(word[1] for word in notes) > max(word[3] for word in body_words)
    assert _span(notes) > width * 0.6
    assert min(word[1] for word in notes) > height * 0.6


def test_a_long_columned_band_flows_on_and_balances_its_last_page(tmp_path: Path):
    body = f"{_section(2)}{_filler(1500)}{_section(1)}<p>Finale</p>"

    with _render(tmp_path, body) as document:
        count = document.page_count
        last = document[count - 1]
        first_bottoms = _bottoms(_words(document[0], "word"), document[0].rect.width / 2)
        last_words = _words(last, "word")
        finale = last.search_for("Finale")
        middle = last.rect.width / 2

    assert count >= 2
    assert abs(first_bottoms[0] - first_bottoms[1]) <= LINE * 1.5
    left, right = _bottoms(last_words, middle)
    assert abs(left - right) <= LINE * 1.5
    assert finale and finale[0].y0 >= max(left, right)


def test_a_page_break_before_a_continuous_break_still_starts_a_page(tmp_path: Path):
    body = f'<p>First</p><div class="page-break"></div>{_section(2)}<p>Second</p>'

    with _render(tmp_path, body) as document:
        pages = [page.get_text() for page in document]

    assert len(pages) == 2
    assert "First" in pages[0] and "Second" not in pages[0]
    assert "Second" in pages[1]


def test_a_page_section_break_still_starts_a_new_page(tmp_path: Path):
    body = f"{_filler(30, 'intro')}{_section(2, 'page')}<p>Columned</p>{_filler(60)}"

    with _render(tmp_path, body) as document:
        pages = [page.get_text() for page in document]

    assert len(pages) == 2
    assert "Columned" in pages[1] and "Columned" not in pages[0]


def test_sectioned_marks_only_continuous_sections_as_flowing():
    body = (
        f"<p>A</p>{_section(2)}<p>B</p>{_section(1, 'page')}<p>C</p>"
        f'{_section(3)}<div class="page-break"></div>{_section(2)}<p>D</p>'
        f"{_section(1, 'odd')}<p>E</p>"
    )

    _, first, columns, flowing = sectioned(body, 1)

    assert first == 1
    assert columns == (2, 1, 2, 1)
    assert flowing == frozenset({0})


def test_sectioned_keeps_a_run_of_empty_continuous_breaks_flowing():
    body = f"<p>A</p>{_section(3)}{_section(2)}<p>B</p>"

    _, _, columns, flowing = sectioned(body, 1)

    assert columns == (2,)
    assert flowing == frozenset({0})


def test_the_preview_counts_the_same_pages_as_the_pdf(tmp_path: Path):
    body = (
        f"{_filler(80, 'intro')}{_section(3)}{_filler(900)}{_section(1)}"
        f"{_filler(200, 'tail')}{_section(2)}{_filler(400, 'two')}"
    )

    preview = preview_document(
        StudioDocumentPreviewParams.model_validate({"html": body}), silent_progress()
    )
    with _render(tmp_path, body) as document:
        count = document.page_count

    assert preview.page_count == count
