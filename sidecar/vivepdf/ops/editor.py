import base64
import contextlib
import io
import os
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

import pymupdf
from PIL import Image, ImageOps
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._figure_tag import MAX_ALT_CHARS, is_tagged, tag_placed_figure
from vivepdf.ops._font_unicode import subset_fonts
from vivepdf.ops._image_files import image_file_bytes, insert_image_file
from vivepdf.ops._inplace import finish
from vivepdf.ops._output import OutputResult
from vivepdf.ops._placement import insertion_matrix, unrotated_insertion_matrix
from vivepdf.ops._redaction import clip_to_own_text, inset, text_boxes
from vivepdf.ops._scanned_text import erase_scanned_words, only_hidden_text, paper_colour
from vivepdf.ops._scratch import place_scratch_page
from vivepdf.ops._svg import drawing_pdf
from vivepdf.ops._watermark_style import WATERMARK_FONT, WATERMARK_FONT_BOLD
from vivepdf.ops.convert import _image_bytes
from vivepdf.ops.editor_blocks import placement_rotation
from vivepdf.ops.editor_chart import ChartSpec, chart_pdf
from vivepdf.ops.editor_flowchart import FlowchartSpec, flowchart_pdf
from vivepdf.ops.editor_question import QuestionSpec, question_pdf
from vivepdf.ops.editor_table import TableSpec, table_pdf
from vivepdf.ops.fonts import (
    ResolvedFont,
    describe_resolution,
    display_font_name,
    embedded_font,
    ensure_font,
    font_covers,
    font_name_for,
    normalize_font_name,
    resolve_choice,
    resolve_font,
    uncovered_glyphs,
)
from vivepdf.ops.textedit import TextEdit, _insert_edit
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

ALIGN = {
    "left": pymupdf.TEXT_ALIGN_LEFT,
    "center": pymupdf.TEXT_ALIGN_CENTER,
    "right": pymupdf.TEXT_ALIGN_RIGHT,
}
MIN_FONT_SIZE = 5.0
MAX_DRAWING_SVG_CHARS = 4_000_000
WarningCode = Literal[
    "fontSubstituted", "glyphsMissing", "textOverflow", "rotatedText", "skewedImage"
]
WarningSeverity = Literal["info", "warning"]


class EditorWarning(RpcModel):
    object_id: str
    code: WarningCode
    detail: str = ""
    severity: WarningSeverity = "warning"


class EditorBox(RpcModel):
    id: str = ""
    page: int = Field(ge=1)
    x0: float
    y0: float
    x1: float
    y1: float
    opacity: float = Field(default=1.0, ge=0, le=1)


class EditorFontSource(RpcModel):
    path: str = Field(min_length=1, max_length=4096)
    password: str | None = None


class EditorRun(RpcModel):
    text: str
    font: str | None = None
    font_xref: int | None = Field(default=None, ge=0)
    font_source: EditorFontSource | None = None
    size: float = Field(default=12, ge=3, le=200)
    color: str = "#111111"
    bold: bool = False
    italic: bool = False
    superscript: bool = False


class EditorText(EditorBox):
    kind: Literal["text"] = "text"
    text: str = Field(min_length=1, max_length=5000)
    font_size: float = Field(default=14, ge=4, le=200)
    color: str = "#111111"
    bold: bool = False
    align: Literal["left", "center", "right"] = "left"
    font_id: str | None = Field(default=None, max_length=4096)
    runs: list[EditorRun] = []


class EditorFigure(EditorBox):
    alt: str | None = Field(default=None, max_length=MAX_ALT_CHARS)


class EditorImage(EditorFigure):
    kind: Literal["image"] = "image"
    png_base64: str | None = None
    path: str | None = None


class EditorDrawing(EditorFigure):
    kind: Literal["drawing"] = "drawing"
    svg: str = Field(min_length=1, max_length=MAX_DRAWING_SVG_CHARS)


class EditorTable(EditorFigure, TableSpec):
    kind: Literal["table"] = "table"


class EditorChart(EditorFigure, ChartSpec):
    kind: Literal["chart"] = "chart"


class EditorQuestion(EditorFigure, QuestionSpec):
    kind: Literal["question"] = "question"


class EditorFlowchart(EditorFigure, FlowchartSpec):
    kind: Literal["flowchart"] = "flowchart"


class EditorReplace(EditorBox):
    kind: Literal["edit"] = "edit"
    text: str = Field(default="", max_length=5000)
    font_size: float = Field(default=12, ge=3, le=200)
    color: str = "#111111"
    bold: bool = False
    italic: bool = False
    font: str | None = None


