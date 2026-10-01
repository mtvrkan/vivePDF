from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.bookmarks import BookmarkAddParams, BookmarksParams, add_bookmark, get_bookmarks
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _document(tmp_path: Path, name: str = "yer imi ş.pdf", outline: bool = True) -> Path:
    document = pymupdf.open()
    for _ in range(5):
        document.new_page(width=400, height=600)
    if outline:
        document.set_toc(
            [
                [1, "Giriş", 1],
                [2, "Alt", 2],
                [1, "Web", -1, {"kind": pymupdf.LINK_URI, "uri": "https://example.org"}],
                [1, "Son", 4, {"kind": pymupdf.LINK_GOTO, "page": 3, "color": (1, 0, 0)}],
            ]
        )
    path = tmp_path / name
    document.save(path)
    document.close()
    return path


def _add(path: Path, **fields: object):
    return add_bookmark(BookmarkAddParams(path=str(path), **fields), silent_progress())


def test_a_bookmark_is_inserted_in_page_order_and_keeps_the_rest(tmp_path: Path) -> None:
    path = _document(tmp_path)
    result = _add(path, title="Üçüncü sayfa", page=3, x=10, y=100)
    assert result.index == 3
    with pymupdf.open(path) as document:
        toc = document.get_toc(simple=False)
        assert [entry[1] for entry in toc] == ["Giriş", "Alt", "Web", "Üçüncü sayfa", "Son"]
        assert toc[2][3]["uri"] == "https://example.org"
        assert toc[4][3].get("color") == pytest.approx((1, 0, 0))
        added = toc[3]
        assert added[0] == 1 and added[2] == 3
        assert added[3]["to"].y == pytest.approx(100)


def test_a_bookmark_after_the_last_page_goes_to_the_end(tmp_path: Path) -> None:
    path = _document(tmp_path)
    _add(path, title="Last", page=5)
    with pymupdf.open(path) as document:
        assert document.get_toc()[-1] == [1, "Last", 5]


def test_a_document_without_bookmarks_gets_an_outline(tmp_path: Path) -> None:
    path = _document(tmp_path, outline=False)
    _add(path, title="First mark", page=2, y=50)
    _add(path, title="Earlier", page=1)
    with pymupdf.open(path) as document:
        assert document.get_toc() == [[1, "Earlier", 1], [1, "First mark", 2]]


def test_rotated_pages_store_the_point_the_reader_clicked(tmp_path: Path) -> None:
    path = _document(tmp_path, outline=False)
    with pymupdf.open(path) as document:
        document[1].set_rotation(90)
        document.saveIncr()
    _add(path, title="Rotated", page=2, x=500, y=40)
    with pymupdf.open(path) as document:
        page = document[1]
        item = document.get_toc(simple=False)[0][3]["xref"]
        kind, destination = document.xref_get_key(item, "Dest")
        assert kind == "array"
        assert destination.endswith(f"{page.xref} 0 R /XYZ 40 null null]") or destination.endswith(
            f"{page.xref} 0 R/XYZ 40 null null]"
        )
        assert document.get_toc() == [[1, "Rotated", 2]]
    assert get_bookmarks(BookmarksParams(path=str(path)), silent_progress()).items[0].top == 40


def test_invalid_pages_and_titles_are_refused(tmp_path: Path) -> None:
    path = _document(tmp_path)
    before = path.read_bytes()
    with pytest.raises(OpError) as refused:
        _add(path, title="Far", page=9)
    assert refused.value.code == ErrorCode.INVALID_PARAMS
    with pytest.raises(OpError) as empty:
        _add(path, title="   ", page=1)
    assert empty.value.code == ErrorCode.INVALID_PARAMS
    assert path.read_bytes() == before


def test_a_locked_file_needs_its_password_and_stays_locked(tmp_path: Path) -> None:
    source = _document(tmp_path)
    locked = tmp_path / "kilitli.pdf"
    with pymupdf.open(source) as document:
        document.save(locked, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="gizli", owner_pw="o")
    with pytest.raises(OpError) as refused:
        _add(locked, title="X", page=1)
    assert refused.value.code == ErrorCode.NEEDS_PASSWORD
    _add(locked, title="X", page=1, password="gizli")
    with pymupdf.open(locked) as document:
        assert document.needs_pass and document.authenticate("gizli")
        assert [1, "X", 1] in document.get_toc()
