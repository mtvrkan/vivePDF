from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.create_book import CreateBookParams, create_book
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

PARAGRAPH = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. " * 6


def _chapters(folder: Path) -> list[str]:
    first = folder / "01_introduction.md"
    first.write_text(
        "# Getting started\n\n"
        + f"{PARAGRAPH}\n\n" * 12
        + "## First steps\n\n"
        + f"{PARAGRAPH}\n\n" * 4
        + "[jump](#nowhere)\n",
        encoding="utf-8",
    )
    second = folder / "02-methods.md"
    second.write_text("## Sampling\n\n" + f"{PARAGRAPH}\n\n" * 3, encoding="utf-8")
    third = folder / "03 notes.txt"
    third.write_text(f"{PARAGRAPH}\n\n" * 2, encoding="utf-8")
    return [str(first), str(second), str(third)]


def _params(folder: Path, **update) -> CreateBookParams:
    values = {
        "chapters": _chapters(folder),
        "title": "Field Guide",
        "author": "A. Writer",
        "chapter_label": "Chapter {n}",
        "toc_title": "Contents",
        "output": str(folder / "book.pdf"),
    }
    values.update(update)
    return CreateBookParams(**values)


def test_book_has_cover_linked_contents_bookmarks_and_running_headers(tmp_path: Path):
    result = create_book(_params(tmp_path), silent_progress())

    with pymupdf.open(result.output) as document:
        assert document.page_count == result.page_count
        assert "Field Guide" in document[0].get_text()
        toc = document.get_toc()
        assert [entry[1] for entry in toc] == [
            "Contents",
            "Getting started",
            "First steps",
            "methods",
            "Sampling",
            "notes",
        ]
        assert toc[0][2] == 2
        chapter_pages = {title: page for level, title, page in toc if level == 1}
        opening = document[chapter_pages["Getting started"] - 1].get_text()
        assert "Chapter 1" in opening
        assert "Getting started" in opening
        assert "Chapter 3" in document[chapter_pages["notes"] - 1].get_text()
        contents = document[1]
        assert str(chapter_pages["methods"]) in contents.get_text()
        targets = {link["page"] + 1 for link in contents.get_links()}
        assert set(chapter_pages.values()) - {2} <= targets
        follower = document[chapter_pages["Getting started"]].get_text()
        assert "Getting started" in follower
        assert str(chapter_pages["Getting started"] + 1) in follower
        assert document.metadata["title"] == "Field Guide"
        assert document.metadata["author"] == "A. Writer"


def test_book_without_cover_and_contents_starts_with_a_title_page(tmp_path: Path):
    params = _params(tmp_path, cover=False, toc=False, running_header=False, page_numbers=False)

    result = create_book(params, silent_progress())

    with pymupdf.open(result.output) as document:
        first = document[0].get_text()
        assert "Field Guide" in first
        assert "Getting started" not in first
        toc = document.get_toc()
        assert toc[0] == [1, "Getting started", 2]
        assert document[0].get_links() == []
        follower = document[2].get_text()
        assert "Getting started" not in follower
        assert "3" not in follower


def test_photo_cover_needs_a_picture(tmp_path: Path):
    params = _params(tmp_path, cover_style="photo")

    with pytest.raises(OpError) as raised:
        create_book(params, silent_progress())

    assert raised.value.data["reason"] == "noCoverImage"
    assert not (tmp_path / "book.pdf").exists()


def test_book_needs_a_title_and_readable_chapters(tmp_path: Path):
    with pytest.raises(OpError) as untitled:
        create_book(_params(tmp_path, title="  "), silent_progress())
    assert untitled.value.data["reason"] == "noTitle"

    with pytest.raises(OpError) as missing:
        create_book(_params(tmp_path, chapters=[str(tmp_path / "gone.md")]), silent_progress())
    assert missing.value.code == ErrorCode.FILE_NOT_FOUND

    picture = tmp_path / "chapter.png"
    picture.write_bytes(b"png")
    with pytest.raises(OpError) as unsupported:
        create_book(_params(tmp_path, chapters=[str(picture)]), silent_progress())
    assert unsupported.value.data["reason"] == "unsupportedType"


def test_existing_output_is_kept_unless_overwrite(tmp_path: Path):
    target = tmp_path / "book.pdf"
    target.write_bytes(b"keep")

    with pytest.raises(OpError):
        create_book(_params(tmp_path), silent_progress())
    assert target.read_bytes() == b"keep"

    result = create_book(_params(tmp_path, overwrite=True), silent_progress())
    assert result.page_count > 3
