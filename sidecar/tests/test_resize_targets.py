from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.page_geometry import ResizeParams, resize_pages
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


def _source(tmp_path: Path) -> pymupdf.Document:
    document = pymupdf.open()
    document.new_page(width=600, height=800)
    document.new_page(width=600, height=800)
    return document


def test_destinations_follow_the_scaled_page(tmp_path: Path):
    document = _source(tmp_path)
    first = document[0].xref
    root, item, other = (document.get_new_xref() for _ in range(3))
    document.update_object(root, f"<</Type/Outlines/First {item} 0 R/Last {other} 0 R/Count 2>>")
    document.update_object(
        item, f"<</Title(a)/Parent {root} 0 R/Next {other} 0 R/Dest[{first} 0 R/XYZ 50 700 0]>>"
    )
    document.update_object(
        other,
        f"<</Title(b)/Parent {root} 0 R/Prev {item} 0 R"
        f"/A<</S/GoTo/D[{first} 0 R/XYZ null 700 null]>>>>",
    )
    document.xref_set_key(document.pdf_catalog(), "Outlines", f"{root} 0 R")
    document[1].insert_link(
        {
            "kind": pymupdf.LINK_GOTO,
            "from": pymupdf.Rect(10, 10, 100, 30),
            "page": 0,
            "to": pymupdf.Point(0, 0),
        }
    )
    link_xref = document[1].annot_xrefs()[0][0]
    document.xref_set_key(link_xref, "Dest", f"[{first} 0 R/FitR 100 100 200 200]")
    source = tmp_path / "linked.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "small.pdf"

    resize_pages(
        ResizeParams(
            path=str(source), output=str(target), width=300, height=400, pages="1", mode="fit"
        ),
        silent_progress(),
    )

    with pymupdf.open(target) as document:
        xrefs = [entry[3]["xref"] for entry in document.get_toc(simple=False)]
        xrefs.append(document[1].annot_xrefs()[0][0])
        bodies = [document.xref_object(xref, compressed=True) for xref in xrefs]
    assert "/XYZ 25 350 0]" in bodies[0]
    assert "/XYZ null 350 null]" in bodies[1]
    assert "/FitR 50 50 100 100]" in bodies[2]


def test_box_mode_keeps_content_in_place_on_a_shifted_page(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    document.xref_set_key(page.xref, "MediaBox", "[20 50 620 850]")
    page = document.reload_page(page)
    page.draw_rect(pymupdf.Rect(100, 100, 200, 200), color=(0, 0, 0), fill=(0, 0, 0))
    source = tmp_path / "shifted.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "box.pdf"

    resize_pages(
        ResizeParams(
            path=str(source), output=str(target), preset="a4", mode="box", auto_rotate=False
        ),
        silent_progress(),
    )

    with pymupdf.open(target) as document:
        page = document[0]
        drawn = pymupdf.Rect()
        for item in page.get_drawings():
            drawn |= item["rect"]
        assert (round(page.rect.width), round(page.rect.height)) == (595, 842)
    assert abs(drawn.x0 - 100) < 1
    assert abs((842 - drawn.y1) - (800 - 200)) < 1


def test_matching_the_largest_page_keeps_each_orientation(tmp_path: Path):
    document = pymupdf.open()
    for width, height in [(595, 842), (842, 595), (420, 595)]:
        document.new_page(width=width, height=height)
    source = tmp_path / "mixed.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "unified.pdf"

    resize_pages(
        ResizeParams(path=str(source), output=str(target), match_largest=True), silent_progress()
    )

    with pymupdf.open(target) as document:
        sizes = [(round(page.rect.width), round(page.rect.height)) for page in document]
    assert sizes == [(595, 842), (842, 595), (595, 842)]


@pytest.mark.parametrize(("width", "height"), [(0, 400), (300, 20000), (-5, 400)])
def test_page_sizes_outside_what_a_pdf_can_hold_are_refused(
    tmp_path: Path, width: float, height: float
):
    document = _source(tmp_path)
    source = tmp_path / "plain.pdf"
    document.save(source)
    document.close()

    with pytest.raises(OpError) as refused:
        resize_pages(
            ResizeParams(
                path=str(source), output=str(tmp_path / "out.pdf"), width=width, height=height
            ),
            silent_progress(),
        )

    assert refused.value.data["reason"] == "pageSizeRange"


def test_a_margin_that_swallows_the_page_names_the_reason(tmp_path: Path):
    document = _source(tmp_path)
    source = tmp_path / "plain.pdf"
    document.save(source)
    document.close()

    with pytest.raises(OpError) as refused:
        resize_pages(
            ResizeParams(
                path=str(source), output=str(tmp_path / "out.pdf"), width=60, height=60, margin=40
            ),
            silent_progress(),
        )

    assert refused.value.data == {"reason": "marginTooLarge"}
