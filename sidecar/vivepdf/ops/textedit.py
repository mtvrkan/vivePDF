import contextlib
import math
import re

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._font_unicode import subset_fonts
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._redaction import clip_to_own_text, inset, text_boxes
from vivepdf.ops._safe_pattern import MatchClock, compile_safe_patterns
from vivepdf.ops.fonts import (
    TEXTEDIT_FONT,
    ResolvedFont,
    ensure_font,
    load_font,
    lookup_font_xref,
    missing_glyphs,
    page_font_xrefs,
    resolve_font,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MIN_FONT_SIZE = 4.0
FONT_SIZE_STEP = 0.5
VERTICAL_PAD = 0.5
RIGHT_ANGLE_TOLERANCE = 2.0
FALLBACK_FONT_NAMES = {"vivepdf-te", "vivepdf-te-bold"}


def _color_to_hex(color: int) -> str:
    return f"#{(color >> 16) & 255:02x}{(color >> 8) & 255:02x}{color & 255:02x}"


def _hex_to_color(value: str) -> tuple[float, float, float]:
    text = value.strip().lstrip("#")
    if len(text) != 6 or any(char not in "0123456789abcdefABCDEF" for char in text):
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"invalid colour '{value}'", {"reason": "badColour"}
        )
    return tuple(int(text[index : index + 2], 16) / 255 for index in (0, 2, 4))  # type: ignore[return-value]


class TextSpansParams(RpcModel):
    path: str
    password: str | None = None
    page: int = Field(ge=0)
    visible: bool = False


class TextSpan(RpcModel):
    id: str
    text: str
    bbox: list[float]
    font: str
    font_xref: int = 0
    size: float
    color: str
    bold: bool
    italic: bool
    opacity: float = 1.0


class TextSpansResult(RpcModel):
    width: float
    height: float
    spans: list[TextSpan]


def _page_at(document: pymupdf.Document, page: int) -> pymupdf.Page:
    if page < 0 or page >= document.page_count:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"page {page} is outside 0..{document.page_count - 1}",
            {"page": page, "pageCount": document.page_count},
        )
    return document[page]


def unrotated_rect(page: pymupdf.Page) -> pymupdf.Rect:
    rect = page.rect * page.derotation_matrix
    rect.normalize()
    return rect


def derotated_bbox(page: pymupdf.Page, bbox: list[float]) -> list[float]:
    rect = pymupdf.Rect(bbox) * page.derotation_matrix
    rect.normalize()
    return [rect.x0, rect.y0, rect.x1, rect.y1]


@op("textedit.spans", TextSpansParams)
def get_spans(params: TextSpansParams, progress: Progress) -> TextSpansResult:
    with open_document(params.path, params.password, mutable=False) as document:
        page = _page_at(document, params.page)
        page_dict = page.get_text("dict")
        page_fonts = page_font_xrefs(page)
        spans: list[TextSpan] = []
        for block_index, block in enumerate(page_dict["blocks"]):
            if block.get("type") != 0:
                continue
            for line_index, line in enumerate(block["lines"]):
                for span_index, span in enumerate(line["spans"]):
                    alpha = span.get("alpha", 255)
                    if not span["text"].strip() or alpha == 0:
                        continue
                    bbox = pymupdf.Rect(span["bbox"])
                    if params.visible and page.rotation:
                        bbox = bbox * page.rotation_matrix
                        bbox.normalize()
                    spans.append(
                        TextSpan(
                            id=f"{block_index}-{line_index}-{span_index}",
                            text=span["text"],
                            bbox=[bbox.x0, bbox.y0, bbox.x1, bbox.y1],
                            font=span["font"],
                            font_xref=lookup_font_xref(page_fonts, span["font"])[0],
                            size=span["size"],
                            color=_color_to_hex(span["color"]),
                            bold=bool(span["flags"] & 16),
                            italic=bool(span["flags"] & 2),
                            opacity=round(alpha / 255, 3),
                        )
                    )
        size = page.rect if params.visible else unrotated_rect(page)
        return TextSpansResult(width=size.width, height=size.height, spans=spans)


