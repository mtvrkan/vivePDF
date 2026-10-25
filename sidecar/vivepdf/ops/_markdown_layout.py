from urllib.parse import quote

import pymupdf

from vivepdf.ops._docx_bidi import mostly_right_to_left
from vivepdf.ops._markup import LINK_SAFE_CHARACTERS, LINK_SCHEMES
from vivepdf.ops._words import LINE_BREAK, breaks_word

TEXT_FLAGS = pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_PRESERVE_LIGATURES
SAME_BASELINE = 0.3
OVERLAP_TOLERANCE = 1.0
LINK_CORE = 0.5
PICTURE_GAP = 36.0
PICTURE_IMAGE_SHARE = 0.5
STRIKE_KINDS = ("fill-path", "stroke-path")
COVER_KINDS = ("fill-path", "fill-image", "fill-shade")
STRIKE_THICKNESS = 0.25
STRIKE_REACH = 0.7
LOG_AREA_LIMIT = 1e12


def is_horizontal(direction: tuple[float, float]) -> bool:
    return abs(direction[1]) < 1e-3 and direction[0] > 0


def turned_lines(page: pymupdf.Page) -> list[dict]:
    return [
        line
        for block in page.get_text("dict", flags=TEXT_FLAGS)["blocks"]
        for line in block.get("lines", [])
        if line["spans"] and not is_horizontal(line["dir"])
    ]


def line_text(line: dict) -> str:
    return "".join(span["text"] for span in line["spans"]).strip()


def _page_links(page: pymupdf.Page) -> list[tuple[pymupdf.Rect, str]]:
    links = []
    for link in page.get_links():
        uri = (link.get("uri") or "").strip()
        if link.get("kind") == pymupdf.LINK_URI and uri.lower().startswith(LINK_SCHEMES):
            links.append((pymupdf.Rect(link["from"]), quote(uri, safe=LINK_SAFE_CHARACTERS)))
    return sorted(links, key=lambda item: (item[0].y0, item[0].x0))


def _link_label(text: str) -> str:
    return text.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")


