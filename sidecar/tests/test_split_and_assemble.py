from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.merge_split import SplitParams, split
from vivepdf.ops.pages import (
    AssemblePage,
    AssembleParams,
    AssembleSource,
    assemble,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture
def outlined(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for number in range(9):
        page = document.new_page(width=595, height=842)
        page.insert_text(
            (72, 120), f"Sayfa {number + 1}", fontsize=14, fontname="dejavu", fontfile=FONT
        )
    document.set_toc(
        [[1, "Giris", 1], [2, "Alt bolum", 2], [1, "Gelisme / ilk", 4], [1, "Sonuc", 8]]
    )
    path = tmp_path / "outlined.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def plain(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for number in range(6):
        page = document.new_page(width=420, height=595)
        page.insert_text(
            (60, 100), f"Sayfa {number + 1}", fontsize=14, fontname="dejavu", fontfile=FONT
        )
    path = tmp_path / "plain.pdf"
    document.save(path)
    document.close()
    return path


def test_a_part_is_named_after_the_bookmark_it_starts_at(outlined: Path, tmp_path: Path):
    folder = tmp_path / "parts"
    result = split(
        SplitParams(path=str(outlined), output_dir=str(folder), mode="bookmarks"),
        silent_progress(),
    )
    names = [Path(part.output).name for part in result.outputs]
    assert names == ["outlined-1-Giris.pdf", "outlined-2-Gelisme-ilk.pdf", "outlined-3-Sonuc.pdf"]


def test_a_second_level_bookmark_does_not_start_a_part(outlined: Path, tmp_path: Path):
    folder = tmp_path / "parts"
    result = split(
        SplitParams(path=str(outlined), output_dir=str(folder), mode="bookmarks"),
        silent_progress(),
    )
    assert [part.page_count for part in result.outputs] == [3, 4, 2]


def test_the_other_modes_still_name_parts_after_their_pages(plain: Path, tmp_path: Path):
    folder = tmp_path / "parts"
    result = split(
        SplitParams(path=str(plain), output_dir=str(folder), mode="every", every=2),
        silent_progress(),
    )
    assert [Path(part.output).name for part in result.outputs] == [
        "plain-1-p1-2.pdf",
        "plain-2-p3-4.pdf",
        "plain-3-p5-6.pdf",
    ]


def test_splitting_by_bookmarks_is_refused_when_there_are_none(plain: Path, tmp_path: Path):
    with pytest.raises(OpError):
        split(
            SplitParams(path=str(plain), output_dir=str(tmp_path / "parts"), mode="bookmarks"),
            silent_progress(),
        )


def test_a_blank_page_takes_the_size_of_the_page_before_it(plain: Path, tmp_path: Path):
    target = tmp_path / "out.pdf"
    assemble(
        AssembleParams(
            sources=[AssembleSource(id="a", path=str(plain))],
            pages=[
                AssemblePage(source="a", index=1),
                AssemblePage(kind="blank"),
                AssemblePage(source="a", index=2),
            ],
            output=str(target),
        ),
        silent_progress(),
    )
    document = pymupdf.open(target)
    assert document.page_count == 3
    assert round(document[1].rect.width) == 420
    assert round(document[1].rect.height) == 595
    document.close()


def test_a_blank_page_before_any_other_takes_the_size_of_the_first_one(plain: Path, tmp_path: Path):
    target = tmp_path / "out.pdf"
    assemble(
        AssembleParams(
            sources=[AssembleSource(id="a", path=str(plain))],
            pages=[AssemblePage(kind="blank"), AssemblePage(source="a", index=1)],
            output=str(target),
        ),
        silent_progress(),
    )
    document = pymupdf.open(target)
    assert round(document[0].rect.width) == 420
    document.close()


def test_a_blank_page_still_takes_a_size_it_is_given(plain: Path, tmp_path: Path):
    target = tmp_path / "out.pdf"
    assemble(
        AssembleParams(
            sources=[AssembleSource(id="a", path=str(plain))],
            pages=[
                AssemblePage(source="a", index=1),
                AssemblePage(kind="blank", width=200, height=300),
            ],
            output=str(target),
        ),
        silent_progress(),
    )
    document = pymupdf.open(target)
    assert round(document[1].rect.width) == 200
    document.close()
