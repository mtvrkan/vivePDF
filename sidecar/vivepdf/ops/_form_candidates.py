import pymupdf

from vivepdf.ops._form_detect_params import (
    CAPTION_SHARE,
    CELL_DEPTH,
    LABEL_REACH,
    RULE_RUN,
    RULE_SPACING_TOLERANCE,
    SCAN_COVERAGE,
    WHITE_LEVEL,
    WRITING_DEPTH,
    DetectParams,
)
from vivepdf.ops._form_raster import _raster_candidates
from vivepdf.ops._form_text_layout import _TextLayout


def _scan_like(page: pymupdf.Page) -> bool:
    covered = 0.0
    for image in page.get_images():
        for rect in page.get_image_rects(image[0]):
            covered += abs(rect & page.rect)
    return covered >= SCAN_COVERAGE * abs(page.rect)


def _on_picture(rect: pymupdf.Rect, picture: pymupdf.Rect) -> bool:
    area = pymupdf.Rect(picture.x0 - 2, picture.y0 - 2, picture.x1 + 2, picture.y1 + 2)
    if not (area.y0 <= rect.y0 and rect.y1 <= area.y1):
        return False
    overlap = min(area.x1, rect.x1) - max(area.x0, rect.x0)
    return overlap >= 0.8 * max(rect.width, 1)


def _invisible(drawing: dict) -> bool:
    if drawing.get("color") is not None and drawing.get("type") != "f":
        return False
    fill = drawing.get("fill")
    return fill is None or all(channel >= WHITE_LEVEL for channel in fill)


def _holds_text(rect: pymupdf.Rect, words: list[tuple]) -> bool:
    inner = pymupdf.Rect(rect.x0 + 2, rect.y0 + 2, rect.x1 - 2, rect.y1 - 2)
    return any(
        inner.contains(pymupdf.Point((word[0] + word[2]) / 2, (word[1] + word[3]) / 2))
        for word in words
    )


def _writing_space_taken(
    rect: pymupdf.Rect, ceiling: float, words: list[tuple], strict: bool = False
) -> bool:
    x0, x1, baseline = rect.x0, rect.x1, rect.y0
    width = x1 - x0
    above = [
        word
        for word in words
        if ceiling <= (word[1] + word[3]) / 2 < baseline + 1
        and min(x1, word[2]) - max(x0, word[0]) > 0
    ]
    if not above:
        return False
    if strict:
        return True
    covered = sum(min(x1, word[2]) - max(x0, word[0]) for word in above)
    if covered >= CAPTION_SHARE * width:
        return True
    return any(word[2] > x0 + CAPTION_SHARE * width for word in above)


def _ceiling(
    rect: pymupdf.Rect, rules: list[pymupdf.Rect], field_height: float, whole_cell: bool
) -> float:
    ceiling = rect.y0 - (CELL_DEPTH if whole_cell else WRITING_DEPTH * field_height)
    for rule in rules:
        overlap = min(rule.x1, rect.x1) - max(rule.x0, rect.x0)
        if rule.y1 < rect.y0 - 1 and overlap >= 0.5 * min(rule.width, rect.width):
            ceiling = max(ceiling, rule.y1)
    return ceiling


def _attached(x: float, y: float, verticals: list[pymupdf.Rect], upward: bool) -> bool:
    for vertical in verticals:
        if abs((vertical.x0 + vertical.x1) / 2 - x) > 2:
            continue
        if upward and vertical.y0 < y - 2 and abs(vertical.y1 - y) <= 2:
            return True
        if not upward and vertical.y1 > y + 2 and abs(vertical.y0 - y) <= 2:
            return True
    return False


def _cell_segments(rect: pymupdf.Rect, verticals: list[pymupdf.Rect]) -> list[pymupdf.Rect]:
    y = (rect.y0 + rect.y1) / 2
    cuts = sorted(
        {
            round((vertical.x0 + vertical.x1) / 2, 1)
            for vertical in verticals
            if rect.x0 + 2 < (vertical.x0 + vertical.x1) / 2 < rect.x1 - 2
            and _attached((vertical.x0 + vertical.x1) / 2, y, [vertical], True)
        }
    )
    edges = [rect.x0, *cuts, rect.x1]
    return [
        pymupdf.Rect(left, rect.y0, right, rect.y1)
        for left, right in zip(edges, edges[1:], strict=False)
    ]


def _grid_edges(rect: pymupdf.Rect, verticals: list[pymupdf.Rect]) -> tuple[bool, bool]:
    y = (rect.y0 + rect.y1) / 2
    closes_cell = all(_attached(x, y, verticals, True) for x in (rect.x0, rect.x1))
    opens_cell = all(_attached(x, y, verticals, False) for x in (rect.x0, rect.x1))
    return closes_cell, opens_cell


