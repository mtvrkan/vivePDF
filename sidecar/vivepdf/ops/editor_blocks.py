import base64
import statistics
from typing import Annotated, Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops.font_repair import repaired_embedded_font
from vivepdf.ops.fonts import (
    FontResolution,
    describe_resolution,
    display_font_name,
    embedded_font,
    lookup_font_xref,
    page_font_xrefs,
    resolve_font,
)
from vivepdf.ops.textedit import _color_to_hex
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

Align = Literal["left", "center", "right", "justify"]
EDGE_TOLERANCE = 1.5
MIN_LINE_HEIGHT = 0.9
MAX_LINE_HEIGHT = 2.5
DEFAULT_LINE_HEIGHT = 1.2


class BlocksParams(RpcModel):
    path: str
    password: str | None = None
    page: int = Field(ge=0)


class TextRun(RpcModel):
    text: str
    font: str
    font_xref: int = 0
    font_family: str = ""
    size: float
    color: str
    bold: bool
    italic: bool
    superscript: bool = False


class TextLine(RpcModel):
    text: str
    bbox: list[float]
    runs: list[TextRun]
    hard_break: bool = False


class TextBlock(RpcModel):
    id: str
    kind: Literal["text"] = "text"
    bbox: list[float]
    text: str
    font: str
    size: float
    color: str
    bold: bool
    italic: bool
    align: Align
    line_height: float
    line_count: int
    font_xref: int = 0
    font_ext: str = ""
    font_family: str = ""
    text_lines: list[TextLine] = []
    first_line_indent: float = 0
    leading: float = 0
    rotated: bool = False


class ImageBlock(RpcModel):
    id: str
    kind: Literal["image"] = "image"
    bbox: list[float]
    xref: int
    width: int
    height: int
    placement_rotation: Literal[0, 90, 180, 270] = 0


Block = Annotated[TextBlock | ImageBlock, Field(discriminator="kind")]


class BlocksResult(RpcModel):
    width: float
    height: float
    blocks: list[Block]


HARD_BREAK_WIDTH_RATIO = 0.85
HARD_BREAK_LOOSE_RATIO = 0.95


def _first_word_width(text: str, width: float) -> float:
    stripped = text.strip()
    if not stripped:
        return 0.0
    first = stripped.split(" ", 1)[0]
    return width * (len(first) + 1) / max(len(stripped), 1)


def detect_hard_breaks(line_boxes: list[pymupdf.Rect], texts: list[str]) -> list[bool]:
    widest = max((box.width for box in line_boxes), default=0.0)
    flags: list[bool] = []
    for index, box in enumerate(line_boxes):
        last = index == len(line_boxes) - 1
        if last or widest <= 0:
            flags.append(False)
            continue
        current = texts[index].rstrip() if index < len(texts) else ""
        following = texts[index + 1].lstrip() if index + 1 < len(texts) else ""
        next_box = line_boxes[index + 1]
        short = box.width < widest * HARD_BREAK_WIDTH_RATIO
        loose = box.width < widest * HARD_BREAK_LOOSE_RATIO
        next_word_fits = box.width + _first_word_width(following, next_box.width) < widest
        starts_upper = following[:1].isupper() or following[:1].isdigit()
        ends_open = current.endswith(("-", ",", ";"))
        flags.append((short and next_word_fits) or (loose and starts_upper and not ends_open))
    return flags


def join_lines(lines: list[str], hard_breaks: list[bool] | None = None) -> str:
    parts: list[str] = []
    for index, line in enumerate(lines):
        cleaned = line.strip()
        if not cleaned:
            continue
        previous_hard = bool(hard_breaks and index > 0 and hard_breaks[index - 1])
        if previous_hard and parts:
            parts.append("\n" + cleaned)
        elif parts and parts[-1].endswith("-") and cleaned[:1].islower():
            parts[-1] = parts[-1][:-1] + cleaned
        else:
            parts.append(cleaned)
    return " ".join(parts).replace(" \n", "\n")


