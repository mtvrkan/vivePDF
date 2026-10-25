import pymupdf

COVER_KINDS = ("fill-path", "fill-image", "fill-shade")
CORE_SHARE = 0.25
RENDER_ZOOM = 2.0
PIXEL_TOLERANCE = 24
LOG_AREA_LIMIT = 1e12


def origin_key(point) -> tuple[float, float]:
    return round(point[0], 1), round(point[1], 1)


def _covers(page: pymupdf.Page) -> list[tuple[int, pymupdf.Rect]]:
    covers = []
    for order, (kind, bbox) in enumerate(page.get_bboxlog()):
        rect = pymupdf.Rect(bbox)
        if kind in COVER_KINDS and not rect.is_empty and abs(rect) < LOG_AREA_LIMIT:
            covers.append((order, rect))
    return covers


def _core(bbox) -> pymupdf.Rect:
    rect = pymupdf.Rect(bbox)
    inset_x, inset_y = rect.width * CORE_SHARE, rect.height * CORE_SHARE
    return pymupdf.Rect(rect.x0 + inset_x, rect.y0 + inset_y, rect.x1 - inset_x, rect.y1 - inset_y)


def _candidates(page: pymupdf.Page) -> dict[tuple[float, float], pymupdf.Rect]:
    covers = _covers(page)
    found: dict[tuple[float, float], pymupdf.Rect] = {}
    if not covers:
        return found
    for span in page.get_texttrace():
        later = [
            rect
            for order, rect in covers
            if order > span["seqno"] and rect.intersects(pymupdf.Rect(span["bbox"]))
        ]
        for char in span["chars"] if later else []:
            core = _core(char[3])
            if chr(char[0]).isspace() or core.is_empty:
                continue
            if any(rect.contains(core) for rect in later):
                found[origin_key(char[2])] = core
    return found


def _renders(page: pymupdf.Page, area: pymupdf.Rect) -> tuple[pymupdf.Pixmap, pymupdf.Pixmap]:
    matrix = pymupdf.Matrix(RENDER_ZOOM, RENDER_ZOOM)
    with pymupdf.open() as single:
        single.insert_pdf(page.parent, from_page=page.number, to_page=page.number, annots=True)
        copy = single[0]
        copy.set_rotation(0)
        shown = copy.get_pixmap(matrix=matrix, clip=area, alpha=False)
        copy.add_redact_annot(copy.rect, fill=False, cross_out=False)
        copy.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_NONE,
            graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
            text=pymupdf.PDF_REDACT_TEXT_REMOVE,
        )
        return shown, copy.get_pixmap(matrix=matrix, clip=area, alpha=False)


def _unchanged(shown: pymupdf.Pixmap, bare: pymupdf.Pixmap, core: pymupdf.Rect) -> bool:
    pixels = (core * pymupdf.Matrix(RENDER_ZOOM, RENDER_ZOOM)).irect & shown.irect
    if pixels.is_empty:
        return False
    for y in range(pixels.y0, pixels.y1):
        for x in range(pixels.x0, pixels.x1):
            local = (x - shown.x, y - shown.y)
            if any(
                abs(a - b) > PIXEL_TOLERANCE
                for a, b in zip(shown.pixel(*local), bare.pixel(*local), strict=True)
            ):
                return False
    return True


def hidden_origins(page: pymupdf.Page) -> set[tuple[float, float]]:
    candidates = _candidates(page)
    if not candidates:
        return set()
    cores = list(candidates.values())
    area = pymupdf.Rect(cores[0])
    for core in cores[1:]:
        area |= core
    shown, bare = _renders(page, area)
    return {key for key, core in candidates.items() if _unchanged(shown, bare, core)}


def _origins(page: pymupdf.Page) -> set[tuple[float, float]]:
    return {
        origin_key(char["origin"])
        for block in page.get_text("rawdict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]
        for line in block.get("lines", [])
        for span in line["spans"]
        for char in span["chars"]
    }


def widget_origins(page: pymupdf.Page) -> set[tuple[float, float]]:
    if page.first_widget is None:
        return set()
    with pymupdf.open() as single:
        single.insert_pdf(page.parent, from_page=page.number, to_page=page.number, widgets=False)
        kept = _origins(single[0])
    return _origins(page) - kept
