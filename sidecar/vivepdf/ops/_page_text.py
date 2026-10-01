from contextlib import nullcontext
from pathlib import Path

import pymupdf

from vivepdf.ops._page_batch import SharedFonts
from vivepdf.ops._watermark_style import GridPosition, grid_cell
from vivepdf.ops.fonts import font_name_for
from vivepdf.ops.furniture import mark_new_content
from vivepdf.rpc.errors import ErrorCode, OpError

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
NUMBER_FONT = FONT_DIR / "DejaVuSans.ttf"

Position = GridPosition


def parse_color(value: str) -> tuple[float, float, float]:
    text = value.strip().lstrip("#")
    if len(text) != 6 or any(char not in "0123456789abcdefABCDEF" for char in text):
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"invalid colour '{value}'", {"reason": "badColour"}
        )
    return tuple(int(text[index : index + 2], 16) / 255 for index in (0, 2, 4))  # type: ignore[return-value]


def anchor_point(
    rect: pymupdf.Rect, width: float, height: float, position: Position, margin: float
) -> pymupdf.Point:
    row, column = grid_cell(position)
    if column == "left":
        x = margin
    elif column == "right":
        x = rect.width - margin - width
    else:
        x = (rect.width - width) / 2
    if row == "top":
        y = margin + height
    elif row == "bottom":
        y = rect.height - margin
    else:
        y = (rect.height + height) / 2
    x = min(max(x, 0.0), max(0.0, rect.width - width))
    y = min(max(y, min(height, rect.height)), rect.height)
    return pymupdf.Point(x, y)


def insert_page_text(
    page: pymupdf.Page,
    baseline: pymupdf.Point,
    text: str,
    *,
    font_file: Path,
    font_size: float,
    color: tuple,
    opacity: float = 1.0,
    artifact: bytes | None = None,
    shared: tuple[SharedFonts, int] | None = None,
) -> None:
    before = set(page.get_contents())
    font_name = font_name_for(font_file)
    fonts = (
        shared[0].using(page, shared[1], font_name, font_file)
        if shared is not None
        else nullcontext()
    )
    with fonts:
        page.insert_text(
            baseline * page.derotation_matrix,
            text,
            fontsize=font_size,
            fontname=font_name,
            fontfile=str(font_file),
            color=color,
            fill_opacity=opacity,
            stroke_opacity=opacity,
            rotate=page.rotation,
        )
    if artifact is not None:
        mark_new_content(page, before, artifact)
