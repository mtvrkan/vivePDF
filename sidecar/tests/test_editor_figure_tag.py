import re
from pathlib import Path

import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops.a11y import CheckParams, check
from vivepdf.ops.a11y_fix import FixParams, fix
from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">'
    '<line x1="0" y1="20" x2="100" y2="20" stroke="#000" stroke-width="2"/>'
    '<text x="10" y="15" font-family="Helvetica" font-size="12">OH</text>'
    "</svg>"
)
TABLE = {
    "cells": [["Name", "Age"], ["Ada", "36"]],
    "columnWidths": [1, 1],
    "align": ["left", "left"],
    "width": 200,
}


def _plain(tmp_path: Path, pages: int = 2) -> Path:
    document = pymupdf.open()
    for number in range(pages):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 90), f"Chapter {number + 1}", fontsize=24)
        page.insert_text((72, 130), "The body text of this page.", fontsize=11)
    path = tmp_path / "plain.pdf"
    document.save(path)
    document.close()
    return path


def _tagged(tmp_path: Path, pages: int = 2) -> Path:
    output = tmp_path / "tagged.pdf"
    fix(
        FixParams(path=str(_plain(tmp_path, pages)), output=str(output), auto_tag=True),
        silent_progress(),
    )
    return output


def _place(source: Path, target: Path, *objects: dict) -> None:
    apply(
        EditorApplyParams.model_validate(
            {"path": str(source), "output": str(target), "objects": list(objects)}
        ),
        silent_progress(),
    )


def _drawing(page: int, alt: str | None = None) -> dict:
    return {
        "kind": "drawing",
        "page": page,
        "x0": 100,
        "y0": 300,
        "x1": 300,
        "y1": 380,
        "svg": SVG,
        "alt": alt,
    }


def _figures(document: pymupdf.Document) -> list[int]:
    return [
        xref
        for xref in range(1, document.xref_length())
        if document.xref_get_key(xref, "S") == ("name", "/Figure")
    ]


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", text)


def _statuses(path: Path) -> dict[str, str]:
    report = check(CheckParams(path=str(path)), silent_progress())
    return {item.id: item.status for item in report.checks}


def _forms(document: pymupdf.Document) -> list[int]:
    return [
        xref
        for xref in range(1, document.xref_length())
        if document.xref_get_key(xref, "Subtype") == ("name", "/Form")
        and document.xref_get_key(xref, "StructParents")[0] == "int"
    ]


def test_a_drawing_placed_in_a_tagged_pdf_becomes_a_figure_with_its_alt_text(
    tmp_path: Path,
) -> None:
    source = _tagged(tmp_path)
    output = tmp_path / "out.pdf"
    _place(source, output, _drawing(1, "Structure of  ethanol"))
    with pymupdf.open(output) as document:
        [figure] = _figures(document)
        assert document.xref_get_key(figure, "Alt")[1] == "Structure of ethanol"
        [form] = _forms(document)
        assert document.xref_stream(form).lstrip().startswith(b"/Figure <</MCID 0>> BDC")
        assert document.xref_get_key(figure, "K/Stm") == ("xref", f"{form} 0 R")
        key = int(document.xref_get_key(form, "StructParents")[1])
        root = int(document.xref_get_key(document.pdf_catalog(), "StructTreeRoot")[1].split()[0])
        assert int(document.xref_get_key(root, "ParentTreeNextKey")[1]) == key + 1
        assert _compact(f"{key} [{figure} 0 R]") in _compact(
            document.xref_get_key(root, "ParentTree/Nums")[1]
        )
        top = int(document.xref_get_key(root, "K")[1].split()[0])
        kids = [int(ref) for ref in document.xref_get_key(top, "K")[1].strip("[]").split()[0::3]]
        pages = [document.xref_get_key(kid, "Pg")[1] for kid in kids]
        first_page, second_page = (f"{document[index].xref} 0 R" for index in range(2))
        position = kids.index(figure)
        assert all(page == first_page for page in pages[:position])
        assert all(page == second_page for page in pages[position + 1 :])
        assert "OH" in document[0].get_text()
    statuses = _statuses(output)
    assert statuses["altText"] == "pass"
    assert statuses["readingOrder"] == "pass"


