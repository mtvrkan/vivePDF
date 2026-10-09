import re

import numpy as np
import pymupdf
import pytest

from vivepdf.ops._forms import FORM_PREFIX, show_page
from vivepdf.ops._studio_models import StudioShadowItem
from vivepdf.ops._studio_shadow import shadow_document, shadow_dpi_limit


def _own_names(document: pymupdf.Document, page: pymupdf.Page) -> list[str]:
    kind, value = document.xref_get_key(page.xref, "Resources/XObject")
    if kind == "xref":
        value = document.xref_object(int(value.split()[0]))
    return re.findall(r"/([A-Za-z0-9]+)\s+\d+\s+0\s+R", value)


def _stamp(color: tuple[float, float, float]) -> pymupdf.Document:
    document = pymupdf.open()
    page = document.new_page(width=40, height=20)
    page.draw_rect(pymupdf.Rect(0, 0, 40, 10), color=None, fill=color)
    page.draw_circle((30, 15), 4, color=None, fill=(0, 0, 0))
    return document


def _placed(place) -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=200, height=200)
    sources = [_stamp((1, 0, 0)), _stamp((0, 0, 1))]
    for index in range(12):
        source = sources[index % 2]
        rect = pymupdf.Rect(10 + index * 12, 10 + index * 14, 70 + index * 12, 40 + index * 14)
        place(page, rect, source, index)
    pixels = page.get_pixmap(alpha=False).samples
    names = _own_names(document, page)
    for source in sources:
        source.close()
    document.close()
    return pixels, names


def test_places_pages_exactly_like_pymupdf_with_unique_names():
    def ours(page, rect, source, index):
        show_page(page, rect, source, 0, keep_proportion=index % 3 == 0, rotate=(index % 4) * 90)

    def theirs(page, rect, source, index):
        page.show_pdf_page(rect, source, 0, keep_proportion=index % 3 == 0, rotate=(index % 4) * 90)

    our_pixels, our_names = _placed(ours)
    their_pixels, _ = _placed(theirs)

    assert our_pixels == their_pixels
    assert len(our_names) == len(set(our_names)) == 12
    assert all(name.startswith(FORM_PREFIX) for name in our_names)


def test_keeps_names_apart_from_forms_already_on_the_page():
    document = pymupdf.open()
    page = document.new_page(width=100, height=100)
    source = _stamp((0, 1, 0))
    page.show_pdf_page(pymupdf.Rect(0, 0, 40, 20), source, 0)
    taken = set(_own_names(document, page))

    show_page(page, pymupdf.Rect(50, 50, 90, 70), source, 0)
    page.show_pdf_page(pymupdf.Rect(0, 50, 40, 70), source, 0)

    names = _own_names(document, page)
    assert len(names) == len(set(names)) == 3
    assert taken < set(names)
    source.close()
    document.close()


def test_refuses_an_empty_target_or_the_page_s_own_document():
    document = pymupdf.open()
    page = document.new_page(width=100, height=100)
    with pytest.raises(ValueError):
        show_page(page, pymupdf.Rect(10, 10, 10, 10), _stamp((0, 0, 0)), 0)
    with pytest.raises(ValueError):
        show_page(page, pymupdf.Rect(0, 0, 50, 50), document, 0)
    document.close()


def _shadow_width(limit: float | None) -> int:
    rect = {
        "kind": "vector",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 60,
        "paths": [
            {"d": "M0 0 L100 0 L100 60 L0 60 Z", "fill": {"type": "solid", "color": "#000000"}}
        ],
    }
    item = StudioShadowItem.model_validate(
        {
            "kind": "shadow",
            "x": 0,
            "y": 0,
            "width": 100,
            "height": 60,
            "shadow": {"color": "#000000", "opacity": 0.5, "x": 4, "y": 4, "blur": 6},
            "items": [rect],
        }
    )
    source = _stamp((0, 0, 0))
    if limit is None:
        document, _ = shadow_document(item, [(source, 0.0)])
    else:
        with shadow_dpi_limit(limit):
            document, _ = shadow_document(item, [(source, 0.0)])
    xref = document[0].get_images()[0][0]
    width = pymupdf.Pixmap(document, xref).width
    drawn = document[0].get_pixmap(alpha=False)
    pixels = np.frombuffer(drawn.samples, dtype=np.uint8)
    document.close()
    source.close()
    assert pixels.min() < 200
    return width


def test_thumbnails_draw_shadows_at_screen_size_while_exports_stay_sharp():
    exported = _shadow_width(None)

    previewed = _shadow_width(36)

    assert previewed < exported / 3
    assert _shadow_width(None) == exported
