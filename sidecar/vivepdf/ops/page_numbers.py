import datetime
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._page_batch import SharedFonts
from vivepdf.ops._page_text import Position, anchor_point, insert_page_text, parse_color
from vivepdf.ops._ranges import PageSide, filter_side, parse_page_ranges
from vivepdf.ops._text_fit import MAX_REPORTED_GLYPHS
from vivepdf.ops.fonts import resolve_choice, uncovered_glyphs
from vivepdf.ops.furniture import artifact_opening, remove_furniture, role_names
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

NumberStyle = Literal["arabic", "romanLower", "romanUpper", "letterLower", "letterUpper"]

ROMAN_STEPS: tuple[tuple[int, str], ...] = (
    (1000, "m"),
    (900, "cm"),
    (500, "d"),
    (400, "cd"),
    (100, "c"),
    (90, "xc"),
    (50, "l"),
    (40, "xl"),
    (10, "x"),
    (9, "ix"),
    (5, "v"),
    (4, "iv"),
    (1, "i"),
)

PAGE_LABEL_STYLES: dict[str, str] = {
    "arabic": "D",
    "romanLower": "r",
    "romanUpper": "R",
    "letterLower": "a",
    "letterUpper": "A",
}


class PageNumberParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    pages: str | None = None
    side: PageSide = "all"
    position: Position = "bottom-center"
    mirror_margins: bool = False
    template: str = "{n}"
    style: NumberStyle = "arabic"
    start: int = Field(default=1, ge=0)
    font_size: float = Field(default=11, ge=4, le=72)
    margin: float = Field(default=28, ge=0, le=200)
    color: str = "#000000"
    bold: bool = False
    prefix: str = ""
    suffix: str = ""
    padding: int = Field(default=0, ge=0, le=12)
    font_id: str | None = None
    page_labels: bool = False
    replace_existing: bool = False


class StampedResult(OutputResult):
    stamped: int
    missing_glyphs: str = ""


LabelPart = tuple[str, str, int]
NUMBER_TOKENS = ("{n}", "{page}", "{total}")


def to_roman(value: int) -> str:
    if value < 1:
        return str(value)
    out: list[str] = []
    remaining = value
    for amount, numeral in ROMAN_STEPS:
        while remaining >= amount:
            out.append(numeral)
            remaining -= amount
    return "".join(out)


def to_letters(value: int) -> str:
    if value < 1:
        return str(value)
    out: list[str] = []
    remaining = value
    while remaining > 0:
        remaining, index = divmod(remaining - 1, 26)
        out.append(chr(ord("a") + index))
    return "".join(reversed(out))


def format_number(value: int, style: NumberStyle) -> str:
    if style == "romanLower":
        return to_roman(value)
    if style == "romanUpper":
        return to_roman(value).upper()
    if style == "letterLower":
        return to_letters(value)
    if style == "letterUpper":
        return to_letters(value).upper()
    return str(value)


def mirrored_position(position: Position, page_number: int) -> Position:
    if page_number % 2 == 1 or position.endswith("center"):
        return position
    row, _, column = position.partition("-")
    flipped = "right" if column == "left" else "left"
    return f"{row}-{flipped}"  # type: ignore[return-value]


def render_furniture_text(
    template: str,
    number: int,
    total: int,
    path: str,
    date_format: str,
    now: datetime.datetime,
) -> str:
    try:
        date_text = now.strftime(date_format)
    except ValueError:
        date_text = now.strftime("%d.%m.%Y")
    return (
        template.replace("{n}", str(number))
        .replace("{page}", str(number))
        .replace("{total}", str(total))
        .replace("{file}", Path(path).stem)
        .replace("{date}", date_text)
        .replace("{time}", now.strftime("%H:%M"))
    )


def render_page_label(
    template: str,
    number: int,
    total_last: int,
    prefix: str,
    padding: int,
    style: NumberStyle = "arabic",
    suffix: str = "",
) -> str:
    numbered = prefix + styled_number(number, style, padding) + suffix
    return (
        template.replace("{n}", numbered)
        .replace("{page}", numbered)
        .replace("{total}", styled_number(total_last, style, padding))
    )


def styled_number(value: int, style: NumberStyle, padding: int) -> str:
    rendered = format_number(value, style)
    if padding and style == "arabic":
        rendered = rendered.zfill(padding)
    return rendered


