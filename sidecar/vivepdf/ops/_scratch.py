from dataclasses import dataclass
from pathlib import Path

import pymupdf

from vivepdf.ops._placement import insertion_matrix
from vivepdf.ops.fonts import resolve_choice, uncovered_glyphs
from vivepdf.rpc.errors import ErrorCode, OpError

HEX_COLOR = r"^#[0-9a-fA-F]{6}$"
LINE_HEIGHT = 1.25
REGULAR_NAME = "scr-r"
BOLD_NAME = "scr-b"


@dataclass
class ScratchFonts:
    regular_path: Path
    bold_path: Path
    regular: pymupdf.Font
    bold: pymupdf.Font

    def of(self, bold: bool) -> pymupdf.Font:
        return self.bold if bold else self.regular

    def name_of(self, bold: bool) -> str:
        return BOLD_NAME if bold else REGULAR_NAME

    def install(self, page: pymupdf.Page) -> None:
        page.insert_font(fontname=REGULAR_NAME, fontfile=str(self.regular_path))
        page.insert_font(fontname=BOLD_NAME, fontfile=str(self.bold_path))

    def missing(self, regular_text: str, bold_text: str) -> str:
        found = uncovered_glyphs(self.regular_path, regular_text) + uncovered_glyphs(
            self.bold_path, bold_text
        )
        return "".join(dict.fromkeys(found))


def rgb(value: str) -> tuple[float, float, float]:
    return tuple(int(value[index : index + 2], 16) / 255 for index in (1, 3, 5))


def load_fonts(font_id: str | None) -> ScratchFonts:
    regular_path = resolve_choice(font_id, False)
    bold_path = resolve_choice(font_id, True)
    try:
        return ScratchFonts(
            regular_path,
            bold_path,
            pymupdf.Font(fontfile=str(regular_path)),
            pymupdf.Font(fontfile=str(bold_path)),
        )
    except Exception as error:  # noqa: BLE001
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the chosen font cannot be read",
            {"reason": "fontUnreadable", "fontId": font_id},
        ) from error


def baseline_offset(font: pymupdf.Font, size: float) -> float:
    line_step = size * LINE_HEIGHT
    return (line_step - (font.ascender - font.descender) * size) / 2 + font.ascender * size


def place_scratch_page(page: pymupdf.Page, box: pymupdf.Rect, scratch: pymupdf.Document) -> int:
    target = pymupdf.Rect(box)
    target.normalize()
    target = target * insertion_matrix(page)
    target.normalize()
    return page.show_pdf_page(
        target, scratch, 0, keep_proportion=True, overlay=True, rotate=page.rotation
    )
