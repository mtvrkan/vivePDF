from dataclasses import dataclass
from typing import Annotated, Literal

import pymupdf
from pydantic import Field, model_validator

from vivepdf.ops._scratch import (
    HEX_COLOR,
    LINE_HEIGHT,
    ScratchFonts,
    baseline_offset,
    load_fonts,
    rgb,
)
from vivepdf.ops.editor_table import wrap_cell
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MAX_OPTIONS = 8
MAX_STEM_CHARS = 4000
MAX_OPTION_CHARS = 1000
MAX_QUESTION_HEIGHT = 14_400.0
NUMBER_GAP = 0.5
LABEL_GAP = 0.35
COLUMN_GAP = 0.8
OPTIONS_GAP = 0.45
ANSWER_LINE_STEP = 2.2
ANSWER_LINE_WIDTH = 0.6
MARK_RADIUS = 0.62
BOTTOM_PAD = 0.3

QuestionLayout = Literal["auto", "stack", "two", "row"]
LetterCase = Literal["upper", "lower"]
OptionText = Annotated[str, Field(max_length=MAX_OPTION_CHARS)]


class QuestionSpec(RpcModel):
    number: int | None = Field(default=1, ge=0, le=9999)
    stem: str = Field(default="", max_length=MAX_STEM_CHARS)
    options: list[OptionText] = Field(default_factory=list, max_length=MAX_OPTIONS)
    layout: QuestionLayout = "auto"
    letter_case: LetterCase = "upper"
    answer: int | None = Field(default=None, ge=0, lt=MAX_OPTIONS)
    mark_answer: bool = False
    answer_lines: int = Field(default=0, ge=0, le=30)
    width: float = Field(default=460, ge=80, le=2000)
    font_size: float = Field(default=11, ge=4, le=72)
    font_id: str | None = Field(default=None, max_length=4096)
    color: str = Field(default="#111111", pattern=HEX_COLOR)
    line_color: str = Field(default="#9ca3af", pattern=HEX_COLOR)

    @model_validator(mode="after")
    def _answer_is_an_option(self) -> "QuestionSpec":
        if self.answer is not None and self.answer >= len(self.options):
            raise ValueError("answer must point at one of the options")
        return self


class QuestionPreviewResult(RpcModel):
    svg: str
    width: float
    height: float
    missing_glyphs: str = ""


@dataclass
class _Option:
    label: str
    lines: list[str]
    x: float
    y: float


@dataclass
class _Layout:
    indent: float
    stem: list[str]
    options: list[_Option]
    label_width: float
    lines_top: float
    height: float


def option_label(index: int, letter_case: LetterCase) -> str:
    letter = chr(ord("A") + index)
    return f"{letter if letter_case == 'upper' else letter.lower()})"


def _columns(spec: QuestionSpec, font: pymupdf.Font, available: float, label_width: float) -> int:
    count = len(spec.options)
    if count <= 1 or spec.layout == "stack":
        return 1
    if spec.layout == "two":
        return 2
    if spec.layout == "row":
        return count

    def fits(columns: int) -> bool:
        room = available / columns - label_width - spec.font_size * COLUMN_GAP
        return all(
            "\n" not in text and font.text_length(text.strip(), fontsize=spec.font_size) <= room
            for text in spec.options
        )

    if fits(count):
        return count
    return 2 if count > 2 and fits(2) else 1


