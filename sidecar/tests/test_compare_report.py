from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.compare import ADDED_COLOUR, REMOVED_COLOUR, CompareParams, compare
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


def _write(path: Path, lines: list[str], rotation: int = 0) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for row, line in enumerate(lines):
        page.insert_text((72, 100 + row * 30), line, fontsize=14, fontname="dv", fontfile=FONT)
    page.set_rotation(rotation)
    document.save(path)
    document.close()
    return path


@pytest.fixture
def revisions(tmp_path: Path) -> tuple[Path, Path]:
    old = _write(tmp_path / "eski sürüm.pdf", ["Sözleşme bedeli yüz lira", "Teslim tarihi mayıs"])
    new = _write(
        tmp_path / "yeni şğı sürüm.pdf", ["Sözleşme bedeli iki yüz lira", "Teslim tarihi mayıs"]
    )
    return old, new


def _fills(page: pymupdf.Page, colour: tuple[float, float, float]) -> list[pymupdf.Rect]:
    return [
        drawing["rect"]
        for drawing in page.get_drawings()
        if drawing.get("fill")
        and all(abs(a - b) < 0.02 for a, b in zip(drawing["fill"], colour, strict=True))
    ]


def _run(old: Path, new: Path, tmp_path: Path):
    return compare(
        CompareParams(path_a=str(old), path_b=str(new), output=str(tmp_path / "rapor.pdf")),
        silent_progress(),
    )


def test_the_report_opens_with_a_summary(revisions, tmp_path: Path) -> None:
    result = _run(*revisions, tmp_path)
    with pymupdf.open(result.output) as report:
        summary = report[0].get_text()
        assert "eski sürüm.pdf" in summary
        assert "yeni şğı sürüm.pdf" in summary
        assert "A1 ↔ B1" in summary
        assert "+1 / −0" in summary


def test_changed_words_are_marked_on_their_own_side(revisions, tmp_path: Path) -> None:
    result = _run(*revisions, tmp_path)
    with pymupdf.open(result.output) as report:
        page = report[1]
        added = _fills(page, ADDED_COLOUR)
        assert len(added) == 1
        assert added[0].x0 > page.rect.width / 2
        assert not _fills(page, REMOVED_COLOUR)
        hits = page.search_for("iki")
        assert any(hit.intersects(added[0]) for hit in hits)


def test_the_report_keeps_the_pages_as_text_not_pictures(revisions, tmp_path: Path) -> None:
    result = _run(*revisions, tmp_path)
    with pymupdf.open(result.output) as report:
        text = report[1].get_text()
        assert "Teslim tarihi" in text
        assert not report[1].get_images()


def test_a_rotated_page_is_marked_where_the_word_is_seen(tmp_path: Path) -> None:
    old = _write(tmp_path / "a.pdf", ["Birinci satır burada", "İkinci satır"], rotation=90)
    new = _write(tmp_path / "b.pdf", ["Birinci satır burada", "İkinci değişik satır"], rotation=90)
    result = _run(old, new, tmp_path)
    with pymupdf.open(result.output) as report:
        page = report[1]
        added = _fills(page, ADDED_COLOUR)
        assert added
    with pymupdf.open(new) as source:
        seen = source[0].search_for("değişik")[0] * source[0].rotation_matrix
        width = source[0].rect.width
    expected = seen + (width + 24, 30, width + 24, 30)
    assert any(mark.intersects(expected) for mark in added)


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_a_rotated_page_is_embedded_as_text_the_way_it_is_seen(
    tmp_path: Path, rotation: int
) -> None:
    old = _write(tmp_path / "a.pdf", ["Birinci satır burada", "İkinci satır"], rotation=rotation)
    new = _write(
        tmp_path / "b.pdf", ["Birinci satır burada", "İkinci değişik satır"], rotation=rotation
    )
    result = _run(old, new, tmp_path)
    with pymupdf.open(new) as source:
        seen = source[0].search_for("değişik")[0] * source[0].rotation_matrix
        width = source[0].rect.width
        assert source[0].rotation == rotation
    expected = seen + (width + 24, 30, width + 24, 30)
    with pymupdf.open(result.output) as report:
        page = report[1]
        assert not page.get_images()
        hits = [hit for hit in page.search_for("değişik") if hit.x0 > width]
        directions = {
            line["dir"]
            for block in page.get_text("dict")["blocks"]
            for line in block.get("lines", [])
            if any("değişik" in span["text"] for span in line["spans"])
        }
    assert len(hits) == 1
    assert abs(hits[0].x0 - expected.x0) < 3
    assert abs(hits[0].y0 - expected.y0) < 3
    assert directions == {{90: (0.0, 1.0), 180: (-1.0, 0.0), 270: (0.0, -1.0)}[rotation]}


def _sized(path: Path, width: float, height: float, marks: list[pymupdf.Rect]) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=width, height=height)
    page.insert_text((72, 100), "Aynı metin", fontsize=14, fontname="dv", fontfile=FONT)
    for mark in marks:
        page.draw_rect(mark, color=(0, 0, 0), fill=(0, 0, 0))
    document.save(path)
    document.close()
    return path


def test_a_page_size_change_is_reported_as_a_difference(tmp_path: Path) -> None:
    old = _sized(tmp_path / "a4.pdf", 595, 842, [])
    new = _sized(tmp_path / "letter.pdf", 612, 792, [])
    result = _run(old, new, tmp_path)
    assert result.changed_pages == 1
    assert result.pages[0].size_changed
    with pymupdf.open(result.output) as report:
        assert "595×842 pt → 612×792 pt" in report[0].get_text()


def test_content_outside_the_smaller_page_is_compared(tmp_path: Path) -> None:
    old = _sized(tmp_path / "short.pdf", 595, 600, [])
    new = _sized(tmp_path / "tall.pdf", 595, 842, [pymupdf.Rect(100, 700, 400, 800)])
    result = compare(CompareParams(path_a=str(old), path_b=str(new), text=False), silent_progress())
    assert result.pages[0].changed_area > 0.05


def test_same_size_pages_are_not_flagged_as_resized(revisions, tmp_path: Path) -> None:
    result = _run(*revisions, tmp_path)
    assert not result.pages[0].size_changed
