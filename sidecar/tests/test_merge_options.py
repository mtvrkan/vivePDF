import itertools
import threading
from pathlib import Path

import pikepdf
import pymupdf
import pytest
from PIL import Image

from vivepdf.ops.merge_split import MergeInput, MergeParams, merge
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress


def _book(path: Path, pages: int, toc: list[list] | None = None, labels: bool = False) -> Path:
    document = pymupdf.open()
    for index in range(pages):
        document.new_page().insert_text((72, 72), f"{path.stem} page {index + 1}")
    if toc:
        document.set_toc(toc)
    if labels:
        document.set_page_labels(
            [{"startpage": 0, "prefix": "A-", "style": "D", "firstpagenum": 1}]
        )
    document.save(path)
    document.close()
    return path


def _merge(tmp_path: Path, paths: list[Path], **options) -> tuple[Path, int]:
    output = tmp_path / "merged.pdf"
    result = merge(
        MergeParams(
            inputs=[MergeInput(path=str(path)) for path in paths],
            output=str(output),
            overwrite=True,
            **options,
        ),
        silent_progress(),
    )
    return output, result.renamed_fields


@pytest.fixture
def books(tmp_path: Path) -> list[Path]:
    return [
        _book(tmp_path / "alpha.pdf", 2, [[1, "Intro", 1], [2, "Detail", 2]]),
        _book(tmp_path / "beta.pdf", 3, [[1, "Start", 2]]),
    ]


@pytest.mark.parametrize(
    ("style", "expected"),
    [
        (
            "nested",
            [[1, "alpha", 1], [2, "Intro", 1], [3, "Detail", 2], [1, "beta", 3], [2, "Start", 4]],
        ),
        ("files", [[1, "alpha", 1], [1, "beta", 3]]),
        ("originals", [[1, "Intro", 1], [2, "Detail", 2], [1, "Start", 4]]),
        ("none", []),
    ],
)
def test_merge_bookmark_styles(tmp_path: Path, books: list[Path], style, expected) -> None:
    output, _ = _merge(tmp_path, books, bookmarks=style)
    with pymupdf.open(output) as document:
        assert document.get_toc(simple=True) == expected


def test_old_bookmark_switch_still_decides_when_no_style_is_given(
    tmp_path: Path, books: list[Path]
) -> None:
    output, _ = _merge(tmp_path, books, add_bookmarks=False)
    with pymupdf.open(output) as document:
        assert document.get_toc(simple=True) == []


def test_contents_page_lists_each_file_with_a_link_to_its_first_page(
    tmp_path: Path, books: list[Path]
) -> None:
    output, _ = _merge(tmp_path, books, contents_page=True, contents_title="İçindekiler")
    with pymupdf.open(output) as document:
        assert document.page_count == 6
        text = document[0].get_text()
        assert "İçindekiler" in text and "alpha" in text and "beta" in text
        assert [link["page"] for link in document[0].get_links()] == [1, 3]
        assert document[1].get_text().startswith("alpha page 1")
        assert document.get_toc(simple=True)[:2] == [[1, "İçindekiler", 1], [1, "alpha", 2]]


def test_contents_page_shows_page_labels_and_gets_a_roman_label(tmp_path: Path) -> None:
    labelled = _book(tmp_path / "labelled.pdf", 2, labels=True)
    plain = _book(tmp_path / "plain.pdf", 1)
    output, _ = _merge(tmp_path, [labelled, plain], contents_page=True)
    with pymupdf.open(output) as document:
        assert document[0].get_label() == "i"
        assert document[1].get_label() == "A-1"
        assert "A-1" in document[0].get_text()


def test_contents_page_flows_onto_more_pages_for_many_files(tmp_path: Path) -> None:
    single = _book(tmp_path / "one.pdf", 1)
    output, _ = _merge(tmp_path, [single] * 40, contents_page=True, bookmarks="none")
    with pymupdf.open(output) as document:
        assert document.page_count == 42
        links = [link["page"] for page in document.pages(0, 2) for link in page.get_links()]
        assert links == list(range(2, 42))


def _form(path: Path, value: str, choice: str) -> Path:
    pdf = pikepdf.new()
    pdf.add_blank_page(page_size=(612, 792))
    page = pdf.pages[0]
    blank = pdf.make_stream(b"")
    radio = pdf.make_indirect(
        pikepdf.Dictionary(
            FT=pikepdf.Name.Btn,
            Ff=49152,
            T=pikepdf.String("answer"),
            V=pikepdf.Name("/" + choice),
            Kids=pikepdf.Array(),
        )
    )
    widgets = []
    for index, state in enumerate(["yes", "no"]):
        widget = pdf.make_indirect(
            pikepdf.Dictionary(
                Type=pikepdf.Name.Annot,
                Subtype=pikepdf.Name.Widget,
                Rect=[72 + 40 * index, 140, 90 + 40 * index, 158],
                Parent=radio,
                AS=pikepdf.Name("/" + (state if state == choice else "Off")),
                AP=pikepdf.Dictionary(N=pikepdf.Dictionary({"/" + state: blank, "/Off": blank})),
                P=page.obj,
            )
        )
        radio.Kids.append(widget)
        widgets.append(widget)
    person = pdf.make_indirect(pikepdf.Dictionary(T=pikepdf.String("person"), Kids=pikepdf.Array()))
    name = pdf.make_indirect(
        pikepdf.Dictionary(
            Type=pikepdf.Name.Annot,
            Subtype=pikepdf.Name.Widget,
            FT=pikepdf.Name.Tx,
            T=pikepdf.String("name"),
            V=pikepdf.String(value),
            Rect=[72, 72, 272, 100],
            Parent=person,
            P=page.obj,
        )
    )
    person.Kids.append(name)
    widgets.append(name)
    page.obj.Annots = pdf.make_indirect(pikepdf.Array(widgets))
    pdf.Root.AcroForm = pdf.make_indirect(
        pikepdf.Dictionary(Fields=pikepdf.Array([radio, person]), NeedAppearances=True)
    )
    pdf.save(path)
    return path


