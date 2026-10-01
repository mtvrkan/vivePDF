from collections.abc import Callable

import pymupdf

from vivepdf.ops._form_appearance import UnicodeAppearance

REDACT_INSET = 0.4
MOSTLY_INSIDE = 0.6
EDGE_GAP = 1.0


def text_boxes(
    page: pymupdf.Page, own_rect: pymupdf.Rect, lines: bool = False
) -> list[pymupdf.Rect]:
    data = page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)
    transform = page.rotation_matrix if page.rotation else None
    own_area = own_rect.get_area()
    boxes: list[pymupdf.Rect] = []
    for block in data["blocks"]:
        if block.get("type") != 0:
            continue
        sources = (
            [(line["bbox"], [span["text"] for span in line["spans"]]) for line in block["lines"]]
            if lines
            else [
                (
                    block["bbox"],
                    [span["text"] for line in block["lines"] for span in line["spans"]],
                )
            ]
        )
        for bbox, texts in sources:
            if not any(text.strip() for text in texts):
                continue
            box = pymupdf.Rect(bbox)
            if transform is not None:
                box = box * transform
                box.normalize()
            area = box.get_area()
            overlap = box & own_rect
            if not overlap.is_empty and (
                overlap.get_area() >= area * MOSTLY_INSIDE
                or (own_area > 0 and overlap.get_area() >= own_area * MOSTLY_INSIDE)
            ):
                continue
            boxes.append(box)
    return boxes


def clip_to_own_text(rect: pymupdf.Rect, foreign_boxes: list[pymupdf.Rect]) -> pymupdf.Rect:
    clipped = pymupdf.Rect(rect)
    for foreign in foreign_boxes:
        if foreign.y1 <= clipped.y0 or foreign.y0 >= clipped.y1:
            continue
        if foreign.x1 <= clipped.x0 or foreign.x0 >= clipped.x1:
            continue
        if foreign.y0 >= clipped.y0 + (clipped.y1 - clipped.y0) / 2:
            clipped.y1 = min(clipped.y1, foreign.y0 - EDGE_GAP)
        else:
            clipped.y0 = max(clipped.y0, foreign.y1 + EDGE_GAP)
    clipped.normalize()
    return clipped


def inset(rect: pymupdf.Rect) -> pymupdf.Rect:
    tightened = pymupdf.Rect(
        rect.x0 + REDACT_INSET,
        rect.y0 + REDACT_INSET,
        rect.x1 - REDACT_INSET,
        rect.y1 - REDACT_INSET,
    )
    tightened.normalize()
    return tightened


Scrubber = Callable[[str], str]

ANNOT_TEXT_KEYS = ("content", "title", "subject")
FIELD_TEXT_KEYS = ("TU", "DV")
CHOICE_WIDGETS = (pymupdf.PDF_WIDGET_TYPE_COMBOBOX, pymupdf.PDF_WIDGET_TYPE_LISTBOX)

MAX_TEXTS = 500
MAX_AREAS = 5000
MAX_TEXT_LENGTH = 300
MIN_WORD_LENGTH = 3
EDGE_PUNCTUATION = " \t\r\n.,;:!?\"'()[]{}<>«»“”‘’"


def clean_texts(texts: list[str]) -> list[str]:
    cleaned: list[str] = []
    for text in texts:
        value = " ".join(str(text).split())[:MAX_TEXT_LENGTH].strip(EDGE_PUNCTUATION)
        if len(value) >= MIN_WORD_LENGTH and value not in cleaned:
            cleaned.append(value)
    return cleaned[:MAX_TEXTS]


def words_in(page: pymupdf.Page, rect: pymupdf.Rect) -> list[str]:
    lines: dict[tuple[int, int], list[tuple[float, str]]] = {}
    for x0, y0, x1, y1, word, block, line, _number in page.get_text("words"):
        center = pymupdf.Point((x0 + x1) / 2, (y0 + y1) / 2)
        if rect.contains(center):
            lines.setdefault((block, line), []).append((x0, word))
    found: list[str] = []
    for key in sorted(lines):
        words = [word for _, word in sorted(lines[key])]
        found.append(" ".join(words))
        found.extend(words)
    return found


def _scrub_string_key(document: pymupdf.Document, xref: int, key: str, scrub: Scrubber) -> bool:
    kind, value = document.xref_get_key(xref, key)
    if kind != "string":
        return False
    cleaned = scrub(value)
    if cleaned == value:
        return False
    document.xref_set_key(xref, key, pymupdf.get_pdf_str(cleaned))
    return True


def _scrub_rich_text(document: pymupdf.Document, xref: int, scrub: Scrubber) -> bool:
    kind, value = document.xref_get_key(xref, "RC")
    if kind == "string":
        return _scrub_string_key(document, xref, "RC", scrub)
    if kind != "xref":
        return False
    text = document.xref_stream(int(value.split()[0])).decode("utf-8", "ignore")
    if scrub(text) == text:
        return False
    document.xref_set_key(xref, "RC", "null")
    return True


