from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.pages import EditPagesParams, PageTurn, edit_pages
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _texts(path: Path) -> list[str]:
    with pymupdf.open(path) as document:
        return [page.get_text().strip() for page in document]


def _rotations(path: Path) -> list[int]:
    with pymupdf.open(path) as document:
        return [page.rotation for page in document]


def _edit(path: Path, **values: object) -> EditPagesParams:
    return EditPagesParams.model_validate({"path": str(path), **values})


@pytest.fixture
def rich_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for index in range(4):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 72), f"Page {index + 1}")
    document[1].set_rotation(90)
    document[2].add_text_annot((100, 100), "keep me")
    document.set_toc([[1, "One", 1], [1, "Three", 3], [1, "Four", 4]])
    path = tmp_path / "rich.pdf"
    document.save(path)
    document.close()
    return path


def test_rotates_and_deletes_in_place(rich_pdf: Path) -> None:
    result = edit_pages(
        _edit(rich_pdf, inPlace=True, delete=[0], rotations=[{"page": 1, "rotate": 90}]),
        silent_progress(),
    )
    assert result.output == str(rich_pdf)
    assert result.page_count == 3
    assert _texts(rich_pdf) == ["Page 2", "Page 3", "Page 4"]
    assert _rotations(rich_pdf) == [180, 0, 0]


def test_outline_and_annotations_survive(rich_pdf: Path) -> None:
    edit_pages(_edit(rich_pdf, inPlace=True, delete=[1]), silent_progress())
    with pymupdf.open(rich_pdf) as document:
        assert document.get_toc(simple=True) == [[1, "One", 1], [1, "Three", 2], [1, "Four", 3]]
        assert [annot.info["content"] for annot in document[1].annots()] == ["keep me"]


def test_rotation_only_keeps_every_page_and_writes_an_output(
    rich_pdf: Path, tmp_path: Path
) -> None:
    output = tmp_path / "turned.pdf"
    result = edit_pages(
        _edit(
            rich_pdf,
            output=str(output),
            rotations=[{"page": 1, "rotate": 270}, {"page": 3, "rotate": 90}],
        ),
        silent_progress(),
    )
    assert result.page_count == 4
    assert _rotations(output) == [0, 0, 0, 90]
    assert _rotations(rich_pdf) == [0, 90, 0, 0]


def test_rotations_that_cancel_out_count_as_nothing(rich_pdf: Path) -> None:
    turns = [PageTurn(page=0, rotate=90), PageTurn(page=0, rotate=270)]
    with pytest.raises(OpError) as caught:
        edit_pages(
            EditPagesParams(path=str(rich_pdf), in_place=True, rotations=turns), silent_progress()
        )
    assert caught.value.data == {"reason": "noPagesSelected"}


def test_deleting_every_page_is_refused(rich_pdf: Path) -> None:
    with pytest.raises(OpError) as caught:
        edit_pages(_edit(rich_pdf, inPlace=True, delete=[0, 1, 2, 3]), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "allPagesDeleted"}
    assert _texts(rich_pdf) == ["Page 1", "Page 2", "Page 3", "Page 4"]


def test_page_out_of_range_is_refused(rich_pdf: Path) -> None:
    with pytest.raises(OpError) as caught:
        edit_pages(_edit(rich_pdf, inPlace=True, delete=[4]), silent_progress())
    assert caught.value.data == {"reason": "pageOutOfRange", "page": 5, "pageCount": 4}


@pytest.mark.parametrize(
    ("destination", "reason"),
    [({}, "outputRequired"), ({"inPlace": True, "output": "x.pdf"}, "outputAndInPlace")],
)
def test_destination_must_be_one_of_output_or_in_place(
    rich_pdf: Path, destination: dict[str, object], reason: str
) -> None:
    with pytest.raises(OpError) as caught:
        edit_pages(_edit(rich_pdf, delete=[0], **destination), silent_progress())
    assert caught.value.data == {"reason": reason}


def test_encrypted_document_stays_protected(encrypted_pdf: Path) -> None:
    edit_pages(_edit(encrypted_pdf, password="secret", inPlace=True, delete=[2]), silent_progress())
    with pymupdf.open(encrypted_pdf) as document:
        assert document.needs_pass
        assert document.authenticate("secret")
        assert document.page_count == 2
