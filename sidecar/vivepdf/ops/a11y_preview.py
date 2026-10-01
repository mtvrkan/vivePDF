import base64
import re

import pymupdf
from pydantic import Field

from vivepdf.ops._a11y_tree import FIGURE_TYPES
from vivepdf.ops._access_structure import _children
from vivepdf.ops._content_objects import (
    Box,
    array_numbers,
    page_bytes,
    union,
    walk_content,
)
from vivepdf.ops._document import open_document, unwrap_document
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

BBOX_PATTERN = re.compile(r"/BBox\s*\[([^\]]*)\]")
MAX_FIGURE_NODES = 200
PADDING_PT = 4.0
MIN_SIDE_PT = 2.0


class FigurePreviewParams(RpcModel):
    path: str
    password: str | None = None
    xref: int = Field(gt=0)
    max_size: int = Field(default=240, ge=64, le=480)


class FigurePreviewResult(RpcModel):
    image: str
    page: int
    exact: bool


def _attribute_box(document: pymupdf.Document, xref: int) -> Box | None:
    kind, value = document.xref_get_key(xref, "A")
    if kind == "xref":
        value = document.xref_object(int(value.split()[0]), compressed=True)
    elif kind not in ("dict", "array"):
        return None
    match = BBOX_PATTERN.search(value)
    numbers = array_numbers(match.group(1)) if match else []
    if len(numbers) != 4:
        return None
    return (
        min(numbers[0], numbers[2]),
        min(numbers[1], numbers[3]),
        max(numbers[0], numbers[2]),
        max(numbers[1], numbers[3]),
    )


def _figure_content(document: pymupdf.Document, xref: int) -> tuple[int | None, set[int]]:
    kind, value = document.xref_get_key(xref, "Pg")
    page = int(value.split()[0]) if kind == "xref" else None
    mcids: set[int] = set()
    stack = [(xref, page)]
    seen: set[int] = set()
    length = document.xref_length()
    while stack and len(seen) < MAX_FIGURE_NODES:
        node, owner = stack.pop()
        if node in seen or node <= 0 or node >= length:
            continue
        seen.add(node)
        for child_kind, child, child_page in _children(document, node, owner):
            if child_kind == "mcid":
                if page is None:
                    page = child_page
                if child_page == page:
                    mcids.add(child)
            else:
                stack.append((child, child_page))
    return page, mcids


def _content_box(document: pymupdf.Document, page: pymupdf.Page, mcids: set[int]) -> Box | None:
    if not mcids:
        return None
    content = walk_content(document, page, page_bytes(document, page))
    inside = {index for index, mark in enumerate(content.marks) if mark.mcid in mcids}
    boxes = [
        item.box
        for item in content.objects
        if item.box is not None and inside.intersection(item.marks)
    ]
    return union(boxes)


def _clip(page: pymupdf.Page, box: Box | None) -> pymupdf.Rect | None:
    if box is None:
        return None
    rect = pymupdf.Rect(box) * page.transformation_matrix * page.rotation_matrix
    rect.normalize()
    rect = (rect + (-PADDING_PT, -PADDING_PT, PADDING_PT, PADDING_PT)) & page.rect
    if rect.is_empty or rect.width < MIN_SIDE_PT or rect.height < MIN_SIDE_PT:
        return None
    return rect


@op("a11y.figurePreview", FigurePreviewParams)
def figure_preview(params: FigurePreviewParams, progress: Progress) -> FigurePreviewResult:
    with open_document(params.path, params.password, mutable=False) as cached:
        document = unwrap_document(cached)
        if params.xref >= document.xref_length():
            raise OpError(ErrorCode.INVALID_PARAMS, f"invalid figure reference {params.xref}")
        kind_type, kind = document.xref_get_key(params.xref, "S")
        if kind_type != "name" or kind not in FIGURE_TYPES:
            raise OpError(ErrorCode.INVALID_PARAMS, f"object {params.xref} is not a figure")
        page_xref, mcids = _figure_content(document, params.xref)
        page_numbers = {document.page_xref(index): index for index in range(document.page_count)}
        if page_xref not in page_numbers:
            raise OpError(ErrorCode.INVALID_PARAMS, "figure has no page", {"reason": "page"})
        progress.check_cancelled()
        page = document[page_numbers[page_xref]]
        clip = _clip(page, _attribute_box(document, params.xref)) or _clip(
            page, _content_box(document, page, mcids)
        )
        area = clip or page.rect
        zoom = (params.max_size - 1) / max(area.width, area.height, 1.0)
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=area, alpha=False)
        return FigurePreviewResult(
            image=base64.b64encode(pixmap.tobytes("png")).decode("ascii"),
            page=page.number + 1,
            exact=clip is not None,
        )