class EditorBlock(EditorBox):
    kind: Literal["block"] = "block"
    text: str = Field(default="", max_length=20000)
    font_size: float = Field(default=12, ge=3, le=200)
    color: str = "#111111"
    bold: bool = False
    italic: bool = False
    font: str | None = None
    align: Literal["left", "center", "right", "justify"] = "left"
    line_height: float = Field(default=1.2, ge=0.8, le=3)
    font_xref: int | None = Field(default=None, ge=0)
    original: list[float] | None = Field(default=None, min_length=4, max_length=4)
    runs: list[EditorRun] = []
    first_line_indent: float = 0
    leading: float = 0
    rotated: bool = False
    font_id: str | None = Field(default=None, max_length=4096)


class EditorImageChange(EditorBox):
    kind: Literal["imageChange"] = "imageChange"
    xref: int = Field(ge=1)
    new_x0: float | None = None
    new_y0: float | None = None
    new_x1: float | None = None
    new_y1: float | None = None
    replacement_png_base64: str | None = None
    replacement_path: str | None = None
    rotate: Literal[0, 90, 180, 270] = 0
    flip_h: bool = False
    flip_v: bool = False
    aspect_locked: bool = True


EditorObject = Annotated[
    EditorText
    | EditorImage
    | EditorDrawing
    | EditorTable
    | EditorChart
    | EditorQuestion
    | EditorFlowchart
    | EditorReplace
    | EditorBlock
    | EditorImageChange,
    Field(discriminator="kind"),
]


class EditorApplyParams(RpcModel):
    path: str
    password: str | None = None
    output: str | None = None
    in_place: bool = False
    overwrite: bool = False
    objects: list[EditorObject] = Field(min_length=1)


class EditorApplyResult(OutputResult):
    applied: int
    warnings: list[EditorWarning] = []


def _rgb(value: str) -> tuple[float, float, float]:
    raw = value.lstrip("#")
    if len(raw) != 6:
        return (0.07, 0.07, 0.07)
    return tuple(int(raw[index : index + 2], 16) / 255 for index in (0, 2, 4))  # type: ignore[return-value]


def _visible_rect(page: pymupdf.Page, box: EditorBox) -> pymupdf.Rect:
    rect = pymupdf.Rect(box.x0, box.y0, box.x1, box.y1)
    rect.normalize()
    if page.rotation:
        rect = rect * page.derotation_matrix
        rect.normalize()
    return rect


def _chosen_font(font_id: str, bold: bool) -> ResolvedFont:
    chosen = resolve_choice(font_id, bold)
    return ResolvedFont(font_name_for(chosen), str(chosen), None)


ForeignFonts = dict[int, ResolvedFont]
FOREIGN_XREF_BASE = 10_000_000


def _path_key(path: str) -> str:
    return os.path.normcase(os.path.abspath(path))


def _source_font(
    sources: dict[str, pymupdf.Document | None], origin: EditorFontSource, xref: int
) -> ResolvedFont | None:
    key = _path_key(origin.path)
    if key not in sources:
        try:
            sources[key] = open_document(origin.path, origin.password)
        except OpError:
            sources[key] = None
    source = sources[key]
    if source is None:
        return None
    extracted = embedded_font(source, xref)
    if extracted is None:
        return None
    name, _ext, buffer = extracted
    return ResolvedFont(f"vpfx{zlib.crc32(buffer):08x}", None, buffer, name)


def _adopt_foreign_fonts(
    target_path: str, objects: list["EditorObject"], warnings: list[EditorWarning]
) -> tuple[list["EditorObject"], ForeignFonts]:
    foreign: ForeignFonts = {}
    adopted_xrefs: dict[tuple[str, int], int | None] = {}
    sources: dict[str, pymupdf.Document | None] = {}
    target = _path_key(target_path)
    adopted: list[EditorObject] = []
    try:
        for index, item in enumerate(objects):
            if item.kind != "text" or not any(run.font_source for run in item.runs):
                adopted.append(item)
                continue
            object_id = item.id or f"{item.kind}{index}"
            runs: list[EditorRun] = []
            lost: set[str] = set()
            for run in item.runs:
                origin = run.font_source
                if origin is None or _path_key(origin.path) == target or not run.font_xref:
                    runs.append(run.model_copy(update={"font_source": None}))
                    continue
                key = (_path_key(origin.path), run.font_xref)
                if key not in adopted_xrefs:
                    font = _source_font(sources, origin, run.font_xref)
                    synthetic = FOREIGN_XREF_BASE + len(foreign) if font else None
                    if font is not None and synthetic is not None:
                        foreign[synthetic] = font
                    adopted_xrefs[key] = synthetic
                synthetic = adopted_xrefs[key]
                if synthetic is None:
                    family = display_font_name(run.font or "")
                    if family not in lost:
                        lost.add(family)
                        warnings.append(
                            EditorWarning(
                                object_id=object_id, code="fontSubstituted", detail=family
                            )
                        )
                runs.append(run.model_copy(update={"font_source": None, "font_xref": synthetic}))
            adopted.append(item.model_copy(update={"runs": runs}))
    finally:
        for source in sources.values():
            if source is not None and not source.is_closed:
                source.close()
    return adopted, foreign


