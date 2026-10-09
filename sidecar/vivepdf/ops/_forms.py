import pymupdf

FORM_PREFIX = "vpFrm"
TAKEN_NAMES = "_vivepdf_form_names"


def _taken(page: pymupdf.Page) -> set[str]:
    document = page.parent
    registry: dict[int, set[str]] = document.__dict__.setdefault(TAKEN_NAMES, {})
    names = registry.get(page.xref)
    if names is None:
        names = {entry[1] for entry in document.get_page_xobjects(page.number)}
        names |= {entry[7] for entry in document.get_page_images(page.number)}
        registry[page.xref] = names
    return names


def _fresh_name(page: pymupdf.Page) -> str:
    taken = _taken(page)
    index = len(taken)
    while f"{FORM_PREFIX}{index}" in taken:
        index += 1
    name = f"{FORM_PREFIX}{index}"
    taken.add(name)
    return name


def _fit(source: pymupdf.Rect, target: pymupdf.Rect, keep: bool, rotate: int) -> pymupdf.Matrix:
    source_middle = (source.tl + source.br) / 2.0
    target_middle = (target.tl + target.br) / 2.0
    matrix = pymupdf.Matrix(1, 0, 0, 1, -source_middle.x, -source_middle.y) * pymupdf.Matrix(rotate)
    turned = source * matrix
    scale_x = target.width / turned.width
    scale_y = target.height / turned.height
    if keep:
        scale_x = scale_y = min(scale_x, scale_y)
    matrix *= pymupdf.Matrix(scale_x, scale_y)
    matrix *= pymupdf.Matrix(1, 0, 0, 1, target_middle.x, target_middle.y)
    return matrix


def show_page(
    page: pymupdf.Page,
    rect: pymupdf.Rect,
    source: pymupdf.Document,
    pno: int = 0,
    *,
    keep_proportion: bool = True,
    overlay: bool = True,
    oc: int = 0,
    rotate: int = 0,
) -> int:
    document = page.parent
    rect = pymupdf.Rect(rect)
    if rect.is_empty or rect.is_infinite:
        raise ValueError("rect must be finite and not empty")
    source_page = source[pno]
    target_rect = rect * ~page.transformation_matrix
    source_rect = source_page.rect * ~source_page.transformation_matrix
    matrix = _fit(source_rect, target_rect, keep_proportion, rotate)
    source_id = source._graft_id
    if document._graft_id == source_id:
        raise ValueError("source document must not equal target")
    graftmap = document.Graftmaps.get(source_id)
    if graftmap is None:
        graftmap = pymupdf.Graftmap(document)
        document.Graftmaps[source_id] = graftmap
    shown = (source_id, pno)
    if overlay:
        page.wrap_contents()
    xref = page._show_pdf_page(
        source_page,
        overlay=overlay,
        matrix=tuple(matrix),
        xref=document.ShownPages.get(shown, 0),
        oc=oc,
        clip=source_rect,
        graftmap=graftmap,
        _imgname=_fresh_name(page),
    )
    document.ShownPages[shown] = xref
    return xref