def test_objects_without_alt_text_are_marked_as_artifacts_and_untagged_files_stay_untagged(
    tmp_path: Path,
) -> None:
    source = _tagged(tmp_path)
    output = tmp_path / "out.pdf"
    _place(
        source,
        output,
        _drawing(2, "   "),
        {"kind": "table", "page": 1, "x0": 72, "y0": 400, "x1": 300, "y1": 460, **TABLE},
    )
    with pymupdf.open(output) as document:
        assert _figures(document) == []
        placed = [
            xref
            for xref in range(1, document.xref_length())
            if document.xref_get_key(xref, "Subtype") == ("name", "/Form")
            and document.xref_stream(xref).lstrip().startswith(b"/Artifact BMC")
        ]
        assert len(placed) == 2
    assert _statuses(output)["readingOrder"] == "pass"

    plain = _plain(tmp_path)
    untouched = tmp_path / "untouched.pdf"
    _place(plain, untouched, _drawing(1, "A line"))
    with pymupdf.open(untouched) as document:
        assert document.xref_get_key(document.pdf_catalog(), "StructTreeRoot")[0] == "null"
        assert b"BDC" not in b"".join(
            document.xref_stream(xref) or b""
            for xref in range(1, document.xref_length())
            if document.xref_is_stream(xref)
        )


def test_a_nested_parent_tree_gets_the_new_key_in_its_last_leaf(tmp_path: Path) -> None:
    document = pymupdf.open(_plain(tmp_path, pages=1))
    page = document[0]
    catalog = document.pdf_catalog()
    leaf, tree, top, root, paragraph = (document.get_new_xref() for _ in range(5))
    document.update_object(
        paragraph, f"<</Type/StructElem/S/P/P {top} 0 R/Pg {page.xref} 0 R/K 0>>"
    )
    document.update_object(top, f"<</Type/StructElem/S/Document/P {root} 0 R/K {paragraph} 0 R>>")
    document.update_object(leaf, f"<</Nums[4 [{paragraph} 0 R]]/Limits[4 4]>>")
    document.update_object(tree, f"<</Kids[{leaf} 0 R]>>")
    document.update_object(root, f"<</Type/StructTreeRoot/K {top} 0 R/ParentTree {tree} 0 R>>")
    document.xref_set_key(catalog, "StructTreeRoot", f"{root} 0 R")
    source = tmp_path / "nested.pdf"
    document.save(source)
    document.close()
    output = tmp_path / "out.pdf"
    _place(source, output, _drawing(1, "Figure"))
    with pymupdf.open(output) as result:
        [figure] = _figures(result)
        assert _compact(result.xref_get_key(leaf, "Limits")[1]) == "[45]"
        assert _compact(f"5 [{figure} 0 R]") in _compact(result.xref_get_key(leaf, "Nums")[1])
        assert _compact(result.xref_get_key(top, "K")[1]) == _compact(
            f"[{paragraph} 0 R {figure} 0 R]"
        )


def test_alt_text_longer_than_the_limit_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        EditorApplyParams.model_validate({"path": "x.pdf", "objects": [_drawing(1, "x" * 2001)]})


def _picture(tmp_path: Path, page: int, alt: str | None = None, **box: float) -> dict:
    path = tmp_path / "picture.png"
    if not path.exists():
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 80), False)
        pixmap.set_rect(pixmap.irect, (200, 40, 40))
        pixmap.save(path)
    placed = {"x0": 100, "y0": 300, "x1": 300, "y1": 380, **box}
    return {"kind": "image", "page": page, "path": str(path), "alt": alt, **placed}


def _image_boxes(path: Path) -> list[tuple[float, ...]]:
    with pymupdf.open(path) as document:
        return [
            tuple(round(value, 1) for value in info["bbox"])
            for info in document[0].get_image_info()
        ]


def test_a_picture_placed_in_a_tagged_pdf_becomes_a_figure_where_it_was_drawn(
    tmp_path: Path,
) -> None:
    source = _tagged(tmp_path)
    output = tmp_path / "out.pdf"
    _place(source, output, _picture(tmp_path, 1, "Red  banner"))
    with pymupdf.open(output) as document:
        [figure] = _figures(document)
        assert document.xref_get_key(figure, "Alt")[1] == "Red banner"
        [form] = _forms(document)
        assert document.xref_stream(form).lstrip().startswith(b"/Figure <</MCID 0>> BDC")
    assert _image_boxes(output) == [(100.0, 300.0, 300.0, 380.0)]
    assert _statuses(output)["altText"] == "pass"