def _text_as_block(item: EditorText) -> EditorBlock:
    return EditorBlock(
        id=item.id,
        page=item.page,
        x0=item.x0,
        y0=item.y0,
        x1=item.x1,
        y1=item.y1,
        opacity=item.opacity,
        text="".join(run.text for run in item.runs),
        font_size=item.font_size,
        color=item.color,
        bold=item.bold,
        align=item.align,
        line_height=1.25,
        runs=item.runs,
        font_id=item.font_id,
    )


def _insert_text(
    document: pymupdf.Document,
    page: pymupdf.Page,
    item: EditorText,
    object_id: str,
    warnings: list[EditorWarning],
    foreign: ForeignFonts | None = None,
) -> None:
    on_page = pymupdf.Rect(item.x0, item.y0, item.x1, item.y1).normalize() & page.rect
    if on_page.is_empty:
        warnings.append(_overflow_warning(object_id, item.text or _runs_text(item)))
        return
    item = item.model_copy(
        update={"x0": on_page.x0, "y0": on_page.y0, "x1": on_page.x1, "y1": on_page.y1}
    )
    if item.runs and _runs_text(item).strip():
        _insert_block(document, page, _text_as_block(item), object_id, warnings, foreign)
        return
    rect = _visible_rect(page, item)
    if item.font_id:
        chosen = _chosen_font(item.font_id, item.bold)
        fontfile = str(chosen.fontfile)
        fontname = chosen.fontname
        missing = uncovered_glyphs(Path(fontfile), item.text)
        if missing:
            warnings.append(
                EditorWarning(object_id=object_id, code="glyphsMissing", detail=missing)
            )
    else:
        fontfile = str(WATERMARK_FONT_BOLD if item.bold else WATERMARK_FONT)
        fontname = "vivepdf-ed-bold" if item.bold else "vivepdf-ed"
    size = item.font_size
    while size >= MIN_FONT_SIZE:
        overflow = page.insert_textbox(
            rect,
            item.text,
            fontsize=size,
            fontname=fontname,
            fontfile=fontfile,
            color=_rgb(item.color),
            align=ALIGN[item.align],
            rotate=page.rotation,
            fill_opacity=item.opacity,
        )
        if overflow >= 0:
            return
        size -= 1
    warnings.append(_overflow_warning(object_id, item.text))


def _overflow_warning(object_id: str, text: str) -> EditorWarning:
    return EditorWarning(
        object_id=object_id, code="textOverflow", detail=" ".join(text.split())[:40]
    )


def _runs_text(item: EditorText | EditorBlock) -> str:
    return "".join(run.text for run in item.runs or [])


def _block_text(item: EditorBlock) -> str:
    return item.text if item.text.strip() else _runs_text(item)


def _apply_opacity(data: bytes, opacity: float) -> bytes:
    if opacity >= 1.0:
        return data
    with Image.open(io.BytesIO(data)) as opened:
        image = opened.convert("RGBA")
        _r, _g, _b, alpha = image.split()
        alpha = alpha.point(lambda value: int(value * opacity))
        image.putalpha(alpha)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()


def _image_stream(item: EditorImage) -> bytes | None:
    if item.png_base64:
        try:
            data = base64.b64decode(item.png_base64)
        except ValueError as error:
            raise OpError(ErrorCode.INVALID_PARAMS, "image is not valid base64") from error
        return _apply_opacity(data, item.opacity)
    if not item.path or not Path(item.path).is_file():
        raise OpError(ErrorCode.FILE_NOT_FOUND, "image file not found", {"path": item.path or ""})
    if item.opacity < 1.0:
        return _apply_opacity(image_file_bytes(item.path), item.opacity)
    return None


def _draw_image(
    page: pymupdf.Page, rect: pymupdf.Rect, item: EditorImage, stream: bytes | None, rotate: int
) -> None:
    if stream is not None:
        page.insert_image(rect, stream=stream, keep_proportion=True, rotate=rotate, overlay=True)
        return
    insert_image_file(page, rect, item.path, keep_proportion=True, rotate=rotate, overlay=True)


def _insert_tagged_image(page: pymupdf.Page, item: EditorImage, stream: bytes | None) -> None:
    box = pymupdf.Rect(item.x0, item.y0, item.x1, item.y1)
    box.normalize()
    scratch = pymupdf.open()
    try:
        scratch_page = scratch.new_page(width=max(box.width, 1.0), height=max(box.height, 1.0))
        _draw_image(scratch_page, scratch_page.rect, item, stream, 0)
        form = place_scratch_page(page, box, scratch)
    finally:
        scratch.close()
    tag_placed_figure(page, form, item.alt, box)


def _insert_image(page: pymupdf.Page, item: EditorImage) -> None:
    stream = _image_stream(item)
    if is_tagged(page.parent):
        _insert_tagged_image(page, item, stream)
        return
    rect = _visible_rect(page, item) * unrotated_insertion_matrix(page)
    _draw_image(page, rect, item, stream, page.rotation)


