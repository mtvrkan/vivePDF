import datetime

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._output import prepare_output, save_document
from vivepdf.ops._page_batch import SharedFonts
from vivepdf.ops._page_text import Position, anchor_point, insert_page_text, parse_color
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._text_fit import MAX_REPORTED_GLYPHS, fit_line
from vivepdf.ops._watermark_style import grid_cell
from vivepdf.ops.fonts import resolve_choice, uncovered_glyphs
from vivepdf.ops.furniture import artifact_opening, remove_furniture, role_names
from vivepdf.ops.page_numbers import StampedResult, render_furniture_text
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class HeaderFooterParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    pages: str | None = None
    header_left: str = ""
    header_center: str = ""
    header_right: str = ""
    footer_left: str = ""
    footer_center: str = ""
    footer_right: str = ""
    font_size: float = Field(default=10, ge=4, le=48)
    margin: float = Field(default=28, ge=0, le=200)
    color: str = "#333333"
    bold: bool = False
    font_id: str | None = None
    date_format: str = Field(default="%d.%m.%Y", max_length=60)
    start: int = Field(default=1, ge=0)
    replace_existing: bool = False


def slot_room(width: float, margin: float, filled: set[str]) -> float:
    usable = max(width - 2 * margin, width / 2)
    if len(filled) <= 1:
        return usable
    return usable / (3 if "center" in filled else 2)


def slot_lines(
    rect: pymupdf.Rect,
    font: pymupdf.Font,
    label: str,
    slot: Position,
    params: HeaderFooterParams,
    room: float,
) -> list[tuple[pymupdf.Point, str, float]]:
    lines = label.replace(chr(13), "").split(chr(10))
    while lines and not lines[-1].strip():
        lines.pop()
    while lines and not lines[0].strip():
        lines.pop(0)
    line_height = params.font_size * (font.ascender - font.descender)
    row, _column = grid_cell(slot)
    placed: list[tuple[pymupdf.Point, str, float]] = []
    for index, line in enumerate(lines):
        fitted, size = fit_line(font, line, params.font_size, room)
        width = font.text_length(fitted, fontsize=size)
        baseline = anchor_point(rect, width, params.font_size, slot, params.margin)
        if row == "bottom":
            baseline.y -= (len(lines) - 1 - index) * line_height
        elif row == "top":
            baseline.y += index * line_height
        else:
            baseline.y += (index - (len(lines) - 1) / 2) * line_height
        if fitted.strip():
            placed.append((baseline, fitted, size))
    return placed


@op("pages.header_footer", HeaderFooterParams)
def header_footer(params: HeaderFooterParams, progress: Progress) -> StampedResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    color = parse_color(params.color)
    font_file = resolve_choice(params.font_id, params.bold)
    font = pymupdf.Font(fontfile=str(font_file))
    slots: list[tuple[Position, str]] = [
        ("top-left", params.header_left),
        ("top-center", params.header_center),
        ("top-right", params.header_right),
        ("bottom-left", params.footer_left),
        ("bottom-center", params.footer_center),
        ("bottom-right", params.footer_right),
    ]
    if not any(text.strip() for _, text in slots):
        raise OpError(ErrorCode.INVALID_PARAMS, "no header or footer text given")
    filled: dict[str, set[str]] = {}
    for slot, text in slots:
        if text.strip():
            row, column = grid_cell(slot)
            filled.setdefault(row, set()).add(column)
    now = datetime.datetime.now()
    with open_document(params.path, params.password) as document:
        indices = list(dict.fromkeys(parse_page_ranges(params.pages, document.page_count)))
        last = params.start + len(indices) - 1
        pages = [document[index] for index in indices]
        page_xrefs = [document.page_xref(index) for index in indices]
        fonts = SharedFonts(document)
        if params.replace_existing:
            remove_furniture(document, indices, role_names(["headerFooter"]), pages=pages)
        written: list[str] = []
        for position, (page, page_xref) in enumerate(zip(pages, page_xrefs, strict=True)):
            progress.check_cancelled()
            for slot, text in slots:
                if not text.strip():
                    continue
                label = render_furniture_text(
                    text, params.start + position, last, params.path, params.date_format, now
                )
                written.append(label)
                room = slot_room(page.rect.width, params.margin, filled[grid_cell(slot)[0]])
                for baseline, line, size in slot_lines(page.rect, font, label, slot, params, room):
                    insert_page_text(
                        page,
                        baseline,
                        line,
                        font_file=font_file,
                        font_size=size,
                        color=color,
                        artifact=artifact_opening(slot, "headerFooter"),
                        shared=(fonts, page_xref),
                    )
            if position % 25 == 0:
                progress.report(
                    position / max(1, len(indices)),
                    "progress.stamping",
                    {"current": position + 1, "total": len(indices)},
                )
        progress.report(0.9, "progress.saving")
        saved = save_document(document, target)
    return StampedResult(
        **saved.model_dump(),
        stamped=len(indices),
        missing_glyphs=uncovered_glyphs(font_file, "".join(written))[:MAX_REPORTED_GLYPHS],
    )
