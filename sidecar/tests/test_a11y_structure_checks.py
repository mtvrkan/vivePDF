from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._access_structure import contrast_ratio, order_differs
from vivepdf.ops.a11y import CheckParams, check
from vivepdf.rpc.progress import silent_progress


def _check_of(path: Path, check_id: str):
    report = check(CheckParams(path=str(path)), silent_progress())
    return report, {item.id: item for item in report.checks}[check_id]


def _marked_content(count: int) -> bytes:
    parts = [
        f"/P <</MCID {mcid}>> BDC BT /helv 11 Tf 72 {80 + mcid * 20} Td (Satir {mcid}) Tj ET EMC"
        for mcid in range(count)
    ]
    return " ".join(parts).encode("latin-1")


def _new_object(document: pymupdf.Document, text: str) -> int:
    xref = document.get_new_xref()
    document.update_object(xref, text)
    return xref


def _tagged(
    path: Path,
    order: list[int],
    extra_untagged_page: bool = False,
) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "x", fontname="helv", fontsize=11)
    document.update_stream(page.get_contents()[0], _marked_content(len(order)))
    root = document.get_new_xref()
    top = document.get_new_xref()
    kids = [
        _new_object(
            document,
            f"<</Type/StructElem/S/P/P {top} 0 R/Pg {page.xref} 0 R/K {mcid}>>",
        )
        for mcid in order
    ]
    references = " ".join(f"{kid} 0 R" for kid in kids)
    document.update_object(top, f"<</Type/StructElem/S/Document/P {root} 0 R/K [{references}]>>")
    document.update_object(
        root, f"<</Type/StructTreeRoot/K {top} 0 R/RoleMap<</ListItem/LI/Bullet/Lbl>>>>"
    )
    catalog = document.pdf_catalog()
    document.xref_set_key(catalog, "StructTreeRoot", f"{root} 0 R")
    document.xref_set_key(catalog, "MarkInfo", "<</Marked true>>")
    if extra_untagged_page:
        loose = document.new_page()
        loose.insert_text((72, 72), "Etiketsiz metin", fontsize=12)
    document.save(path)
    document.close()
    return path


def test_structure_in_content_order_passes(tmp_path: Path) -> None:
    path = _tagged(tmp_path / "sıralı.pdf", [0, 1, 2, 3, 4, 5])
    report, item = _check_of(path, "readingOrder")
    assert item.status == "pass"
    assert report.reading_order_pages == 0


def test_a_scrambled_structure_order_asks_for_review(tmp_path: Path) -> None:
    path = _tagged(tmp_path / "karışık.pdf", [5, 4, 3, 2, 1, 0])
    report, item = _check_of(path, "readingOrder")
    assert item.status == "warn"
    assert item.count == 1
    assert report.reading_order_pages == 1


def test_one_floating_element_out_of_order_is_tolerated(tmp_path: Path) -> None:
    path = _tagged(tmp_path / "float.pdf", [0, 7, 1, 2, 3, 4, 5, 6])
    _report, item = _check_of(path, "readingOrder")
    assert item.status == "pass"


def test_a_page_with_text_outside_the_structure_fails(tmp_path: Path) -> None:
    path = _tagged(tmp_path / "eksik.pdf", [0, 1, 2], extra_untagged_page=True)
    report, item = _check_of(path, "readingOrder")
    assert item.status == "fail"
    assert report.untagged_content_pages == 1


def test_an_untagged_document_fails_the_reading_order(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Etiketsiz", fontsize=12)
    document.new_page()
    path = tmp_path / "untagged.pdf"
    document.save(path)
    document.close()
    _report, item = _check_of(path, "readingOrder")
    assert item.status == "fail"
    assert item.count == 1


def _list_document(tmp_path: Path, name: str, list_children: str) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "x", fontname="helv", fontsize=11)
    document.update_stream(page.get_contents()[0], _marked_content(2))
    root = document.get_new_xref()
    top = document.get_new_xref()
    listing = document.get_new_xref()
    children = [
        _new_object(document, text.format(parent=listing, page=page.xref))
        for text in list_children.split("|")
    ]
    document.update_object(
        listing,
        f"<</Type/StructElem/S/L/P {top} 0 R/K [{' '.join(f'{kid} 0 R' for kid in children)}]>>",
    )
    document.update_object(top, f"<</Type/StructElem/S/Document/P {root} 0 R/K [{listing} 0 R]>>")
    document.update_object(
        root, f"<</Type/StructTreeRoot/K {top} 0 R/RoleMap<</ListItem/LI/Bullet/Lbl>>>>"
    )
    catalog = document.pdf_catalog()
    document.xref_set_key(catalog, "StructTreeRoot", f"{root} 0 R")
    document.xref_set_key(catalog, "MarkInfo", "<</Marked true>>")
    path = tmp_path / name
    document.save(path)
    document.close()
    return path


