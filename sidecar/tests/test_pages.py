from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._ranges import PageScope
from vivepdf.ops.merge_split import MergeInput, MergeParams, SplitParams, merge, split
from vivepdf.ops.page_geometry import CropParams, Insets, ResizeParams, crop_pages, resize_pages
from vivepdf.ops.pages import (
    AssemblePage,
    AssembleParams,
    AssembleSource,
    InsertBlankParams,
    PagesParams,
    RotateParams,
    SourceParams,
    assemble,
    delete_pages,
    extract_pages,
    insert_blank,
    reverse_pages,
    rotate_pages,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _texts(path: str | Path) -> list[str]:
    with pymupdf.open(path) as document:
        return [page.get_text().strip() for page in document]


def _main(sample_pdf: Path) -> list[AssembleSource]:
    return [AssembleSource(id="main", path=str(sample_pdf))]


def _page(index: int, rotate: int = 0, source: str = "main") -> AssemblePage:
    return AssemblePage(kind="page", source=source, index=index, rotate=rotate)  # type: ignore[arg-type]


def test_assemble_reorders_duplicates_and_rotates(sample_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "assembled.pdf"
    result = assemble(
        AssembleParams(
            sources=_main(sample_pdf),
            output=str(output),
            pages=[_page(3), _page(1, rotate=90), _page(3)],
        ),
        silent_progress(),
    )
    assert result.page_count == 3
    assert _texts(output) == ["Page 3", "Page 1", "Page 3"]
    with pymupdf.open(output) as document:
        assert document[1].rotation == 90


def test_assemble_mixes_sources_blank_and_image_pages(
    sample_pdf: Path, encrypted_pdf: Path, tmp_path: Path
) -> None:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 400, 300), False)
    pixmap.set_rect(pixmap.irect, (10, 200, 10))
    image = tmp_path / "photo.png"
    pixmap.save(image)
    output = tmp_path / "mixed.pdf"
    result = assemble(
        AssembleParams(
            sources=[
                AssembleSource(id="main", path=str(sample_pdf)),
                AssembleSource(id="ext", path=str(encrypted_pdf), password="secret"),
            ],
            output=str(output),
            pages=[
                _page(1),
                AssemblePage(kind="blank", width=420, height=595),
                _page(2, source="ext"),
                AssemblePage(kind="image", path=str(image)),
                _page(2),
                _page(3),
            ],
        ),
        silent_progress(),
    )
    assert result.page_count == 6
    assert _texts(output) == ["Page 1", "", "Page 2", "", "Page 2", "Page 3"]
    with pymupdf.open(output) as document:
        assert round(document[1].rect.width) == 420
        assert document[3].rect.width > document[3].rect.height
        assert len(document[3].get_images()) == 1