def _insert_drawing(page: pymupdf.Page, item: EditorDrawing) -> None:
    target = pymupdf.Rect(item.x0, item.y0, item.x1, item.y1)
    target.normalize()
    target = target * insertion_matrix(page)
    target.normalize()
    drawing = drawing_pdf(item.svg.encode("utf-8"), "drawing", item.opacity)
    try:
        form = page.show_pdf_page(
            target, drawing, 0, keep_proportion=True, overlay=True, rotate=page.rotation
        )
    finally:
        drawing.close()
    tag_placed_figure(page, form, item.alt, pymupdf.Rect(item.x0, item.y0, item.x1, item.y1))


def _insert_scratch(
    page: pymupdf.Page,
    item: EditorTable | EditorChart | EditorQuestion | EditorFlowchart,
    object_id: str,
    warnings: list[EditorWarning],
) -> None:
    if item.kind == "table":
        built, missing = table_pdf(item, item.opacity)
    elif item.kind == "chart":
        built, missing = chart_pdf(item, item.opacity)
    elif item.kind == "question":
        built, missing = question_pdf(item, item.opacity)
    else:
        built, missing = flowchart_pdf(item, item.opacity)
    if missing:
        warnings.append(EditorWarning(object_id=object_id, code="glyphsMissing", detail=missing))
    try:
        form = place_scratch_page(page, pymupdf.Rect(item.x0, item.y0, item.x1, item.y1), built)
    finally:
        built.close()
    tag_placed_figure(page, form, item.alt, pymupdf.Rect(item.x0, item.y0, item.x1, item.y1))


BLOCK_ALIGN = {
    "left": pymupdf.TEXT_ALIGN_LEFT,
    "center": pymupdf.TEXT_ALIGN_CENTER,
    "right": pymupdf.TEXT_ALIGN_RIGHT,
    "justify": pymupdf.TEXT_ALIGN_JUSTIFY,
}
BLOCK_PAD = 1.0
SUPERSCRIPT_SCALE = 0.6
SUPERSCRIPT_RAISE = 0.33
SHRINK_STEP = 0.5


@dataclass
class _Atom:
    text: str
    font_name: str | None
    font_xref: int | None
    size: float
    color: str
    bold: bool
    italic: bool
    superscript: bool
    is_break: bool = False
    is_space: bool = False


def _style_key(run: EditorRun) -> tuple[str | None, int | None, bool, bool]:
    return (run.font, run.font_xref, run.bold, run.italic)


def _effective_runs(item: EditorBlock) -> list[EditorRun]:
    if item.runs:
        return item.runs
    return [
        EditorRun(
            text=item.text,
            font=item.font,
            font_xref=item.font_xref,
            size=item.font_size,
            color=item.color,
            bold=item.bold,
            italic=item.italic,
        )
    ]


def _tokenize(runs: list[EditorRun]) -> list[_Atom]:
    atoms: list[_Atom] = []
    for run in runs:
        buf = ""

        def flush(active: EditorRun = run) -> None:
            nonlocal buf
            if buf:
                atoms.append(
                    _Atom(
                        buf,
                        active.font,
                        active.font_xref,
                        active.size,
                        active.color,
                        active.bold,
                        active.italic,
                        active.superscript,
                    )
                )
                buf = ""

        for char in run.text:
            if char == "\n":
                flush()
                atoms.append(
                    _Atom(
                        "\n",
                        run.font,
                        run.font_xref,
                        run.size,
                        run.color,
                        run.bold,
                        run.italic,
                        run.superscript,
                        is_break=True,
                    )
                )
            elif char.isspace():
                flush()
                atoms.append(
                    _Atom(
                        " ",
                        run.font,
                        run.font_xref,
                        run.size,
                        run.color,
                        run.bold,
                        run.italic,
                        run.superscript,
                        is_space=True,
                    )
                )
            else:
                buf += char
        flush()
    return atoms


