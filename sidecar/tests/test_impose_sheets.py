from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.analyze import ImposeParams, impose
from vivepdf.rpc.progress import silent_progress

RED = (1, 0, 0)
BLUE = (0, 0, 1)


def _impose(source: Path, tmp_path: Path, **options) -> pymupdf.Document:
    target = tmp_path / "sheets.pdf"
    impose(
        ImposeParams(path=str(source), output=str(target), overwrite=True, **options),
        silent_progress(),
    )
    return pymupdf.open(target)


def _save(document: pymupdf.Document, tmp_path: Path, name: str) -> Path:
    path = tmp_path / name
    document.save(path)
    document.close()
    return path


def test_comments_that_never_print_stay_off_the_sheets(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    for index, (label, flags) in enumerate((("printed", 4), ("screenonly", 0), ("noview", 36))):
        note = page.add_freetext_annot(
            pymupdf.Rect(60, 60 + index * 60, 300, 100 + index * 60), label, fontsize=12
        )
        note.set_flags(flags)
        note.update()
    document.new_page()
    source = _save(document, tmp_path, "notes.pdf")

    with _impose(source, tmp_path, layout="2up") as sheets:
        text = sheets[0].get_text()

    assert "printed" in text
    assert "screenonly" not in text and "noview" not in text


def test_automatic_paper_follows_the_most_common_page_size(tmp_path: Path):
    document = pymupdf.open()
    document.new_page(width=420, height=595)
    for _ in range(3):
        document.new_page(width=595, height=842)
    source = _save(document, tmp_path, "cover.pdf")

    with _impose(source, tmp_path, layout="2up") as sheets:
        assert (round(sheets[0].rect.width), round(sheets[0].rect.height)) == (842, 595)


@pytest.mark.parametrize(("paper", "size"), [("a3", (1191, 842)), ("tabloid", (1224, 792))])
def test_large_papers_are_offered(tmp_path: Path, paper: str, size: tuple[int, int]):
    document = pymupdf.open()
    document.new_page()
    source = _save(document, tmp_path, "one.pdf")

    with _impose(source, tmp_path, layout="2up", paper=paper) as sheets:
        assert (round(sheets[0].rect.width), round(sheets[0].rect.height)) == size


def _labelled(tmp_path: Path, count: int) -> Path:
    document = pymupdf.open()
    for index in range(count):
        page = document.new_page(width=300, height=400)
        page.insert_text((140, 200), f"P{index + 1}", fontsize=12)
    return _save(document, tmp_path, "labelled.pdf")


def _label_positions(sheet: pymupdf.Page) -> dict[str, float]:
    return {word[4]: round(word[0], 1) for word in sheet.get_text("words")}


def test_a_spine_allowance_is_ignored_on_grids_without_a_middle(tmp_path: Path):
    source = _labelled(tmp_path, 3)
    with _impose(source, tmp_path, layout="custom", columns=3, rows=1) as plain:
        without = _label_positions(plain[0])
    with _impose(source, tmp_path, layout="custom", columns=3, rows=1, gutter=40) as spined:
        with_gutter = _label_positions(spined[0])

    assert with_gutter == without


def test_blank_booklet_cells_get_no_border(tmp_path: Path):
    source = _labelled(tmp_path, 2)

    with _impose(source, tmp_path, layout="booklet", border=True) as sheets:
        borders = sum(len(sheet.get_drawings()) for sheet in sheets)

    assert borders == 2


def _coloured(tmp_path: Path, width: float, height: float) -> Path:
    document = pymupdf.open()
    for index in range(8):
        page = document.new_page(width=width, height=height)
        page.draw_rect(page.rect, color=None, fill=RED if index % 2 == 0 else BLUE, width=0)
    return _save(document, tmp_path, "coloured.pdf")


def _pixel(sheet: pymupdf.Page, x: float) -> tuple[int, int, int]:
    pixmap = sheet.get_pixmap(dpi=72)
    return pixmap.pixel(int(x), pixmap.height // 2)


@pytest.mark.parametrize(
    ("width", "height", "flip"),
    [(300, 420, False), (300, 420, True), (420, 300, False)],
)
def test_creep_never_pushes_a_page_across_the_spine(
    tmp_path: Path, width: float, height: float, flip: bool
):
    source = _coloured(tmp_path, width, height)

    with _impose(
        source,
        tmp_path,
        layout="booklet",
        margin=0,
        gap=0,
        creep=20,
        flip_short_edge=flip,
    ) as sheets:
        for sheet in (sheets[2], sheets[3]):
            middle = sheet.rect.width / 2
            left = _pixel(sheet, middle / 2)
            right = _pixel(sheet, middle + middle / 2)
            assert left != right
            assert _pixel(sheet, middle - 3) == left
            assert _pixel(sheet, middle + 3) == right