def test_assemble_validates_sources_and_indices(sample_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        assemble(
            AssembleParams(
                sources=_main(sample_pdf), output=str(tmp_path / "a.pdf"), pages=[_page(9)]
            ),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.INVALID_PARAMS
    with pytest.raises(OpError):
        assemble(
            AssembleParams(
                sources=_main(sample_pdf),
                output=str(tmp_path / "b.pdf"),
                pages=[_page(1, source="ghost")],
            ),
            silent_progress(),
        )
    with pytest.raises(OpError) as missing:
        assemble(
            AssembleParams(
                sources=_main(sample_pdf),
                output=str(tmp_path / "c.pdf"),
                pages=[AssemblePage(kind="image", path=str(tmp_path / "nope.png"))],
            ),
            silent_progress(),
        )
    assert missing.value.code == ErrorCode.FILE_NOT_FOUND


def test_assemble_rejects_output_equal_to_input(sample_pdf: Path) -> None:
    with pytest.raises(OpError) as raised:
        assemble(
            AssembleParams(sources=_main(sample_pdf), output=str(sample_pdf), pages=[_page(1)]),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.INVALID_PARAMS


def test_existing_output_needs_overwrite(sample_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "exists.pdf"
    output.write_bytes(b"x")
    params = AssembleParams(sources=_main(sample_pdf), output=str(output), pages=[_page(1)])
    with pytest.raises(OpError) as raised:
        assemble(params, silent_progress())
    assert raised.value.data == {"exists": True, "path": str(output.resolve())}
    result = assemble(params.model_copy(update={"overwrite": True}), silent_progress())
    assert result.page_count == 1


def test_merge_with_ranges_and_bookmarks(sample_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "merged.pdf"
    result = merge(
        MergeParams(
            inputs=[
                MergeInput(path=str(sample_pdf), ranges="1-2"),
                MergeInput(path=str(sample_pdf), ranges="3"),
            ],
            output=str(output),
        ),
        silent_progress(),
    )
    assert result.page_count == 3
    assert _texts(output) == ["Page 1", "Page 2", "Page 3"]
    with pymupdf.open(output) as document:
        toc = document.get_toc(simple=True)
        assert [entry[2] for entry in toc] == [1, 3]


def test_merge_normalises_orphaned_bookmark_levels(sample_pdf: Path, tmp_path: Path) -> None:
    deep = tmp_path / "deep.pdf"
    with pymupdf.open(sample_pdf) as document:
        document.set_toc([[1, "Bölüm", 1], [2, "Alt bölüm", 2], [3, "Derin", 3]])
        document.save(deep)
    output = tmp_path / "merged-toc.pdf"
    result = merge(
        MergeParams(
            inputs=[MergeInput(path=str(deep), ranges="3"), MergeInput(path=str(deep))],
            output=str(output),
        ),
        silent_progress(),
    )
    assert result.page_count == 4
    with pymupdf.open(output) as document:
        levels = [entry[0] for entry in document.get_toc(simple=True)]
    assert levels, "merged document lost its bookmarks"
    previous = 0
    for level in levels:
        assert level <= previous + 1, levels
        previous = level


def test_merge_missing_input(tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        merge(
            MergeParams(
                inputs=[MergeInput(path=str(tmp_path / "nope.pdf"))], output=str(tmp_path / "o.pdf")
            ),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.FILE_NOT_FOUND


def test_split_every_and_ranges(sample_pdf: Path, tmp_path: Path) -> None:
    result = split(
        SplitParams(
            path=str(sample_pdf), mode="every", every=2, output_dir=str(tmp_path / "parts")
        ),
        silent_progress(),
    )
    assert [part.page_count for part in result.outputs] == [2, 1]
    assert result.outputs[0].output.endswith("sample-1-p1-2.pdf")
    assert result.outputs[1].first_page == 3

    ranged = split(
        SplitParams(
            path=str(sample_pdf), mode="ranges", ranges="3;1-2", output_dir=str(tmp_path / "ranged")
        ),
        silent_progress(),
    )
    assert [(part.first_page, part.last_page) for part in ranged.outputs] == [(3, 3), (1, 2)]


def test_split_single_odd_even_and_size(sample_pdf: Path, tmp_path: Path) -> None:
    single = split(
        SplitParams(path=str(sample_pdf), mode="single", output_dir=str(tmp_path / "s")),
        silent_progress(),
    )
    assert len(single.outputs) == 3
    odd_even = split(
        SplitParams(path=str(sample_pdf), mode="odd_even", output_dir=str(tmp_path / "oe")),
        silent_progress(),
    )
    assert [part.page_count for part in odd_even.outputs] == [2, 1]
    by_size = split(
        SplitParams(
            path=str(sample_pdf), mode="size", max_bytes=1024, output_dir=str(tmp_path / "sz")
        ),
        silent_progress(),
    )
    assert sum(part.page_count for part in by_size.outputs) == 3


def test_split_bookmarks_requires_toc(sample_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        split(
            SplitParams(path=str(sample_pdf), mode="bookmarks", output_dir=str(tmp_path)),
            silent_progress(),
        )
    assert raised.value.data == {"reason": "noBookmarks"}


def test_delete_extract_reverse(sample_pdf: Path, tmp_path: Path) -> None:
    deleted = delete_pages(
        PagesParams(path=str(sample_pdf), output=str(tmp_path / "d.pdf"), pages=[2]),
        silent_progress(),
    )
    assert _texts(deleted.output) == ["Page 1", "Page 3"]
    extracted = extract_pages(
        PagesParams(path=str(sample_pdf), output=str(tmp_path / "e.pdf"), pages=[3, 1]),
        silent_progress(),
    )
    assert _texts(extracted.output) == ["Page 3", "Page 1"]
    reversed_result = reverse_pages(
        SourceParams(path=str(sample_pdf), output=str(tmp_path / "r.pdf")), silent_progress()
    )
    assert _texts(reversed_result.output) == ["Page 3", "Page 2", "Page 1"]


def test_delete_all_pages_rejected(sample_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError):
        delete_pages(
            PagesParams(path=str(sample_pdf), output=str(tmp_path / "x.pdf"), pages=[1, 2, 3]),
            silent_progress(),
        )


def test_rotate_insert_blank_resize_crop(sample_pdf: Path, tmp_path: Path) -> None:
    rotated = rotate_pages(
        RotateParams(
            path=str(sample_pdf), output=str(tmp_path / "rot.pdf"), pages="2", degrees=180
        ),
        silent_progress(),
    )
    with pymupdf.open(rotated.output) as document:
        assert [page.rotation for page in document] == [0, 180, 0]

    blank = insert_blank(
        InsertBlankParams(path=str(sample_pdf), output=str(tmp_path / "b.pdf"), at=2, count=2),
        silent_progress(),
    )
    assert blank.page_count == 5
    assert _texts(blank.output) == ["Page 1", "", "", "Page 2", "Page 3"]

    resized = resize_pages(
        ResizeParams(path=str(sample_pdf), output=str(tmp_path / "rs.pdf"), preset="letter"),
        silent_progress(),
    )
    with pymupdf.open(resized.output) as document:
        assert round(document[0].rect.width) == 612
        assert "Page 1" in document[0].get_text()

    cropped = crop_pages(
        CropParams(
            path=str(sample_pdf),
            output=str(tmp_path / "c.pdf"),
            insets=Insets(left=20, top=30, right=20, bottom=30),
        ),
        silent_progress(),
    )
    with pymupdf.open(cropped.output) as document:
        assert round(document[0].rect.width) == 595 - 40
        assert round(document[0].rect.height) == 842 - 60


def test_crop_too_much_rejected(sample_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError):
        crop_pages(
            CropParams(
                path=str(sample_pdf),
                output=str(tmp_path / "c.pdf"),
                insets=Insets(left=400, right=400),
            ),
            silent_progress(),
        )


def test_split_by_size_accounts_for_shared_resources(tmp_path: Path) -> None:
    document = pymupdf.open()
    for index in range(6):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 72), f"Sayfa {index + 1}", fontname="helv")
    path = tmp_path / "shared.pdf"
    document.save(path, deflate=False)
    document.close()
    file_bytes = path.stat().st_size
    parts = split(
        SplitParams(
            path=str(path),
            mode="size",
            max_bytes=max(1024, file_bytes // 2),
            output_dir=str(tmp_path / "shared"),
        ),
        silent_progress(),
    )
    assert len(parts.outputs) >= 2
    assert sum(part.page_count for part in parts.outputs) == 6


def test_split_by_size_flags_parts_over_the_limit(tmp_path: Path) -> None:
    path = tmp_path / "heavy.pdf"
    with pymupdf.open() as document:
        noise = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 200), False)
        noise.set_rect(noise.irect, (0, 0, 0))
        for x in range(0, 200, 3):
            for y in range(0, 200, 5):
                noise.set_pixel(x, y, ((x * 7) % 255, (y * 13) % 255, (x * y) % 255))
        document.new_page().insert_image(pymupdf.Rect(0, 0, 400, 400), pixmap=noise)
        document.new_page().insert_text((72, 72), "light")
        document.save(path)
    result = split(
        SplitParams(path=str(path), mode="size", max_bytes=2048, output_dir=str(tmp_path / "over")),
        silent_progress(),
    )
    assert result.outputs[0].bytes > 2048
    assert result.oversized_parts == [1]


def test_split_by_size_can_be_cancelled(sample_pdf: Path, tmp_path: Path) -> None:
    class Cancelled(Exception):
        pass

    class Stop:
        def report(self, *_args: object) -> None:
            return None

        def check_cancelled(self) -> None:
            raise Cancelled

    with pytest.raises(Cancelled):
        split(
            SplitParams(
                path=str(sample_pdf), mode="size", max_bytes=4096, output_dir=str(tmp_path / "c")
            ),
            Stop(),
        )
    assert not (tmp_path / "c").exists() or not any((tmp_path / "c").iterdir())


def test_split_names_parts_from_a_pattern(sample_pdf: Path, tmp_path: Path) -> None:
    result = split(
        SplitParams(
            path=str(sample_pdf),
            mode="every",
            every=2,
            pattern="{name}_{first}-{last}_of_{n}",
            output_dir=str(tmp_path / "named"),
        ),
        silent_progress(),
    )
    names = [Path(part.output).name for part in result.outputs]
    assert names == [f"{sample_pdf.stem}_1-2_of_1.pdf", f"{sample_pdf.stem}_3-3_of_2.pdf"]


def test_split_pattern_without_numbers_keeps_names_apart(sample_pdf: Path, tmp_path: Path) -> None:
    result = split(
        SplitParams(
            path=str(sample_pdf), mode="single", pattern="part", output_dir=str(tmp_path / "same")
        ),
        silent_progress(),
    )
    assert [Path(part.output).name for part in result.outputs] == [
        "part.pdf",
        "part-2.pdf",
        "part-3.pdf",
    ]


def _pdf_with_lines(path: Path, lines: list[str]) -> Path:
    document = pymupdf.open()
    for line in lines:
        page = document.new_page()
        if line:
            page.insert_text((72, 72), line)
    document.save(path)
    document.close()
    return path


def test_split_by_text_starts_a_part_at_each_match_and_names_it(tmp_path: Path) -> None:
    source = _pdf_with_lines(
        tmp_path / "invoices.pdf",
        ["Cover letter", "Invoice No: A-1", "details", "", "INVOICE NO: B-2", "details"],
    )
    result = split(
        SplitParams(
            path=str(source),
            mode="text",
            text_pattern=r"invoice no:\s*(\S+)",
            output_dir=str(tmp_path / "parts"),
        ),
        silent_progress(),
    )
    assert [(part.first_page, part.last_page) for part in result.outputs] == [
        (1, 1),
        (2, 4),
        (5, 6),
    ]
    assert [Path(part.output).name for part in result.outputs] == [
        "invoices-1-p1.pdf",
        "invoices-2-A-1.pdf",
        "invoices-3-B-2.pdf",
    ]


def test_split_by_text_starting_on_the_first_page_has_no_leading_part(tmp_path: Path) -> None:
    source = _pdf_with_lines(tmp_path / "chapters.pdf", ["Chapter one", "x", "Chapter two"])
    result = split(
        SplitParams(
            path=str(source),
            mode="text",
            text_pattern="(chapter [a-z]+)",
            pattern="{n} {title}",
            output_dir=str(tmp_path / "parts"),
        ),
        silent_progress(),
    )
    assert [Path(part.output).name for part in result.outputs] == [
        "1 Chapter one.pdf",
        "2 Chapter two.pdf",
    ]


@pytest.mark.parametrize(
    ("pattern", "reason"),
    [("missing", "noMatches"), ("(", "badPattern"), ("  ", None)],
)
def test_split_by_text_refuses_bad_or_unmatched_patterns(
    tmp_path: Path, pattern: str, reason: str | None
) -> None:
    source = _pdf_with_lines(tmp_path / "plain.pdf", ["alpha", "beta"])
    with pytest.raises(OpError) as caught:
        split(
            SplitParams(
                path=str(source), mode="text", text_pattern=pattern, output_dir=str(tmp_path / "o")
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert (caught.value.data or {}).get("reason") == reason
    assert not (tmp_path / "o").exists() or not any((tmp_path / "o").iterdir())


def _pdf_with_pages(path: Path, count: int) -> Path:
    document = pymupdf.open()
    for index in range(count):
        document.new_page().insert_text((72, 72), f"Page {index + 1}")
    document.save(path)
    document.close()
    return path


def test_page_scope_picks_odd_even_every_and_ranges(tmp_path: Path) -> None:
    source = _pdf_with_pages(tmp_path / "seven.pdf", 7)

    def extracted(scope: PageScope) -> list[str]:
        result = extract_pages(
            PagesParams(
                path=str(source), output=str(tmp_path / "out.pdf"), scope=scope, overwrite=True
            ),
            silent_progress(),
        )
        return _texts(result.output)

    assert extracted(PageScope(kind="odd")) == ["Page 1", "Page 3", "Page 5", "Page 7"]
    assert extracted(PageScope(kind="even")) == ["Page 2", "Page 4", "Page 6"]
    assert extracted(PageScope(kind="every", every=3, start=2)) == ["Page 2", "Page 5"]
    assert extracted(PageScope(kind="ranges", ranges="6-, 2, 2")) == ["Page 6", "Page 7", "Page 2"]


def test_page_scope_deletes_and_rotates(tmp_path: Path) -> None:
    source = _pdf_with_pages(tmp_path / "four.pdf", 4)
    deleted = delete_pages(
        PagesParams(path=str(source), output=str(tmp_path / "d.pdf"), scope=PageScope(kind="even")),
        silent_progress(),
    )
    assert _texts(deleted.output) == ["Page 1", "Page 3"]
    rotated = rotate_pages(
        RotateParams(
            path=str(source),
            output=str(tmp_path / "r.pdf"),
            scope=PageScope(kind="every", every=2, start=1),
            degrees=90,
        ),
        silent_progress(),
    )
    with pymupdf.open(rotated.output) as document:
        assert [page.rotation for page in document] == [90, 0, 90, 0]


def test_page_scope_that_matches_nothing_is_refused(tmp_path: Path) -> None:
    source = _pdf_with_pages(tmp_path / "two.pdf", 2)
    with pytest.raises(OpError) as caught:
        extract_pages(
            PagesParams(
                path=str(source),
                output=str(tmp_path / "x.pdf"),
                scope=PageScope(kind="every", every=2, start=5),
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert not (tmp_path / "x.pdf").exists()


def test_pages_and_scope_are_mutually_exclusive(sample_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        PagesParams(path=str(sample_pdf), output=str(tmp_path / "x.pdf"))
    with pytest.raises(ValueError):
        PagesParams(
            path=str(sample_pdf), output=str(tmp_path / "x.pdf"), pages=[1], scope=PageScope()
        )