class TextEdit(RpcModel):
    bbox: list[float] = Field(min_length=4, max_length=4)
    text: str
    size: float = Field(gt=0)
    color: str
    bold: bool = False
    italic: bool = False
    font: str | None = None
    font_xref: int | None = None
    opacity: float = Field(default=1.0, ge=0, le=1)


class TextEditWarning(RpcModel):
    code: str
    detail: str | None = None


class TextEditParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    page: int = Field(ge=0)
    edits: list[TextEdit]
    visible: bool = False


class TextEditResult(OutputResult):
    replaced: int = 0
    warnings: list[TextEditWarning] = []


def _transformed(rect: pymupdf.Rect, matrix: pymupdf.Matrix) -> pymupdf.Rect:
    moved = rect * matrix
    moved.normalize()
    return moved


def redact_rect(page: pymupdf.Page, bbox: list[float], rotation: int = 0) -> pymupdf.Rect:
    x0, y0, x1, y1 = bbox
    base = inset(pymupdf.Rect(x0, y0, x1, y1))
    if not page.rotation and not rotation:
        return clip_to_own_text(base, text_boxes(page, base, lines=True))
    visible = _transformed(base, page.rotation_matrix)
    foreign = [
        _transformed(box, page.derotation_matrix) for box in text_boxes(page, visible, lines=True)
    ]
    upright = pymupdf.Matrix(rotation)
    clipped = clip_to_own_text(
        _transformed(base, upright), [_transformed(box, upright) for box in foreign]
    )
    return _transformed(clipped, ~upright)


def edit_font(page: pymupdf.Page, edit: TextEdit) -> ResolvedFont:
    return resolve_font(
        page.parent,
        edit.text or " ",
        font_name=edit.font,
        font_xref=edit.font_xref,
        bold=edit.bold,
        italic=edit.italic,
        page=page,
    )


def direction_rotation(direction: tuple[float, float] | list[float]) -> int:
    angle = math.degrees(math.atan2(-float(direction[1]), float(direction[0]))) % 360
    nearest = round(angle / 90) * 90
    if abs(angle - nearest) > RIGHT_ANGLE_TOLERANCE:
        return 0
    return int(nearest) % 360


def text_rotation(page: pymupdf.Page, bbox: list[float], blocks: list[dict] | None = None) -> int:
    rect = pymupdf.Rect(bbox)
    best_area = 0.0
    rotation = 0
    if blocks is None:
        blocks = page.get_text("dict").get("blocks", [])
    for block in blocks:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                area = abs(pymupdf.Rect(span["bbox"]) & rect)
                if area > best_area:
                    best_area = area
                    rotation = direction_rotation(line.get("dir", (1.0, 0.0)))
    return rotation


def _baseline_start(bbox: list[float], rotation: int, rise: float) -> tuple[float, float]:
    x0, y0, x1, y1 = bbox
    if rotation == 90:
        return (x0 + rise, y1)
    if rotation == 180:
        return (x1, y1 - rise)
    if rotation == 270:
        return (x1 - rise, y0)
    return (x0, y0 + rise)


def _run_length(bbox: list[float], rotation: int) -> float:
    x0, y0, x1, y1 = bbox
    return y1 - y0 if rotation in (90, 270) else x1 - x0


def _fitted_size(loaded: pymupdf.Font, text: str, size: float, available: float) -> float:
    fitted = size
    while fitted >= MIN_FONT_SIZE and loaded.text_length(text, fontsize=fitted) > available:
        fitted -= FONT_SIZE_STEP
    return fitted


def substituted_font(edit: TextEdit, font: ResolvedFont) -> str | None:
    if not edit.font or font.fontname not in FALLBACK_FONT_NAMES:
        return None
    loaded = load_font(font)
    return str(loaded.name) if loaded is not None and loaded.name else font.fontname