def _item_with_parts(tmp_path: Path, name: str, item_type: str, label_type: str) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "x", fontname="helv", fontsize=11)
    document.update_stream(page.get_contents()[0], _marked_content(2))
    root, top, listing, item, label, body = (document.get_new_xref() for _ in range(6))
    document.update_object(
        label, f"<</Type/StructElem/S/{label_type}/P {item} 0 R/Pg {page.xref} 0 R/K 0>>"
    )
    document.update_object(
        body, f"<</Type/StructElem/S/LBody/P {item} 0 R/Pg {page.xref} 0 R/K 1>>"
    )
    document.update_object(
        item, f"<</Type/StructElem/S/{item_type}/P {listing} 0 R/K [{label} 0 R {body} 0 R]>>"
    )
    document.update_object(listing, f"<</Type/StructElem/S/L/P {top} 0 R/K [{item} 0 R]>>")
    document.update_object(top, f"<</Type/StructElem/S/Document/P {root} 0 R/K [{listing} 0 R]>>")
    document.update_object(
        root, f"<</Type/StructTreeRoot/K {top} 0 R/RoleMap<</ListItem/LI/Bullet/Lbl>>>>"
    )
    catalog = document.pdf_catalog()
    document.xref_set_key(catalog, "StructTreeRoot", f"{root} 0 R")
    document.xref_set_key(catalog, "MarkInfo", "<</Marked true>>")
    path = tmp_path / name
    document.save(path)
    document.close()
    return path


@pytest.mark.parametrize(("item_type", "label_type"), [("LI", "Lbl"), ("ListItem", "Bullet")])
def test_a_well_formed_list_passes(tmp_path: Path, item_type: str, label_type: str) -> None:
    path = _item_with_parts(tmp_path, f"liste {item_type}.pdf", item_type, label_type)
    report, item = _check_of(path, "listStructure")
    assert item.status == "pass"
    assert report.lists == 1
    assert report.list_errors == 0


def test_a_label_outside_a_list_item_fails(tmp_path: Path) -> None:
    path = _item_with_parts(tmp_path, "bozuk.pdf", "P", "Lbl")
    report, item = _check_of(path, "listStructure")
    assert item.status == "fail"
    assert report.list_errors >= 2


def test_a_paragraph_directly_inside_a_list_fails(tmp_path: Path) -> None:
    path = _list_document(
        tmp_path,
        "p-in-l.pdf",
        "<</Type/StructElem/S/P/P {parent} 0 R/Pg {page} 0 R/K 0>>",
    )
    report, item = _check_of(path, "listStructure")
    assert item.status == "fail"
    assert report.list_errors == 1


def _coloured(tmp_path: Path, name: str, colour, size: float = 11, backdrop=None) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    if backdrop is not None:
        page.draw_rect(pymupdf.Rect(50, 50, 400, 120), color=None, fill=backdrop)
    page.insert_text((72, 90), "Kontrast örneği", fontsize=size, color=colour)
    path = tmp_path / name
    document.save(path)
    document.close()
    return path


def test_pale_grey_text_on_white_is_flagged_as_an_estimate(tmp_path: Path) -> None:
    path = _coloured(tmp_path, "açık gri.pdf", (0.75, 0.75, 0.75))
    report, item = _check_of(path, "contrast")
    assert item.status == "warn"
    assert item.count == 1
    assert item.value == "1"
    assert report.low_contrast_pages == 1


def test_white_text_on_a_dark_panel_passes(tmp_path: Path) -> None:
    path = _coloured(tmp_path, "koyu.pdf", (1, 1, 1), backdrop=(0.1, 0.1, 0.3))
    _report, item = _check_of(path, "contrast")
    assert item.status == "pass"


