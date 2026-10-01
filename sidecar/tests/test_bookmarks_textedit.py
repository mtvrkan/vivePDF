from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._bookmark_model import BookmarkItem, BookmarksGenerateParams
from vivepdf.ops.bookmarks import (
    BookmarksParams,
    BookmarksSetParams,
    generate_bookmarks,
    get_bookmarks,
)
from vivepdf.ops.textedit import (
    TextEdit,
    TextEditParams,
    TextSpansParams,
    get_spans,
    replace_text,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

FONT = "vivepdf/assets/fonts/DejaVuSans.ttf"


@pytest.fixture
def heading_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 100), "Document Title", fontsize=24, fontfile=FONT, fontname="dv")
    page.insert_text(
        (72, 140),
        "This is a body paragraph with normal text.",
        fontsize=11,
        fontfile=FONT,
        fontname="dv",
    )
    page.insert_text(
        (72, 170),
        "Another line of regular body content here.",
        fontsize=11,
        fontfile=FONT,
        fontname="dv",
    )
    path = tmp_path / "heading.pdf"
    document.save(path)
    document.close()
    return path


def test_bookmarks_get_set_roundtrip(sample_pdf: Path, tmp_path: Path) -> None:
    items = [
        BookmarkItem(level=1, title="Intro", page=1),
        BookmarkItem(level=2, title="Details", page=2),
        BookmarkItem(level=1, title="Conclusion", page=3),
    ]
    set_bookmarks_result = None
    from vivepdf.ops.bookmarks import set_bookmarks

    set_bookmarks_result = set_bookmarks(
        BookmarksSetParams(path=str(sample_pdf), output=str(tmp_path / "toc.pdf"), items=items),
        silent_progress(),
    )
    assert set_bookmarks_result.page_count == 3
    fetched = get_bookmarks(
        BookmarksParams(path=str(set_bookmarks_result.output)), silent_progress()
    )
    assert [item.title for item in fetched.items] == ["Intro", "Details", "Conclusion"]
    assert [item.level for item in fetched.items] == [1, 2, 1]
    assert [item.page for item in fetched.items] == [1, 2, 3]


def test_bookmarks_set_rejects_invalid_level_jump(sample_pdf: Path, tmp_path: Path) -> None:
    from vivepdf.ops.bookmarks import set_bookmarks

    with pytest.raises(OpError) as raised:
        set_bookmarks(
            BookmarksSetParams(
                path=str(sample_pdf),
                output=str(tmp_path / "bad.pdf"),
                items=[
                    BookmarkItem(level=1, title="Intro", page=1),
                    BookmarkItem(level=3, title="Skips a level", page=2),
                ],
            ),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.INVALID_PARAMS


def test_bookmarks_generate_finds_heading(heading_pdf: Path, tmp_path: Path) -> None:
    result = generate_bookmarks(
        BookmarksGenerateParams(path=str(heading_pdf), output=str(tmp_path / "gen.pdf")),
        silent_progress(),
    )
    assert any(item.title == "Document Title" and item.level == 1 for item in result.items)
    assert all(item.title != "This is a body paragraph with normal text." for item in result.items)


def test_textedit_spans_returns_inserted_text(heading_pdf: Path) -> None:
    result = get_spans(TextSpansParams(path=str(heading_pdf), page=0), silent_progress())
    titles = [span for span in result.spans if span.text.strip() == "Document Title"]
    assert len(titles) == 1
    assert titles[0].size == pytest.approx(24, rel=0.05)


@pytest.fixture
def hello_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 100), "Hello", fontsize=16, fontfile=FONT, fontname="dv")
    page.insert_text((72, 140), "Unrelated other text", fontsize=12, fontfile=FONT, fontname="dv")
    path = tmp_path / "hello.pdf"
    document.save(path)
    document.close()
    return path


def test_textedit_replace_swaps_text(hello_pdf: Path, tmp_path: Path) -> None:
    spans = get_spans(TextSpansParams(path=str(hello_pdf), page=0), silent_progress())
    hello_span = next(span for span in spans.spans if "Hello" in span.text)
    result = replace_text(
        TextEditParams(
            path=str(hello_pdf),
            output=str(tmp_path / "edited.pdf"),
            page=0,
            edits=[
                TextEdit(
                    bbox=hello_span.bbox,
                    text="Merhaba",
                    size=hello_span.size,
                    color=hello_span.color,
                    font=hello_span.font,
                )
            ],
        ),
        silent_progress(),
    )
    assert result.replaced == 1
    with pymupdf.open(result.output) as document:
        text = document[0].get_text()
        assert "Merhaba" in text
        assert "Hello" not in text
        assert "Unrelated other text" in text


@pytest.fixture
def three_level_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for index in range(3):
        page = document.new_page()
        page.insert_text((72, 80), f"Part {index + 1}", fontsize=23.7, fontfile=FONT, fontname="dv")
        page.insert_text(
            (72, 130), f"Chapter {index + 1}", fontsize=17.3, fontfile=FONT, fontname="dv"
        )
        page.insert_text(
            (72, 180), f"Section {index + 1}", fontsize=13.5, fontfile=FONT, fontname="dv"
        )
        page.insert_text(
            (72, 230),
            "Body text that is clearly longer than any of the headings above it, repeated.",
            fontsize=11,
            fontfile=FONT,
            fontname="dv",
        )
    path = tmp_path / "levels.pdf"
    document.save(path)
    document.close()
    return path


def test_bookmarks_generate_keeps_headings_with_fractional_sizes(
    three_level_pdf: Path, tmp_path: Path
) -> None:
    result = generate_bookmarks(
        BookmarksGenerateParams(path=str(three_level_pdf), output=str(tmp_path / "gen.pdf")),
        silent_progress(),
    )
    titles = [item.title for item in result.items]
    assert "Part 1" in titles and "Chapter 1" in titles and "Section 1" in titles
    assert not any(title.startswith("Body text") for title in titles)


def test_bookmarks_generate_honours_the_level_limit(three_level_pdf: Path, tmp_path: Path) -> None:
    one = generate_bookmarks(
        BookmarksGenerateParams(
            path=str(three_level_pdf), output=str(tmp_path / "one.pdf"), max_levels=1
        ),
        silent_progress(),
    )
    assert [item.title for item in one.items] == ["Part 1", "Part 2", "Part 3"]
    two = generate_bookmarks(
        BookmarksGenerateParams(
            path=str(three_level_pdf), output=str(tmp_path / "two.pdf"), max_levels=2
        ),
        silent_progress(),
    )
    assert len(two.items) > len(one.items)


def test_bookmarks_generate_never_writes_a_level_jump(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 80), "Small heading first", fontsize=14, fontfile=FONT, fontname="dv")
    page.insert_text((72, 120), "Bigger heading later", fontsize=22, fontfile=FONT, fontname="dv")
    page.insert_text(
        (72, 170),
        "Ordinary body copy that dominates the page by character count for sure.",
        fontsize=10,
        fontfile=FONT,
        fontname="dv",
    )
    source = tmp_path / "jump.pdf"
    document.save(source)
    document.close()
    result = generate_bookmarks(
        BookmarksGenerateParams(path=str(source), output=str(tmp_path / "gen.pdf")),
        silent_progress(),
    )
    levels = [item.level for item in result.items]
    assert levels and levels[0] == 1
    for previous, current in zip(levels, levels[1:], strict=False):
        assert current <= previous + 1
    written = get_bookmarks(BookmarksParams(path=str(result.output)), silent_progress())
    assert [item.level for item in written.items] == levels
