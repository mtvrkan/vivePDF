from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._bookmark_model import BookmarkItem
from vivepdf.ops.bookmarks import (
    BookmarksParams,
    BookmarksSetParams,
    get_bookmarks,
    set_bookmarks,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _document(tmp_path: Path, bodies: list[str] | None = None) -> Path:
    document = pymupdf.open()
    for _ in range(4):
        document.new_page()
    if bodies:
        root = document.get_new_xref()
        xrefs = [document.get_new_xref() for _ in bodies]
        document.update_object(
            root,
            f"<</Type/Outlines/First {xrefs[0]} 0 R/Last {xrefs[-1]} 0 R/Count {len(xrefs)}>>",
        )
        for index, (xref, body) in enumerate(zip(xrefs, bodies, strict=True)):
            links = f"/Parent {root} 0 R"
            if index:
                links += f"/Prev {xrefs[index - 1]} 0 R"
            if index < len(xrefs) - 1:
                links += f"/Next {xrefs[index + 1]} 0 R"
            document.update_object(xref, f"<</Title(item {index}){links}{body}>>")
        document.xref_set_key(document.pdf_catalog(), "Outlines", f"{root} 0 R")
    else:
        document.set_toc([[1, "Eski", 1], [2, "Alt", 2]])
    path = tmp_path / "yer imleri.pdf"
    document.save(path)
    document.close()
    return path


def _items(path: Path) -> list[BookmarkItem]:
    return get_bookmarks(BookmarksParams(path=str(path)), silent_progress()).items


def _set_in_place(path: Path, items: list[BookmarkItem]):
    return set_bookmarks(
        BookmarksSetParams(path=str(path), in_place=True, items=items), silent_progress()
    )


def test_writing_in_place_replaces_the_outline_in_the_same_file(tmp_path: Path):
    path = _document(tmp_path)

    result = _set_in_place(
        path,
        [
            BookmarkItem(level=1, title="Yeni", page=3),
            BookmarkItem(level=2, title="Çocuk", page=4),
        ],
    )

    assert result.output == str(path)
    assert sorted(entry.name for entry in tmp_path.iterdir()) == [path.name]
    with pymupdf.open(path) as document:
        assert document.get_toc() == [[1, "Yeni", 3], [2, "Çocuk", 4]]


def test_neither_output_nor_in_place_is_refused(tmp_path: Path):
    path = _document(tmp_path)

    with pytest.raises(OpError) as raised:
        set_bookmarks(
            BookmarksSetParams(path=str(path), items=[BookmarkItem(level=1, title="A", page=1)]),
            silent_progress(),
        )

    assert raised.value.code == ErrorCode.INVALID_PARAMS
    assert raised.value.data["reason"] == "outputRequired"


def test_both_output_and_in_place_are_refused(tmp_path: Path):
    path = _document(tmp_path)

    with pytest.raises(OpError) as raised:
        set_bookmarks(
            BookmarksSetParams(
                path=str(path),
                output=str(tmp_path / "out.pdf"),
                in_place=True,
                items=[BookmarkItem(level=1, title="A", page=1)],
            ),
            silent_progress(),
        )

    assert raised.value.data["reason"] == "outputAndInPlace"


def test_an_invalid_tree_leaves_the_file_untouched(tmp_path: Path):
    path = _document(tmp_path)
    before = path.read_bytes()

    with pytest.raises(OpError):
        _set_in_place(path, [BookmarkItem(level=1, title="Dışarıda", page=9)])

    assert path.read_bytes() == before


def test_kept_actions_survive_an_in_place_rewrite(tmp_path: Path):
    path = _document(
        tmp_path,
        [
            "/A<</S/JavaScript/JS(app.alert(1))>>",
            "/A<</S/Launch/F(notes.txt)>>",
        ],
    )
    before = _items(path)
    renamed = [
        before[1].model_copy(update={"title": "Notlar"}),
        before[0].model_copy(update={"level": 2}),
    ]

    _set_in_place(path, renamed)

    after = _items(path)
    assert [(item.title, item.level, item.target) for item in after] == [
        ("Notlar", 1, "launch"),
        ("item 0", 2, "other"),
    ]
    with pymupdf.open(path) as document:
        bodies = [
            document.xref_object(entry[3]["xref"], compressed=True)
            for entry in document.get_toc(simple=False)
        ]
    assert "/S/Launch" in bodies[0]
    assert "/S/JavaScript" in bodies[1]