def test_a_picture_on_a_turned_tagged_page_lands_where_an_untagged_one_does(
    tmp_path: Path,
) -> None:
    turned_plain = tmp_path / "turned.pdf"
    with pymupdf.open(_plain(tmp_path, pages=1)) as document:
        document[0].set_rotation(90)
        document.save(turned_plain)
    turned_tagged = tmp_path / "turned-tagged.pdf"
    fix(
        FixParams(path=str(turned_plain), output=str(turned_tagged), auto_tag=True),
        silent_progress(),
    )
    picture = _picture(tmp_path, 1, "", x0=150, y0=100, x1=350, y1=180)
    plain_out = tmp_path / "plain-out.pdf"
    tagged_out = tmp_path / "tagged-out.pdf"
    _place(turned_plain, plain_out, picture)
    _place(turned_tagged, tagged_out, picture)
    assert _image_boxes(tagged_out) == _image_boxes(plain_out)
    with pymupdf.open(tagged_out) as document:
        assert _figures(document) == []
        assert any(
            document.xref_get_key(xref, "Subtype") == ("name", "/Form")
            and document.xref_stream(xref).lstrip().startswith(b"/Artifact BMC")
            for xref in range(1, document.xref_length())
        )


def test_a_missing_picture_in_a_tagged_pdf_is_reported_and_nothing_is_written(
    tmp_path: Path,
) -> None:
    source = _tagged(tmp_path)
    output = tmp_path / "out.pdf"
    picture = {**_picture(tmp_path, 1, "Gone"), "path": str(tmp_path / "gone.png")}
    with pytest.raises(OpError) as raised:
        _place(source, output, picture)
    assert raised.value.code == ErrorCode.FILE_NOT_FOUND
    assert not output.exists()


def _append_update(path: Path, objects: dict[int, str], size: int, root: int) -> None:
    data = path.read_bytes()
    previous = int(data[data.rindex(b"startxref") + len(b"startxref") :].split()[0])
    body = b""
    entries = []
    for number, text in objects.items():
        entries.append((number, len(data) + len(body)))
        body += f"{number} 0 obj\n{text}\nendobj\n".encode()
    table = "xref\n0 1\n0000000000 65535 f \n" + "".join(
        f"{number} 1\n{offset:010d} 00000 n \n" for number, offset in entries
    )
    trailer = f"trailer\n<</Size {size}/Root {root} 0 R/Prev {previous}>>\n"
    footer = f"startxref\n{len(data) + len(body)}\n%%EOF\n"
    path.write_bytes(data + body + (table + trailer + footer).encode())


def test_a_structure_kid_pointing_at_an_object_missing_from_the_xref_is_skipped(
    tmp_path: Path,
) -> None:
    document = pymupdf.open(_plain(tmp_path, pages=1))
    page = document[0]
    catalog = document.pdf_catalog()
    tree, top, root, paragraph = (document.get_new_xref() for _ in range(4))
    document.update_object(
        paragraph, f"<</Type/StructElem/S/P/P {top} 0 R/Pg {page.xref} 0 R/K 0>>"
    )
    document.update_object(top, f"<</Type/StructElem/S/Document/P {root} 0 R/K {paragraph} 0 R>>")
    document.update_object(tree, f"<</Nums[0 [{paragraph} 0 R]]>>")
    document.update_object(root, f"<</Type/StructTreeRoot/K {top} 0 R/ParentTree {tree} 0 R>>")
    document.xref_set_key(catalog, "StructTreeRoot", f"{root} 0 R")
    size = document.xref_length()
    source = tmp_path / "gap.pdf"
    document.save(source)
    document.close()
    missing = size
    _append_update(
        source,
        {
            top: f"<</Type/StructElem/S/Document/P {root} 0 R/K[{paragraph} 0 R {missing} 0 R]>>",
            missing + 1: "<</Filler true>>",
        },
        size + 2,
        catalog,
    )
    output = tmp_path / "out.pdf"
    _place(source, output, _drawing(1, "Figure"))
    with pymupdf.open(output) as result:
        [figure] = [
            xref
            for xref in range(1, result.xref_length())
            if result.xref_object(xref, compressed=True).find("/S/Figure") >= 0
        ]
        assert result.xref_get_key(figure, "Alt")[1] == "Figure"
        assert f"{figure} 0 R" in result.xref_get_key(top, "K")[1]