def _has_label(rect: pymupdf.Rect, words: list[tuple], field_height: float) -> bool:
    center = (rect.y0 + rect.y1) / 2
    band = field_height / 2 + 3
    return any(
        (
            abs((word[1] + word[3]) / 2 - center) <= band
            and rect.x0 - LABEL_REACH <= word[2] <= rect.x0 + 4
        )
        or (
            rect.y0 - field_height <= word[3] <= rect.y0 + 2 and word[2] <= rect.x0 + 4 + rect.width
        )
        or (
            rect.y1 - 2 <= word[1] <= rect.y1 + field_height / 2
            and rect.x0 - 4 <= word[0] <= rect.x1
        )
        for word in words
    )


def _drop_rule_runs(
    lines: list[pymupdf.Rect], words: list[tuple], field_height: float
) -> list[pymupdf.Rect]:
    runs: list[list[pymupdf.Rect]] = []
    for rect in sorted(lines, key=lambda item: (round(item.x0), round(item.x1), item.y1)):
        run = next(
            (
                group
                for group in runs
                if abs(group[0].x0 - rect.x0) <= 2 and abs(group[0].x1 - rect.x1) <= 2
            ),
            None,
        )
        if run is None:
            runs.append([rect])
        else:
            run.append(rect)
    kept: list[pymupdf.Rect] = []
    for run in runs:
        run.sort(key=lambda item: item.y1)
        gaps = [later.y1 - earlier.y1 for earlier, later in zip(run, run[1:], strict=False)]
        mean = sum(gaps) / len(gaps) if gaps else 0
        even = (
            len(run) >= RULE_RUN
            and mean > 0
            and all(abs(gap - mean) <= RULE_SPACING_TOLERANCE * mean for gap in gaps)
        )
        if even:
            kept.extend(rect for rect in run if _has_label(rect, words, field_height))
        else:
            kept.extend(run)
    return kept


def _candidate_rects(
    page: pymupdf.Page,
    params: DetectParams,
    layout: _TextLayout,
    scanned: list[int] | None = None,
) -> list[tuple[str, pymupdf.Rect]]:
    words = layout.words
    pictures = [
        pymupdf.Rect(rect)
        for image in page.get_images()
        for rect in page.get_image_rects(image[0])
        if abs(rect & page.rect) < SCAN_COVERAGE * abs(page.rect)
    ]
    candidates: list[tuple[str, pymupdf.Rect]] = []
    lines: list[pymupdf.Rect] = []
    shaped = False
    drawings = [
        drawing
        for drawing in page.get_drawings()
        if not any(_on_picture(pymupdf.Rect(drawing["rect"]), picture) for picture in pictures)
    ]
    rules = [
        pymupdf.Rect(drawing["rect"])
        for drawing in drawings
        if pymupdf.Rect(drawing["rect"]).height <= 2.5
    ]
    verticals = [
        pymupdf.Rect(drawing["rect"])
        for drawing in drawings
        if pymupdf.Rect(drawing["rect"]).width <= 2.5 and pymupdf.Rect(drawing["rect"]).height >= 3
    ]
    for drawing in drawings:
        rect = pymupdf.Rect(drawing["rect"])
        width, height = rect.width, rect.height
        if width <= 0 and height <= 0:
            continue
        if height <= 2.5 and width >= params.min_line_width:
            shaped = True
            closes_cell, opens_cell = _grid_edges(rect, verticals)
            if opens_cell and not closes_cell:
                continue
            for segment in _cell_segments(rect, verticals) if closes_cell else [rect]:
                if segment.width < params.min_line_width:
                    continue
                ceiling = _ceiling(segment, rules, params.field_height, closes_cell)
                if _writing_space_taken(segment, ceiling, words, closes_cell):
                    continue
                lines.append(
                    pymupdf.Rect(
                        segment.x0, segment.y1 - params.field_height, segment.x1, segment.y1 + 1
                    )
                )
        elif _invisible(drawing):
            continue
        elif abs(width - height) <= 3 and params.box_min <= width <= params.box_max:
            shaped = True
            if not _holds_text(rect, words):
                candidates.append(("checkbox", rect))
        elif params.box_max < height <= 160 and width >= params.min_line_width:
            shaped = True
            if not _holds_text(rect, words):
                candidates.append(
                    ("text", pymupdf.Rect(rect.x0 + 1, rect.y0 + 1, rect.x1 - 1, rect.y1 - 1))
                )
    if layout.leaders or layout.boxes:
        shaped = True
    lines.extend(layout.leaders)
    candidates.extend(("checkbox", rect) for rect in layout.boxes)
    candidates.extend(("text", rect) for rect in _drop_rule_runs(lines, words, params.field_height))
    if not shaped and _scan_like(page):
        candidates = _raster_candidates(page, params)
        if candidates and scanned is not None:
            scanned.append(page.number + 1)
    existing = [pymupdf.Rect(widget.rect) for widget in page.widgets()]
    kept: list[tuple[str, pymupdf.Rect]] = []
    for kind, rect in candidates:
        if any(rect.intersects(other) for other in existing):
            continue
        if any(
            kind == other_kind
            and (rect & other).get_area() > 0.5 * min(rect.get_area(), other.get_area())
            for other_kind, other in kept
        ):
            continue
        kept.append((kind, rect))
    kept.sort(key=lambda item: (round(item[1].y0 / params.field_height), item[1].x0))
    return kept
