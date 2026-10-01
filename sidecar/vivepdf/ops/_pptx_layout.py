import math
import re
from dataclasses import dataclass

import pymupdf

EMU_PER_POINT = 12700
MIN_FONT_POINTS = 1.0
MAX_FONT_POINTS = 4000.0
BOLD_FLAG = 16
ITALIC_FLAG = 2
SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")
UNSAFE_CHARACTERS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")
FONT_SUFFIXES = ("PSMT", "MT", "PS")
FONT_STYLE = re.compile(
    r"(?:(?:semi|demi|extra|ultra)?(?:bold|light|black|heavy|thin|medium|regular|roman|book"
    r"|italic|oblique|condensed|narrow|it|bd|bi|lt|md|rg|bk))+(?:psmt|mt|ps)?",
    re.IGNORECASE,
)
FONT_FAMILIES = {
    "Helvetica": "Arial",
    "Times": "Times New Roman",
    "TimesNewRoman": "Times New Roman",
    "Courier": "Courier New",
    "CourierNew": "Courier New",
}
DEFAULT_FAMILY = "Arial"


@dataclass(slots=True)
class SlideFrame:
    left: int
    top: int
    ratio: float


@dataclass(slots=True)
class LineBox:
    left: float
    top: float
    width: float
    height: float
    angle: float
    spans: list[dict]


def font_family(name: str) -> str:
    parts = re.split(r"[-,]", SUBSET_PREFIX.sub("", name or ""))
    kept = parts[:1]
    for part in parts[1:]:
        if not part or FONT_STYLE.fullmatch(part):
            break
        kept.append(part)
    base = " ".join(kept)
    for suffix in FONT_SUFFIXES:
        if base.endswith(suffix) and len(base) > len(suffix):
            base = base[: -len(suffix)]
            break
    return FONT_FAMILIES.get(base, base) or DEFAULT_FAMILY


def slide_text(text: str) -> str:
    return UNSAFE_CHARACTERS.sub("", text)


def _visible(span: dict) -> bool:
    return span.get("alpha", 255) > 0


def _direction(line: dict, matrix: pymupdf.Matrix) -> tuple[float, float]:
    origin = pymupdf.Point(0, 0) * matrix
    moved = pymupdf.Point(*line["dir"]) * matrix
    return moved.x - origin.x, moved.y - origin.y


def line_boxes(page: pymupdf.Page) -> list[LineBox]:
    matrix = page.rotation_matrix
    boxes: list[LineBox] = []
    for block in page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]:
        for line in block.get("lines", []):
            spans = [span for span in line["spans"] if _visible(span) and span["text"]]
            if not any(slide_text(span["text"]).strip() for span in spans):
                continue
            bounds = pymupdf.Rect(line["bbox"])
            shown = bounds * matrix
            dx, dy = _direction(line, matrix)
            angle = round(math.degrees(math.atan2(dy, dx)), 1) % 360
            along_x = abs(line["dir"][0]) >= abs(line["dir"][1])
            length = bounds.width if along_x else bounds.height
            thickness = bounds.height if along_x else bounds.width
            center = (shown.tl + shown.br) / 2
            boxes.append(
                LineBox(
                    left=center.x - length / 2,
                    top=center.y - thickness / 2,
                    width=length,
                    height=thickness,
                    angle=angle,
                    spans=spans,
                )
            )
    return boxes


def text_free_pixmap(document: pymupdf.Document, index: int, dpi: int) -> pymupdf.Pixmap:
    with pymupdf.open() as single:
        single.insert_pdf(document, from_page=index, to_page=index, annots=True)
        page = single[0]
        page.add_redact_annot(page.rect, fill=False, cross_out=False)
        page.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_NONE,
            graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
            text=pymupdf.PDF_REDACT_TEXT_REMOVE,
        )
        return page.get_pixmap(dpi=dpi)


def _font_points(size: float, ratio: float) -> float:
    return min(MAX_FONT_POINTS, max(MIN_FONT_POINTS, round(size * ratio / EMU_PER_POINT, 1)))


def add_line_box(slide, box: LineBox, frame: SlideFrame) -> None:
    from pptx.dml.color import RGBColor
    from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE
    from pptx.util import Emu, Pt

    shape = slide.shapes.add_textbox(
        Emu(round(frame.left + box.left * frame.ratio)),
        Emu(round(frame.top + box.top * frame.ratio)),
        Emu(max(1, round(box.width * frame.ratio))),
        Emu(max(1, round(box.height * frame.ratio))),
    )
    text_frame = shape.text_frame
    text_frame.word_wrap = False
    text_frame.auto_size = MSO_AUTO_SIZE.NONE
    text_frame.margin_left = text_frame.margin_right = 0
    text_frame.margin_top = text_frame.margin_bottom = 0
    text_frame.vertical_anchor = MSO_ANCHOR.TOP
    paragraph = text_frame.paragraphs[0]
    for span in box.spans:
        text = slide_text(span["text"])
        if not text:
            continue
        run = paragraph.add_run()
        run.text = text
        font = run.font
        font.size = Pt(_font_points(span["size"], frame.ratio))
        font.name = font_family(span["font"])
        font.bold = bool(span["flags"] & BOLD_FLAG)
        font.italic = bool(span["flags"] & ITALIC_FLAG)
        font.color.rgb = RGBColor.from_string(f"{span['color'] & 0xFFFFFF:06X}")
    if box.angle:
        shape.rotation = box.angle
