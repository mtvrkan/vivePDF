import math
import re

import pymupdf

from vivepdf.ops._studio_models import (
    StudioBox,
    StudioLinear,
    StudioPath,
    StudioRadial,
    StudioSolid,
    StudioStop,
    StudioStroke,
    StudioVectorItem,
)
from vivepdf.rpc.errors import ErrorCode, OpError

TOKEN = re.compile(r"[MLHVCQZmlhvcqz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
ARGUMENTS = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "Q": 4, "Z": 0}
CAPS = {"butt": 0, "round": 1, "square": 2}
JOINS = {"miter": 0, "round": 1, "bevel": 2}
MITER_LIMIT = 4
MAX_COMMANDS = 200_000
GROUP_BOX = "[-100000 -100000 100000 100000]"
TRANSPARENCY_GROUP = "/Group<</Type/Group/S/Transparency>>"


def _number(value: float) -> str:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return "0" if text in {"", "-0"} else text


def _bad_path(message: str) -> OpError:
    return OpError(ErrorCode.INVALID_PARAMS, message, {"reason": "badPath"})


def path_operators(data: str) -> str:
    tokens = TOKEN.findall(data)
    if len(tokens) > MAX_COMMANDS * 7:
        raise _bad_path("the path is too long")
    out: list[str] = []
    index = 0
    command = ""
    x = y = start_x = start_y = 0.0
    started = False

    def point(px: float, py: float) -> str:
        return f"{_number(px)} {_number(py)}"

    while index < len(tokens):
        token = tokens[index]
        if token.isalpha():
            command = token
            index += 1
            if command in "Zz":
                if started:
                    out.append("h")
                x, y = start_x, start_y
                continue
        elif not command or command in "Zz":
            raise _bad_path("path data must start with a command")
        upper = command.upper()
        count = ARGUMENTS[upper]
        values = tokens[index : index + count]
        if len(values) < count or any(value.isalpha() for value in values):
            raise _bad_path("path data is incomplete")
        numbers = [float(value) for value in values]
        index += count
        relative = command.islower()
        if upper == "H":
            x = numbers[0] + (x if relative else 0)
            out.append(f"{point(x, y)} l")
        elif upper == "V":
            y = numbers[0] + (y if relative else 0)
            out.append(f"{point(x, y)} l")
        else:
            if relative:
                numbers = [
                    value + (x if position % 2 == 0 else y)
                    for position, value in enumerate(numbers)
                ]
            if upper == "M":
                x, y = numbers
                start_x, start_y = x, y
                started = True
                out.append(f"{point(x, y)} m")
                command = "l" if relative else "L"
            elif upper == "L":
                x, y = numbers
                out.append(f"{point(x, y)} l")
            elif upper == "C":
                out.append(
                    f"{point(numbers[0], numbers[1])} {point(numbers[2], numbers[3])} "
                    f"{point(numbers[4], numbers[5])} c"
                )
                x, y = numbers[4], numbers[5]
            else:
                qx, qy, ex, ey = numbers
                first = (x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y))
                second = (ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey))
                out.append(f"{point(*first)} {point(*second)} {point(ex, ey)} c")
                x, y = ex, ey
        if not started:
            raise _bad_path("path data must start with a move")
    return "\n".join(out)


def _rgb(colour: str) -> str:
    return " ".join(_number(int(colour[index : index + 2], 16) / 255) for index in (1, 3, 5))


def _normalised_stops(stops: list[StudioStop]) -> list[tuple[float, str]]:
    ordered = sorted(((stop.offset, stop.color) for stop in stops), key=lambda item: item[0])
    if ordered[0][0] > 0:
        ordered.insert(0, (0.0, ordered[0][1]))
    if ordered[-1][0] < 1:
        ordered.append((1.0, ordered[-1][1]))
    spaced: list[tuple[float, str]] = []
    for offset, colour in ordered:
        if spaced and offset <= spaced[-1][0]:
            offset = min(1.0, spaced[-1][0] + 1e-4)
        spaced.append((offset, colour))
    return spaced