def _insert_edit(page: pymupdf.Page, edit: TextEdit, rotation: int = 0) -> list[TextEditWarning]:
    text = edit.text.strip(chr(10))
    if not text:
        return []
    warnings: list[TextEditWarning] = []
    color = _hex_to_color(edit.color)
    font = edit_font(page, edit)
    ensure_font(page, font)
    substitute = substituted_font(edit, font)
    if substitute:
        warnings.append(TextEditWarning(code="fontSubstituted", detail=substitute))
    absent = missing_glyphs(font, text)
    if absent:
        warnings.append(TextEditWarning(code="glyphsMissing", detail=absent[:20]))
    x0, y0, x1, y1 = edit.bbox
    loaded = load_font(font)
    if loaded is not None and chr(10) not in text:
        fitted = _fitted_size(loaded, text, edit.size, _run_length(edit.bbox, rotation))
        if fitted >= MIN_FONT_SIZE:
            page.insert_text(
                _baseline_start(edit.bbox, rotation, loaded.ascender * fitted),
                text,
                fontsize=fitted,
                fontname=font.fontname,
                fontfile=font.fontfile,
                color=color,
                fill_opacity=edit.opacity,
                rotate=rotation,
            )
            if fitted < edit.size:
                warnings.append(TextEditWarning(code="textShrunk", detail=f"{fitted:g}"))
            return warnings
    if rotation in (90, 270):
        rect = pymupdf.Rect(x0 - VERTICAL_PAD, y0, x1 + VERTICAL_PAD, y1)
    else:
        rect = pymupdf.Rect(x0, y0 - VERTICAL_PAD, x1, y1 + VERTICAL_PAD)
    fontsize = edit.size
    while fontsize >= MIN_FONT_SIZE:
        overflow = page.insert_textbox(
            rect,
            edit.text,
            align=0,
            fontsize=fontsize,
            fontname=font.fontname,
            fontfile=font.fontfile,
            color=color,
            fill_opacity=edit.opacity,
            rotate=rotation,
        )
        if overflow >= 0:
            if fontsize < edit.size:
                warnings.append(TextEditWarning(code="textShrunk", detail=f"{fontsize:g}"))
            return warnings
        fontsize -= FONT_SIZE_STEP
    warnings.append(TextEditWarning(code="textOverflow", detail=text[:40]))
    return warnings


@op("textedit.replace", TextEditParams)
def replace_text(params: TextEditParams, progress: Progress) -> TextEditResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    replaced = 0
    with open_document(params.path, params.password) as document:
        page = _page_at(document, params.page)
        warnings: list[TextEditWarning] = []
        if params.visible and page.rotation:
            for edit in params.edits:
                edit.bbox = derotated_bbox(page, edit.bbox)
        rotations = [text_rotation(page, edit.bbox) for edit in params.edits]
        for edit, rotation in zip(params.edits, rotations, strict=True):
            page.add_redact_annot(redact_rect(page, edit.bbox, rotation))
        if params.edits:
            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE
            )
        for edit, rotation in zip(params.edits, rotations, strict=True):
            if edit.text.strip():
                warnings.extend(_insert_edit(page, edit, rotation))
            replaced += 1
        with contextlib.suppress(Exception):
            subset_fonts(document, fallback=False)
        progress.report(0.9, "progress.saving")
        saved = save_document(document, target)
    return TextEditResult(
        **saved.model_dump(), replaced=replaced, warnings=unique_warnings(warnings)
    )


class FindReplaceParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    find: str = Field(min_length=1, max_length=500)
    replace: str = Field(max_length=2000)
    case_sensitive: bool = False
    whole_word: bool = False
    regex: bool = False
    pages: str | None = None


class FindReplaceResult(OutputResult):
    replaced: int
    pages_changed: int
    warnings: list[TextEditWarning] = []


