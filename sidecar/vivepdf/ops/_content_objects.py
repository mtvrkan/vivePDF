import math
import re
from dataclasses import dataclass, field
from typing import Literal

import pymupdf

from vivepdf.ops._content import _skip_inline_image, content_tokens

Matrix = tuple[float, float, float, float, float, float]
Box = tuple[float, float, float, float]
ObjectKind = Literal["text", "image", "form", "inline", "path", "shading"]

IDENTITY: Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
NUMBER_PATTERN = re.compile(rb"^[+-]?(\d+\.?\d*|\.\d+)$")
MCID_PATTERN = re.compile(rb"/MCID\s+(\d+)")
ARRAY_NUMBER_PATTERN = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)")
NON_OPERATORS = {b"true", b"false", b"null"}
PATH_CONSTRUCTION = {b"m", b"l", b"c", b"v", b"y", b"h", b"re"}
PATH_PAINTING = {b"S", b"s", b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*", b"n"}
TEXT_SHOWING = {b"Tj", b"TJ", b"'", b'"'}
MAX_INSTRUCTIONS = 2_000_000


@dataclass
class Instruction:
    start: int
    end: int
    operator: bytes
    operands: list[bytes]


@dataclass
class MarkedSpan:
    tag: bytes
    properties: bytes | None
    open_start: int
    open_end: int
    mcid: int | None = None
    close_start: int | None = None
    close_end: int | None = None


@dataclass
class ContentObject:
    kind: ObjectKind
    start: int
    end: int
    marks: tuple[int, ...]
    box: Box | None = None
    size: float = 0.0
    first_y: float | None = None
    last_y: float | None = None
    shown: bool = False
    characters: int = 0
    has_text: bool = False
    has_images: bool = False


@dataclass
class PageContent:
    objects: list[ContentObject] = field(default_factory=list)
    marks: list[MarkedSpan] = field(default_factory=list)


@dataclass(frozen=True)
class FormFacts:
    matrix: Matrix
    box: Box
    has_text: bool
    has_images: bool


def _is_operator(text: bytes) -> bool:
    if not text or text in NON_OPERATORS:
        return False
    first = text[:1]
    return first.isalpha() or first in (b"'", b'"')


def instructions(data: bytes) -> list[Instruction]:
    found: list[Instruction] = []
    pending: list[tuple[int, int, bytes]] = []
    for start, end, text in content_tokens(data):
        if not _is_operator(text):
            pending.append((start, end, text))
            continue
        begin = pending[0][0] if pending else start
        stop = _skip_inline_image(data, end) if text == b"BI" else end
        found.append(Instruction(begin, stop, text, [token for _, _, token in pending]))
        pending = []
        if len(found) >= MAX_INSTRUCTIONS:
            break
    return found


def multiply(first: Matrix, second: Matrix) -> Matrix:
    a, b, c, d, e, f = first
    g, h, i, j, k, m = second
    return (
        a * g + b * i,
        a * h + b * j,
        c * g + d * i,
        c * h + d * j,
        e * g + f * i + k,
        e * h + f * j + m,
    )


def apply(matrix: Matrix, x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = matrix
    return (x * a + y * c + e, x * b + y * d + f)


def scale_of(matrix: Matrix) -> float:
    a, b, c, d, _e, _f = matrix
    return math.sqrt(abs(a * d - b * c))


def transformed_box(matrix: Matrix, box: Box) -> Box:
    x0, y0, x1, y1 = box
    corners = [apply(matrix, x, y) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
    xs = [point[0] for point in corners]
    ys = [point[1] for point in corners]
    return (min(xs), min(ys), max(xs), max(ys))


def union(boxes: list[Box]) -> Box | None:
    if not boxes:
        return None
    return (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )


def _numbers(operands: list[bytes], count: int) -> list[float] | None:
    values = [float(token) for token in operands if NUMBER_PATTERN.match(token)]
    return values[-count:] if len(values) >= count else None


def array_numbers(text: str) -> list[float]:
    return [float(value) for value in ARRAY_NUMBER_PATTERN.findall(text)]


def form_facts(document: pymupdf.Document, xref: int, cache: dict[int, FormFacts]) -> FormFacts:
    if xref in cache:
        return cache[xref]
    matrix_kind, matrix_value = document.xref_get_key(xref, "Matrix")
    matrix_numbers = array_numbers(matrix_value) if matrix_kind == "array" else []
    matrix: Matrix = tuple(matrix_numbers) if len(matrix_numbers) == 6 else IDENTITY  # type: ignore[assignment]
    box_kind, box_value = document.xref_get_key(xref, "BBox")
    box_numbers = array_numbers(box_value) if box_kind == "array" else []
    box: Box = (
        (
            min(box_numbers[0], box_numbers[2]),
            min(box_numbers[1], box_numbers[3]),
            max(box_numbers[0], box_numbers[2]),
            max(box_numbers[1], box_numbers[3]),
        )
        if len(box_numbers) == 4
        else (0.0, 0.0, 0.0, 0.0)
    )
    try:
        stream = document.xref_stream(xref) or b""
    except Exception:  # noqa: BLE001
        stream = b""
    operators = {instruction.operator for instruction in instructions(stream)}
    facts = FormFacts(
        matrix=matrix,
        box=box,
        has_text=bool(operators & TEXT_SHOWING),
        has_images=b"Do" in operators or b"BI" in operators,
    )
    cache[xref] = facts
    return facts


def page_xobjects(page: pymupdf.Page) -> dict[str, tuple[str, int]]:
    found: dict[str, tuple[str, int]] = {}
    for item in page.get_images(full=True):
        if item[9] == 0:
            found[str(item[7])] = ("image", int(item[0]))
    for item in page.get_xobjects():
        if item[2] == 0:
            found[str(item[1])] = ("form", int(item[0]))
    return found


def page_bytes(document: pymupdf.Document, page: pymupdf.Page) -> bytes:
    parts: list[bytes] = []
    for xref in page.get_contents():
        try:
            parts.append(document.xref_stream(xref) or b"")
        except Exception:  # noqa: BLE001
            continue
    return b"\n".join(parts)


def _mcid(document: pymupdf.Document, page_xref: int, properties: bytes | None) -> int | None:
    if properties is None:
        return None
    if properties.startswith(b"<<"):
        match = MCID_PATTERN.search(properties)
        return int(match.group(1)) if match else None
    if properties.startswith(b"/"):
        name = properties.decode("latin-1").lstrip("/")
        kind, value = document.xref_get_key(page_xref, f"Resources/Properties/{name}/MCID")
        return int(value) if kind == "int" else None
    return None


@dataclass
class _TextBlock:
    start: int
    marks: tuple[int, ...]
    text_matrix: Matrix = IDENTITY
    line_matrix: Matrix = IDENTITY
    size: float = 0.0
    first_y: float | None = None
    last_y: float | None = None
    shown: bool = False
    characters: int = 0


def walk_content(
    document: pymupdf.Document,
    page: pymupdf.Page,
    data: bytes,
    forms: dict[int, FormFacts] | None = None,
) -> PageContent:
    content = PageContent()
    forms = forms if forms is not None else {}
    xobjects = page_xobjects(page)
    ctm = IDENTITY
    font_size = 0.0
    leading = 0.0
    saved: list[tuple[Matrix, float, float]] = []
    open_marks: list[int] = []
    text: _TextBlock | None = None
    path_start: int | None = None
    path_marks: tuple[int, ...] = ()

    for instruction in instructions(data):
        operator = instruction.operator
        operands = instruction.operands
        if operator == b"q":
            saved.append((ctm, font_size, leading))
        elif operator == b"Q":
            ctm, font_size, leading = saved.pop() if saved else (IDENTITY, font_size, leading)
        elif operator == b"cm":
            values = _numbers(operands, 6)
            if values:
                ctm = multiply(tuple(values), ctm)  # type: ignore[arg-type]
        elif operator in (b"BDC", b"BMC"):
            tag = operands[0] if operands else b""
            properties = operands[1] if operator == b"BDC" and len(operands) > 1 else None
            content.marks.append(
                MarkedSpan(
                    tag=tag,
                    properties=properties,
                    open_start=instruction.start,
                    open_end=instruction.end,
                    mcid=_mcid(document, page.xref, properties),
                )
            )
            open_marks.append(len(content.marks) - 1)
        elif operator == b"EMC":
            if open_marks:
                closing = content.marks[open_marks.pop()]
                closing.close_start = instruction.start
                closing.close_end = instruction.end
        elif operator == b"Tf":
            values = _numbers(operands, 1)
            if values:
                font_size = values[0]
        elif operator == b"TL":
            values = _numbers(operands, 1)
            if values:
                leading = values[0]
        elif operator == b"BT":
            text = _TextBlock(start=instruction.start, marks=tuple(open_marks))
        elif operator == b"ET":
            if text is not None:
                content.objects.append(
                    ContentObject(
                        kind="text",
                        start=text.start,
                        end=instruction.end,
                        marks=text.marks,
                        size=text.size,
                        first_y=text.first_y,
                        last_y=text.last_y,
                        shown=text.shown,
                        characters=text.characters,
                    )
                )
            text = None
        elif text is not None and operator == b"Tm":
            values = _numbers(operands, 6)
            if values:
                text.text_matrix = text.line_matrix = tuple(values)  # type: ignore[assignment]
        elif text is not None and operator in (b"Td", b"TD"):
            values = _numbers(operands, 2)
            if values:
                if operator == b"TD":
                    leading = -values[1]
                text.line_matrix = multiply(
                    (1.0, 0.0, 0.0, 1.0, values[0], values[1]), text.line_matrix
                )
                text.text_matrix = text.line_matrix
        elif text is not None and operator == b"T*":
            text.line_matrix = multiply((1.0, 0.0, 0.0, 1.0, 0.0, -leading), text.line_matrix)
            text.text_matrix = text.line_matrix
        elif text is not None and operator in TEXT_SHOWING:
            if operator in (b"'", b'"'):
                text.line_matrix = multiply((1.0, 0.0, 0.0, 1.0, 0.0, -leading), text.line_matrix)
                text.text_matrix = text.line_matrix
            placed = multiply(text.text_matrix, ctm)
            text.size = max(text.size, abs(font_size) * scale_of(placed))
            y = apply(placed, 0.0, 0.0)[1]
            text.first_y = y if text.first_y is None else text.first_y
            text.last_y = y
            text.shown = True
            text.characters += sum(len(token) for token in operands if token[:1] in (b"(", b"<"))
        elif operator == b"Do" and operands:
            name = operands[-1].decode("latin-1").lstrip("/")
            kind, xref = xobjects.get(name, ("", 0))
            if kind == "image":
                content.objects.append(
                    ContentObject(
                        kind="image",
                        start=instruction.start,
                        end=instruction.end,
                        marks=tuple(open_marks),
                        box=transformed_box(ctm, (0.0, 0.0, 1.0, 1.0)),
                    )
                )
            elif kind == "form":
                facts = form_facts(document, xref, forms)
                content.objects.append(
                    ContentObject(
                        kind="form",
                        start=instruction.start,
                        end=instruction.end,
                        marks=tuple(open_marks),
                        box=transformed_box(multiply(facts.matrix, ctm), facts.box),
                        has_text=facts.has_text,
                        has_images=facts.has_images,
                    )
                )
        elif operator == b"BI":
            content.objects.append(
                ContentObject(
                    kind="inline",
                    start=instruction.start,
                    end=instruction.end,
                    marks=tuple(open_marks),
                    box=transformed_box(ctm, (0.0, 0.0, 1.0, 1.0)),
                )
            )
        elif operator in PATH_CONSTRUCTION:
            if path_start is None:
                path_start = instruction.start
                path_marks = tuple(open_marks)
        elif operator in PATH_PAINTING:
            if path_start is not None and operator != b"n":
                content.objects.append(
                    ContentObject(
                        kind="path", start=path_start, end=instruction.end, marks=path_marks
                    )
                )
            path_start = None
        elif operator == b"sh":
            content.objects.append(
                ContentObject(
                    kind="shading",
                    start=instruction.start,
                    end=instruction.end,
                    marks=tuple(open_marks),
                )
            )
    return content
