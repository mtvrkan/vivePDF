import contextlib
import io
import re
from collections.abc import Callable

import pymupdf
from PIL import Image

from vivepdf.ops._placement import insertion_matrix, unrotated_insertion_matrix
from vivepdf.ops._svg import drawing_pdf

EQUATION_PREFIX = "vpeq-"
PLACEHOLDER_HEIGHT = 3
DISPLAY_LINE = 1.2
NUMBER_RESERVE_EM = 3.0
SVG_UNITS_PER_EM = 1000
SVG_PIXELS_PER_EM = 100
ASPECT_TOLERANCE = 0.1
VIEW_BOX = re.compile(r"""\sviewBox\s*=\s*["']([^"']+)["']""")
SVG_OPEN = re.compile(r"^<svg\b[^>]*>")
SIZE_ATTRIBUTE = re.compile(r"""\s(?:width|height|style)\s*=\s*["'][^"']*["']""")
DISPLAY = re.compile(
    r"""<p\b(?=[^>]*\sid\s*=\s*["'](e-\d+)["'])(?=[^>]*\sdata-equation\s*=\s*["'](\d+)["'])[^>]*>""",
    re.IGNORECASE,
)


def equation_size(svg: str) -> tuple[float, float] | None:
    opening = SVG_OPEN.match(svg)
    match = VIEW_BOX.search(opening.group(0)) if opening else None
    if not match:
        return None
    parts = match.group(1).replace(",", " ").split()
    try:
        width, height = float(parts[2]), float(parts[3])
    except (IndexError, ValueError):
        return None
    if not (width > 0 and height > 0):
        return None
    return width / SVG_UNITS_PER_EM, height / SVG_UNITS_PER_EM


def placeholder(index: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("LA", (index + 1, PLACEHOLDER_HEIGHT), (0, 0)).save(buffer, "PNG")
    return buffer.getvalue()


def add_placeholders(archive: pymupdf.Archive, count: int) -> None:
    for index in range(count):
        archive.add(placeholder(index), f"{EQUATION_PREFIX}{index}")


def displayed(body: str) -> dict[str, int]:
    return {match.group(1): int(match.group(2)) for match in DISPLAY.finditer(body)}


def _sized(svg: str, size: tuple[float, float]) -> str:
    width, height = (side * SVG_PIXELS_PER_EM for side in size)
    opening = f'<svg width="{width:.2f}" height="{height:.2f}"'
    return SVG_OPEN.sub(
        lambda match: SIZE_ATTRIBUTE.sub("", match.group(0)).replace("<svg", opening, 1),
        svg,
        count=1,
    )


class Equations:
    def __init__(self, svgs: list[str]) -> None:
        self.svgs = svgs
        self.pictures: dict[int, pymupdf.Document | None] = {}

    def size(self, index: int) -> tuple[float, float] | None:
        if not 0 <= index < len(self.svgs):
            return None
        return equation_size(self.svgs[index])

    def picture(self, index: int) -> pymupdf.Document | None:
        if index in self.pictures:
            return self.pictures[index]
        found = None
        size = self.size(index)
        if size:
            with contextlib.suppress(Exception):
                found = drawing_pdf(_sized(self.svgs[index], size).encode(), "equation")
            if found is not None and found.page_count == 0:
                found.close()
                found = None
        self.pictures[index] = found
        return found

    def close(self) -> None:
        for picture in self.pictures.values():
            if picture is not None:
                picture.close()
        self.pictures.clear()

    def _place(self, page: pymupdf.Page, rect: pymupdf.Rect, index: int) -> None:
        picture = self.picture(index)
        if picture is None or rect.is_empty:
            return
        with contextlib.suppress(Exception):
            page.show_pdf_page(rect, picture, 0, keep_proportion=False)

    def draw_display(self, page: pymupdf.Page, box: pymupdf.Rect, index: int) -> None:
        size = self.size(index)
        if size is None or box.height <= 0:
            return
        em = box.height / DISPLAY_LINE
        width, height = size[0] * em, size[1] * em
        room = box.width - 2 * NUMBER_RESERVE_EM * em
        if room > 0 and width > room:
            width, height = room, height * room / width
        middle = pymupdf.Point((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
        half = pymupdf.Point(width / 2, height / 2)
        target = pymupdf.Rect(middle - half, middle + half)
        self._place(page, target * insertion_matrix(page), index)

    def draw_inline(self, page: pymupdf.Page) -> None:
        for info in page.get_image_info():
            if info.get("height") != PLACEHOLDER_HEIGHT:
                continue
            index = int(info.get("width", 0)) - 1
            size = self.size(index)
            bbox = pymupdf.Rect(info["bbox"])
            if size is None or bbox.is_empty:
                continue
            expected = size[0] / size[1]
            if abs(bbox.width / bbox.height - expected) > ASPECT_TOLERANCE * expected:
                continue
            self._place(page, bbox * unrotated_insertion_matrix(page), index)


def draw_equations(
    document: pymupdf.Document,
    positions: list,
    body: str,
    svgs: list[str],
    check_cancelled: Callable[[], None],
) -> None:
    if not svgs:
        return
    equations = Equations(svgs)
    try:
        wanted = displayed(body)
        drawn: set[str] = set()
        for position in positions:
            if not (position.id in wanted and position.open_close & 1) or position.id in drawn:
                continue
            drawn.add(position.id)
            if 1 <= position.page_num <= document.page_count:
                page = document[position.page_num - 1]
                equations.draw_display(page, pymupdf.Rect(position.rect), wanted[position.id])
        for page in document:
            check_cancelled()
            equations.draw_inline(page)
    finally:
        equations.close()