def _page_glyphs(textpage: pymupdf.TextPage) -> dict[float, list[tuple[float, float, str]]]:
    glyphs: dict[float, list[tuple[float, float, str]]] = {}
    for block in textpage.extractRAWDICT()["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                for char in span["chars"]:
                    key = round(char["origin"][1], 1)
                    glyphs.setdefault(key, []).append((char["bbox"][0], char["bbox"][2], char["c"]))
    return glyphs


def _middle(glyph: tuple[float, float, str]) -> float:
    return (glyph[0] + glyph[1]) / 2


def _linked_text(
    span: dict,
    glyphs: dict[float, list[tuple[float, float, str]]],
    links: list[tuple[pymupdf.Rect, str]],
) -> str:
    area = pymupdf.Rect(span["bbox"])
    baseline = span["origin"][1]
    core = span["size"] * LINK_CORE
    row = sorted(
        glyph
        for glyph in glyphs.get(round(baseline, 1), [])
        if area.x0 - OVERLAP_TOLERANCE <= _middle(glyph) <= area.x1 + OVERLAP_TOLERANCE
    )
    text = span["text"]
    cursor = 0
    for rect, url in links:
        if min(baseline, rect.y1) - max(baseline - core, rect.y0) < core / 2:
            continue
        label = "".join(glyph[2] for glyph in row if rect.x0 <= _middle(glyph) <= rect.x1).strip()
        position = text.find(label, cursor) if any(map(str.isalnum, label)) else -1
        if position < 0:
            continue
        linked = f"[{_link_label(label)}]({url})"
        text = text[:position] + linked + text[position + len(label) :]
        cursor = position + len(linked)
    return text


def _baseline(line: dict) -> tuple[float, float]:
    spans = line["spans"]
    return spans[0]["origin"][1], max(span["size"] for span in spans) or 1.0


def _apart(line: dict, other: dict) -> bool:
    return all(
        span["bbox"].x1 <= piece["bbox"].x0 + OVERLAP_TOLERANCE
        or piece["bbox"].x1 <= span["bbox"].x0 + OVERLAP_TOLERANCE
        for span in line["spans"]
        for piece in other["spans"]
    )


def _shares_baseline(line: dict, other: dict) -> bool:
    (baseline, size), (other_baseline, other_size) = _baseline(line), _baseline(other)
    return abs(baseline - other_baseline) <= max(size, other_size) * SAME_BASELINE and _apart(
        line, other
    )


def _joined_lines(textlines: list[dict]) -> list[dict]:
    from pymupdf4llm.helpers.document_layout import is_superscripted

    lines: list[dict] = []
    for line in textlines:
        if not line["spans"] or not all(
            abs(span.get("dir", (1, 0))[1]) < 1e-3 for span in line["spans"]
        ):
            lines.append(line)
            continue
        target = next(
            (kept for kept in lines if kept["spans"] and _shares_baseline(kept, line)), None
        )
        if target is None:
            lines.append(line)
            continue
        spans = sorted(target["spans"] + line["spans"], key=lambda span: span["bbox"].x0)
        bbox = pymupdf.Rect(target["bbox"]) | line["bbox"]
        if is_superscripted({"spans": spans, "bbox": bbox}) and not is_superscripted(target):
            lines.append(line)
            continue
        target["spans"] = spans
        target["bbox"] = bbox
    return lines


def _turned_boxes(page: pymupdf.Page, tables: list[pymupdf.Rect]) -> list:
    from pymupdf4llm.helpers.document_layout import LayoutBox

    boxes = []
    for number, line in enumerate(turned_lines(page)):
        area = pymupdf.Rect(line["bbox"])
        centre = (area.tl + area.br) / 2
        if not line_text(line) or any(centre in table for table in tables):
            continue
        spans = [
            {
                **span,
                "bbox": pymupdf.Rect(span["bbox"]),
                "dir": line["dir"],
                "line": number,
                "block": number,
            }
            for span in line["spans"]
        ]
        boxes.append(LayoutBox(*area, "text", textlines=[{"bbox": area, "spans": spans}]))
    return boxes


def add_turned_text(page: pymupdf.Page, layout) -> None:
    tables = [
        pymupdf.Rect(box.x0, box.y0, box.x1, box.y1)
        for box in layout.boxes
        if box.boxclass == "table"
    ]
    boxes = _turned_boxes(page, tables)
    if not boxes:
        return
    position = len(layout.boxes)
    while position and layout.boxes[position - 1].boxclass == "page-footer":
        position -= 1
    layout.boxes[position:position] = boxes


def _close(box, other) -> bool:
    across = min(box.x1, other.x1) - max(box.x0, other.x0)
    down = min(box.y1, other.y1) - max(box.y0, other.y0)
    return (across > 0 and down >= -PICTURE_GAP) or (down > 0 and across >= -PICTURE_GAP)


def _drawn(box, images: list[pymupdf.Rect]) -> bool:
    area = pymupdf.Rect(box.x0, box.y0, box.x1, box.y1)
    return area.is_empty or all(
        abs(area & image) < abs(area) * PICTURE_IMAGE_SHARE for image in images
    )


def merge_pictures(page: pymupdf.Page, layout) -> None:
    images = [pymupdf.Rect(info["bbox"]) for info in page.get_image_info()]
    boxes = []
    for box in layout.boxes:
        last = boxes[-1] if boxes else None
        if (
            last is not None
            and box.boxclass == last.boxclass == "picture"
            and _close(last, box)
            and _drawn(last, images)
            and _drawn(box, images)
        ):
            last.x0, last.y0 = min(last.x0, box.x0), min(last.y0, box.y0)
            last.x1, last.y1 = max(last.x1, box.x1), max(last.y1, box.y1)
            if box.textlines:
                last.textlines = [*(last.textlines or []), *box.textlines]
            continue
        boxes.append(box)
    layout.boxes = boxes


def _strike_lines(span: dict, log: list[tuple[int, str, pymupdf.Rect]]) -> list:
    area = pymupdf.Rect(span["bbox"])
    baseline, size = span["origin"][1], span["size"] or 1.0
    return [
        (order, pymupdf.Rect(max(rect.x0, area.x0), rect.y0, min(rect.x1, area.x1), rect.y1))
        for order, kind, rect in log
        if kind in STRIKE_KINDS
        and rect.height <= size * STRIKE_THICKNESS
        and baseline - size * STRIKE_REACH <= rect.y1
        and rect.y0 <= baseline
        and min(rect.x1, area.x1) - max(rect.x0, area.x0) >= area.width / 2
    ]


def _covered(segment: pymupdf.Rect, order: int, log: list[tuple[int, str, pymupdf.Rect]]) -> bool:
    cover = pymupdf.Rect(
        segment.x0 + OVERLAP_TOLERANCE, segment.y0, segment.x1 - OVERLAP_TOLERANCE, segment.y1
    )
    return any(
        later > order and kind in COVER_KINDS and rect.contains(cover) for later, kind, rect in log
    )


def clear_hidden_strikes(page: pymupdf.Page, layout) -> None:
    struck = [
        span
        for box in layout.boxes
        for line in box.textlines or []
        for span in line["spans"]
        if span.get("char_flags", 0) & pymupdf.mupdf.FZ_STEXT_STRIKEOUT
    ]
    if not struck:
        return
    log = [
        (order, kind, pymupdf.Rect(rect))
        for order, (kind, rect) in enumerate(page.get_bboxlog())
        if pymupdf.Rect(rect).is_valid and abs(pymupdf.Rect(rect)) < LOG_AREA_LIMIT
    ]
    for span in struck:
        lines = _strike_lines(span, log)
        if lines and all(_covered(segment, order, log) for order, segment in lines):
            span["char_flags"] &= ~pymupdf.mupdf.FZ_STEXT_STRIKEOUT


def _right_to_left(line: dict) -> dict:
    if len(line["spans"]) > 1 and mostly_right_to_left(
        "".join(span["text"] for span in line["spans"])
    ):
        line["spans"] = sorted(line["spans"], key=lambda span: -span["bbox"].x1)
    return line


def join_baselines(layout) -> None:
    for box in layout.boxes:
        if box.textlines:
            box.textlines = [_right_to_left(line) for line in _joined_lines(box.textlines)]


def link_spans(page: pymupdf.Page, layout) -> None:
    links = _page_links(page)
    if not links:
        return
    glyphs = _page_glyphs(page.get_textpage(flags=TEXT_FLAGS))
    for box in layout.boxes:
        for line in box.textlines or []:
            for span in line["spans"]:
                span["text"] = _linked_text(span, glyphs, links)


def mark_broken_words(layout) -> None:
    for box in layout.boxes:
        lines = [line for line in box.textlines or [] if line["spans"]]
        for line, following in zip(lines, lines[1:], strict=False):
            last = line["spans"][-1]
            if breaks_word(last["text"], following["spans"][0]["text"]):
                last["text"] = last["text"].rstrip() + LINE_BREAK


def cover_bare_page(page: pymupdf.Page, layout) -> None:
    from pymupdf4llm.helpers.document_layout import LayoutBox

    if layout.boxes:
        return
    area = pymupdf.Rect()
    for info in page.get_image_info():
        area |= pymupdf.Rect(info["bbox"]) & page.rect
    if not area.is_empty:
        layout.boxes.append(LayoutBox(*area, "picture"))
