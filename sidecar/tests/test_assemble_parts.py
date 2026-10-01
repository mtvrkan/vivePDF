import threading
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.pages import (
    AssemblePage,
    AssembleParams,
    AssemblePartsParams,
    AssembleSource,
    PageLabelRule,
    assemble,
    assemble_parts,
    explicit_label_parts,
    part_bounds,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress


@pytest.fixture
def weeks(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for index in range(16):
        document.new_page().insert_text((72, 72), f"Sayfa {index + 1}")
    document.set_toc([[1, "Hafta 1", 1], [1, "Hafta 2", 3], [1, "Hafta 8", 15]])
    path = tmp_path / "ders.pdf"
    document.save(path)
    document.close()
    return path


def _pages(numbers: list[int]) -> list[AssemblePage]:
    return [AssemblePage(source="main", index=number) for number in numbers]


def _params(
    source: Path, pages: list[AssemblePage], cuts: list[int], **extra
) -> AssemblePartsParams:
    return AssemblePartsParams(
        sources=[AssembleSource(id="main", path=str(source))],
        pages=pages,
        cuts=cuts,
        outputDir=str(source.parent / "parts"),
        baseName="ders",
        **extra,
    )


def _texts(path: str) -> list[str]:
    with pymupdf.open(path) as document:
        return [page.get_text().strip() for page in document]


def test_eight_weeks_become_eight_files_in_one_run(weeks: Path) -> None:
    result = assemble_parts(
        _params(weeks, _pages(list(range(1, 17))), [2, 4, 6, 8, 10, 12, 14]), silent_progress()
    )
    assert len(result.outputs) == 8
    assert [Path(part.output).name for part in result.outputs][:2] == [
        "ders-1-p1-2.pdf",
        "ders-2-p3-4.pdf",
    ]
    assert [(part.first_page, part.last_page, part.page_count) for part in result.outputs][-1] == (
        15,
        16,
        2,
    )
    assert _texts(result.outputs[7].output) == ["Sayfa 15", "Sayfa 16"]
    with pymupdf.open(result.outputs[1].output) as second:
        assert second.get_toc() == [[1, "Hafta 2", 1]]


def test_parts_follow_the_arranged_order_with_blanks_and_rotation(weeks: Path) -> None:
    pages = [
        AssemblePage(source="main", index=3, rotate=90),
        AssemblePage(kind="blank"),
        AssemblePage(source="main", index=1),
        AssemblePage(source="main", index=2),
    ]
    result = assemble_parts(_params(weeks, pages, [2]), silent_progress())
    first, second = (part.output for part in result.outputs)
    with pymupdf.open(first) as document:
        assert document[0].rotation == 90
        assert document[1].get_text().strip() == ""
        assert document[1].rect == document[0].rect
    assert _texts(second) == ["Sayfa 1", "Sayfa 2"]


def test_part_bounds_collapse_repeated_cuts_and_refuse_edges() -> None:
    assert part_bounds(5, [3, 1, 3]) == [(0, 1), (1, 3), (3, 5)]
    for cut in (0, 5):
        with pytest.raises(OpError) as error:
            part_bounds(5, [cut])
        assert error.value.code is ErrorCode.INVALID_PARAMS


def test_an_existing_part_is_not_overwritten_unasked(weeks: Path) -> None:
    folder = weeks.parent / "parts"
    folder.mkdir()
    (folder / "ders-2-p3-4.pdf").write_bytes(b"old")
    with pytest.raises(OpError) as error:
        assemble_parts(_params(weeks, _pages([1, 2, 3, 4]), [2]), silent_progress())
    assert error.value.data and error.value.data.get("exists") is True
    assert not (folder / "ders-1-p1-2.pdf").exists()
    assert (folder / "ders-2-p3-4.pdf").read_bytes() == b"old"
    result = assemble_parts(
        _params(weeks, _pages([1, 2, 3, 4]), [2], overwrite=True), silent_progress()
    )
    assert _texts(result.outputs[1].output) == ["Sayfa 3", "Sayfa 4"]


def test_cancel_after_the_first_part_removes_what_was_written(weeks: Path) -> None:
    event = threading.Event()

    def sink(_value, _message, detail) -> None:
        if detail and detail.get("current") == 2:
            event.set()

    with pytest.raises(OpError) as error:
        assemble_parts(_params(weeks, _pages([1, 2, 3, 4]), [2]), Progress(sink, event))
    assert error.value.code is ErrorCode.CANCELLED
    assert list((weeks.parent / "parts").glob("*.pdf")) == []


def test_single_file_assembly_is_unchanged(weeks: Path, tmp_path: Path) -> None:
    target = tmp_path / "out.pdf"
    result = assemble(
        AssembleParams(
            sources=[AssembleSource(id="main", path=str(weeks))],
            pages=[*_pages([4, 3]), AssemblePage(kind="blank")],
            output=str(target),
        ),
        silent_progress(),
    )
    assert result.page_count == 3
    assert _texts(str(target)) == ["Sayfa 4", "Sayfa 3", ""]


def test_cancel_with_overwrite_keeps_the_parts_that_were_there(weeks: Path) -> None:
    folder = weeks.parent / "parts"
    folder.mkdir()
    (folder / "ders-1-p1-2.pdf").write_bytes(b"old one")
    (folder / "ders-2-p3-4.pdf").write_bytes(b"old two")
    event = threading.Event()

    def sink(_value, _message, detail) -> None:
        if detail and detail.get("current") == 2:
            event.set()

    with pytest.raises(OpError) as error:
        assemble_parts(
            _params(weeks, _pages([1, 2, 3, 4]), [2], overwrite=True), Progress(sink, event)
        )
    assert error.value.code is ErrorCode.CANCELLED
    assert (folder / "ders-1-p1-2.pdf").read_bytes() == b"old one"
    assert (folder / "ders-2-p3-4.pdf").read_bytes() == b"old two"
    assert sorted(path.name for path in folder.iterdir()) == ["ders-1-p1-2.pdf", "ders-2-p3-4.pdf"]


def test_duplicate_source_ids_are_refused(weeks: Path) -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        AssembleParams(
            sources=[
                AssembleSource(id="main", path=str(weeks)),
                AssembleSource(id="main", path=str(weeks)),
            ],
            pages=_pages([1]),
            output=str(weeks.parent / "out.pdf"),
        )


def test_an_absurd_blank_page_size_is_refused() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        AssemblePage(kind="blank", width=1e9, height=842)
    with pytest.raises(ValidationError):
        AssemblePage(kind="blank", width=float("inf"), height=842)


def test_an_image_past_the_pixel_cap_is_refused(weeks: Path, tmp_path: Path) -> None:
    from PIL import Image

    huge = tmp_path / "huge.png"
    Image.new("1", (12000, 9000)).save(huge)
    with pytest.raises(OpError) as error:
        assemble(
            AssembleParams(
                sources=[AssembleSource(id="main", path=str(weeks))],
                pages=[AssemblePage(kind="image", path=str(huge), width=595, height=842)],
                output=str(tmp_path / "out.pdf"),
            ),
            silent_progress(),
        )
    assert error.value.code is ErrorCode.INVALID_PARAMS
    assert error.value.data and error.value.data.get("reason") == "pictureTooLarge"
    assert not (tmp_path / "out.pdf").exists()


def test_a_file_that_is_not_an_image_is_refused(weeks: Path, tmp_path: Path) -> None:
    fake = tmp_path / "notes.png"
    fake.write_text("not an image")
    with pytest.raises(OpError) as error:
        assemble(
            AssembleParams(
                sources=[AssembleSource(id="main", path=str(weeks))],
                pages=[AssemblePage(kind="image", path=str(fake))],
                output=str(tmp_path / "out.pdf"),
            ),
            silent_progress(),
        )
    assert error.value.code is ErrorCode.INVALID_PARAMS
    assert error.value.data and error.value.data.get("reason") == "imageUnreadable"


def _labels(path: str) -> list[str]:
    with pymupdf.open(path) as document:
        return [page.get_label() for page in document]


def test_page_labels_give_a_cover_roman_front_matter_and_arabic_body(weeks: Path) -> None:
    output = weeks.parent / "labelled.pdf"
    assemble(
        AssembleParams(
            sources=[AssembleSource(id="main", path=str(weeks))],
            pages=_pages([1, 2, 3, 4, 5, 6]),
            output=str(output),
            labels=[
                PageLabelRule(start=0, style="", prefix="Kapak"),
                PageLabelRule(start=1, style="r"),
                PageLabelRule(start=3, style="D"),
            ],
        ),
        silent_progress(),
    )
    assert _labels(str(output)) == ["Kapak", "i", "ii", "1", "2", "3"]


def test_page_labels_carry_on_across_split_parts(weeks: Path) -> None:
    result = assemble_parts(
        _params(
            weeks,
            _pages([1, 2, 3, 4]),
            [2],
            labels=[PageLabelRule(start=0, style="r"), PageLabelRule(start=1, style="D")],
        ),
        silent_progress(),
    )
    assert [_labels(part.output) for part in result.outputs] == [["i", "1"], ["2", "3"]]


def test_an_empty_label_list_drops_the_labels_of_the_source(tmp_path: Path) -> None:
    source = tmp_path / "roman.pdf"
    with pymupdf.open() as document:
        for _ in range(2):
            document.new_page()
        document.set_page_labels([{"startpage": 0, "style": "r", "prefix": "", "firstpagenum": 1}])
        document.save(source)
    output = tmp_path / "plain.pdf"
    assemble(
        AssembleParams(
            sources=[AssembleSource(id="main", path=str(source))],
            pages=_pages([1, 2]),
            output=str(output),
            labels=[],
        ),
        silent_progress(),
    )
    assert _labels(str(output)) == ["", ""]


def test_a_page_label_past_the_last_page_is_refused(weeks: Path) -> None:
    with pytest.raises(OpError) as caught:
        assemble(
            AssembleParams(
                sources=[AssembleSource(id="main", path=str(weeks))],
                pages=_pages([1, 2]),
                output=str(weeks.parent / "out.pdf"),
                labels=[PageLabelRule(start=5)],
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_two_page_labels_on_one_page_are_refused() -> None:
    with pytest.raises(OpError):
        explicit_label_parts([PageLabelRule(start=1), PageLabelRule(start=1, style="r")], 3)
