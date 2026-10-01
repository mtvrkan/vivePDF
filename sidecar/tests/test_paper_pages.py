from pathlib import Path

import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops._paper import MM, PaperPattern, paper_marks
from vivepdf.ops.pages import (
    AssemblePage,
    AssembleParams,
    AssembleSource,
    InsertBlankParams,
    assemble,
    insert_blank,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

A4 = (595.0, 842.0)


@pytest.fixture
def source(tmp_path: Path) -> Path:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Ders notu")
    path = tmp_path / "notlar.pdf"
    document.save(path)
    document.close()
    return path


def _assemble(source: Path, pages: list[AssemblePage], tmp_path: Path) -> Path:
    output = tmp_path / "out.pdf"
    assemble(
        AssembleParams(
            sources=[AssembleSource(id="main", path=str(source))],
            pages=pages,
            output=str(output),
        ),
        silent_progress(),
    )
    return output


def test_lined_paper_rules_every_step_with_a_margin_line() -> None:
    marks = paper_marks(*A4, PaperPattern(style="lined", spacing=8, margin=True))
    rules = [line for line in marks.lines if line[4] == "rule"]
    margins = [line for line in marks.lines if line[4] == "margin"]
    assert len(rules) == int((842 - 20 * MM) / (8 * MM))
    assert rules[1][1] - rules[0][1] == pytest.approx(8 * MM)
    assert len(margins) == 1 and margins[0][0] == pytest.approx(30 * MM)


def test_grid_and_dots_share_a_centred_lattice() -> None:
    grid = paper_marks(*A4, PaperPattern(style="grid", spacing=5))
    dots = paper_marks(*A4, PaperPattern(style="dots", spacing=5))
    verticals = [line for line in grid.lines if line[0] == line[2]]
    horizontals = [line for line in grid.lines if line[1] == line[3]]
    assert len(dots.dots) == len(verticals) * len(horizontals)
    left, right = verticals[0][0], verticals[-1][0]
    assert left == pytest.approx(595 - right)
    assert sorted({round(x, 6) for x, _ in dots.dots}) == pytest.approx(
        [line[0] for line in verticals]
    )


def test_isometric_rows_alternate_by_half_a_step() -> None:
    marks = paper_marks(*A4, PaperPattern(style="isometric", spacing=6))
    rows: dict[float, list[float]] = {}
    for x, y in marks.dots:
        rows.setdefault(round(y, 3), []).append(x)
    first, second = (sorted(rows[key]) for key in sorted(rows)[:2])
    assert second[0] - first[0] == pytest.approx(3 * MM)
    assert len(first) == len(second) + 1


def test_handwriting_bands_have_four_lines_with_dashed_middles() -> None:
    marks = paper_marks(*A4, PaperPattern(style="handwriting", spacing=4))
    kinds = [line[4] for line in marks.lines]
    assert len(kinds) % 4 == 0 and kinds[:4] == ["rule", "guide", "guide", "rule"]


def test_music_staff_has_five_lines_per_stave() -> None:
    marks = paper_marks(*A4, PaperPattern(style="staff", spacing=2))
    ys = [line[1] for line in marks.lines]
    assert len(ys) % 5 == 0
    assert ys[5] - ys[4] == pytest.approx(6 * 2 * MM)


def test_a_page_smaller_than_one_step_gets_no_marks() -> None:
    marks = paper_marks(40, 40, PaperPattern(style="grid", spacing=30))
    assert marks.lines == [] and marks.dots == []


def test_assembled_blank_page_is_drawn_as_background_artifact(source: Path, tmp_path: Path):
    paper = PaperPattern(style="grid", spacing=5, color="#336699")
    output = _assemble(
        source,
        [
            AssemblePage(source="main", index=1),
            AssemblePage(kind="blank", width=595, height=842, paper=paper),
            AssemblePage(kind="blank", width=595, height=842),
        ],
        tmp_path,
    )
    with pymupdf.open(output) as document:
        patterned, plain = document[1], document[2]
        drawings = patterned.get_drawings()
        assert drawings and drawings[0]["color"] == pytest.approx((0.2, 0.4, 0.6), abs=0.01)
        assert b"/Artifact" in patterned.read_contents()
        assert not plain.get_drawings()
        assert not patterned.get_text().strip()


def test_rotated_patterned_blank_keeps_its_lines_on_the_page(source: Path, tmp_path: Path):
    paper = PaperPattern(style="lined", spacing=8)
    output = _assemble(
        source,
        [AssemblePage(kind="blank", width=595, height=842, rotate=90, paper=paper)],
        tmp_path,
    )
    with pymupdf.open(output) as document:
        page = document[0]
        assert page.rotation == 90
        assert all(page.mediabox.contains(item["rect"]) for item in page.get_drawings())


def test_insert_blank_draws_the_pattern_on_every_new_page(source: Path, tmp_path: Path):
    output = tmp_path / "inserted.pdf"
    insert_blank(
        InsertBlankParams(
            path=str(source),
            output=str(output),
            at=2,
            count=2,
            paper=PaperPattern(style="dots", spacing=5),
        ),
        silent_progress(),
    )
    with pymupdf.open(output) as document:
        assert document.page_count == 3
        assert document[0].get_text().strip() == "Ders notu"
        assert document[1].get_drawings() and document[2].get_drawings()


def test_a_pattern_too_dense_for_a_huge_page_is_refused(source: Path, tmp_path: Path):
    with pytest.raises(OpError) as error:
        _assemble(
            source,
            [
                AssemblePage(
                    kind="blank",
                    width=14400,
                    height=14400,
                    paper=PaperPattern(style="dots", spacing=2),
                )
            ],
            tmp_path,
        )
    assert error.value.code is ErrorCode.INVALID_PARAMS
    assert error.value.data == {"reason": "paperTooDense"}


def test_bad_paper_values_are_refused() -> None:
    with pytest.raises(ValidationError):
        PaperPattern(style="grid", spacing=1)
    with pytest.raises(ValidationError):
        PaperPattern(style="grid", spacing=5, color="blue")
    with pytest.raises(ValidationError):
        PaperPattern(style="hexagon", spacing=5)  # type: ignore[arg-type]
