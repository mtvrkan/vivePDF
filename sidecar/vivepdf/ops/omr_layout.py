import math
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import pymupdf
import zxingcpp

from vivepdf.rpc.errors import ErrorCode, OpError

Paper = Literal["a4", "letter"]
LetterCase = Literal["upper", "lower"]

PAPERS: dict[str, tuple[float, float]] = {"a4": (595.0, 842.0), "letter": (612.0, 792.0)}
PAYLOAD_PREFIX = "VPOMR1"
MAX_QUESTIONS = 200
MAX_OPTIONS = 8
MAX_DIGITS = 12
MAX_BOOKLETS = 4

MARGIN = 28.0
FIDUCIAL = 16.0
QR_SIDE = 64.0
HEADER_TOP = MARGIN + FIDUCIAL + 8.0
SECTION_TOP = 128.0
SECTION_LABEL = 14.0
DIGIT_BOX = 15.0
DIGIT_PITCH = 16.0
DIGIT_ROW = 14.0
SECTION_GAP = 24.0
LABEL_GAP = 4.0
BUBBLE_RADIUS = 5.0
OPTION_PITCH = 15.0
ROW_PITCH = 14.0
BLOCK_ROWS = 5
BLOCK_GAP = 5.0
NUMBER_WIDTH = 20.0
COLUMN_GAP = 14.0
ANSWERS_GAP = 16.0
BOTTOM_LIMIT = MARGIN + FIDUCIAL + 8.0
SIDE_INSET = 4.0

Point = tuple[float, float]


@dataclass(frozen=True)
class SheetSpec:
    questions: int
    options: int
    digits: int = 0
    booklets: int = 1
    letter_case: LetterCase = "upper"
    paper: Paper = "a4"

    def payload(self) -> str:
        case = "U" if self.letter_case == "upper" else "L"
        return (
            f"{PAYLOAD_PREFIX};q={self.questions};o={self.options};d={self.digits}"
            f";b={self.booklets};c={case};p={self.paper}"
        )


@dataclass
class SheetLayout:
    spec: SheetSpec
    width: float
    height: float
    fiducials: list[Point]
    qr_area: pymupdf.Rect
    qr_symbol: pymupdf.Rect
    qr_modules: np.ndarray
    title_box: pymupdf.Rect
    name_box: pymupdf.Rect
    hint_box: pymupdf.Rect
    id_label: pymupdf.Rect | None
    id_boxes: list[pymupdf.Rect]
    digit_bubbles: list[list[Point]]
    booklet_label: pymupdf.Rect | None
    booklet_bubbles: list[Point]
    number_boxes: list[pymupdf.Rect]
    question_bubbles: list[list[Point]]
    capacity: int
    radius: float = BUBBLE_RADIUS
    letters: list[str] = field(default_factory=list)


def option_letters(count: int, letter_case: LetterCase) -> list[str]:
    letters = [chr(ord("A") + index) for index in range(count)]
    return letters if letter_case == "upper" else [letter.lower() for letter in letters]


def parse_payload(text: str) -> SheetSpec | None:
    parts = text.strip().split(";")
    if not parts or parts[0] != PAYLOAD_PREFIX:
        return None
    values = dict(part.split("=", 1) for part in parts[1:] if "=" in part)
    try:
        spec = SheetSpec(
            questions=int(values["q"]),
            options=int(values["o"]),
            digits=int(values.get("d", "0")),
            booklets=int(values.get("b", "1")),
            letter_case="lower" if values.get("c") == "L" else "upper",
            paper="letter" if values.get("p") == "letter" else "a4",
        )
    except (KeyError, ValueError):
        return None
    valid = (
        1 <= spec.questions <= MAX_QUESTIONS
        and 2 <= spec.options <= MAX_OPTIONS
        and 0 <= spec.digits <= MAX_DIGITS
        and 1 <= spec.booklets <= MAX_BOOKLETS
    )
    return spec if valid else None


def _qr_modules(payload: str) -> np.ndarray:
    image = zxingcpp.create_barcode(payload, zxingcpp.BarcodeFormat.QRCode).to_image(scale=1)
    return np.asarray(image) < 128


def _rows_height(rows: int) -> float:
    return rows * ROW_PITCH + max(0, rows - 1) // BLOCK_ROWS * BLOCK_GAP


def _fiducials(width: float, height: float) -> list[Point]:
    near = MARGIN + FIDUCIAL / 2
    return [
        (near, near),
        (width - near, near),
        (near, height - near),
        (width - near, height - near),
    ]