class FindPreviewParams(RpcModel):
    path: str
    password: str | None = None
    find: str = Field(min_length=1, max_length=500)
    case_sensitive: bool = False
    whole_word: bool = False
    regex: bool = False
    pages: str | None = None
    limit: int = Field(default=200, ge=1, le=2000)


class FindHit(RpcModel):
    page: int
    text: str
    context: str


class FindPreviewResult(RpcModel):
    hits: list[FindHit]
    total: int
    pages_searched: int
    hidden: int = 0


UNICODE_SPACES = str.maketrans(
    dict.fromkeys([0x00A0, *range(0x2000, 0x200B), 0x202F, 0x205F, 0x3000], " ")
)


def searchable(text: str) -> str:
    return text.translate(UNICODE_SPACES)


DOTTED_I_FOLDS = {
    "i": "(?-i:[iI\u0130])",
    "I": "(?-i:[Ii\u0131])",
    "\u0131": "(?-i:[\u0131I])",
    "\u0130": "(?-i:[\u0130i])",
}


def literal_pattern(needle: str, case_sensitive: bool) -> str:
    if case_sensitive:
        return re.escape(needle)
    return "".join(DOTTED_I_FOLDS.get(char) or re.escape(char) for char in needle)


def compile_needle(
    needle: str, case_sensitive: bool, whole_word: bool, regex: bool
) -> re.Pattern[str]:
    needle = searchable(needle)
    flags = 0 if case_sensitive else re.IGNORECASE
    pattern = needle if regex else literal_pattern(needle, case_sensitive)
    if whole_word:
        pattern = rf"(?<!\w)(?:{pattern})(?!\w)"
    try:
        compiled = re.compile(pattern, flags)
    except re.error as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"invalid search pattern: {error}",
            {"pattern": needle, "reason": "badPattern"},
        ) from error
    if regex:
        compile_safe_patterns([needle], flags)
    return compiled


DOLLAR_REFERENCE = re.compile(r"\$(\$|\d+|\{(\w+)\})")


def replacement_template(pattern: re.Pattern[str], replacement: str) -> str:
    def python_reference(match: re.Match[str]) -> str:
        token = match.group(1)
        if token == "$":
            return "$"
        name = match.group(2) or token
        return rf"\g<{name}>"

    template = DOLLAR_REFERENCE.sub(python_reference, replacement)
    probe = re.compile(f"(?:{pattern.pattern})|", pattern.flags).match("")
    try:
        if probe is not None:
            probe.expand(template)
    except (re.error, IndexError) as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"invalid replacement: {error}",
            {"reason": "replacementGroup", "replacement": replacement},
        ) from error
    return template


GLYPH_FLAGS = pymupdf.TEXTFLAGS_RAWDICT & ~pymupdf.TEXT_PRESERVE_LIGATURES


def page_glyphs(page: pymupdf.Page) -> tuple[str, list[pymupdf.Rect | None], list[dict | None]]:
    letters: list[str] = []
    boxes: list[pymupdf.Rect | None] = []
    owners: list[dict | None] = []
    for block in page.get_text("rawdict", flags=GLYPH_FLAGS).get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                hidden = span.get("alpha", 255) == 0
                for char in span.get("chars", []):
                    letters.append(char["c"])
                    boxes.append(None if hidden else pymupdf.Rect(char["bbox"]))
                    owners.append(span)
            letters.append("\n")
            boxes.append(None)
            owners.append(None)
    return "".join(letters), boxes, owners


def page_characters(page: pymupdf.Page) -> tuple[str, list[pymupdf.Rect | None]]:
    text, boxes, _owners = page_glyphs(page)
    return searchable(text), boxes


def replaceable(match: re.Match[str], boxes: list[pymupdf.Rect | None]) -> bool:
    window = boxes[match.start() : match.end()]
    return bool(window) and all(box is not None for box in window)


