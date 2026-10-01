import json
from pathlib import Path

import pymupdf
import pytest
from fontTools.ttLib import TTFont
from pydantic import ValidationError

from vivepdf.ops._bookmark_model import BookmarkItem, BookmarksGenerateParams
from vivepdf.ops._bookmark_outline import outline_counts
from vivepdf.ops.bookmarks import (
    BookmarksParams,
    BookmarksSetParams,
    generate_bookmarks,
    get_bookmarks,
    set_bookmarks,
)
from vivepdf.ops.bookmarks_transfer import BookmarksImportParams, import_bookmarks
from vivepdf.ops.fonts import ResolvedFont, ensure_font
from vivepdf.ops.textedit import (
    FindPreviewParams,
    FindReplaceParams,
    TextEdit,
    TextEditParams,
    TextSpansParams,
    find_preview,
    find_replace,
    get_spans,
    replace_text,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture
def lines(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text(
        (50, 100), "kısa kelime burada devam ediyor", fontsize=11, fontname="dj", fontfile=FONT
    )
    page.insert_text((50, 140), "Tarih 2024-05-17 sonra", fontsize=11, fontname="dj", fontfile=FONT)
    path = tmp_path / "satırlar.pdf"
    document.save(path)
    document.close()
    return path


def _words(path: str, index: int = 0) -> list[tuple[float, float, str]]:
    document = pymupdf.open(path)
    words = [(word[0], word[2], word[4]) for word in document[index].get_text("words")]
    document.close()
    return words


def test_a_longer_replacement_pushes_the_rest_of_the_line_along(lines: Path, tmp_path: Path):
    result = find_replace(
        FindReplaceParams(
            path=str(lines),
            output=str(tmp_path / "long.pdf"),
            find="kısa",
            replace="çok daha uzun bir ifade",
        ),
        silent_progress(),
    )
    words = [word for word in _words(result.output) if word[2] != "Tarih"]
    ordered = sorted((word for word in words if word[0] < 500), key=lambda word: word[0])
    for left, right in zip(ordered, ordered[1:], strict=False):
        if abs(left[0] - right[0]) > 1 and right[2] in ("kelime", "burada", "devam", "ediyor"):
            assert right[0] >= left[1] - 0.5
    text = pymupdf.open(result.output)[0].get_text()
    assert "çok daha uzun bir ifade kelime burada devam ediyor" in text


def test_a_shorter_replacement_leaves_the_line_alone(lines: Path, tmp_path: Path):
    before = {word[2]: word[0] for word in _words(str(lines))}
    result = find_replace(
        FindReplaceParams(
            path=str(lines), output=str(tmp_path / "short.pdf"), find="kelime", replace="söz"
        ),
        silent_progress(),
    )
    after = {word[2]: word[0] for word in _words(result.output)}
    assert after["burada"] == pytest.approx(before["burada"], abs=0.5)


def test_dollar_group_references_are_understood(lines: Path, tmp_path: Path):
    result = find_replace(
        FindReplaceParams(
            path=str(lines),
            output=str(tmp_path / "date.pdf"),
            find=r"(\d{4})-(\d{2})-(\d{2})",
            replace="$3.$2.$1",
            regex=True,
        ),
        silent_progress(),
    )
    assert "17.05.2024" in pymupdf.open(result.output)[0].get_text()


def test_a_missing_group_is_a_clear_error_not_a_crash(lines: Path, tmp_path: Path):
    with pytest.raises(OpError) as caught:
        find_replace(
            FindReplaceParams(
                path=str(lines),
                output=str(tmp_path / "bad.pdf"),
                find=r"(\d{4})",
                replace=r"\2",
                regex=True,
            ),
            silent_progress(),
        )
    assert caught.value.data["reason"] == "replacementGroup"
    assert not (tmp_path / "bad.pdf").exists()


def test_preview_counts_only_what_replace_would_change(lines: Path):
    empty = find_preview(
        FindPreviewParams(path=str(lines), find="x*", regex=True), silent_progress()
    )
    assert empty.total == 0
    across = find_preview(
        FindPreviewParams(path=str(lines), find=r"ediyor\sTarih", regex=True), silent_progress()
    )
    assert across.total == 0


def test_turkish_dotted_and_dotless_i_match_without_case(lines: Path, tmp_path: Path):
    document = pymupdf.open()
    document.new_page().insert_text(
        (50, 100), "İSTANBUL ılık ILIK", fontsize=11, fontname="dj", fontfile=FONT
    )
    source = tmp_path / "tr.pdf"
    document.save(source)
    document.close()
    istanbul = find_preview(FindPreviewParams(path=str(source), find="istanbul"), silent_progress())
    warm = find_preview(FindPreviewParams(path=str(source), find="ılık"), silent_progress())
    assert istanbul.total == 1
    assert warm.total == 2


def _shared_space_font(tmp_path: Path) -> str:
    font = TTFont(FONT)
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap[0xA0] = table.cmap[0x20]
            table.cmap[0xAD] = table.cmap[0x2D]
    path = tmp_path / "shared-space.ttf"
    font.save(path)
    return str(path)


def test_reused_embedded_font_keeps_spaces_and_hyphens(tmp_path: Path):
    fontfile = _shared_space_font(tmp_path)
    loaded = pymupdf.Font(fontfile=fontfile)
    assert loaded.has_glyph(0x20) == loaded.has_glyph(0xA0)
    document = pymupdf.open()
    page = document.new_page()
    ensure_font(page, ResolvedFont("vpfspace", fontfile, None))
    page.insert_text((50, 100), "iki kelime - tire", fontname="vpfspace", fontfile=fontfile)
    assert page.get_text().strip() == "iki kelime - tire"


def test_textedit_rejects_a_malformed_box():
    with pytest.raises(ValidationError):
        TextEdit(bbox=[1, 2], text="x", size=10, color="#000000")


def test_textedit_visible_coordinates_round_trip_on_rotated_and_cropped_pages(tmp_path: Path):
    document = pymupdf.open()
    rotated = document.new_page(width=595, height=842)
    rotated.insert_text((60, 90), "rot90")
    rotated.set_rotation(90)
    cropped = document.new_page(width=700, height=900)
    cropped.insert_text((160, 190), "cropped")
    cropped.set_cropbox(pymupdf.Rect(100, 100, 600, 800))
    source = tmp_path / "boxes.pdf"
    document.save(source)
    document.close()
    size = get_spans(TextSpansParams(path=str(source), page=1), silent_progress())
    assert (size.width, size.height) == (500, 700)
    spans = get_spans(TextSpansParams(path=str(source), page=0, visible=True), silent_progress())
    span = spans.spans[0]
    result = replace_text(
        TextEditParams(
            path=str(source),
            output=str(tmp_path / "out.pdf"),
            page=0,
            visible=True,
            edits=[TextEdit(bbox=span.bbox, text="ROTX", size=span.size, color=span.color)],
        ),
        silent_progress(),
    )
    words = [word for _left, _right, word in _words(result.output, 0)]
    assert words == ["ROTX"]


@pytest.fixture
def outline(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for index in range(4):
        document.new_page().insert_text((72, 400), f"page {index + 1}")
    document.set_toc(
        [
            [1, "Bir", 1, {"kind": 1, "page": 0, "to": pymupdf.Point(72, 300), "zoom": 1.5}],
            [2, "İki", 2, {"kind": 1, "page": 1, "to": pymupdf.Point(100, 200)}],
            [1, "Üç", 4],
            [1, "Hedefsiz", -1],
        ]
    )
    path = tmp_path / "yer imleri.pdf"
    document.save(path)
    document.close()
    return path


def test_get_reads_bookmarks_without_a_destination(outline: Path):
    items = get_bookmarks(BookmarksParams(path=str(outline)), silent_progress()).items
    assert [item.page for item in items] == [1, 2, 4, 0]
    assert items[0].top == 300
    assert items[0].zoom == 1.5


def test_saving_edited_bookmarks_keeps_positions_and_empty_targets(outline: Path, tmp_path: Path):
    items = get_bookmarks(BookmarksParams(path=str(outline)), silent_progress()).items
    items[0].title = "Bir (düzenlendi)"
    result = set_bookmarks(
        BookmarksSetParams(
            path=str(outline), output=str(tmp_path / "set.pdf"), items=items, open_panel=True
        ),
        silent_progress(),
    )
    document = pymupdf.open(result.output)
    toc = document.get_toc(simple=False)
    page_mode = document.xref_get_key(document.pdf_catalog(), "PageMode")
    document.close()
    assert toc[0][1] == "Bir (düzenlendi)"
    assert toc[0][3]["to"] == pymupdf.Point(72, 300)
    assert toc[0][3]["zoom"] == 1.5
    assert toc[1][3]["to"] == pymupdf.Point(100, 200)
    assert toc[3][2] == -1
    assert page_mode == ("name", "/UseOutlines")


def test_collapsed_state_is_written_per_bookmark(outline: Path, tmp_path: Path):
    items = [
        BookmarkItem(level=1, title="A", page=1, collapsed=True),
        BookmarkItem(level=2, title="A1", page=2),
        BookmarkItem(level=1, title="B", page=3),
        BookmarkItem(level=2, title="B1", page=4),
    ]
    result = set_bookmarks(
        BookmarksSetParams(path=str(outline), output=str(tmp_path / "c.pdf"), items=items),
        silent_progress(),
    )
    read = get_bookmarks(BookmarksParams(path=result.output), silent_progress()).items
    assert [item.collapsed for item in read] == [True, False, False, False]


def test_outline_counts_follow_the_open_state():
    assert outline_counts([1, 2, 3, 2, 1], [False, True, False, False, False]) == [
        2,
        -1,
        0,
        0,
        0,
    ]
    assert outline_counts([1, 2, 2], [True, False, False]) == [-2, 0, 0]


@pytest.mark.parametrize(
    ("name", "content", "reason"),
    [
        ("strings.json", json.dumps(["a"]).encode(), "bookmarkFile"),
        ("number.json", json.dumps([{"title": "x", "page": "abc"}]).encode(), "bookmarkFile"),
        ("legacy.json", '[{"title":"ş","page":1}]'.encode("cp1254"), "bookmarkFile"),
    ],
)
def test_bad_bookmark_files_are_refused_cleanly(
    outline: Path, tmp_path: Path, name: str, content: bytes, reason: str
):
    data = tmp_path / name
    data.write_bytes(content)
    with pytest.raises(OpError) as caught:
        import_bookmarks(
            BookmarksImportParams(
                path=str(outline), output=str(tmp_path / "x.pdf"), data_path=str(data)
            ),
            silent_progress(),
        )
    assert caught.value.data["reason"] == reason


def test_a_bookmark_file_saved_with_a_bom_is_read(outline: Path, tmp_path: Path):
    data = tmp_path / "bom.json"
    data.write_bytes(
        b"\xef\xbb\xbf" + json.dumps([{"level": 1, "title": "Giriş", "page": 2}]).encode()
    )
    result = import_bookmarks(
        BookmarksImportParams(
            path=str(outline), output=str(tmp_path / "b.pdf"), data_path=str(data)
        ),
        silent_progress(),
    )
    assert [item.title for item in result.items] == ["Giriş"]


def test_generating_from_a_document_without_headings_keeps_its_outline(
    outline: Path, tmp_path: Path
):
    blank = pymupdf.open()
    blank.new_page()
    blank_path = tmp_path / "blank.pdf"
    blank.save(blank_path)
    blank.close()
    with pytest.raises(OpError) as caught:
        generate_bookmarks(
            BookmarksGenerateParams(path=str(blank_path), output=str(tmp_path / "g.pdf")),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "noHeadings"}
    assert not (tmp_path / "g.pdf").exists()