def detect_align(block_box: pymupdf.Rect, line_boxes: list[pymupdf.Rect]) -> Align:
    if len(line_boxes) <= 1:
        return "left"
    measured = line_boxes[:-1] if len(line_boxes) > 2 else line_boxes
    left_gaps = [box.x0 - block_box.x0 for box in measured]
    right_gaps = [block_box.x1 - box.x1 for box in measured]
    left_flush = all(gap <= EDGE_TOLERANCE for gap in left_gaps)
    right_flush = all(gap <= EDGE_TOLERANCE for gap in right_gaps)
    if left_flush and right_flush:
        return "justify"
    if left_flush:
        return "left"
    if right_flush:
        return "right"
    if all(
        abs(left - right) <= EDGE_TOLERANCE * 2
        for left, right in zip(left_gaps, right_gaps, strict=False)
    ):
        return "center"
    return "left"


def detect_line_height(line_boxes: list[pymupdf.Rect], size: float) -> float:
    if len(line_boxes) < 2 or size <= 0:
        return DEFAULT_LINE_HEIGHT
    deltas = [
        later.y0 - earlier.y0
        for earlier, later in zip(line_boxes, line_boxes[1:], strict=False)
        if later.y0 > earlier.y0
    ]
    if not deltas:
        return DEFAULT_LINE_HEIGHT
    factor = statistics.median(deltas) / size
    return round(min(MAX_LINE_HEIGHT, max(MIN_LINE_HEIGHT, factor)), 2)


def _shown(box: pymupdf.Rect, transform: pymupdf.Matrix | None) -> list[float]:
    shown = pymupdf.Rect(box)
    if transform is not None:
        shown = shown * transform
        shown.normalize()
    return [round(shown.x0, 2), round(shown.y0, 2), round(shown.x1, 2), round(shown.y1, 2)]


def _run_matches(run: TextRun, span: dict, font_name: str, size: float, color: str) -> bool:
    return (
        run.font == font_name
        and run.size == size
        and run.color == color
        and run.bold == bool(span["flags"] & 16)
        and run.italic == bool(span["flags"] & 2)
        and run.superscript == bool(span["flags"] & 1)
    )


def build_line(
    line: dict, transform: pymupdf.Matrix | None, fonts: dict[str, tuple[int, str]]
) -> TextLine:
    runs: list[TextRun] = []
    for span in line["spans"]:
        text = str(span["text"])
        if not text:
            continue
        font_name = str(span["font"])
        size = round(float(span["size"]), 2)
        color = _color_to_hex(int(span["color"]))
        if runs and _run_matches(runs[-1], span, font_name, size, color):
            runs[-1] = runs[-1].model_copy(update={"text": runs[-1].text + text})
            continue
        xref, _ext = lookup_font_xref(fonts, font_name)
        runs.append(
            TextRun(
                text=text,
                font=font_name,
                font_xref=xref,
                font_family=display_font_name(font_name),
                size=size,
                color=color,
                bold=bool(span["flags"] & 16),
                italic=bool(span["flags"] & 2),
                superscript=bool(span["flags"] & 1),
            )
        )
    return TextLine(
        text="".join(str(span["text"]) for span in line["spans"]),
        bbox=_shown(pymupdf.Rect(line["bbox"]), transform),
        runs=runs,
    )


def detect_leading(line_boxes: list[pymupdf.Rect]) -> float:
    if len(line_boxes) < 2:
        return 0.0
    deltas = [
        later.y0 - earlier.y0
        for earlier, later in zip(line_boxes, line_boxes[1:], strict=False)
        if later.y0 > earlier.y0
    ]
    if not deltas:
        return 0.0
    return round(statistics.median(deltas), 2)


def detect_first_line_indent(line_boxes: list[pymupdf.Rect]) -> float:
    if len(line_boxes) < 2:
        return 0.0
    rest_min = min(box.x0 for box in line_boxes[1:])
    return round(max(0.0, line_boxes[0].x0 - rest_min), 2)


def detect_rotated(lines: list[dict]) -> bool:
    for line in lines:
        dx, dy = line.get("dir", (1, 0))
        if abs(dx - 1) > 0.01 or abs(dy) > 0.01:
            return True
    return False


MERGE_GAP_FACTOR = 0.9
MERGE_X_TOLERANCE = 4.0
MERGE_SIZE_TOLERANCE = 0.6