def _function(stops: list[StudioStop]) -> str:
    spaced = _normalised_stops(stops)
    pieces = [
        f"<</FunctionType 2/Domain[0 1]/C0[{_rgb(left)}]/C1[{_rgb(right)}]/N 1>>"
        for (_, left), (_, right) in zip(spaced, spaced[1:], strict=False)
    ]
    if len(pieces) == 1:
        return pieces[0]
    bounds = " ".join(_number(offset) for offset, _ in spaced[1:-1])
    encode = " ".join("0 1" for _ in pieces)
    return (
        f"<</FunctionType 3/Domain[0 1]/Functions[{''.join(pieces)}]"
        f"/Bounds[{bounds}]/Encode[{encode}]>>"
    )


def _shading(fill: StudioLinear | StudioRadial) -> str:
    if isinstance(fill, StudioLinear):
        coords = " ".join(_number(value) for value in (fill.x1, fill.y1, fill.x2, fill.y2))
        kind = 2
    else:
        cx, cy = _number(fill.cx), _number(fill.cy)
        coords = f"{cx} {cy} 0 {cx} {cy} {_number(fill.r)}"
        kind = 3
    return (
        f"<</ShadingType {kind}/ColorSpace/DeviceRGB/Coords[{coords}]"
        f"/Function {_function(fill.stops)}/Extend[true true]>>"
    )


def _stroke_operators(stroke: StudioStroke) -> str:
    dash = " ".join(_number(value) for value in stroke.dash if value >= 0)
    if stroke.dash and not any(stroke.dash):
        dash = ""
    return (
        f"{_rgb(stroke.color)} RG {_number(stroke.width)} w {CAPS[stroke.cap]} J "
        f"{JOINS[stroke.join]} j {MITER_LIMIT} M [{dash}] 0 d"
    )


def stroke_margin(paths: list[StudioPath]) -> float:
    widest = max((path.stroke.width for path in paths if path.stroke), default=0.0)
    return widest * MITER_LIMIT / 2 + 1 if widest else 0.0


class _Resources:
    def __init__(self) -> None:
        self.states: dict[float, str] = {}
        self.shadings: list[str] = []
        self.forms: list[list[str]] = []

    def state(self, opacity: float) -> str:
        key = round(opacity, 4)
        if key not in self.states:
            self.states[key] = f"G{len(self.states)}"
        return self.states[key]

    def shading(self, body: str) -> str:
        self.shadings.append(body)
        return f"Sh{len(self.shadings) - 1}"

    def form(self, lines: list[str]) -> str:
        self.forms.append(lines)
        return f"Fm{len(self.forms) - 1}"

    def dictionary(self, forms: list[int] | None = None) -> str:
        states = "".join(
            f"/{name}<</Type/ExtGState/ca {_number(value)}/CA {_number(value)}>>"
            for value, name in self.states.items()
        )
        shadings = "".join(f"/Sh{index}{body}" for index, body in enumerate(self.shadings))
        objects = "".join(f"/Fm{index} {xref} 0 R" for index, xref in enumerate(forms or []))
        return f"<</ExtGState<<{states}>>/Shading<<{shadings}>>/XObject<<{objects}>>>>"


def _path_content(path: StudioPath, resources: _Resources) -> list[str]:
    geometry = path_operators(path.d)
    if not geometry:
        return []
    star = "*" if path.even_odd else ""
    lines = ["q"]
    grouped = path.opacity < 1 and path.fill is not None and path.stroke is not None
    if path.opacity < 1 and not grouped:
        lines.append(f"/{resources.state(path.opacity)} gs")
    if isinstance(path.fill, StudioSolid):
        lines += [f"{_rgb(path.fill.color)} rg", geometry, f"f{star}"]
    elif path.fill is not None:
        name = resources.shading(_shading(path.fill))
        lines += ["q", geometry, f"W{star} n", f"/{name} sh", "Q"]
    if path.stroke is not None:
        lines += [_stroke_operators(path.stroke), geometry, "S"]
    lines.append("Q")
    if grouped:
        name = resources.form(lines)
        return ["q", f"/{resources.state(path.opacity)} gs", f"/{name} Do", "Q"]
    return lines


