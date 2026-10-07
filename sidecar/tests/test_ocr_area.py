from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import ocr
from vivepdf.ops._ocr_area import (
    Row,
    Word,
    _reading_dpis,
    consensus_rows,
    visual_rows,
    without_clipped_rows,
)
from vivepdf.ops.ocr import OcrAreaParams, ocr_area
from vivepdf.rpc.progress import silent_progress

CODE_LINES = [
    "for (i in e)",
    "if (r = t.call(e[i], i, e[i]), r === !1) break;",
    "return e",
]


def _word(text: str, x0: float, y0: float, x1: float, y1: float) -> Word:
    return Word(pymupdf.Rect(x0, y0, x1, y1), text)


def _row(text: str, y0: float, y1: float) -> Row:
    return Row([_word(text, 10, y0, 200, y1)])


@pytest.fixture
def dark_code_scan(tmp_path: Path) -> Path:
    source = pymupdf.open()
    page = source.new_page(width=600, height=200)
    page.draw_rect(page.rect, color=None, fill=(0.04, 0.12, 0.28))
    for number, line in enumerate(CODE_LINES):
        page.insert_text(
            (40, 60 + number * 30), line, fontsize=16, fontname="cour", color=(0.9, 0.95, 1)
        )
    picture = page.get_pixmap(dpi=150)
    scanned = pymupdf.open()
    scanned_page = scanned.new_page(width=page.rect.width, height=page.rect.height)
    scanned_page.insert_image(scanned_page.rect, pixmap=picture)
    path = tmp_path / "dark-code.pdf"
    scanned.save(path)
    return path


def test_visual_rows_join_words_tesseract_split_across_lines() -> None:
    words = [
        _word("r === !1)", 300, 50, 380, 62),
        _word("if (r = t.call(e[i],", 40, 50, 200, 62),
        _word("break;", 400, 51, 450, 62),
        _word("return e", 40, 80, 110, 92),
    ]

    rows = visual_rows(words)

    assert [row.text for row in rows] == [
        "if (r = t.call(e[i], r === !1) break;",
        "return e",
    ]


def test_consensus_picks_the_reading_most_readings_agree_with() -> None:
    raw = [_row("if (r = t.call(e[i], i, elil)", 50, 62)]
    inverted = [_row("if (r = t.call(e[i], i, e[i])", 50, 62)]
    sharp = [_row("if (r = t.call(e[i], i, e[i])", 50.5, 62.5)]

    rows = consensus_rows([raw, inverted, sharp])

    assert [row.text for row in rows] == ["if (r = t.call(e[i], i, e[i])"]


def test_consensus_keeps_the_base_reading_when_the_others_disagree_equally() -> None:
    base = [_row("t.call(e[i], i, e[i])", 50, 62)]
    low = [_row("t.call(el[i]l, i, e[i])", 50, 62)]
    high = [_row("t.call(e[i], 1, e[i1])", 50, 62)]

    rows = consensus_rows([base, low, high])

    assert [row.text for row in rows] == ["t.call(e[i], i, e[i])"]


def test_consensus_drops_a_row_only_one_reading_saw() -> None:
    raw = [_row("wie Ki AV SS", 10, 18), _row("return e", 50, 62)]
    inverted = [_row("return e", 50, 62)]
    sharp = [_row("return e", 50, 62)]

    rows = consensus_rows([raw, inverted, sharp])

    assert [row.text for row in rows] == ["return e"]


def test_clipped_edge_row_is_dropped_but_a_lone_row_is_kept() -> None:
    area = pymupdf.Rect(0, 74, 400, 97)
    cut = _row("ur Ça an ey", 73.5, 80.7)
    whole = _row("if (r = t.call(e[i], i, e[i])", 82.1, 91.3)

    assert [row.text for row in without_clipped_rows([cut, whole], area)] == [whole.text]
    assert without_clipped_rows([cut], area) == [cut]


def test_a_small_area_is_read_at_three_resolutions_and_a_large_one_once() -> None:
    line = pymupdf.Rect(150, 80, 450, 94)
    page = pymupdf.Rect(0, 0, 595, 842)

    assert _reading_dpis(line, 300) == [300, 200, 400]
    assert len(_reading_dpis(page, 300)) == 1


def test_ocr_area_reads_a_light_on_dark_code_line_as_one_line(dark_code_scan: Path) -> None:
    result = ocr_area(
        OcrAreaParams(path=str(dark_code_scan), page=0, rect=[30, 70, 560, 96], languages=["eng"]),
        silent_progress(),
    )

    assert result.recognized is True
    assert len(result.lines) == 1
    assert result.lines[0].text.count("e[i]") == 2
    assert result.lines[0].text.endswith("break;")
    assert all(line.y0 >= 70 and line.y1 <= 96 for line in result.lines)


@pytest.mark.parametrize(
    ("languages", "folder"), [(["tur", "eng"], "tessdata-best"), (["eng", "deu"], "tessdata")]
)
def test_ocr_area_uses_best_models_only_when_every_language_has_one(
    dark_code_scan: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    languages: list[str],
    folder: str,
) -> None:
    monkeypatch.setenv("VIVEPDF_TESSDATA_DIR", str(tmp_path / "tessdata"))
    monkeypatch.setattr(ocr, "_language_string", lambda chosen: "+".join(chosen))
    used: list[str] = []
    monkeypatch.setattr(ocr, "read_area", lambda *args: used.append(args[4]) or [])

    ocr_area(
        OcrAreaParams(
            path=str(dark_code_scan), page=0, rect=[30, 70, 560, 96], languages=languages
        ),
        silent_progress(),
    )

    assert used == [str(tmp_path / folder)]