class _Paragraph:
    def __init__(self, block: dict) -> None:
        self.lines = [
            line for line in block["lines"] if any(span["text"].strip() for span in line["spans"])
        ]
        self.box = pymupdf.Rect(block["bbox"])
        self.spans = [span for line in self.lines for span in line["spans"] if span["text"].strip()]
        self.dominant = max(self.spans, key=lambda span: len(span["text"].strip()), default=None)

    def line_boxes(self) -> list[pymupdf.Rect]:
        return [pymupdf.Rect(line["bbox"]) for line in self.lines]

    def texts(self) -> list[str]:
        return ["".join(span["text"] for span in line["spans"]) for line in self.lines]

    def can_absorb(self, other: "_Paragraph") -> bool:
        size = float(self.dominant["size"])
        if abs(size - float(other.dominant["size"])) > MERGE_SIZE_TOLERANCE:
            return False
        if self.dominant["font"] != other.dominant["font"]:
            return False
        gap = other.box.y0 - self.box.y1
        if gap < -size * 0.3 or gap > size * MERGE_GAP_FACTOR:
            return False
        overlap = min(self.box.x1, other.box.x1) - max(self.box.x0, other.box.x0)
        if overlap <= 0:
            return False
        left_aligned = abs(self.box.x0 - other.box.x0) <= MERGE_X_TOLERANCE
        centred = (
            abs((self.box.x0 + self.box.x1) - (other.box.x0 + other.box.x1))
            <= MERGE_X_TOLERANCE * 2
        )
        return left_aligned or centred

    def absorb(self, other: "_Paragraph") -> None:
        self.lines.extend(other.lines)
        self.box = self.box | other.box
        self.spans.extend(other.spans)
        self.dominant = max(self.spans, key=lambda span: len(span["text"].strip()))


def merge_paragraphs(blocks: list[dict]) -> list[_Paragraph]:
    paragraphs: list[_Paragraph] = []
    for block in blocks:
        if block.get("type") != 0:
            continue
        candidate = _Paragraph(block)
        if not candidate.spans:
            continue
        if paragraphs and paragraphs[-1].can_absorb(candidate):
            paragraphs[-1].absorb(candidate)
        else:
            paragraphs.append(candidate)
    return paragraphs


def paragraph_to_block(
    paragraph: _Paragraph,
    index: int,
    transform: pymupdf.Matrix | None,
    fonts: dict[str, tuple[int, str]] | None = None,
) -> TextBlock:
    dominant = paragraph.dominant
    line_boxes = paragraph.line_boxes()
    font_name = str(dominant["font"])
    xref, ext = lookup_font_xref(fonts or {}, font_name)
    hard_breaks = detect_hard_breaks(line_boxes, paragraph.texts())
    text_lines = [
        build_line(line, transform, fonts or {}).model_copy(update={"hard_break": hard})
        for line, hard in zip(paragraph.lines, hard_breaks, strict=False)
    ]
    return TextBlock(
        id=f"t{index}",
        bbox=_shown(paragraph.box, transform),
        text=join_lines(paragraph.texts(), hard_breaks),
        font=font_name,
        size=round(float(dominant["size"]), 2),
        color=_color_to_hex(int(dominant["color"])),
        bold=bool(dominant["flags"] & 16),
        italic=bool(dominant["flags"] & 2),
        align=detect_align(paragraph.box, line_boxes),
        line_height=detect_line_height(line_boxes, float(dominant["size"])),
        line_count=len(line_boxes),
        font_xref=xref,
        font_ext="" if ext == "n/a" else ext,
        font_family=display_font_name(font_name),
        text_lines=text_lines,
        first_line_indent=detect_first_line_indent(line_boxes),
        leading=detect_leading(line_boxes),
        rotated=detect_rotated(paragraph.lines),
    )


def analyze_text_block(
    block: dict, index: int, transform: pymupdf.Matrix | None
) -> TextBlock | None:
    spans = [span for line in block["lines"] for span in line["spans"] if span["text"].strip()]
    if not spans:
        return None
    dominant = max(spans, key=lambda span: len(span["text"].strip()))
    line_boxes = [
        pymupdf.Rect(line["bbox"])
        for line in block["lines"]
        if any(span["text"].strip() for span in line["spans"])
    ]
    block_box = pymupdf.Rect(block["bbox"])
    return TextBlock(
        id=f"t{index}",
        bbox=_shown(block_box, transform),
        text=join_lines(
            ["".join(span["text"] for span in line["spans"]) for line in block["lines"]]
        ),
        font=str(dominant["font"]),
        size=round(float(dominant["size"]), 2),
        color=_color_to_hex(int(dominant["color"])),
        bold=bool(dominant["flags"] & 16),
        italic=bool(dominant["flags"] & 2),
        align=detect_align(block_box, line_boxes),
        line_height=detect_line_height(line_boxes, float(dominant["size"])),
        line_count=len(line_boxes),
    )


