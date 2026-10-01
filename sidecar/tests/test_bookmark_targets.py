import json
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._bookmark_model import BookmarkItem, BookmarksGenerateParams
from vivepdf.ops.bookmarks import (
    BookmarkAddParams,
    BookmarksParams,
    BookmarksSetParams,
    add_bookmark,
    generate_bookmarks,
    get_bookmarks,
    set_bookmarks,
)
from vivepdf.ops.bookmarks_transfer import BookmarksImportParams, import_bookmarks
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


def _with_outline(document: pymupdf.Document, bodies: list[str]) -> None:
    root = document.get_new_xref()
    xrefs = [document.get_new_xref() for _ in bodies]
    document.update_object(
        root, f"<</Type/Outlines/First {xrefs[0]} 0 R/Last {xrefs[-1]} 0 R/Count {len(xrefs)}>>"
    )
    for index, (xref, body) in enumerate(zip(xrefs, bodies, strict=True)):
        links = f"/Parent {root} 0 R"
        if index:
            links += f"/Prev {xrefs[index - 1]} 0 R"
        if index < len(xrefs) - 1:
            links += f"/Next {xrefs[index + 1]} 0 R"
        document.update_object(xref, f"<</Title(item {index}){links}{body}>>")
    document.xref_set_key(document.pdf_catalog(), "Outlines", f"{root} 0 R")


def _items(path: Path) -> list[BookmarkItem]:
    return get_bookmarks(BookmarksParams(path=str(path)), silent_progress()).items


def _rewrite(path: Path, tmp_path: Path, items: list[BookmarkItem], name: str = "out.pdf") -> Path:
    target = tmp_path / name
    set_bookmarks(
        BookmarksSetParams(path=str(path), output=str(target), items=items), silent_progress()
    )
    return target


def _raw(path: Path) -> list[str]:
    with pymupdf.open(path) as document:
        return [
            document.xref_object(entry[3]["xref"], compressed=True)
            for entry in document.get_toc(simple=False)
        ]


def _comparable(items: list[BookmarkItem]) -> list[dict]:
    return [item.model_dump(exclude={"source"}) for item in items]


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_positions_survive_a_round_trip_on_turned_and_cropped_pages(tmp_path: Path, rotation: int):
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    document.xref_set_key(page.xref, "MediaBox", "[20 50 620 850]")
    document.xref_set_key(page.xref, "CropBox", "[70 90 570 750]")
    document.xref_set_key(page.xref, "Rotate", str(rotation))
    _with_outline(document, [f"/Dest[{page.xref} 0 R/XYZ 130 600 2]"])
    source = tmp_path / "turned.pdf"
    document.save(source)
    document.close()

    before = _items(source)
    written = _rewrite(source, tmp_path, before)

    assert "/XYZ 130 600 2]" in _raw(written)[0]
    assert _comparable(_items(written)) == _comparable(before)


def test_a_position_given_only_as_a_height_keeps_the_other_axis_free(tmp_path: Path):
    document = pymupdf.open()
    document.new_page(width=400, height=600)
    turned = document.new_page(width=400, height=600)
    turned.set_rotation(90)
    source = tmp_path / "plain.pdf"
    document.save(source)
    document.close()

    written = _rewrite(
        source,
        tmp_path,
        [
            BookmarkItem(level=1, title="upright", page=1, top=100),
            BookmarkItem(level=1, title="turned", page=2, top=100),
        ],
    )

    upright, turned_raw = _raw(written)
    assert "/XYZ null 500 null]" in upright
    assert "/XYZ 100 null null]" in turned_raw
    assert [item.top for item in _items(written)] == [100, 100]


def test_fit_modes_links_actions_and_styles_are_kept(tmp_path: Path):
    document = pymupdf.open()
    for _ in range(3):
        document.new_page()
    pages = [document[index].xref for index in range(3)]
    _with_outline(
        document,
        [
            "/A<</S/URI/URI(https://example.com/a)>>/C[1 0 0]/F 3",
            "/A<</S/Launch/F(notes.txt)>>",
            "/A<</S/GoToR/F(other.pdf)/D[2/FitH 300]/NewWindow true>>",
            f"/Dest[{pages[1]} 0 R/Fit]/F 2",
            f"/Dest[{pages[2]} 0 R/FitR 10 20 300 400]",
            f"/A<</S/GoTo/D[{pages[0]} 0 R/FitH 250]>>/C[0 0.5 1]",
            "/A<</S/JavaScript/JS(app.alert(1))>>",
        ],
    )
    source = tmp_path / "rich.pdf"
    document.save(source)
    document.close()

    before = _items(source)
    assert [item.target for item in before] == [
        "web",
        "launch",
        "file",
        "page",
        "page",
        "page",
        "other",
    ]
    assert (before[0].color, before[0].bold, before[0].italic) == ("#ff0000", True, True)
    assert (before[2].file, before[2].page) == ("other.pdf", 3)
    assert (before[3].fit, before[3].fit_args, before[3].bold) == ("Fit", [], True)
    assert (before[4].fit, before[4].fit_args) == ("FitR", [10, 20, 300, 400])
    assert (before[5].fit, before[5].fit_args, before[5].color) == ("FitH", [250], "#0080ff")

    written = _rewrite(source, tmp_path, before)

    assert _comparable(_items(written)) == _comparable(before)
    raw = _raw(written)
    assert "/URI(https://example.com/a)" in raw[0]
    assert "/S/Launch" in raw[1]
    assert "/NewWindow true" in raw[2]
    assert "/S/JavaScript" in raw[6]
    assert all("/Dest null" not in body for body in raw)