def sheet_layout(spec: SheetSpec) -> SheetLayout:
    width, height = PAPERS[spec.paper]
    left = MARGIN + SIDE_INSET
    right = width - MARGIN - SIDE_INSET

    modules = _qr_modules(spec.payload())
    qr_area = pymupdf.Rect(
        width - MARGIN - QR_SIDE, HEADER_TOP, width - MARGIN, HEADER_TOP + QR_SIDE
    )
    module = QR_SIDE / modules.shape[1]
    rows, columns = np.nonzero(modules)
    qr_symbol = pymupdf.Rect(
        qr_area.x0 + float(columns.min()) * module,
        qr_area.y0 + float(rows.min()) * module,
        qr_area.x0 + float(columns.max() + 1) * module,
        qr_area.y0 + float(rows.max() + 1) * module,
    )
    title_box = pymupdf.Rect(left, HEADER_TOP, qr_area.x0 - 12, HEADER_TOP + 26)
    name_box = pymupdf.Rect(left, HEADER_TOP + 34, qr_area.x0 - 12, HEADER_TOP + 58)

    id_label: pymupdf.Rect | None = None
    id_boxes: list[pymupdf.Rect] = []
    digit_bubbles: list[list[Point]] = []
    booklet_label: pymupdf.Rect | None = None
    booklet_bubbles: list[Point] = []
    cursor = left
    section_bottom = SECTION_TOP - ANSWERS_GAP
    bubbles_top = SECTION_TOP + SECTION_LABEL + DIGIT_BOX + 4 + DIGIT_ROW / 2
    if spec.digits:
        id_label = pymupdf.Rect(
            cursor,
            SECTION_TOP,
            cursor + spec.digits * DIGIT_PITCH + SECTION_GAP - LABEL_GAP,
            SECTION_TOP + SECTION_LABEL - 1,
        )
        for digit in range(spec.digits):
            x = cursor + digit * DIGIT_PITCH
            id_boxes.append(
                pymupdf.Rect(
                    x,
                    SECTION_TOP + SECTION_LABEL,
                    x + DIGIT_BOX,
                    SECTION_TOP + SECTION_LABEL + DIGIT_BOX,
                )
            )
            centre = x + DIGIT_BOX / 2
            digit_bubbles.append([(centre, bubbles_top + value * DIGIT_ROW) for value in range(10)])
        cursor += spec.digits * DIGIT_PITCH + SECTION_GAP
        section_bottom = bubbles_top + 9 * DIGIT_ROW + DIGIT_ROW / 2
    if spec.booklets > 1:
        booklet_label = pymupdf.Rect(
            cursor,
            SECTION_TOP,
            cursor + max(DIGIT_PITCH * 3, DIGIT_BOX) + SECTION_GAP - LABEL_GAP,
            SECTION_TOP + SECTION_LABEL - 1,
        )
        centre = cursor + DIGIT_BOX / 2
        booklet_bubbles = [
            (centre, bubbles_top + index * DIGIT_ROW) for index in range(spec.booklets)
        ]
        cursor += max(DIGIT_PITCH * 3, DIGIT_BOX) + SECTION_GAP
        section_bottom = max(
            section_bottom, bubbles_top + (spec.booklets - 1) * DIGIT_ROW + DIGIT_ROW / 2
        )
    has_section = bool(spec.digits) or spec.booklets > 1
    hint_top = SECTION_TOP if has_section else HEADER_TOP + 62
    hint_box = pymupdf.Rect(
        cursor if has_section else left, hint_top, right, hint_top + (60 if has_section else 30)
    )
    answers_top = (section_bottom if has_section else hint_box.y1) + ANSWERS_GAP

    area_height = height - BOTTOM_LIMIT - answers_top
    column_width = NUMBER_WIDTH + spec.options * OPTION_PITCH
    column_count = max(1, int((right - left + COLUMN_GAP) // (column_width + COLUMN_GAP)))
    max_rows = 0
    while _rows_height(max_rows + 1) <= area_height:
        max_rows += 1
    capacity = column_count * max_rows
    if spec.questions > capacity:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"{spec.questions} questions do not fit on one sheet (at most {capacity})",
            {"reason": "omrTooManyQuestions", "capacity": capacity},
        )
    per_column = math.ceil(spec.questions / column_count)
    rows = min(max_rows, math.ceil(per_column / BLOCK_ROWS) * BLOCK_ROWS)
    used_columns = math.ceil(spec.questions / rows)
    used_width = used_columns * column_width + (used_columns - 1) * COLUMN_GAP
    offset = left + (right - left - used_width) / 2

    number_boxes: list[pymupdf.Rect] = []
    question_bubbles: list[list[Point]] = []
    for index in range(spec.questions):
        column, row = divmod(index, rows)
        x0 = offset + column * (column_width + COLUMN_GAP)
        y = answers_top + row * ROW_PITCH + row // BLOCK_ROWS * BLOCK_GAP + ROW_PITCH / 2
        number_boxes.append(
            pymupdf.Rect(x0, y - ROW_PITCH / 2, x0 + NUMBER_WIDTH - 4, y + ROW_PITCH / 2)
        )
        question_bubbles.append(
            [
                (x0 + NUMBER_WIDTH + option * OPTION_PITCH + OPTION_PITCH / 2, y)
                for option in range(spec.options)
            ]
        )

    return SheetLayout(
        spec=spec,
        width=width,
        height=height,
        fiducials=_fiducials(width, height),
        qr_area=qr_area,
        qr_symbol=qr_symbol,
        qr_modules=modules,
        title_box=title_box,
        name_box=name_box,
        hint_box=hint_box,
        id_label=id_label,
        id_boxes=id_boxes,
        digit_bubbles=digit_bubbles,
        booklet_label=booklet_label,
        booklet_bubbles=booklet_bubbles,
        number_boxes=number_boxes,
        question_bubbles=question_bubbles,
        capacity=capacity,
        letters=option_letters(spec.options, spec.letter_case),
    )