def _fields(path: Path) -> list[tuple[int, str, str]]:
    with pymupdf.open(path) as document:
        return [
            (page.number, widget.field_name, widget.field_value)
            for page in document
            for widget in page.widgets()
        ]


def test_same_named_form_fields_stay_separate_with_readable_names(tmp_path: Path) -> None:
    first = _form(tmp_path / "first.pdf", "Alice", "yes")
    second = _form(tmp_path / "second.pdf", "Bob", "no")
    output, renamed = _merge(tmp_path, [first, second, first])
    assert renamed == 4
    assert _fields(output) == [
        (0, "answer", "yes"),
        (0, "answer", "Off"),
        (0, "person.name", "Alice"),
        (1, "answer_2", "Off"),
        (1, "answer_2", "no"),
        (1, "person_2.name", "Bob"),
        (2, "answer_3", "yes"),
        (2, "answer_3", "Off"),
        (2, "person_3.name", "Alice"),
    ]


def test_a_merge_without_clashing_fields_renames_nothing(tmp_path: Path) -> None:
    form = _form(tmp_path / "only.pdf", "Alice", "yes")
    plain = _book(tmp_path / "plain.pdf", 1)
    output, renamed = _merge(tmp_path, [form, plain])
    assert renamed == 0
    assert [name for _, name, _ in _fields(output)] == ["answer", "answer", "person.name"]


def _recorder() -> tuple[Progress, list[float]]:
    values: list[float] = []
    return Progress(lambda value, _m, _d: values.append(value), threading.Event()), values


def test_converting_an_image_input_keeps_the_progress_bar_moving_forward(
    tmp_path: Path, books: list[Path]
) -> None:
    photo = tmp_path / "photo.png"
    Image.new("RGB", (400, 300), (200, 40, 40)).save(photo)
    progress, values = _recorder()
    merge(
        MergeParams(
            inputs=[MergeInput(path=str(path)) for path in [books[0], photo, books[1]]],
            output=str(tmp_path / "mixed.pdf"),
        ),
        progress,
    )
    assert all(later >= earlier - 1e-9 for earlier, later in itertools.pairwise(values))
    assert all(0.0 <= value <= 1.0 for value in values)


def test_scoped_progress_maps_into_its_share_and_clamps() -> None:
    progress, values = _recorder()
    share = progress.within(0.2, 0.4)
    for value in (0.0, 0.5, 1.0, 1.5, -1.0):
        share.report(value)
    assert values == pytest.approx([0.2, 0.3, 0.4, 0.4, 0.2])


def test_scoped_progress_shares_the_cancel_flag() -> None:
    cancel = threading.Event()
    share = Progress(lambda *_: None, cancel).within(0.0, 0.5)
    cancel.set()
    with pytest.raises(OpError) as error:
        share.check_cancelled()
    assert error.value.code == ErrorCode.CANCELLED


def test_a_form_page_picked_twice_keeps_its_fields_in_both_copies(tmp_path: Path) -> None:
    form = _form(tmp_path / "form.pdf", "Alice", "yes")
    output = tmp_path / "twice.pdf"
    result = merge(
        MergeParams(
            inputs=[MergeInput(path=str(form), ranges="1, 1")],
            output=str(output),
        ),
        silent_progress(),
    )
    assert result.renamed_fields == 2
    assert _fields(output) == [
        (0, "answer", "yes"),
        (0, "answer", "Off"),
        (0, "person.name", "Alice"),
        (1, "answer_2", "yes"),
        (1, "answer_2", "Off"),
        (1, "person_2.name", "Alice"),
    ]


def test_a_form_in_reverse_order_keeps_every_field_once(tmp_path: Path) -> None:
    form = _form(tmp_path / "form.pdf", "Alice", "yes")
    output = tmp_path / "reversed.pdf"
    result = merge(
        MergeParams(inputs=[MergeInput(path=str(form), reverse=True)], output=str(output)),
        silent_progress(),
    )
    assert result.renamed_fields == 0
    assert [name for _, name, _ in _fields(output)] == ["answer", "answer", "person.name"]


def test_a_plain_page_picked_twice_is_copied_twice(tmp_path: Path) -> None:
    plain = _book(tmp_path / "plain.pdf", 2)
    output, renamed = _merge(tmp_path, [plain], bookmarks="none")
    with pymupdf.open(output) as document:
        assert document.page_count == 2
    output = tmp_path / "repeat.pdf"
    merge(
        MergeParams(inputs=[MergeInput(path=str(plain), ranges="2, 1, 2")], output=str(output)),
        silent_progress(),
    )
    with pymupdf.open(output) as document:
        assert [page.get_text().strip() for page in document] == [
            "plain page 2",
            "plain page 1",
            "plain page 2",
        ]
    assert renamed == 0