def _layout(spec: QuestionSpec, fonts: ScratchFonts) -> _Layout:
    size = spec.font_size
    step = size * LINE_HEIGHT
    indent = 0.0
    if spec.number is not None:
        widest = max(fonts.bold.text_length(f"{spec.number}.", fontsize=size), size * 1.2)
        indent = widest + size * NUMBER_GAP
    available = max(1.0, spec.width - indent)
    stem = wrap_cell(spec.stem, fonts.regular, size, available) if spec.stem.strip() else []
    top = len(stem) * step
    labels = [option_label(index, spec.letter_case) for index in range(len(spec.options))]
    label_width = (
        max((fonts.bold.text_length(label, fontsize=size) for label in labels), default=0.0)
        + size * LABEL_GAP
    )
    options: list[_Option] = []
    if spec.options:
        if stem:
            top += size * OPTIONS_GAP
        columns = _columns(spec, fonts.regular, available, label_width)
        column_width = available / columns
        text_width = max(
            1.0, column_width - label_width - (size * COLUMN_GAP if columns > 1 else 0)
        )
        for start in range(0, len(spec.options), columns):
            row_height = 0
            for offset, text in enumerate(spec.options[start : start + columns]):
                lines = wrap_cell(text, fonts.regular, size, text_width)
                options.append(
                    _Option(labels[start + offset], lines, indent + offset * column_width, top)
                )
                row_height = max(row_height, len(lines))
            top += row_height * step
    lines_top = top
    top += spec.answer_lines * size * ANSWER_LINE_STEP
    height = max(step, top) + size * BOTTOM_PAD
    if height > MAX_QUESTION_HEIGHT:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the question is too tall to place on a page",
            {"reason": "questionTooTall", "height": round(height)},
        )
    return _Layout(indent, stem, options, label_width, lines_top, height)


def _draw(page: pymupdf.Page, spec: QuestionSpec, layout: _Layout, fonts: ScratchFonts, opacity):
    fonts.install(page)
    colour = rgb(spec.color)
    size = spec.font_size
    step = size * LINE_HEIGHT

    def write(x: float, top: float, text: str, bold: bool) -> None:
        if text:
            page.insert_text(
                (x, top + baseline_offset(fonts.of(bold), size)),
                text,
                fontname=fonts.name_of(bold),
                fontsize=size,
                color=colour,
                fill_opacity=opacity,
            )

    if spec.number is not None:
        write(0, 0, f"{spec.number}.", True)
    for index, line in enumerate(layout.stem):
        write(layout.indent, index * step, line, False)
    for index, option in enumerate(layout.options):
        chosen = spec.mark_answer and spec.answer == index
        write(option.x, option.y, option.label, True)
        for line_index, line in enumerate(option.lines):
            write(option.x + layout.label_width, option.y + line_index * step, line, chosen)
        if chosen:
            label = fonts.bold.text_length(option.label, fontsize=size)
            page.draw_circle(
                (option.x + label / 2, option.y + step / 2),
                size * MARK_RADIUS,
                color=colour,
                width=max(0.6, size / 14),
                stroke_opacity=opacity,
            )
    line_colour = rgb(spec.line_color)
    for index in range(1, spec.answer_lines + 1):
        y = layout.lines_top + index * size * ANSWER_LINE_STEP
        page.draw_line(
            (layout.indent, y),
            (spec.width, y),
            color=line_colour,
            width=ANSWER_LINE_WIDTH,
            stroke_opacity=opacity,
        )


def question_pdf(spec: QuestionSpec, opacity: float = 1.0) -> tuple[pymupdf.Document, str]:
    if not spec.stem.strip() and not any(text.strip() for text in spec.options):
        raise OpError(
            ErrorCode.INVALID_PARAMS, "the question is empty", {"reason": "questionEmpty"}
        )
    fonts = load_fonts(spec.font_id)
    layout = _layout(spec, fonts)
    document = pymupdf.open()
    page = document.new_page(width=spec.width, height=layout.height)
    _draw(page, spec, layout, fonts, opacity)
    labels = "".join(option.label for option in layout.options)
    number = f"{spec.number}." if spec.number is not None else ""
    return document, fonts.missing(spec.stem + "".join(spec.options), labels + number)


@op("editor.question_preview", QuestionSpec)
def question_preview(params: QuestionSpec, _progress: Progress) -> QuestionPreviewResult:
    document, missing = question_pdf(params)
    try:
        page = document[0]
        return QuestionPreviewResult(
            svg=page.get_svg_image(text_as_path=True),
            width=page.rect.width,
            height=page.rect.height,
            missing_glyphs=missing,
        )
    finally:
        document.close()
