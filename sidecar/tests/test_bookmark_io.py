import json
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._bookmark_model import (
    BookmarkItem,
    BookmarksGenerateParams,
    BookmarksSuggestParams,
)
from vivepdf.ops.bookmarks import (
    BookmarksSetParams,
    generate_bookmarks,
    set_bookmarks,
    suggest_bookmarks,
)
from vivepdf.ops.bookmarks_transfer import (
    BookmarksExportParams,
    BookmarksImportParams,
    BookmarksParseParams,
    export_bookmarks,
    import_bookmarks,
    parse_bookmarks,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def outlined(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for _ in range(9):
        document.new_page(width=595, height=842)
    path = tmp_path / "plain.pdf"
    document.save(path)
    document.close()

    target = tmp_path / "outlined.pdf"
    set_bookmarks(
        BookmarksSetParams(
            path=str(path),
            output=str(target),
            items=[
                BookmarkItem(level=1, title="Birinci bölüm", page=1),
                BookmarkItem(level=2, title="Alt başlık", page=3),
                BookmarkItem(level=1, title="İkinci bölüm", page=6),
            ],
        ),
        silent_progress(),
    )
    return target


def _titles(path: Path) -> list[tuple[int, str, int]]:
    document = pymupdf.open(path)
    toc = [(level, title, page) for level, title, page in document.get_toc()]
    document.close()
    return toc


def test_exporting_writes_every_bookmark_with_its_level_and_page(outlined: Path, tmp_path: Path):
    data = tmp_path / "outline.json"
    result = export_bookmarks(
        BookmarksExportParams(path=str(outlined), output=str(data)), silent_progress()
    )
    assert result.count == 3
    payload = json.loads(data.read_text(encoding="utf-8"))
    assert [entry["title"] for entry in payload["bookmarks"]] == [
        "Birinci bölüm",
        "Alt başlık",
        "İkinci bölüm",
    ]
    assert [entry["level"] for entry in payload["bookmarks"]] == [1, 2, 1]
    assert [entry["page"] for entry in payload["bookmarks"]] == [1, 3, 6]


def test_an_exported_outline_comes_back_unchanged(outlined: Path, tmp_path: Path):
    data = tmp_path / "outline.json"
    export_bookmarks(BookmarksExportParams(path=str(outlined), output=str(data)), silent_progress())
    document = pymupdf.open()
    for _ in range(9):
        document.new_page(width=595, height=842)
    blank = tmp_path / "blank.pdf"
    document.save(blank)
    document.close()

    target = tmp_path / "restored.pdf"
    import_bookmarks(
        BookmarksImportParams(path=str(blank), output=str(target), data_path=str(data)),
        silent_progress(),
    )
    assert _titles(target) == _titles(outlined)


def test_importing_a_page_beyond_the_document_is_refused(outlined: Path, tmp_path: Path):
    data = tmp_path / "bad.json"
    data.write_text(
        json.dumps({"bookmarks": [{"level": 1, "title": "Yok", "page": 99}]}), encoding="utf-8"
    )
    with pytest.raises(OpError):
        import_bookmarks(
            BookmarksImportParams(
                path=str(outlined), output=str(tmp_path / "out.pdf"), data_path=str(data)
            ),
            silent_progress(),
        )


def test_importing_a_file_that_is_not_an_outline_is_refused(outlined: Path, tmp_path: Path):
    data = tmp_path / "junk.json"
    data.write_text("not json at all", encoding="utf-8")
    with pytest.raises(OpError):
        import_bookmarks(
            BookmarksImportParams(
                path=str(outlined), output=str(tmp_path / "out2.pdf"), data_path=str(data)
            ),
            silent_progress(),
        )


def test_a_level_that_jumps_is_pulled_back_to_the_next_one_down(outlined: Path, tmp_path: Path):
    data = tmp_path / "jump.json"
    data.write_text(
        json.dumps({"bookmarks": [{"level": 4, "title": "Derin", "page": 1}]}), encoding="utf-8"
    )
    target = tmp_path / "levelled.pdf"
    import_bookmarks(
        BookmarksImportParams(path=str(outlined), output=str(target), data_path=str(data)),
        silent_progress(),
    )
    assert _titles(target) == [(1, "Derin", 1)]


def test_a_bookmark_every_third_page(outlined: Path, tmp_path: Path):
    target = tmp_path / "every.pdf"
    generate_bookmarks(
        BookmarksGenerateParams(
            path=str(outlined),
            output=str(target),
            mode="everyPage",
            every=3,
            label="Sayfa {n}",
        ),
        silent_progress(),
    )
    assert _titles(target) == [(1, "Sayfa 1", 1), (1, "Sayfa 4", 4), (1, "Sayfa 7", 7)]


def _positioned_file(tmp_path: Path) -> Path:
    data = tmp_path / "positioned.json"
    data.write_text(
        json.dumps(
            {
                "bookmarks": [
                    {"level": 1, "title": "Konum", "page": 2, "left": 50, "top": 400, "zoom": 1.5},
                    {"level": 2, "title": "Konumsuz", "page": 3},
                ]
            }
        ),
        encoding="utf-8",
    )
    return data


def test_imported_items_keep_their_position_and_zoom(outlined: Path, tmp_path: Path):
    result = import_bookmarks(
        BookmarksImportParams(
            path=str(outlined),
            output=str(tmp_path / "pos.pdf"),
            data_path=str(_positioned_file(tmp_path)),
        ),
        silent_progress(),
    )
    first, second = result.items
    assert (first.left, first.top, first.zoom) == (50, 400, 1.5)
    assert (second.left, second.top, second.zoom) == (None, None, None)


def test_parsing_a_bookmark_file_returns_items_and_writes_nothing(outlined: Path, tmp_path: Path):
    before = sorted(item.name for item in tmp_path.iterdir())
    result = parse_bookmarks(
        BookmarksParseParams(path=str(outlined), data_path=str(_positioned_file(tmp_path))),
        silent_progress(),
    )
    assert [(item.level, item.title, item.page) for item in result.items] == [
        (1, "Konum", 2),
        (2, "Konumsuz", 3),
    ]
    assert (result.items[0].left, result.items[0].top, result.items[0].zoom) == (50, 400, 1.5)
    assert sorted(item.name for item in tmp_path.iterdir()) == sorted([*before, "positioned.json"])


def test_parsing_without_replace_keeps_the_existing_outline_first(outlined: Path, tmp_path: Path):
    result = parse_bookmarks(
        BookmarksParseParams(
            path=str(outlined), data_path=str(_positioned_file(tmp_path)), replace=False
        ),
        silent_progress(),
    )
    assert [item.title for item in result.items] == [
        "Birinci bölüm",
        "Alt başlık",
        "İkinci bölüm",
        "Konum",
        "Konumsuz",
    ]


def test_parsing_a_bad_file_is_refused(outlined: Path, tmp_path: Path):
    data = tmp_path / "junk.json"
    data.write_text("{", encoding="utf-8")
    with pytest.raises(OpError) as caught:
        parse_bookmarks(
            BookmarksParseParams(path=str(outlined), data_path=str(data)), silent_progress()
        )
    assert caught.value.data == {"reason": "bookmarkFile"}
    with pytest.raises(OpError):
        parse_bookmarks(
            BookmarksParseParams(path=str(outlined), data_path=str(tmp_path / "none.json")),
            silent_progress(),
        )


def test_suggesting_bookmarks_every_page_writes_nothing(outlined: Path, tmp_path: Path):
    before = sorted(item.name for item in tmp_path.iterdir())
    result = suggest_bookmarks(
        BookmarksSuggestParams(path=str(outlined), mode="everyPage", every=4, label="Sayfa {n}"),
        silent_progress(),
    )
    assert [(item.title, item.page) for item in result.items] == [
        ("Sayfa 1", 1),
        ("Sayfa 5", 5),
        ("Sayfa 9", 9),
    ]
    assert sorted(item.name for item in tmp_path.iterdir()) == before


def test_suggesting_headings_on_a_document_without_text_is_refused(outlined: Path):
    with pytest.raises(OpError) as caught:
        suggest_bookmarks(BookmarksSuggestParams(path=str(outlined)), silent_progress())
    assert caught.value.data == {"reason": "noHeadings"}