def _resolve_styles(
    document: pymupdf.Document,
    page: pymupdf.Page,
    atoms: list[_Atom],
    object_id: str,
    warnings: list[EditorWarning],
    font_id: str | None = None,
    foreign: ForeignFonts | None = None,
) -> dict[tuple[str | None, int | None, bool, bool], tuple[ResolvedFont, pymupdf.Font]]:
    combined: dict[tuple[str | None, int | None, bool, bool], str] = {}
    order: list[tuple[str | None, int | None, bool, bool]] = []
    for atom in atoms:
        if atom.is_break:
            continue
        key = (atom.font_name, atom.font_xref, atom.bold, atom.italic)
        if key not in combined:
            combined[key] = ""
            order.append(key)
        combined[key] += atom.text
    resolved_cache: dict[
        tuple[str | None, int | None, bool, bool], tuple[ResolvedFont, pymupdf.Font]
    ] = {}
    seen_warnings: set[tuple[str, str, str]] = set()
    for key in order:
        font_name, font_xref, bold, italic = key
        text = combined[key] or "A"
        adopted = foreign.get(font_xref) if foreign and font_xref is not None else None
        if font_id:
            resolved = _chosen_font(font_id, bold)
        elif adopted is not None and font_covers(text, fontbuffer=adopted.fontbuffer):
            resolved = adopted
        else:
            resolved = resolve_font(
                document,
                text,
                font_name=font_name,
                font_xref=None if adopted is not None else font_xref,
                bold=bold,
                italic=italic,
                page=page,
            )
        resolution = describe_resolution(resolved, font_name, text)
        if font_xref and not font_id and resolution.source != "embedded":
            warn_key = (object_id, "fontSubstituted", resolution.family)
            if warn_key not in seen_warnings:
                seen_warnings.add(warn_key)
                same_family = bool(font_name) and normalize_font_name(
                    display_font_name(font_name)
                ) == normalize_font_name(resolution.family)
                warnings.append(
                    EditorWarning(
                        object_id=object_id,
                        code="fontSubstituted",
                        detail=resolution.family,
                        severity="info" if same_family else "warning",
                    )
                )
        if resolution.missing_glyphs:
            warn_key = (object_id, "glyphsMissing", resolution.missing_glyphs)
            if warn_key not in seen_warnings:
                seen_warnings.add(warn_key)
                warnings.append(
                    EditorWarning(
                        object_id=object_id, code="glyphsMissing", detail=resolution.missing_glyphs
                    )
                )
        try:
            loaded = pymupdf.Font(
                fontfile=resolved.fontfile,
                fontbuffer=resolved.fontbuffer,
                fontname=resolved.fontname
                if resolved.fontfile is None and resolved.fontbuffer is None
                else None,
            )
        except Exception:
            loaded = pymupdf.Font(fontname="helv")
        resolved_cache[key] = (resolved, loaded)
    return resolved_cache


def _atom_size(atom: _Atom, delta: float) -> float:
    base = max(MIN_FONT_SIZE, atom.size - delta)
    return base * SUPERSCRIPT_SCALE if atom.superscript else base


def _atom_width(atom: _Atom, font_obj: pymupdf.Font, delta: float) -> float:
    if not atom.text or atom.is_break:
        return 0.0
    return font_obj.text_length(atom.text, fontsize=_atom_size(atom, delta))


def _wrap_lines(
    atoms: list[_Atom],
    resolved: dict[tuple[str | None, int | None, bool, bool], tuple[ResolvedFont, pymupdf.Font]],
    width: float,
    first_line_indent: float,
    delta: float,
) -> list[list[_Atom]]:
    lines: list[list[_Atom]] = []
    current: list[_Atom] = []

    def available(line_index: int) -> float:
        return max(1.0, width - (first_line_indent if line_index == 0 else 0.0))

    for atom in atoms:
        if atom.is_break:
            lines.append(current)
            current = []
            continue
        key = (atom.font_name, atom.font_xref, atom.bold, atom.italic)
        _resolved_font, font_obj = resolved[key]
        if atom.is_space:
            if not current:
                continue
            current.append(atom)
            continue
        width_used = sum(
            _atom_width(
                entry,
                resolved[(entry.font_name, entry.font_xref, entry.bold, entry.italic)][1],
                delta,
            )
            for entry in current
        )
        word_width = _atom_width(atom, font_obj, delta)
        if current and width_used + word_width > available(len(lines)):
            if current and current[-1].is_space:
                current.pop()
            lines.append(current)
            current = []
        current.append(atom)
    lines.append(current)
    return lines


def _line_width(
    line: list[_Atom],
    resolved: dict[tuple[str | None, int | None, bool, bool], tuple[ResolvedFont, pymupdf.Font]],
    delta: float,
) -> float:
    return sum(
        _atom_width(
            atom, resolved[(atom.font_name, atom.font_xref, atom.bold, atom.italic)][1], delta
        )
        for atom in line
    )


def _line_height(item: EditorBlock, delta: float) -> float:
    if item.leading > 0:
        scale = (
            max(MIN_FONT_SIZE, item.font_size - delta) / item.font_size if item.font_size else 1.0
        )
        return item.leading * scale
    return max(MIN_FONT_SIZE, item.font_size - delta) * item.line_height


def _layout_block(
    item: EditorBlock,
    atoms: list[_Atom],
    resolved: dict[tuple[str | None, int | None, bool, bool], tuple[ResolvedFont, pymupdf.Font]],
    rect: pymupdf.Rect,
) -> tuple[list[list[_Atom]], float, float]:
    delta = 0.0
    while True:
        lines = _wrap_lines(atoms, resolved, rect.width, item.first_line_indent, delta)
        line_height = _line_height(item, delta)
        total_height = line_height * max(1, len(lines))
        floor_reached = all(
            atom.size - delta <= MIN_FONT_SIZE for atom in atoms if not atom.is_break
        )
        if total_height <= rect.height or floor_reached:
            return lines, line_height, delta
        delta += SHRINK_STEP