def vector_document(item: StudioVectorItem) -> tuple[pymupdf.Document, float]:
    scale_x = item.width / (item.view_width or item.width)
    scale_y = item.height / (item.view_height or item.height)
    margin = stroke_margin(item.paths) * max(scale_x, scale_y)
    width, height = item.width + 2 * margin, item.height + 2 * margin
    resources = _Resources()
    body = [
        f"1 0 0 -1 0 {_number(height)} cm",
        f"1 0 0 1 {_number(margin)} {_number(margin)} cm",
        f"{_number(scale_x)} 0 0 {_number(scale_y)} 0 0 cm",
    ]
    for path in item.paths:
        body += _path_content(path, resources)
    document = pymupdf.open()
    page = document.new_page(width=width, height=height)
    forms: list[int] = []
    if resources.forms:
        shared = _new_object(document, resources.dictionary())
        forms = [
            _new_stream(
                document,
                f"<</Type/XObject/Subtype/Form/BBox{GROUP_BOX}/Resources {shared} 0 R"
                f"{TRANSPARENCY_GROUP}>>",
                "\n".join(lines),
            )
            for lines in resources.forms
        ]
    stream = _new_stream(document, "<<>>", "q\n" + "\n".join(body) + "\nQ\n")
    document.xref_set_key(page.xref, "Contents", f"{stream} 0 R")
    document.xref_set_key(page.xref, "Resources", resources.dictionary(forms))
    return group_opacity(document, item.opacity), margin


def _new_object(document: pymupdf.Document, body: str) -> int:
    xref = document.get_new_xref()
    document.update_object(xref, body)
    return xref


def _new_stream(document: pymupdf.Document, body: str, content: str | bytes) -> int:
    xref = _new_object(document, body)
    document.update_stream(xref, content.encode("latin-1") if isinstance(content, str) else content)
    return xref


def group_opacity(document: pymupdf.Document, opacity: float) -> pymupdf.Document:
    if opacity >= 1:
        return document
    page = document[0]
    kind, box = document.xref_get_key(page.xref, "MediaBox")
    if kind != "array":
        box = f"[0 0 {_number(page.rect.width)} {_number(page.rect.height)}]"
    kind, resources = document.xref_get_key(page.xref, "Resources")
    if kind not in {"dict", "xref"}:
        resources = "<<>>"
    form = _new_stream(
        document,
        f"<</Type/XObject/Subtype/Form/BBox{box}/Resources {resources}{TRANSPARENCY_GROUP}>>",
        page.read_contents(),
    )
    value = _number(opacity)
    stream = _new_stream(document, "<<>>", "q\n/GA gs\n/GF Do\nQ\n")
    document.xref_set_key(page.xref, "Contents", f"{stream} 0 R")
    document.xref_set_key(
        page.xref,
        "Resources",
        f"<</ExtGState<</GA<</Type/ExtGState/ca {value}/CA {value}>>>>/XObject<</GF {form} 0 R>>>>",
    )
    return document


def rotated_bounds(box: StudioBox, margin: float = 0.0) -> pymupdf.Rect:
    width, height = box.width + 2 * margin, box.height + 2 * margin
    angle = math.radians(box.rotation)
    cos, sin = abs(math.cos(angle)), abs(math.sin(angle))
    outer_width = width * cos + height * sin
    outer_height = width * sin + height * cos
    cx, cy = box.x + box.width / 2, box.y + box.height / 2
    return pymupdf.Rect(
        cx - outer_width / 2, cy - outer_height / 2, cx + outer_width / 2, cy + outer_height / 2
    )


def place(
    page: pymupdf.Page, source: pymupdf.Document, box: StudioBox, margin: float = 0.0
) -> None:
    target = rotated_bounds(box, margin)
    rotation = box.rotation % 360
    page.show_pdf_page(
        target,
        source,
        0,
        keep_proportion=rotation % 90 != 0,
        overlay=True,
        rotate=-rotation,
    )
