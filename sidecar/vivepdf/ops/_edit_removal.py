from dataclasses import dataclass

import pymupdf

from vivepdf.ops._content import cut_spans
from vivepdf.ops._content_objects import walk_content
from vivepdf.ops._redaction import MOSTLY_INSIDE

CORE_SHARE = 0.25
MIN_CORE = 0.25
EFFECT_MARGIN = 0.5
EFFECT_COVERAGE = 0.4


@dataclass
class EditedArea:
    original: pymupdf.Rect
    graphics: pymupdf.Rect
    size: float


def _centre(box: pymupdf.Rect) -> pymupdf.Point:
    return pymupdf.Point((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)


def _mostly_inside(box: pymupdf.Rect, rect: pymupdf.Rect) -> bool:
    area = box.get_area()
    if area <= 0:
        return rect.contains(_centre(box))
    overlap = box & rect
    return not overlap.is_empty and overlap.get_area() >= area * MOSTLY_INSIDE


def own_glyph_boxes(page: pymupdf.Page, rect: pymupdf.Rect) -> list[list[pymupdf.Rect]]:
    data = page.get_text("rawdict", flags=pymupdf.TEXTFLAGS_TEXT)
    blocks = [block for block in data["blocks"] if block.get("type") == 0]
    whole = [block for block in blocks if _mostly_inside(pymupdf.Rect(block["bbox"]), rect)]
    runs: list[list[pymupdf.Rect]] = []
    for block in whole or blocks:
        for line in block["lines"]:
            run: list[pymupdf.Rect] = []
            for span in line["spans"]:
                owned = bool(whole) or _mostly_inside(pymupdf.Rect(span["bbox"]), rect)
                for char in span["chars"]:
                    if char["c"].isspace():
                        continue
                    box = pymupdf.Rect(char["bbox"])
                    if owned and rect.contains(_centre(box)):
                        run.append(box)
                        continue
                    if run:
                        runs.append(run)
                        run = []
            if run:
                runs.append(run)
    return runs


def _core(box: pymupdf.Rect) -> pymupdf.Rect:
    centre_x = (box.x0 + box.x1) / 2
    centre_y = (box.y0 + box.y1) / 2
    half_width = max(abs(box.width) * CORE_SHARE, MIN_CORE)
    half_height = max(abs(box.height) * CORE_SHARE, MIN_CORE)
    return pymupdf.Rect(
        centre_x - half_width, centre_y - half_height, centre_x + half_width, centre_y + half_height
    )


def glyph_bands(runs: list[list[pymupdf.Rect]]) -> list[pymupdf.Rect]:
    bands: list[pymupdf.Rect] = []
    for run in runs:
        band = _core(run[0])
        for box in run[1:]:
            band |= _core(box)
        bands.append(band)
    return bands


def _covered_share(box: pymupdf.Rect, glyphs: list[pymupdf.Rect]) -> float:
    area = box.get_area()
    if area <= 0:
        return 0.0
    covered = sum((glyph & box).get_area() for glyph in glyphs if not (glyph & box).is_empty)
    return covered / area


def _is_effect(box: pymupdf.Rect, area: EditedArea, glyphs: list[pymupdf.Rect]) -> bool:
    margin = area.size * EFFECT_MARGIN
    reach = pymupdf.Rect(
        area.original.x0 - margin,
        area.original.y0 - margin,
        area.original.x1 + margin,
        area.original.y1 + margin,
    )
    return reach.contains(box) and _covered_share(box, glyphs) >= EFFECT_COVERAGE


def _pdf_to_page(page: pymupdf.Page) -> pymupdf.Matrix:
    crop, media = page.cropbox, page.mediabox
    return pymupdf.Matrix(1, 0, 0, -1, -crop.x0, media.y1 - crop.y0)


def drop_effect_images(
    page: pymupdf.Page, areas: list[tuple[EditedArea, list[pymupdf.Rect]]]
) -> int:
    document = page.parent
    data = page.read_contents()
    content = walk_content(document, page, data)
    to_page = _pdf_to_page(page)
    spans: list[tuple[int, int]] = []
    for item in content.objects:
        if item.kind not in ("image", "inline") or item.box is None:
            continue
        box = pymupdf.Rect(item.box) * to_page
        box.normalize()
        if any(_is_effect(box, area, glyphs) for area, glyphs in areas if glyphs):
            spans.append((item.start, item.end))
    if not spans:
        return 0
    new_xref = document.get_new_xref()
    document.update_object(new_xref, "<<>>")
    document.update_stream(new_xref, cut_spans(data, spans))
    page.set_contents(new_xref)
    return len(spans)


def remove_edited_text(page: pymupdf.Page, areas: list[EditedArea]) -> None:
    owned = [(area, own_glyph_boxes(page, area.original)) for area in areas]
    bands = [band for _area, runs in owned for band in glyph_bands(runs)]
    for band in bands:
        page.add_redact_annot(band)
    if bands:
        page.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_NONE,
            graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
            text=pymupdf.PDF_REDACT_TEXT_REMOVE,
        )
    shapes = [area.graphics for area in areas if not area.graphics.is_empty]
    for shape in shapes:
        page.add_redact_annot(shape)
    if shapes:
        page.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_NONE,
            graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
            text=pymupdf.PDF_REDACT_TEXT_NONE,
        )
    drop_effect_images(page, [(area, [box for run in runs for box in run]) for area, runs in owned])