def _write_lines(
    page: pymupdf.Page,
    item: EditorBlock,
    lines: list[list[_Atom]],
    line_height: float,
    delta: float,
    resolved: dict[tuple[str | None, int | None, bool, bool], tuple[ResolvedFont, pymupdf.Font]],
    rect: pymupdf.Rect,
) -> None:
    writers: dict[str, pymupdf.TextWriter] = {}
    baseline = rect.y0 + line_height * 0.82
    for line_index, line in enumerate(lines):
        trimmed = list(line)
        while trimmed and trimmed[-1].is_space:
            trimmed.pop()
        natural_width = _line_width(trimmed, resolved, delta)
        indent = item.first_line_indent if line_index == 0 else 0.0
        justify = (
            item.align == "justify"
            and line_index < len(lines) - 1
            and any(a.is_space for a in trimmed)
        )
        if item.align == "center":
            x = rect.x0 + indent + max(0.0, (rect.width - indent - natural_width) / 2)
        elif item.align == "right":
            x = rect.x1 - natural_width
        else:
            x = rect.x0 + indent
        space_count = sum(1 for atom in trimmed if atom.is_space)
        extra_per_space = 0.0
        if justify and space_count:
            extra_per_space = max(0.0, (rect.width - indent - natural_width) / space_count)
        cursor = x
        for atom in trimmed:
            key = (atom.font_name, atom.font_xref, atom.bold, atom.italic)
            _resolved_font, font_obj = resolved[key]
            size = _atom_size(atom, delta)
            if atom.is_space:
                cursor += font_obj.text_length(" ", fontsize=size) + extra_per_space
                continue
            y = baseline + line_index * line_height
            if atom.superscript:
                y -= max(MIN_FONT_SIZE, atom.size - delta) * SUPERSCRIPT_RAISE
            writer = writers.setdefault(atom.color, pymupdf.TextWriter(page.rect))
            writer.append((cursor, y), atom.text, font=font_obj, fontsize=size)
            cursor += font_obj.text_length(atom.text, fontsize=size)
    for color, writer in writers.items():
        writer.write_text(page, color=_rgb(color), opacity=item.opacity)


def _insert_block(
    document: pymupdf.Document,
    page: pymupdf.Page,
    item: EditorBlock,
    object_id: str,
    warnings: list[EditorWarning],
    foreign: ForeignFonts | None = None,
) -> None:
    if not item.text.strip():
        return
    rect = _visible_rect(page, item)
    if item.rotated or page.rotation:
        if item.rotated:
            warnings.append(EditorWarning(object_id=object_id, code="rotatedText"))
        padded = pymupdf.Rect(
            rect.x0 - BLOCK_PAD, rect.y0 - BLOCK_PAD, rect.x1 + BLOCK_PAD, rect.y1 + BLOCK_PAD
        )
        font = (
            _chosen_font(item.font_id, item.bold)
            if item.font_id
            else resolve_font(
                document,
                item.text,
                font_name=item.font,
                font_xref=item.font_xref,
                bold=item.bold,
                italic=item.italic,
                page=page,
            )
        )
        ensure_font(page, font)
        size = item.font_size
        while size >= MIN_FONT_SIZE:
            overflow = page.insert_textbox(
                padded,
                item.text,
                fontsize=size,
                fontname=font.fontname,
                fontfile=font.fontfile,
                color=_rgb(item.color),
                align=BLOCK_ALIGN[item.align],
                lineheight=item.line_height,
                rotate=page.rotation,
                fill_opacity=item.opacity,
            )
            if overflow >= 0:
                return
            size -= SHRINK_STEP
        warnings.append(_overflow_warning(object_id, _block_text(item)))
        return
    atoms = _tokenize(_effective_runs(item))
    resolved = _resolve_styles(document, page, atoms, object_id, warnings, item.font_id, foreign)
    lines, line_height, delta = _layout_block(item, atoms, resolved, rect)
    if line_height * max(1, len(lines)) > rect.height:
        warnings.append(_overflow_warning(object_id, _block_text(item)))
    _write_lines(page, item, lines, line_height, delta, resolved, rect)


SUPPORTED_REPLACEMENT_FORMATS = ("PNG", "JPEG", "WEBP", "BMP", "GIF", "TIFF", "HEIF")


def _validate_replacement_bytes(data: bytes, item: EditorImageChange) -> None:
    source = item.replacement_path or "image"
    try:
        with Image.open(io.BytesIO(data)) as opened:
            image_format = opened.format
    except Exception as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"unsupported image format for {Path(source).name}",
            {
                "path": item.replacement_path or "",
                "xref": item.xref,
                "supported": list(SUPPORTED_REPLACEMENT_FORMATS),
            },
        ) from error
    if image_format not in SUPPORTED_REPLACEMENT_FORMATS:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"unsupported image format for {Path(source).name}: {image_format or 'unknown'}",
            {
                "path": item.replacement_path or "",
                "xref": item.xref,
                "supported": list(SUPPORTED_REPLACEMENT_FORMATS),
            },
        )