def hidden_match(match: re.Match[str], boxes: list[pymupdf.Rect | None]) -> bool:
    window = boxes[match.start() : match.end()]
    return bool(window) and "\n" not in match.group(0) and any(box is None for box in window)


def _union(boxes: list[pymupdf.Rect | None]) -> pymupdf.Rect:
    rect = pymupdf.Rect(boxes[0])
    for box in boxes[1:]:
        if box is not None:
            rect |= box
    return rect


def pattern_hits(
    page: pymupdf.Page, pattern: re.Pattern[str], replacement: str, regex: bool
) -> list[tuple[pymupdf.Rect, str, str]]:
    text, boxes = page_characters(page)
    hits: list[tuple[pymupdf.Rect, str, str]] = []
    for match in pattern.finditer(text):
        if not replaceable(match, boxes):
            continue
        value = match.expand(replacement) if regex else replacement
        hits.append((_union(boxes[match.start() : match.end()]), match.group(0), value))
    return hits


def hit_context(text: str, start: int, end: int, width: int = 28) -> str:
    before = text[max(0, start - width) : start].replace("\n", " ")
    after = text[end : end + width].replace("\n", " ")
    return f"{before}‹{text[start:end]}›{after}".strip()


@op("textedit.find_preview", FindPreviewParams)
def find_preview(params: FindPreviewParams, progress: Progress) -> FindPreviewResult:
    pattern = compile_needle(params.find, params.case_sensitive, params.whole_word, params.regex)
    clock = MatchClock()
    hits: list[FindHit] = []
    total = 0
    hidden = 0
    with open_document(params.path, params.password, mutable=False) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        for position, index in enumerate(indices):
            progress.check_cancelled()
            page = document[index]
            text, boxes = page_characters(page)
            for match in clock.located(pattern, text):
                if not replaceable(match, boxes):
                    hidden += hidden_match(match, boxes)
                    continue
                total += 1
                if len(hits) < params.limit:
                    hits.append(
                        FindHit(
                            page=index + 1,
                            text=match.group(0),
                            context=hit_context(text, match.start(), match.end()),
                        )
                    )
            if position % 20 == 0:
                progress.report(position / max(1, len(indices)), "progress.searching")
        searched = len(indices)
    return FindPreviewResult(hits=hits, total=total, pages_searched=searched, hidden=hidden)


def _span_at(blocks: list[dict], rect: pymupdf.Rect) -> dict | None:
    best = None
    best_area = 0.0
    for block in blocks:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                span_rect = pymupdf.Rect(span["bbox"])
                area = abs(span_rect & rect)
                if area > best_area:
                    best_area = area
                    best = span
    return best


WIDTH_SLACK = 1.04
REFLOW_TOLERANCE = 0.5
COLUMN_OVERLAP = 0.3


class _Segment:
    __slots__ = ("edit", "is_hit", "left", "original", "rotation", "upright", "width")

    def __init__(
        self,
        edit: TextEdit,
        original: pymupdf.Rect,
        width: float,
        is_hit: bool,
        rotation: int = 0,
    ):
        self.edit = edit
        self.original = original
        self.width = width
        self.is_hit = is_hit
        self.rotation = rotation
        self.upright = _transformed(original, pymupdf.Matrix(rotation))
        self.left = self.upright.x0


def _styled_edit(
    page_fonts: dict[str, tuple[int, str]],
    span: dict | None,
    rect: pymupdf.Rect,
    text: str,
) -> TextEdit:
    size = float(span["size"]) if span else max(6.0, rect.height * 0.8)
    flags = int(span.get("flags", 0)) if span else 0
    span_font = str(span["font"]) if span else None
    xref = lookup_font_xref(page_fonts, span_font)[0] if span_font else 0
    return TextEdit(
        bbox=[rect.x0, rect.y0, rect.x1, rect.y1],
        text=text,
        size=size,
        color=_color_to_hex(int(span["color"])) if span else "#000000",
        bold=bool(flags & 16),
        italic=bool(flags & 2),
        font=span_font,
        font_xref=xref or None,
        opacity=round(span.get("alpha", 255) / 255, 3) if span else 1.0,
    )