def _as_lists(item: object) -> object:
    if isinstance(item, (list, tuple)):
        return [_as_lists(part) for part in item]
    return item


def _scrub_choice(widget: pymupdf.Widget, scrub: Scrubber) -> bool:
    def clean(item: object) -> object:
        if isinstance(item, str):
            return scrub(item)
        if isinstance(item, list):
            return [clean(part) for part in item]
        return item

    options = [_as_lists(option) for option in widget.choice_values or []]
    value = _as_lists(widget.field_value)
    cleaned_options = [clean(option) for option in options]
    cleaned_value = clean(value)
    if cleaned_options == options and cleaned_value == value:
        return False
    widget.choice_values = cleaned_options
    widget.field_value = cleaned_value
    return True


def _scrub_attachment(annot: pymupdf.Annot, scrub: Scrubber) -> bool:
    if annot.type[0] != pymupdf.PDF_ANNOT_FILE_ATTACHMENT:
        return False
    info = annot.file_info or {}
    fields = {"filename": "filename", "ufilename": "ufilename", "desc": "description"}
    updates = {
        field: scrub(str(info.get(key) or ""))
        for field, key in fields.items()
        if scrub(str(info.get(key) or "")) != str(info.get(key) or "")
    }
    if not updates:
        return False
    annot.update_file(**updates)
    return True


def _touches(rect: pymupdf.Rect, rects: list[pymupdf.Rect]) -> bool:
    return any(not (rect & other).is_empty for other in rects)


def scrub_page(page: pymupdf.Page, rects: list[pymupdf.Rect], scrub: Scrubber) -> int:
    count = 0
    for xref in [annot.xref for annot in page.annots()]:
        annot = page.load_annot(xref)
        if annot is None or annot.type[0] in (pymupdf.PDF_ANNOT_REDACT, pymupdf.PDF_ANNOT_POPUP):
            continue
        if _touches(annot.rect, rects):
            page.delete_annot(annot)
            count += 1
            continue
        info = annot.info or {}
        cleaned = {key: scrub(str(info.get(key) or "")) for key in ANNOT_TEXT_KEYS}
        if any(cleaned[key] != str(info.get(key) or "") for key in ANNOT_TEXT_KEYS):
            annot.set_info(**cleaned)
            annot.update()
            count += 1
        if _scrub_rich_text(page.parent, annot.xref, scrub):
            count += 1
        if _scrub_attachment(annot, scrub):
            count += 1
    for link in page.get_links():
        target = str(link.get("uri") or link.get("file") or "")
        if _touches(pymupdf.Rect(link["from"]), rects) or (target and scrub(target) != target):
            page.delete_link(link)
            count += 1
    appearance = UnicodeAppearance(page.parent)
    for xref in [widget.xref for widget in page.widgets()]:
        widget = page.load_widget(xref)
        if widget is None:
            continue
        if _touches(widget.rect, rects):
            page.delete_widget(widget)
            count += 1
            continue
        value = widget.field_value
        if widget.field_type == pymupdf.PDF_WIDGET_TYPE_TEXT and isinstance(value, str):
            cleaned_value = scrub(value)
            if cleaned_value != value:
                widget.field_value = cleaned_value
                widget.update()
                appearance.redraw(widget)
                count += 1
        elif widget.field_type in CHOICE_WIDGETS and _scrub_choice(widget, scrub):
            widget.update()
            count += 1
        for key in FIELD_TEXT_KEYS:
            if _scrub_string_key(page.parent, widget.xref, key, scrub):
                count += 1
    appearance.finish()
    return count


JPEG_QUALITY = 90


def jpeg_images(page: pymupdf.Page) -> tuple[set[int], set[tuple[int, int]]]:
    document = page.parent
    xrefs: set[int] = set()
    sizes: set[tuple[int, int]] = set()
    for item in page.get_images(full=True):
        xrefs.add(item[0])
        if document.xref_get_key(item[0], "Filter")[1] == "/DCTDecode":
            sizes.add((item[2], item[3]))
    return xrefs, sizes


def recompress_redacted(page: pymupdf.Page, before: set[int], sizes: set[tuple[int, int]]) -> int:
    document = page.parent
    count = 0
    for item in page.get_images(full=True):
        xref, smask, width, height = item[0], item[1], item[2], item[3]
        if xref in before or smask or (width, height) not in sizes:
            continue
        if document.xref_get_key(xref, "Filter")[1] not in ("null", "/FlateDecode"):
            continue
        pixmap = pymupdf.Pixmap(document, xref)
        if pixmap.alpha or pixmap.n not in (1, 3):
            continue
        document.update_stream(
            xref, pixmap.tobytes("jpeg", jpg_quality=JPEG_QUALITY), compress=False
        )
        document.xref_set_key(xref, "Filter", "/DCTDecode")
        document.xref_set_key(xref, "DecodeParms", "null")
        count += 1
    return count