def _replacement_bytes(item: EditorImageChange) -> bytes | None:
    if item.replacement_png_base64:
        try:
            data = base64.b64decode(item.replacement_png_base64)
        except ValueError as error:
            raise OpError(ErrorCode.INVALID_PARAMS, "image is not valid base64") from error
        _validate_replacement_bytes(data, item)
        return data
    if item.replacement_path:
        source = Path(item.replacement_path)
        if not source.is_file():
            raise OpError(
                ErrorCode.FILE_NOT_FOUND,
                f"image file not found for xref {item.xref}",
                {"path": item.replacement_path, "xref": item.xref},
            )
        data = source.read_bytes()
        _validate_replacement_bytes(data, item)
        return image_file_bytes(source)
    return None


def _transform_image(data: bytes, item: EditorImageChange) -> bytes:
    if not item.rotate and not item.flip_h and not item.flip_v:
        return data
    with Image.open(io.BytesIO(data)) as opened:
        image = ImageOps.exif_transpose(opened)
        if item.flip_h:
            image = ImageOps.mirror(image)
        if item.flip_v:
            image = ImageOps.flip(image)
        if item.rotate:
            image = image.rotate(-item.rotate, expand=True)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()


def _sibling_placements(
    page: pymupdf.Page, xref: int, own_rect: pymupdf.Rect
) -> list[tuple[pymupdf.Rect, int]]:
    siblings: list[tuple[pymupdf.Rect, int]] = []
    for info in page.get_image_info(xrefs=True):
        if int(info.get("xref") or 0) != xref:
            continue
        box = pymupdf.Rect(info["bbox"])
        if (
            abs(box.x0 - own_rect.x0) <= 1
            and abs(box.y0 - own_rect.y0) <= 1
            and abs(box.x1 - own_rect.x1) <= 1
            and abs(box.y1 - own_rect.y1) <= 1
        ):
            continue
        siblings.append((box, _insert_rotation(page, placement_rotation(info.get("transform")))))
    return siblings


def _placement_rotation(page: pymupdf.Page, xref: int, own_rect: pymupdf.Rect) -> int | None:
    for info in page.get_image_info(xrefs=True):
        if int(info.get("xref") or 0) != xref:
            continue
        box = pymupdf.Rect(info["bbox"])
        if (
            abs(box.x0 - own_rect.x0) > 1
            or abs(box.y0 - own_rect.y0) > 1
            or abs(box.x1 - own_rect.x1) > 1
            or abs(box.y1 - own_rect.y1) > 1
        ):
            continue
        return placement_rotation(info.get("transform"))
    return 0


def _insert_rotation(page: pymupdf.Page, placed: int | None) -> int:
    return page.rotation if placed is None else placed


def _apply_image_change(
    document: pymupdf.Document,
    page: pymupdf.Page,
    item: EditorImageChange,
    object_id: str,
    warnings: list[EditorWarning],
) -> None:
    deleting = (
        item.new_x0 is None or item.new_y0 is None or item.new_x1 is None or item.new_y1 is None
    )
    own_rect = _visible_rect(
        page, EditorBox(page=item.page, x0=item.x0, y0=item.y0, x1=item.x1, y1=item.y1)
    )
    siblings = _sibling_placements(page, item.xref, own_rect)
    placed = _placement_rotation(page, item.xref, own_rect)
    if placed is None:
        warnings.append(EditorWarning(object_id=object_id, code="skewedImage"))
    replacement = None if deleting else _replacement_bytes(item)
    smask = 0
    for image in page.get_images(full=True):
        if image[0] == item.xref:
            smask = image[1]
            break
    needs_original = siblings or (not deleting and replacement is None)
    payload = _image_bytes(document, item.xref, smask) if needs_original else None
    page.delete_image(item.xref)
    for box, sibling_rotation in siblings:
        if payload is None:
            continue
        page.insert_image(
            box * unrotated_insertion_matrix(page),
            stream=payload[0],
            keep_proportion=False,
            rotate=sibling_rotation,
            overlay=True,
        )
    if deleting:
        return
    data = replacement if replacement is not None else (payload[0] if payload else None)
    if data is None:
        return
    target = _visible_rect(
        page,
        EditorBox(page=item.page, x0=item.new_x0, y0=item.new_y0, x1=item.new_x1, y1=item.new_y1),
    )
    rotate = _insert_rotation(page, placed)
    page.insert_image(
        target * unrotated_insertion_matrix(page),
        stream=_apply_opacity(_transform_image(data, item), item.opacity),
        keep_proportion=item.aspect_locked,
        rotate=rotate,
        overlay=True,
    )