def _measured(page: pymupdf.Page, edit: TextEdit, fallback: pymupdf.Font) -> float:
    if not edit.text:
        return 0.0
    measurer = load_font(edit_font(page, edit)) or fallback
    return measurer.text_length(edit.text, fontsize=edit.size)


def _tail_runs(
    start: int, end: int, glyphs: tuple[str, list[pymupdf.Rect | None], list[dict | None]]
) -> list[tuple[dict | None, pymupdf.Rect, str]]:
    text, boxes, owners = glyphs
    runs: list[tuple[dict | None, pymupdf.Rect, str]] = []
    index = start
    while index < end:
        owner = owners[index]
        stop = index
        while stop < end and owners[stop] is owner:
            stop += 1
        runs.append((owner, _union(boxes[index:stop]), text[index:stop]))
        index = stop
    return runs


def _line_segments(
    page: pymupdf.Page,
    page_fonts: dict[str, tuple[int, str]],
    fallback: pymupdf.Font,
    matches: list[tuple[int, int, str]],
    glyphs: tuple[str, list[pymupdf.Rect | None], list[dict | None]],
    blocks: list[dict],
) -> list[_Segment]:
    text, boxes, _owners = glyphs
    segments: list[_Segment] = []
    for start, end, replacement in matches:
        rect = _union(boxes[start:end])
        edit = _styled_edit(page_fonts, _span_at(blocks, rect), rect, replacement)
        rotation = text_rotation(page, edit.bbox, blocks)
        segments.append(_Segment(edit, rect, _measured(page, edit, fallback), True, rotation))
    line_rotation = segments[0].rotation
    if not any(segment.width > segment.upright.width + REFLOW_TOLERANCE for segment in segments):
        return segments
    line_end = text.index("\n", matches[-1][1])
    gaps = [
        (end, next_start)
        for (_start, end, _value), (next_start, _end, _next) in zip(
            matches, matches[1:], strict=False
        )
    ]
    gaps.append((matches[-1][1], line_end))
    reflowed: list[_Segment] = []
    for segment, (gap_start, gap_end) in zip(segments, gaps, strict=True):
        reflowed.append(segment)
        for owner, rect, run_text in _tail_runs(gap_start, gap_end, glyphs):
            edit = _styled_edit(page_fonts, owner, rect, run_text)
            tail = _Segment(edit, rect, 0.0, False, line_rotation)
            tail.width = tail.upright.width
            reflowed.append(tail)
    cursor = reflowed[0].upright.x0
    previous_end = cursor
    for segment in reflowed:
        left = cursor + max(0.0, segment.upright.x0 - previous_end)
        previous_end = segment.upright.x1
        segment.left = left
        cursor = left + segment.width
    return reflowed


def _place_segment(segment: _Segment, edge: float) -> bool:
    upright = segment.upright
    left = segment.left
    if segment.is_hit:
        right = min(edge, max(upright.x1, left + segment.width * WIDTH_SLACK))
    else:
        right = left + segment.width * WIDTH_SLACK
    frame = pymupdf.Matrix(segment.rotation)
    placed = _transformed(pymupdf.Rect(left, upright.y0, right, upright.y1), ~frame)
    segment.edit.bbox = [placed.x0, placed.y0, placed.x1, placed.y1]
    return not segment.is_hit and left + segment.width > edge + REFLOW_TOLERANCE


def _page_edge(page: pymupdf.Page, rotation: int) -> float:
    return _transformed(unrotated_rect(page), pymupdf.Matrix(rotation)).x1