def placement_rotation(transform: tuple[float, ...] | list[float] | None) -> int | None:
    if not transform:
        return 0
    a, b, c, d = transform[:4]
    if abs(b) < 0.05 and abs(c) < 0.05:
        return 180 if a < 0 and d < 0 else 0
    if abs(a) < 0.05 and abs(d) < 0.05:
        return 90 if b < 0 else 270
    return None


def visible_rotation(page: pymupdf.Page, transform: tuple[float, ...] | list[float] | None) -> int:
    placed = placement_rotation(transform)
    return (page.rotation - (placed or 0)) % 360


def _image_blocks(page: pymupdf.Page, transform: pymupdf.Matrix | None) -> list[ImageBlock]:
    found: list[ImageBlock] = []
    seen: set[tuple[int, tuple[float, ...]]] = set()
    for info in page.get_image_info(xrefs=True):
        xref = int(info.get("xref") or 0)
        box = pymupdf.Rect(info["bbox"])
        key = (xref, tuple(round(value) for value in box))
        placeholder = int(info.get("width") or 0) <= 1 or int(info.get("height") or 0) <= 1
        if not xref or key in seen or box.is_empty or placeholder:
            continue
        seen.add(key)
        found.append(
            ImageBlock(
                id=f"i{xref}-{len(found)}",
                bbox=_shown(box, transform),
                xref=xref,
                width=int(info.get("width") or 0),
                height=int(info.get("height") or 0),
                placement_rotation=visible_rotation(page, info.get("transform")),
            )
        )
    return found


@op("editor.blocks", BlocksParams)
def blocks(params: BlocksParams, _progress: Progress) -> BlocksResult:
    with open_document(params.path, params.password, mutable=False) as document:
        if params.page >= document.page_count:
            raise OpError(ErrorCode.INVALID_PARAMS, "page out of range", {"reason": "page"})
        page = document[params.page]
        transform = page.rotation_matrix if page.rotation else None
        page_dict = page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)
        ordered = sorted(
            page_dict["blocks"], key=lambda block: (round(block["bbox"][1]), block["bbox"][0])
        )
        fonts = page_font_xrefs(page)
        found: list[TextBlock | ImageBlock] = [
            paragraph_to_block(paragraph, index, transform, fonts)
            for index, paragraph in enumerate(merge_paragraphs(ordered))
        ]
        found.extend(_image_blocks(page, transform))
        return BlocksResult(width=page.rect.width, height=page.rect.height, blocks=found)


class FontParams(RpcModel):
    path: str
    password: str | None = None
    xref: int = Field(ge=1)


class FontResult(RpcModel):
    name: str
    ext: str
    base64: str


@op("editor.font", FontParams)
def font(params: FontParams, _progress: Progress) -> FontResult:
    with open_document(params.path, params.password, mutable=False) as document:
        extracted = embedded_font(document, params.xref)
        if extracted is None:
            raise OpError(ErrorCode.INVALID_PARAMS, "font is not embedded", {"reason": "font"})
        name, ext, buffer = extracted
        program = repaired_embedded_font(document, params.xref, name, ext, buffer)
        return FontResult(name=name, ext=ext, base64=base64.b64encode(program).decode("ascii"))


class FontPlanParams(RpcModel):
    path: str
    password: str | None = None
    page: int = Field(ge=0)
    font_xref: int | None = Field(default=None, ge=0)
    font_family: str | None = None
    bold: bool = False
    italic: bool = False
    text: str = Field(min_length=1, max_length=5000)


@op("editor.font_plan", FontPlanParams)
def font_plan(params: FontPlanParams, _progress: Progress) -> FontResolution:
    with open_document(params.path, params.password, mutable=False) as document:
        if params.page >= document.page_count:
            raise OpError(ErrorCode.INVALID_PARAMS, "page out of range", {"reason": "page"})
        page = document[params.page]
        resolved = resolve_font(
            document,
            params.text,
            font_name=params.font_family,
            font_xref=params.font_xref,
            bold=params.bold,
            italic=params.italic,
            page=page,
        )
        return describe_resolution(resolved, params.font_family, params.text)
