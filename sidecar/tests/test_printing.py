import sys
from pathlib import Path

import pytest

from vivepdf.ops.printing import (
    PrintersParams,
    PrintParams,
    cups_arguments,
    plan_placement,
    printers,
)
from vivepdf.rpc.progress import silent_progress


def test_fit_keeps_aspect_and_centres_on_the_page():
    placement = plan_placement(595.0, 842.0, 4960, 7016, 600, 600, "fit")
    assert placement.rotate is False
    assert abs(placement.width - 4960) <= 3
    assert abs(placement.height - 7016) <= 3
    assert placement.x <= 1 and placement.y <= 1
    letter = plan_placement(612.0, 792.0, 4960, 7016, 600, 600, "fit")
    assert letter.width == 4960
    assert letter.height < 7016
    assert letter.y == (7016 - letter.height) // 2


def test_landscape_page_is_rotated_onto_portrait_paper_and_actual_size_never_overflows():
    slide = plan_placement(720.0, 540.0, 2480, 3508, 300, 300, "fit")
    assert slide.rotate is True
    assert slide.width == 2480
    poster = plan_placement(2000.0, 3000.0, 2480, 3508, 300, 300, "actual")
    assert poster.factor < 1.0
    assert poster.width <= 2480 and poster.height <= 3508
    small = plan_placement(200.0, 300.0, 2480, 3508, 300, 300, "actual")
    assert small.factor == 1.0
    assert small.width == round(200 / 72 * 300)


def test_cups_arguments_cover_ranges_copies_and_options():
    params = PrintParams(path="/tmp/a.pdf", pages="1-2,5", copies=3, scale="fit", grayscale=True)
    args = cups_arguments(params, [0, 1, 4], "Office")
    assert args[:3] == ["lp", "-n", "3"]
    assert "-d" in args and args[args.index("-d") + 1] == "Office"
    assert "page-ranges=1,2,5" in args
    assert "fit-to-page" in args and "ColorModel=Gray" in args
    assert args[-1] == str(Path("/tmp/a.pdf").resolve())


@pytest.mark.skipif(sys.platform != "win32", reason="Windows spooler only")
def test_windows_printer_listing_reports_backend():
    result = printers(PrintersParams(), silent_progress())
    assert result.backend == "windows"
    assert all(isinstance(entry.name, str) for entry in result.printers)


def test_validate_printer_rejects_unknown_name():
    from vivepdf.ops.printing import _validate_printer
    from vivepdf.rpc.errors import OpError

    with pytest.raises(OpError):
        _validate_printer("definitely-not-a-real-printer-xyz")


def test_validate_printer_allows_none():
    from vivepdf.ops.printing import _validate_printer

    _validate_printer(None)


def _coloured_pages(colours: list[tuple[float, float, float]]):
    import pymupdf

    document = pymupdf.open()
    for colour in colours:
        page = document.new_page(width=200, height=300)
        page.draw_rect(page.rect, color=colour, fill=colour)
    return document


def test_print_sheets_pick_odd_or_even_pages_and_reverse_whole_sheets():
    from vivepdf.ops.printing import print_sheets

    indices = [0, 1, 2, 3, 4]
    assert print_sheets(indices, "all", False, 1) == [[0], [1], [2], [3], [4]]
    assert print_sheets(indices, "odd", False, 1) == [[0], [2], [4]]
    assert print_sheets(indices, "even", True, 1) == [[3], [1]]
    assert print_sheets(indices, "all", True, 2) == [[4], [2, 3], [0, 1]]
    assert print_sheets([0], "even", False, 1) == []


def test_sheet_cells_follow_the_paper_orientation():
    from vivepdf.ops.printing import sheet_cells

    assert sheet_cells(200, 300, 2) == [(0, 0, 200, 150), (0, 150, 200, 150)]
    assert sheet_cells(300, 200, 2) == [(0, 0, 150, 200), (150, 0, 150, 200)]
    assert len(sheet_cells(300, 300, 9)) == 9
    assert sheet_cells(200, 300, 6)[-1] == (100, 200, 100, 100)


def test_auto_rotate_can_be_switched_off():
    turned = plan_placement(720.0, 540.0, 2480, 3508, 300, 300, "fit", auto_rotate=True)
    kept = plan_placement(720.0, 540.0, 2480, 3508, 300, 300, "fit", auto_rotate=False)
    assert turned.rotate is True
    assert kept.rotate is False
    assert kept.width == 2480 and kept.height < 3508


def test_four_pages_share_one_sheet_in_reading_order():
    from vivepdf.ops.printing import compose_sheet

    red, green, blue, black = (1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 0, 0)
    document = _coloured_pages([red, green, blue, black])
    params = PrintParams(path="unused.pdf", pages_per_sheet=4)
    sheet, box = compose_sheet(document, [0, 1, 2, 3], 400, 600, 72, 72, params)
    assert box == (0, 0, 400, 600)
    assert sheet.size == (400, 600)
    assert sheet.getpixel((100, 150)) == (255, 0, 0)
    assert sheet.getpixel((300, 150)) == (0, 255, 0)
    assert sheet.getpixel((100, 450)) == (0, 0, 255)
    assert sheet.getpixel((300, 450)) == (0, 0, 0)
    assert sheet.getpixel((200, 2)) == (255, 255, 255)
    half, _box = compose_sheet(document, [2], 400, 600, 72, 72, params)
    assert half.getpixel((100, 150)) == (0, 0, 255)
    assert half.getpixel((300, 450)) == (255, 255, 255)


def test_a_single_page_sheet_keeps_the_old_placement():
    from vivepdf.ops.printing import compose_sheet

    document = _coloured_pages([(1, 0, 0)])
    image, box = compose_sheet(document, [0], 400, 600, 72, 72, PrintParams(path="unused.pdf"))
    assert box == (0, 0, 400, 600)
    assert image.size == (400, 600)


def test_document_only_printing_drops_markup_but_keeps_fields_and_links():
    import pymupdf

    from vivepdf.ops.printing import strip_markup

    document = pymupdf.open()
    page = document.new_page()
    page.add_highlight_annot(pymupdf.Rect(50, 50, 100, 60))
    page.add_text_annot((200, 200), "note")
    widget = pymupdf.Widget()
    widget.field_name = "name"
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.rect = pymupdf.Rect(50, 300, 200, 320)
    page.add_widget(widget)
    page.insert_link(
        {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(0, 0, 10, 10), "uri": "https://a"}
    )
    assert strip_markup(document, [0, 0]) == 2
    page = document[0]
    assert list(page.annots()) == []
    assert len(list(page.widgets())) == 1
    assert [kind for _xref, kind, _name in page.annot_xrefs()].count(pymupdf.PDF_ANNOT_LINK) == 1


def test_cups_arguments_map_the_acrobat_options():
    params = PrintParams(
        path="/tmp/a.pdf",
        subset="even",
        reverse=True,
        pages_per_sheet=4,
        auto_rotate=False,
        annotations=False,
    )
    args = cups_arguments(params, [0, 1], None, Path("/tmp/stripped.pdf"))
    assert "page-set=even" in args and "outputorder=reverse" in args
    assert "number-up=4" in args and "nopdfAutoRotate" in args
    assert args[-1] == str(Path("/tmp/stripped.pdf").resolve())
    plain = cups_arguments(PrintParams(path="/tmp/a.pdf"), [0], None)
    assert not any(value.startswith(("page-set", "outputorder", "number-up")) for value in plain)


def test_an_unsupported_pages_per_sheet_is_refused():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PrintParams(path="/tmp/a.pdf", pages_per_sheet=3)
