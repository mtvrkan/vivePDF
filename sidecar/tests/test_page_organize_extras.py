from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.merge_split import MergeInput, MergeParams, SplitParams, merge, split
from vivepdf.ops.pages import (
    PagesParams,
    RotateParams,
    SourceParams,
    delete_pages,
    extract_pages,
    label_rules,
    page_label_parts,
    reverse_pages,
    rotate_pages,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _document(
    path: Path,
    prefix: str,
    count: int,
    toc: list[list] | None = None,
    labels: list[dict] | None = None,
    size: tuple[float, float] = (595, 842),
) -> Path:
    document = pymupdf.open()
    for index in range(count):
        page = document.new_page(width=size[0], height=size[1])
        page.insert_text((72, 72), f"{prefix}{index + 1}")
    if toc:
        document.set_toc(toc)
    if labels:
        document.set_page_labels(labels)
    document.save(path)
    document.close()
    return path


def _texts(path: str | Path) -> list[str]:
    with pymupdf.open(path) as document:
        return [page.get_text().strip() for page in document]


def _labels(path: str | Path) -> list[str]:
    with pymupdf.open(path) as document:
        return [page.get_label() for page in document]


def test_merge_interleaves_duplex_scan_with_reversed_backs(tmp_path: Path) -> None:
    fronts = _document(tmp_path / "fronts.pdf", "F", 3)
    backs = _document(tmp_path / "backs.pdf", "B", 3)
    result = merge(
        MergeParams(
            inputs=[MergeInput(path=str(fronts)), MergeInput(path=str(backs), reverse=True)],
            output=str(tmp_path / "duplex.pdf"),
            interleave=True,
        ),
        silent_progress(),
    )
    assert result.page_count == 6
    assert _texts(result.output) == ["F1", "B3", "F2", "B2", "F3", "B1"]


def test_merge_interleave_appends_leftover_pages_and_sorts_bookmarks(tmp_path: Path) -> None:
    long = _document(tmp_path / "long.pdf", "L", 3, toc=[[1, "L end", 3], [1, "L start", 1]])
    short = _document(tmp_path / "short.pdf", "S", 1, toc=[[1, "S start", 1]])
    result = merge(
        MergeParams(
            inputs=[MergeInput(path=str(long)), MergeInput(path=str(short))],
            output=str(tmp_path / "mixed.pdf"),
            interleave=True,
        ),
        silent_progress(),
    )
    assert _texts(result.output) == ["L1", "S1", "L2", "L3"]
    with pymupdf.open(result.output) as document:
        assert [entry[2] for entry in document.get_toc()] == [1, 2, 4]


def test_merge_pads_odd_inputs_with_a_matching_blank(tmp_path: Path) -> None:
    odd = _document(tmp_path / "odd.pdf", "O", 3, size=(842, 595))
    even = _document(tmp_path / "even.pdf", "E", 2)
    last = _document(tmp_path / "last.pdf", "Z", 1)
    result = merge(
        MergeParams(
            inputs=[MergeInput(path=str(p)) for p in (odd, even, last)],
            output=str(tmp_path / "padded.pdf"),
            pad_odd=True,
        ),
        silent_progress(),
    )
    assert _texts(result.output) == ["O1", "O2", "O3", "", "E1", "E2", "Z1"]
    with pymupdf.open(result.output) as document:
        assert document[3].rect.width == pytest.approx(842)
        assert [entry[1:] for entry in document.get_toc()] == [["odd", 1], ["even", 5], ["last", 7]]


def test_merge_keeps_page_labels_and_numbers_the_rest(tmp_path: Path) -> None:
    plain = _document(tmp_path / "plain.pdf", "P", 2)
    book = _document(
        tmp_path / "book.pdf",
        "K",
        4,
        labels=[
            {"startpage": 0, "style": "r", "prefix": "", "firstpagenum": 1},
            {"startpage": 2, "style": "D", "prefix": "A-", "firstpagenum": 1},
        ],
    )
    result = merge(
        MergeParams(
            inputs=[MergeInput(path=str(plain)), MergeInput(path=str(book), ranges="2-4")],
            output=str(tmp_path / "labelled.pdf"),
        ),
        silent_progress(),
    )
    assert _labels(result.output) == ["1", "2", "ii", "A-1", "A-2"]


def test_merge_without_labels_writes_none(tmp_path: Path) -> None:
    plain = _document(tmp_path / "plain.pdf", "P", 2)
    result = merge(
        MergeParams(inputs=[MergeInput(path=str(plain))], output=str(tmp_path / "o.pdf")),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        assert document.get_page_labels() == []


def test_label_rules_compress_runs() -> None:
    parts = [
        ("r", "", 1),
        ("r", "", 2),
        ("D", "", 1),
        ("D", "", 2),
        ("", "Cover", 9),
        ("", "Cover", 9),
    ]
    assert label_rules(parts) == [
        {"startpage": 0, "style": "r", "prefix": "", "firstpagenum": 1},
        {"startpage": 2, "style": "D", "prefix": "", "firstpagenum": 1},
        {"startpage": 4, "style": "", "prefix": "Cover", "firstpagenum": 9},
    ]


def test_page_label_parts_without_rules_is_none(tmp_path: Path) -> None:
    with pymupdf.open(_document(tmp_path / "p.pdf", "P", 2)) as document:
        assert page_label_parts(document) is None


def test_split_into_equal_parts(tmp_path: Path) -> None:
    source = _document(tmp_path / "seven.pdf", "P", 7)
    result = split(
        SplitParams(path=str(source), mode="count", parts=3, output_dir=str(tmp_path / "out")),
        silent_progress(),
    )
    assert [part.page_count for part in result.outputs] == [3, 2, 2]
    many = split(
        SplitParams(path=str(source), mode="count", parts=20, output_dir=str(tmp_path / "many")),
        silent_progress(),
    )
    assert len(many.outputs) == 7


def test_split_count_requires_parts(tmp_path: Path) -> None:
    source = _document(tmp_path / "p.pdf", "P", 3)
    with pytest.raises(OpError) as caught:
        split(
            SplitParams(path=str(source), mode="count", output_dir=str(tmp_path / "out")),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_split_by_second_level_bookmarks_keeps_their_outline(tmp_path: Path) -> None:
    toc = [[1, "Part", 1], [2, "Chapter A", 1], [3, "Section", 2], [2, "Chapter B", 3]]
    source = _document(tmp_path / "book.pdf", "P", 4, toc=toc)
    top = split(
        SplitParams(path=str(source), mode="bookmarks", output_dir=str(tmp_path / "top")),
        silent_progress(),
    )
    assert [part.page_count for part in top.outputs] == [4]
    deep = split(
        SplitParams(
            path=str(source), mode="bookmarks", bookmark_level=2, output_dir=str(tmp_path / "deep")
        ),
        silent_progress(),
    )
    assert [Path(part.output).name for part in deep.outputs] == [
        "book-1-Part.pdf",
        "book-2-Chapter B.pdf",
    ]
    with pymupdf.open(deep.outputs[0].output) as document:
        assert document.get_toc() == [[1, "Part", 1], [2, "Chapter A", 1], [3, "Section", 2]]


def test_split_keeps_page_labels_per_part(tmp_path: Path) -> None:
    source = _document(
        tmp_path / "labelled.pdf",
        "P",
        4,
        labels=[
            {"startpage": 0, "style": "r", "prefix": "", "firstpagenum": 1},
            {"startpage": 2, "style": "D", "prefix": "", "firstpagenum": 1},
        ],
    )
    result = split(
        SplitParams(path=str(source), mode="every", every=3, output_dir=str(tmp_path / "out")),
        silent_progress(),
    )
    assert _labels(result.outputs[0].output) == ["i", "ii", "1"]
    assert _labels(result.outputs[1].output) == ["2"]


def test_split_checks_every_target_before_writing(tmp_path: Path) -> None:
    source = _document(tmp_path / "doc.pdf", "P", 3)
    out = tmp_path / "out"
    out.mkdir()
    (out / "doc-3-p3.pdf").write_bytes(b"keep")
    with pytest.raises(OpError) as caught:
        split(SplitParams(path=str(source), mode="single", output_dir=str(out)), silent_progress())
    assert caught.value.data and caught.value.data.get("exists")
    assert sorted(entry.name for entry in out.iterdir()) == ["doc-3-p3.pdf"]


def test_delete_and_extract_keep_the_surviving_bookmarks(tmp_path: Path) -> None:
    toc = [[1, "One", 1], [2, "One sub", 2], [1, "Three", 3]]
    source = _document(tmp_path / "doc.pdf", "P", 3, toc=toc)
    deleted = delete_pages(
        PagesParams(path=str(source), pages=[1], output=str(tmp_path / "d.pdf")),
        silent_progress(),
    )
    with pymupdf.open(deleted.output) as document:
        assert document.get_toc() == [[1, "One sub", 1], [1, "Three", 2]]
    extracted = extract_pages(
        PagesParams(path=str(source), pages=[3, 2], output=str(tmp_path / "e.pdf")),
        silent_progress(),
    )
    with pymupdf.open(extracted.output) as document:
        assert document.get_toc() == [[1, "One sub", 2], [1, "Three", 1]]


def test_delete_renumbers_page_labels(tmp_path: Path) -> None:
    source = _document(
        tmp_path / "doc.pdf",
        "P",
        3,
        labels=[{"startpage": 0, "style": "a", "prefix": "", "firstpagenum": 1}],
    )
    deleted = delete_pages(
        PagesParams(path=str(source), pages=[1], output=str(tmp_path / "d.pdf")),
        silent_progress(),
    )
    assert _labels(deleted.output) == ["b", "c"]
    reversed_output = reverse_pages(
        SourceParams(path=str(source), output=str(tmp_path / "r.pdf")), silent_progress()
    )
    assert _labels(reversed_output.output) == ["c", "b", "a"]


def test_rotate_counts_a_repeated_page_once(tmp_path: Path) -> None:
    source = _document(tmp_path / "doc.pdf", "P", 3)
    result = rotate_pages(
        RotateParams(path=str(source), pages="1,1-2", degrees=90, output=str(tmp_path / "r.pdf")),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        assert [page.rotation for page in document] == [90, 90, 0]


def _shared_image_pdf(path: Path, pages: int) -> Path:
    import numpy

    noise = numpy.random.default_rng(7).integers(0, 255, (300, 300, 3), dtype=numpy.uint8)
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, 300, 300, noise.tobytes(), False)
    document = pymupdf.open()
    xref = 0
    for _ in range(pages):
        page = document.new_page()
        xref = page.insert_image(page.rect, pixmap=pixmap, xref=xref)
    document.save(path, deflate=True)
    document.close()
    return path


def test_reordering_does_not_copy_shared_resources_per_page(tmp_path: Path) -> None:
    from vivepdf.ops.pages import AssemblePage, AssembleParams, AssembleSource, assemble

    source = _shared_image_pdf(tmp_path / "shared.pdf", 12)
    result = assemble(
        AssembleParams(
            sources=[AssembleSource(id="main", path=str(source))],
            pages=[AssemblePage(kind="page", source="main", index=i) for i in range(12, 0, -1)],
            output=str(tmp_path / "reversed.pdf"),
        ),
        silent_progress(),
    )
    assert result.bytes < source.stat().st_size * 1.5
    odd_even = split(
        SplitParams(path=str(source), mode="odd_even", output_dir=str(tmp_path / "oe")),
        silent_progress(),
    )
    assert all(part.bytes < source.stat().st_size * 1.5 for part in odd_even.outputs)
    interleaved = merge(
        MergeParams(
            inputs=[
                MergeInput(path=str(source), ranges="1-6"),
                MergeInput(path=str(source), ranges="7-12", reverse=True),
            ],
            output=str(tmp_path / "interleaved.pdf"),
            interleave=True,
        ),
        silent_progress(),
    )
    assert interleaved.bytes < source.stat().st_size * 1.5
