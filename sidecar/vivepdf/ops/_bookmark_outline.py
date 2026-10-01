import math

import pymupdf

from vivepdf.ops._bookmark_model import DESTINATION, FIT_ARITY, OPEN_ALL_LEVELS, BookmarkItem


def _number(value: float | None) -> str:
    if value is None:
        return "null"
    text = f"{round(value, 3):.3f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def _pdf_position(
    page: pymupdf.Page, left: float | None, top: float | None
) -> tuple[float | None, float | None]:
    if left is None and top is None:
        return None, None
    crop = page.cropbox
    unrotated = pymupdf.Point(left or 0.0, top or 0.0) * page.derotation_matrix
    x = unrotated.x + crop.x0
    y = page.mediabox.y1 - (unrotated.y + crop.y0)
    has_x, has_y = left is not None, top is not None
    if page.rotation % 180:
        has_x, has_y = has_y, has_x
    return (x if has_x else None), (y if has_y else None)


def _visible_position(
    page: pymupdf.Page, left: float | None, top: float | None
) -> tuple[float | None, float | None]:
    if left is None and top is None:
        return None, None
    crop = page.cropbox
    unrotated = pymupdf.Point(
        0.0 if left is None else left - crop.x0,
        0.0 if top is None else page.mediabox.y1 - top - crop.y0,
    )
    visible = unrotated * page.rotation_matrix
    has_x, has_y = left is not None, top is not None
    if page.rotation % 180:
        has_x, has_y = has_y, has_x
    return (
        round(visible.x, 3) if has_x else None,
        round(visible.y, 3) if has_y else None,
    )


def _explicit_destination(
    document: pymupdf.Document, xref: int
) -> tuple[str, list[float | None]] | None:
    for key in ("Dest", "A/D"):
        kind, value = document.xref_get_key(xref, key)
        if kind == "array":
            break
    else:
        return None
    match = DESTINATION.fullmatch(value.strip())
    if match is None or match.group(1) not in FIT_ARITY:
        return None
    arguments: list[float | None] = []
    for token in match.group(2).split():
        if token == "null":
            arguments.append(None)
            continue
        try:
            number = float(token)
        except ValueError:
            return None
        if not math.isfinite(number):
            return None
        arguments.append(number)
    if len(arguments) != FIT_ARITY[match.group(1)]:
        return None
    return match.group(1), arguments


def _action_type(document: pymupdf.Document, xref: int) -> str | None:
    kind, value = document.xref_get_key(xref, "A/S")
    return value.lstrip("/") if kind == "name" else None


def _hex_color(color: object) -> str | None:
    if not isinstance(color, (tuple, list)) or len(color) != 3:
        return None
    channels = [round(max(0.0, min(1.0, float(channel))) * 255) for channel in color]
    if not any(channels):
        return None
    return "#" + "".join(f"{channel:02x}" for channel in channels)


def _finite(value: object) -> float | None:
    number = float(value) if isinstance(value, (int, float)) else math.nan
    return round(number, 3) if math.isfinite(number) else None


def _page_position(
    document: pymupdf.Document, page_number: int, xref: int | None, destination: dict
) -> dict:
    fields: dict = {}
    explicit = _explicit_destination(document, xref) if xref else None
    if explicit is not None and explicit[0] != "XYZ":
        return {"fit": explicit[0], "fit_args": explicit[1]}
    if explicit is not None and 1 <= page_number <= document.page_count:
        left, top, zoom = explicit[1]
        visible_left, visible_top = _visible_position(document[page_number - 1], left, top)
        if visible_left is not None:
            fields["left"] = visible_left
        if visible_top is not None:
            fields["top"] = visible_top
    else:
        zoom = destination.get("zoom")
        point = destination.get("to")
        if point is not None and destination.get("kind") == pymupdf.LINK_GOTO:
            left, top = _finite(point.x), _finite(point.y)
            if left is not None and top is not None:
                fields.update(left=left, top=top)
    if zoom:
        fields["zoom"] = _finite(zoom)
    return fields


def _read_item(document: pymupdf.Document, entry: list) -> BookmarkItem:
    level, title, page = entry[0], entry[1], entry[2]
    destination = entry[3] if len(entry) > 3 and isinstance(entry[3], dict) else {}
    xref = int(destination.get("xref") or 0) or None
    fields: dict = {
        "level": level,
        "title": title,
        "page": max(0, page),
        "collapsed": bool(destination.get("collapse")),
        "color": _hex_color(destination.get("color")),
        "bold": bool(destination.get("bold")),
        "italic": bool(destination.get("italic")),
        "source": xref,
    }
    action = _action_type(document, xref) if xref else None
    if action == "URI" or (action is None and destination.get("kind") == pymupdf.LINK_URI):
        fields.update(target="web", uri=str(destination.get("uri") or ""), page=0)
    elif action == "GoToR":
        remote = destination.get("page")
        remote_page = remote + 1 if isinstance(remote, int) and remote >= 0 else 0
        fields.update(target="file", file=destination.get("file") or None, page=remote_page)
    elif action == "Launch":
        fields.update(target="launch", file=destination.get("file") or None, page=0)
    elif action not in (None, "GoTo"):
        fields.update(target="other", page=0)
    elif page >= 1:
        fields.update(_page_position(document, page, xref, destination))
    return BookmarkItem(**fields)


def _read_outline(document: pymupdf.Document) -> list[BookmarkItem]:
    return [_read_item(document, entry) for entry in document.get_toc(simple=False)]


def outline_counts(levels: list[int], collapsed: list[bool]) -> list[int]:
    children: list[list[int]] = [[] for _ in levels]
    stack: list[int] = []
    for index, level in enumerate(levels):
        while stack and levels[stack[-1]] >= level:
            stack.pop()
        if stack:
            children[stack[-1]].append(index)
        stack.append(index)
    visible = [0] * len(levels)
    for index in range(len(levels) - 1, -1, -1):
        visible[index] = sum(
            1 + (0 if collapsed[child] else visible[child]) for child in children[index]
        )
    return [
        0 if not children[index] else (-visible[index] if collapsed[index] else visible[index])
        for index in range(len(levels))
    ]


def write_outline(document: pymupdf.Document, toc: list[list], collapsed: list[bool]) -> list[int]:
    document.set_toc(toc, collapse=OPEN_ALL_LEVELS)
    written = document.get_toc(simple=False)
    xrefs = [
        int(entry[3].get("xref") or 0) if len(entry) > 3 and isinstance(entry[3], dict) else 0
        for entry in written
    ]
    counts = outline_counts([entry[0] for entry in written], collapsed)
    for xref, count in zip(xrefs, counts, strict=False):
        if xref and count:
            document.xref_set_key(xref, "Count", str(count))
    return xrefs