def page_label_part(style: NumberStyle, prefix: str, number: int, padding: int) -> LabelPart:
    if number < 1:
        return "", prefix + styled_number(number, style, padding), 1
    if style == "arabic" and padding:
        return "D", prefix + "0" * max(0, padding - len(str(number))), number
    return PAGE_LABEL_STYLES[style], prefix, number


def existing_label_parts(document: pymupdf.Document) -> list[LabelPart]:
    rules = sorted(document.get_page_labels(), key=lambda rule: rule.get("startpage", 0))
    parts: list[LabelPart] = []
    active: dict | None = None
    upcoming = iter(rules)
    following = next(upcoming, None)
    for index in range(document.page_count):
        while following is not None and following.get("startpage", 0) <= index:
            active, following = following, next(upcoming, None)
        if active is None:
            parts.append(("D", "", index + 1))
            continue
        first = int(active.get("firstpagenum", 1) or 1)
        parts.append(
            (
                active.get("style", "") or "",
                active.get("prefix", "") or "",
                first + index - int(active.get("startpage", 0)),
            )
        )
    return parts


def label_rules(parts: list[LabelPart]) -> list[dict]:
    rules: list[dict] = []
    previous: LabelPart | None = None
    for index, part in enumerate(parts):
        style, prefix, number = part
        continues = (
            previous is not None
            and previous[0] == style
            and previous[1] == prefix
            and (style == "" or number == previous[2] + 1)
        )
        if not continues:
            rules.append(
                {"startpage": index, "prefix": prefix, "style": style, "firstpagenum": number}
            )
        previous = part
    return rules


def _write_page_labels(
    document: pymupdf.Document, indices: list[int], params: PageNumberParams
) -> None:
    if not indices:
        return
    parts = existing_label_parts(document)
    for position, index in enumerate(indices):
        parts[index] = page_label_part(
            params.style, params.prefix, params.start + position, params.padding
        )
    document.set_page_labels(label_rules(parts))


@op("pages.number", PageNumberParams)
def number_pages(params: PageNumberParams, progress: Progress) -> StampedResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    color = parse_color(params.color)
    font_file = resolve_choice(params.font_id, params.bold)
    font = pymupdf.Font(fontfile=str(font_file))
    if not any(token in params.template for token in NUMBER_TOKENS):
        raise OpError(ErrorCode.INVALID_PARAMS, "template must contain {n} or {total}")
    with open_document(params.path, params.password) as document:
        indices = filter_side(
            list(dict.fromkeys(parse_page_ranges(params.pages, document.page_count))), params.side
        )
        total = len(indices)
        pages = [document[index] for index in indices]
        page_xrefs = [document.page_xref(index) for index in indices]
        fonts = SharedFonts(document)
        if params.replace_existing:
            remove_furniture(document, indices, role_names(["pageNumber"]), pages=pages)
        labels: list[str] = []
        for position, (index, page) in enumerate(zip(indices, pages, strict=True)):
            progress.check_cancelled()
            label = render_page_label(
                params.template,
                params.start + position,
                params.start + total - 1,
                params.prefix,
                params.padding,
                params.style,
                params.suffix,
            )
            labels.append(label)
            slot = (
                mirrored_position(params.position, index + 1)
                if params.mirror_margins
                else params.position
            )
            width = font.text_length(label, fontsize=params.font_size)
            baseline = anchor_point(page.rect, width, params.font_size, slot, params.margin)
            insert_page_text(
                page,
                baseline,
                label,
                font_file=font_file,
                font_size=params.font_size,
                color=color,
                artifact=artifact_opening(slot, "pageNumber"),
                shared=(fonts, page_xrefs[position]),
            )
            if position % 25 == 0:
                progress.report(
                    position / total, "progress.stamping", {"current": position + 1, "total": total}
                )
        if params.page_labels:
            _write_page_labels(document, indices, params)
        progress.report(0.9, "progress.saving")
        saved = save_document(document, target)
    return StampedResult(
        **saved.model_dump(),
        stamped=total,
        missing_glyphs=uncovered_glyphs(font_file, "".join(labels))[:MAX_REPORTED_GLYPHS],
    )