def test_moving_a_bookmark_to_another_page_drops_its_old_fit_box(tmp_path: Path):
    document = pymupdf.open()
    for _ in range(2):
        document.new_page()
    source = tmp_path / "two.pdf"
    document.save(source)
    document.close()
    with pytest.raises(ValueError):
        BookmarkItem(level=1, title="box", page=1, fit="FitR", fit_args=[1, 2, 3])
    written = _rewrite(
        source,
        tmp_path,
        [BookmarkItem(level=1, title="wide", page=2, fit="FitH", fit_args=None)],
    )
    assert "/FitH null]" in _raw(written)[0]


def test_new_links_are_checked_and_encoded(tmp_path: Path):
    document = pymupdf.open()
    document.new_page()
    source = tmp_path / "one.pdf"
    document.save(source)
    document.close()

    for item in (
        BookmarkItem(level=1, title="script", page=0, target="web", uri="javascript:alert(1)"),
        BookmarkItem(level=1, title="program", page=0, target="file", file="tool.exe"),
    ):
        with pytest.raises(OpError) as refused:
            _rewrite(source, tmp_path, [item])
        assert refused.value.data["reason"] == "bookmarkLink"

    written = _rewrite(
        source,
        tmp_path,
        [
            BookmarkItem(level=1, title="web", page=0, target="web", uri="https://örnek.com/ş"),
            BookmarkItem(level=1, title="doc", page=2, target="file", file="ek.pdf"),
        ],
    )
    raw = _raw(written)
    assert "/URI(https://xn--rnek-4qa.com/%C5%9F)" in raw[0]
    assert "/S/GoToR" in raw[1] and "/D[1/Fit]" in raw[1]


def test_empty_titles_are_refused(tmp_path: Path):
    document = pymupdf.open()
    document.new_page()
    source = tmp_path / "one.pdf"
    document.save(source)
    document.close()
    with pytest.raises(OpError) as refused:
        _rewrite(source, tmp_path, [BookmarkItem(level=1, title="  ", page=1)])
    assert refused.value.data == {"reason": "bookmarkTitle", "index": 0}


def test_found_headings_point_at_their_height(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.set_cropbox(pymupdf.Rect(0, 40, 595, 842))
    for line in range(12):
        page.insert_text((72, 120 + line * 14), "gövde metni satırı", fontsize=10)
    page.insert_text((72, 500), "Sonuç Bölümü", fontsize=20, fontname="dejavu", fontfile=FONT)
    source = tmp_path / "headings.pdf"
    document.save(source)
    document.close()

    result = generate_bookmarks(
        BookmarksGenerateParams(path=str(source), output=str(tmp_path / "gen.pdf")),
        silent_progress(),
    )

    with pymupdf.open(source) as document:
        heading = document[0].search_for("Sonuç Bölümü")[0]
    item = next(item for item in _items(Path(result.output)) if item.title == "Sonuç Bölümü")
    assert item.left is None
    assert abs(item.top - (heading.y0 - 6)) < 2


def test_imported_links_and_styles_are_written(tmp_path: Path):
    document = pymupdf.open()
    for _ in range(2):
        document.new_page()
    source = tmp_path / "two.pdf"
    document.save(source)
    document.close()
    data = tmp_path / "outline.json"
    data.write_text(
        json.dumps(
            {
                "bookmarks": [
                    {"level": 1, "title": "Site", "page": 0, "target": "web", "uri": "https://a.b"},
                    {"level": 1, "title": "Kırmızı", "page": 2, "color": "#FF0000", "bold": True},
                    {"level": 1, "title": "Geniş", "page": 1, "fit": "FitH", "fitArgs": [700]},
                    {"level": 1, "title": "Program", "page": 0, "target": "launch", "file": "a"},
                ]
            }
        ),
        encoding="utf-8",
    )

    result = import_bookmarks(
        BookmarksImportParams(
            path=str(source), output=str(tmp_path / "in.pdf"), data_path=str(data)
        ),
        silent_progress(),
    )

    items = _items(Path(result.output))
    assert (items[0].target, items[0].uri) == ("web", "https://a.b")
    assert (items[1].color, items[1].bold, items[1].page) == ("#ff0000", True, 2)
    assert (items[2].fit, items[2].fit_args) == ("FitH", [700])
    assert (items[3].target, items[3].page) == ("page", 0)


def test_a_bookmark_added_on_a_turned_cropped_page_lands_at_the_clicked_height(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.set_cropbox(pymupdf.Rect(50, 100, 550, 760))
    page.set_rotation(270)
    source = tmp_path / "add.pdf"
    document.save(source)
    document.close()

    add_bookmark(
        BookmarkAddParams(path=str(source), title="Burası", page=1, x=10, y=123), silent_progress()
    )

    assert _items(source)[0].top == 123