def _redact_rect(
    page: pymupdf.Page, item: EditorReplace | EditorBlock, tight: bool = True
) -> pymupdf.Rect:
    if item.kind == "block" and item.original is not None:
        x0, y0, x1, y1 = item.original
        base = _visible_rect(page, EditorBox(page=item.page, x0=x0, y0=y0, x1=x1, y1=y1))
    else:
        base = _visible_rect(page, item)
    if tight:
        base = inset(base)
    return clip_to_own_text(base, text_boxes(page, base))


def _redact_edits(document: pymupdf.Document, edits: list[EditorReplace | EditorBlock]) -> None:
    scanned: dict[int, list[tuple[pymupdf.Rect, tuple[float, float, float]]]] = {}
    drawn: dict[int, list[pymupdf.Rect]] = {}
    for item in edits:
        index = item.page - 1
        page = document[index]
        rect = _redact_rect(page, item)
        if only_hidden_text(page, rect):
            area = _redact_rect(page, item, tight=False)
            scanned.setdefault(index, []).append((area, paper_colour(page, area)))
        else:
            drawn.setdefault(index, []).append(rect)
    for index, areas in scanned.items():
        erase_scanned_words(document[index], areas)
    for index, rects in drawn.items():
        page = document[index]
        for rect in rects:
            page.add_redact_annot(rect)
        page.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_NONE,
            graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
        )


def _insert_replacement(page: pymupdf.Page, item: EditorReplace) -> None:
    if not item.text.strip():
        return
    rect = _visible_rect(page, item)
    _insert_edit(
        page,
        TextEdit(
            bbox=[rect.x0, rect.y0, rect.x1, rect.y1],
            text=item.text,
            size=item.font_size,
            color=item.color,
            bold=item.bold,
            italic=item.italic,
            font=item.font,
            opacity=item.opacity,
        ),
    )


@op("editor.apply", EditorApplyParams)
def apply(params: EditorApplyParams, progress: Progress) -> EditorApplyResult:
    document = open_document(params.path, params.password)
    try:
        total = len(params.objects)
        warnings: list[EditorWarning] = []
        for item in params.objects:
            if item.page > document.page_count:
                raise OpError(
                    ErrorCode.INVALID_PARAMS,
                    f"page {item.page} is outside 1..{document.page_count}",
                    {
                        "reason": "pageOutOfRange",
                        "page": item.page,
                        "pageCount": document.page_count,
                    },
                )
            if item.kind == "imageChange" and item.new_x0 is not None:
                _replacement_bytes(item)
        objects, foreign = _adopt_foreign_fonts(params.path, params.objects, warnings)
        _redact_edits(document, [item for item in objects if item.kind in ("edit", "block")])
        for index, item in enumerate(objects):
            progress.check_cancelled()
            page = document[item.page - 1]
            object_id = item.id or f"{item.kind}{index}"
            if item.kind == "text":
                _insert_text(document, page, item, object_id, warnings, foreign)
            elif item.kind == "edit":
                _insert_replacement(page, item)
            elif item.kind == "block":
                _insert_block(document, page, item, object_id, warnings)
            elif item.kind == "imageChange":
                _apply_image_change(document, page, item, object_id, warnings)
            elif item.kind == "drawing":
                _insert_drawing(page, item)
            elif item.kind in ("table", "chart", "question", "flowchart"):
                _insert_scratch(page, item, object_id, warnings)
            else:
                _insert_image(page, item)
            progress.report(
                (index + 1) / total * 0.9,
                "progress.applying",
                {"current": index + 1, "total": total},
            )
        with contextlib.suppress(Exception):
            subset_fonts(document, fallback=False)
        progress.report(0.95, "progress.saving")
        saved = finish(document, params.path, params.output, params.in_place, params.overwrite)
        return EditorApplyResult(**saved.model_dump(), applied=total, warnings=warnings)
    finally:
        if not document.is_closed:
            document.close()


PREVIEW_MAX_SIDE = 1200


class ImagePreviewParams(RpcModel):
    path: str


class ImagePreviewResult(RpcModel):
    png_base64: str
    width: int
    height: int


@op("editor.image_preview", ImagePreviewParams)
def image_preview(params: ImagePreviewParams, _progress: Progress) -> ImagePreviewResult:
    source = Path(params.path)
    if not source.is_file():
        raise OpError(
            ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}", {"path": params.path}
        )
    try:
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGBA")
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"cannot read image: {source.name}",
            {"reason": "imageUnreadable", "path": params.path},
        ) from error
    scale = min(1.0, PREVIEW_MAX_SIDE / max(image.size))
    if scale < 1:
        image = image.resize((max(1, int(image.width * scale)), max(1, int(image.height * scale))))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return ImagePreviewResult(
        png_base64=base64.b64encode(buffer.getvalue()).decode("ascii"),
        width=image.width,
        height=image.height,
    )