def column_edge(page: pymupdf.Page, blocks: list[dict], line: list[_Segment]) -> float:
    rotation = line[0].rotation
    frame = pymupdf.Matrix(rotation)
    top = min(segment.upright.y0 for segment in line)
    bottom = max(segment.upright.y1 for segment in line)
    end = max(segment.upright.x1 for segment in line)
    needed = (bottom - top) * COLUMN_OVERLAP
    edge = _page_edge(page, rotation)
    for block in blocks:
        for text_line in block.get("lines", []):
            box = pymupdf.Rect(text_line["bbox"])
            if any(box.intersects(segment.original) for segment in line):
                continue
            upright = _transformed(box, frame)
            overlap = min(upright.y1, bottom) - max(upright.y0, top)
            if overlap > needed and upright.x0 >= end - REFLOW_TOLERANCE:
                edge = min(edge, upright.x0)
    return edge


def unique_warnings(warnings: list[TextEditWarning]) -> list[TextEditWarning]:
    return list({(warning.code, warning.detail): warning for warning in warnings}.values())


@op("textedit.find_replace", FindReplaceParams)
def find_replace(params: FindReplaceParams, progress: Progress) -> FindReplaceResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    replaced = 0
    pages_changed = 0
    warnings: list[TextEditWarning] = []
    fallback = pymupdf.Font(fontfile=str(TEXTEDIT_FONT))
    pattern = compile_needle(params.find, params.case_sensitive, params.whole_word, params.regex)
    template = replacement_template(pattern, params.replace) if params.regex else params.replace
    clock = MatchClock()
    hidden = 0
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        for position, index in enumerate(indices):
            progress.check_cancelled()
            progress.report(
                position / max(1, len(indices)),
                "progress.replacing",
                {"current": position + 1, "total": len(indices)},
            )
            page = document[index]
            glyphs = page_glyphs(page)
            text, boxes, _owners = glyphs
            by_line: dict[int, list[tuple[int, int, str]]] = {}
            for match in clock.located(pattern, searchable(text)):
                if not replaceable(match, boxes):
                    hidden += hidden_match(match, boxes)
                    continue
                value = match.expand(template) if params.regex else template
                line = text.count("\n", 0, match.start())
                by_line.setdefault(line, []).append((match.start(), match.end(), value))
            if not by_line:
                continue
            page_fonts = page_font_xrefs(page)
            blocks = page.get_text("dict").get("blocks", [])
            segments: list[_Segment] = []
            edges: list[float] = []
            for matches in by_line.values():
                line = _line_segments(page, page_fonts, fallback, matches, glyphs, blocks)
                edge = column_edge(page, blocks, line)
                segments.extend(line)
                edges.extend([edge] * len(line))
            for segment, edge in zip(segments, edges, strict=True):
                original = segment.original
                page.add_redact_annot(
                    redact_rect(
                        page,
                        [original.x0, original.y0, original.x1, original.y1],
                        segment.rotation,
                    )
                )
                if _place_segment(segment, edge):
                    warnings.append(
                        TextEditWarning(code="lineOverflow", detail=segment.edit.text.strip()[:40])
                    )
            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE
            )
            for segment in segments:
                if segment.edit.text.strip():
                    warnings.extend(_insert_edit(page, segment.edit, segment.rotation))
            replaced += sum(1 for segment in segments if segment.is_hit)
            pages_changed += 1
        if replaced == 0 and hidden:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "the search text is only in hidden text",
                {"reason": "onlyHiddenMatches", "hidden": hidden},
            )
        if replaced == 0:
            raise OpError(
                ErrorCode.INVALID_PARAMS, "the search text was not found", {"reason": "noMatches"}
            )
        with contextlib.suppress(Exception):
            subset_fonts(document, fallback=False)
        progress.report(0.95, "progress.saving")
        saved = save_document(document, target)
    return FindReplaceResult(
        **saved.model_dump(),
        replaced=replaced,
        pages_changed=pages_changed,
        warnings=unique_warnings(warnings),
    )