def test_large_text_uses_the_lower_threshold(tmp_path: Path) -> None:
    grey = (0.5, 0.5, 0.5)
    assert 3.0 < contrast_ratio(grey, (1, 1, 1)) < 4.5
    _report, small = _check_of(_coloured(tmp_path, "small.pdf", grey, 10), "contrast")
    _report, large = _check_of(_coloured(tmp_path, "large.pdf", grey, 24), "contrast")
    assert small.status == "warn"
    assert large.status == "pass"


def _on_picture(
    tmp_path: Path, name: str, backdrop: tuple[int, int, int], colour, as_jpeg: bool = False
) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 50, 10), False)
    pixmap.set_rect(pixmap.irect, backdrop)
    if as_jpeg:
        page.insert_image(pymupdf.Rect(50, 50, 400, 120), stream=pixmap.tobytes("jpeg"))
    else:
        page.insert_image(pymupdf.Rect(50, 50, 400, 120), pixmap=pixmap)
    page.insert_text((72, 90), "Resim üstü", fontsize=11, color=colour)
    path = tmp_path / name
    document.save(path)
    document.close()
    return path


@pytest.mark.parametrize("as_jpeg", [False, True])
def test_light_text_on_a_dark_picture_passes(tmp_path: Path, as_jpeg: bool) -> None:
    path = _on_picture(tmp_path, "resim.pdf", (20, 20, 20), (1, 1, 1), as_jpeg)
    _report, item = _check_of(path, "contrast")
    assert item.status == "pass"


@pytest.mark.parametrize("as_jpeg", [False, True])
def test_dark_text_on_a_dark_picture_is_estimated(tmp_path: Path, as_jpeg: bool) -> None:
    path = _on_picture(tmp_path, "koyu resim.pdf", (40, 40, 60), (0.1, 0.1, 0.1), as_jpeg)
    _report, item = _check_of(path, "contrast")
    assert item.status == "warn"
    assert item.count == 1


def test_black_text_on_a_pale_picture_passes(tmp_path: Path) -> None:
    path = _on_picture(tmp_path, "açık resim.pdf", (235, 230, 220), (0, 0, 0))
    _report, item = _check_of(path, "contrast")
    assert item.status == "pass"


def test_dark_text_on_a_dark_panel_is_flagged(tmp_path: Path) -> None:
    path = _coloured(tmp_path, "koyu panel.pdf", (0.15, 0.15, 0.2), backdrop=(0.1, 0.1, 0.3))
    report, item = _check_of(path, "contrast")
    assert item.status == "warn"
    assert report.low_contrast_runs == 1


def test_a_small_panel_over_a_picture_wins_over_the_picture(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 20), False)
    pixmap.set_rect(pixmap.irect, (20, 20, 20))
    page.insert_image(pymupdf.Rect(20, 20, 500, 300), pixmap=pixmap)
    page.draw_rect(pymupdf.Rect(60, 70, 300, 110), color=None, fill=(1, 1, 1))
    page.insert_text((72, 95), "Etiket", fontsize=11, color=(0, 0, 0))
    path = tmp_path / "etiket.pdf"
    document.save(path)
    document.close()
    _report, item = _check_of(path, "contrast")
    assert item.status == "pass"


def test_text_on_a_turned_page_over_a_picture_is_estimated(tmp_path: Path) -> None:
    path = _on_picture(tmp_path, "döndür.pdf", (40, 40, 60), (0.1, 0.1, 0.1))
    with pymupdf.open(path) as document:
        document[0].set_rotation(90)
        turned = tmp_path / "döndürülmüş.pdf"
        document.save(turned)
    _report, item = _check_of(turned, "contrast")
    assert item.status == "warn"


def test_twin_pictures_fall_back_to_the_rendered_backdrop(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    for colour, rect in (
        ((40, 40, 60), pymupdf.Rect(50, 50, 400, 120)),
        ((250, 250, 250), pymupdf.Rect(50, 400, 400, 470)),
    ):
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 50, 10), False)
        pixmap.set_rect(pixmap.irect, colour)
        page.insert_image(rect, pixmap=pixmap)
    page.insert_text((72, 90), "İkiz resim", fontsize=11, color=(0.1, 0.1, 0.1))
    path = tmp_path / "ikiz.pdf"
    document.save(path)
    document.close()
    _report, item = _check_of(path, "contrast")
    assert item.status == "warn"


def test_order_comparison_ignores_marked_content_missing_from_the_page() -> None:
    assert not order_differs([0, 1, 2, 99], [0, 1, 2])
    assert order_differs([4, 3, 2, 1, 0], [0, 1, 2, 3, 4])
