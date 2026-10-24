import re
import zipfile
from pathlib import Path

import pymupdf
import pytest
from docx.oxml.ns import qn
from lxml import etree

from vivepdf.ops._docx_lines import needs_space_between
from vivepdf.ops.convert import DocxParams, to_docx
from vivepdf.rpc.progress import silent_progress

TWIPS_PER_PT = 20


def _convert(source: Path, tmp_path: Path) -> Path:
    target = tmp_path / "out.docx"
    to_docx(DocxParams(path=str(source), output=str(target)), silent_progress())
    return target


def _body(target: Path):
    with zipfile.ZipFile(target) as archive:
        return etree.fromstring(archive.read("word/document.xml"))


def _paragraph_texts(target: Path) -> list[str]:
    texts = []
    for paragraph in _body(target).iter(qn("w:p")):
        parts = []
        for node in paragraph.iter(qn("w:t"), qn("w:br")):
            parts.append("\n" if node.tag == qn("w:br") else node.text or "")
        texts.append("".join(parts))
    return texts


def _save(document: pymupdf.Document, path: Path) -> Path:
    document.save(path)
    document.close()
    return path


def test_spaces_drawn_as_their_own_pieces_stay_between_the_words(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    x = 60.0
    for word in ["Quick", "technical", "progress", "helps", "people"]:
        page.insert_text((x, 100), word, fontsize=12)
        x += pymupdf.get_text_length(word, "helv", 12)
        page.insert_text((x, 100), " ", fontsize=12, color=(0, 0, 1))
        x += pymupdf.get_text_length(" ", "helv", 12) * 2
    for line in range(6):
        page.insert_text((60, 160 + line * 18), f"Body line number {line}", fontsize=11)
    source = _save(document, tmp_path / "spaced.pdf")

    texts = _paragraph_texts(_convert(source, tmp_path))

    assert any("Quick technical progress helps people" in text for text in texts)


def test_a_slightly_tilted_line_is_kept(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    for line in range(6):
        page.insert_text((60, 100 + line * 18), f"Body line number {line}", fontsize=11)
    pivot = pymupdf.Point(60, 300)
    page.insert_text(
        pivot, "Approved by Nesibe", fontsize=14, morph=(pivot, pymupdf.Matrix(1).prerotate(0.5))
    )
    source = _save(document, tmp_path / "tilted.pdf")

    texts = _paragraph_texts(_convert(source, tmp_path))

    assert any("Approved by Nesibe" in text for text in texts)


@pytest.mark.parametrize(
    ("before", "after", "expected"),
    [
        ("veya iş", "uygulamalarında", True),
        ("veya iş ", "uygulamalarında", False),
        ("Ar-", "Ge", False),
        ("東京", "大阪", False),
        ("", "word", False),
    ],
)
def test_wrapped_lines_get_a_space_only_where_words_would_touch(before, after, expected):
    assert needs_space_between(before, after) is expected


def test_a_bullet_after_a_long_line_starts_its_own_line(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    items = [
        "• Replacing an outdated or harmful thing with a newer one is renewal",
        "• Creative solutions found for needs count as innovation too",
        "• Being new",
    ]
    for index, item in enumerate(items):
        page.insert_text((60, 100 + index * 18), item, fontsize=12)
    source = _save(document, tmp_path / "bullets.pdf")

    text = "\n".join(_paragraph_texts(_convert(source, tmp_path)))

    assert re.search(r"renewal\s*\n\s*\S\s*Creative", text)
    assert re.search(r"too\s*\n\s*\S\s*Being", text)


def test_table_columns_are_as_wide_as_their_cells(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    columns = [60, 300, 380, 520]
    for row in range(4):
        top = 100 + row * 24
        for left, right in zip(columns, columns[1:], strict=False):
            page.draw_rect(pymupdf.Rect(left, top, right, top + 24), color=(0, 0, 0), width=1)
            page.insert_text((left + 4, top + 16), f"Cell {row}", fontsize=10)
    source = _save(document, tmp_path / "table.pdf")

    body = _body(_convert(source, tmp_path))
    table = next(body.iter(qn("w:tbl")))
    grid = [int(float(col.get(qn("w:w")))) for col in table.iter(qn("w:gridCol"))]
    first_row = next(table.iter(qn("w:tr")))
    cells = [int(float(width.get(qn("w:w")))) for width in first_row.iter(qn("w:tcW"))]

    assert len(grid) == 3
    assert all(abs(column - cell) <= TWIPS_PER_PT for column, cell in zip(grid, cells, strict=True))
