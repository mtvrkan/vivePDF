from dataclasses import dataclass, field
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

MAX_NODES = 40
MAX_EDGES = 80
MAX_NODE_CHARS = 300
MAX_LABEL_CHARS = 60
MAX_SIDE = 14_400.0
TEXT_WIDTH = 11.0
PADDING = 0.8
MIN_WIDTH = 6.0
MIN_HEIGHT = 2.4
SLANT = 0.9
LAYER_GAP = 2.6
NODE_GAP = 2.2
LANE_GAP = 1.4
ARROW = 0.55
ORDER_SWEEPS = 4
LABEL_SCALE = 0.85
MARGIN = 0.8

FlowShape = Literal["process", "terminal", "decision", "io", "connector"]
FlowDirection = Literal["down", "right"]
NodeId = Annotated[str, Field(min_length=1, max_length=40)]
Point = tuple[float, float]


class FlowNode(RpcModel):
    id: NodeId
    shape: FlowShape = "process"
    text: str = Field(default="", max_length=MAX_NODE_CHARS)


class FlowEdge(RpcModel):
    source: NodeId
    target: NodeId
    label: str = Field(default="", max_length=MAX_LABEL_CHARS)


class FlowchartSpec(RpcModel):
    nodes: list[FlowNode] = Field(min_length=1, max_length=MAX_NODES)
    edges: list[FlowEdge] = Field(default_factory=list, max_length=MAX_EDGES)
    direction: FlowDirection = "down"
    font_size: float = Field(default=10, ge=4, le=36)
    font_id: str | None = Field(default=None, max_length=4096)
    color: str = Field(default="#111111", pattern=HEX_COLOR)
    stroke: str = Field(default="#1f2937", pattern=HEX_COLOR)
    fill: str | None = Field(default="#eef2ff", pattern=HEX_COLOR)

    @model_validator(mode="after")
    def _connected_ids(self) -> "FlowchartSpec":
        ids = [node.id for node in self.nodes]
        if len(ids) != len(set(ids)):
            raise ValueError("node ids must be unique")
        known = set(ids)
        for edge in self.edges:
            if edge.source not in known or edge.target not in known:
                raise ValueError("every arrow must join two steps of the chart")
            if edge.source == edge.target:
                raise ValueError("an arrow cannot start and end at the same step")
        return self


class FlowchartPreviewResult(RpcModel):
    svg: str
    width: float
    height: float
    missing_glyphs: str = ""


@dataclass
class _Node:
    spec: FlowNode
    lines: list[str]
    width: float
    height: float
    layer: int = 0
    order: float = 0.0
    x: float = 0.0
    y: float = 0.0

    @property
    def box(self) -> pymupdf.Rect:
        return pymupdf.Rect(
            self.x - self.width / 2,
            self.y - self.height / 2,
            self.x + self.width / 2,
            self.y + self.height / 2,
        )


@dataclass
class _Route:
    points: list[Point]
    label: str
    back: bool = False


@dataclass
class _Layout:
    nodes: dict[str, _Node]
    routes: list[_Route] = field(default_factory=list)


def _measure(spec: FlowchartSpec, fonts: ScratchFonts) -> dict[str, _Node]:
    size = spec.font_size
    step = size * LINE_HEIGHT
    pad = size * PADDING
    nodes: dict[str, _Node] = {}
    for node in spec.nodes:
        lines = wrap_cell(node.text, fonts.regular, size, size * TEXT_WIDTH)
        text_width = max(fonts.regular.text_length(line, fontsize=size) for line in lines)
        text_height = len(lines) * step
        width = max(size * MIN_WIDTH, text_width + 2 * pad)
        height = max(size * MIN_HEIGHT, text_height + 2 * pad)
        if node.shape == "terminal":
            width += height * 0.5
        elif node.shape == "io":
            width += size * SLANT * 2
        elif node.shape == "decision":
            width, height = 2 * (text_width + pad), 2 * (text_height + pad * 0.6)
        elif node.shape == "connector":
            width = height = max(size * MIN_HEIGHT, text_width + 2 * pad, text_height + 2 * pad)
        nodes[node.id] = _Node(node, lines, width, height)
    return nodes


def _back_edges(spec: FlowchartSpec) -> set[int]:
    outgoing: dict[str, list[tuple[int, str]]] = {node.id: [] for node in spec.nodes}
    for index, edge in enumerate(spec.edges):
        outgoing[edge.source].append((index, edge.target))
    state: dict[str, int] = {}
    back: set[int] = set()

    def visit(start: str) -> None:
        stack = [(start, iter(outgoing[start]))]
        state[start] = 1
        while stack:
            current, children = stack[-1]
            for index, target in children:
                if state.get(target) == 1:
                    back.add(index)
                elif target not in state:
                    state[target] = 1
                    stack.append((target, iter(outgoing[target])))
                    break
            else:
                state[current] = 2
                stack.pop()

    for node in spec.nodes:
        if node.id not in state:
            visit(node.id)
    return back


def _assign_layers(spec: FlowchartSpec, nodes: dict[str, _Node], back: set[int]) -> None:
    forward = [edge for index, edge in enumerate(spec.edges) if index not in back]
    for _ in range(len(nodes)):
        changed = False
        for edge in forward:
            wanted = nodes[edge.source].layer + 1
            if nodes[edge.target].layer < wanted:
                nodes[edge.target].layer = wanted
                changed = True
        if not changed:
            break


def _order_layers(spec: FlowchartSpec, nodes: dict[str, _Node]) -> list[list[_Node]]:
    count = max(node.layer for node in nodes.values()) + 1
    layers: list[list[_Node]] = [[] for _ in range(count)]
    for position, node in enumerate(spec.nodes):
        nodes[node.id].order = position
        layers[nodes[node.id].layer].append(nodes[node.id])
    neighbours: dict[str, list[str]] = {node.id: [] for node in spec.nodes}
    for edge in spec.edges:
        neighbours[edge.source].append(edge.target)
        neighbours[edge.target].append(edge.source)
    for sweep in range(ORDER_SWEEPS):
        sequence = range(1, count) if sweep % 2 == 0 else range(count - 2, -1, -1)
        for index in sequence:
            reference = index - 1 if sweep % 2 == 0 else index + 1
            for node in layers[index]:
                linked = [
                    nodes[other].order
                    for other in neighbours[node.spec.id]
                    if nodes[other].layer == reference
                ]
                if linked:
                    node.order = sum(linked) / len(linked)
            layers[index].sort(key=lambda node: node.order)
            for position, node in enumerate(layers[index]):
                node.order = position
    return layers


def _place(spec: FlowchartSpec, layers: list[list[_Node]], gap: float) -> None:
    size = spec.font_size
    down = spec.direction == "down"

    def along(node: _Node) -> float:
        return node.height if down else node.width

    def across(node: _Node) -> float:
        return node.width if down else node.height

    spans = [
        sum(across(node) for node in layer) + size * NODE_GAP * (len(layer) - 1) for layer in layers
    ]
    widest = max(spans)
    main = 0.0
    for layer, span in zip(layers, spans, strict=True):
        depth = max(along(node) for node in layer)
        cross = (widest - span) / 2
        for node in layer:
            centre_main = main + depth / 2
            centre_cross = cross + across(node) / 2
            node.x, node.y = (centre_cross, centre_main) if down else (centre_main, centre_cross)
            cross += across(node) + size * NODE_GAP
        main += depth + gap


def _anchor(node: _Node, side: str) -> Point:
    box = node.box
    return {
        "top": (node.x, box.y0),
        "bottom": (node.x, box.y1),
        "left": (box.x0, node.y),
        "right": (box.x1, node.y),
    }[side]


def _forward_route(spec: FlowchartSpec, source: _Node, target: _Node, gap: float) -> list[Point]:
    if spec.direction == "down":
        if source.spec.shape == "decision" and abs(target.x - source.x) > source.width / 2:
            start = _anchor(source, "right" if target.x > source.x else "left")
            end = _anchor(target, "top")
            return [start, (end[0], start[1]), end]
        start, end = _anchor(source, "bottom"), _anchor(target, "top")
        if abs(start[0] - end[0]) < 0.5:
            return [start, end]
        turn = end[1] - gap / 2
        return [start, (start[0], turn), (end[0], turn), end]
    if source.spec.shape == "decision" and abs(target.y - source.y) > source.height / 2:
        start = _anchor(source, "bottom" if target.y > source.y else "top")
        end = _anchor(target, "left")
        return [start, (start[0], end[1]), end]
    start, end = _anchor(source, "right"), _anchor(target, "left")
    if abs(start[1] - end[1]) < 0.5:
        return [start, end]
    turn = end[0] - gap / 2
    return [start, (turn, start[1]), (turn, end[1]), end]


def _back_route(spec: FlowchartSpec, nodes, source: _Node, target: _Node, lane: int):
    reach = spec.font_size * LANE_GAP * (lane + 1)
    if spec.direction == "down":
        edge = max(node.box.x1 for node in nodes.values()) + reach
        start, end = _anchor(source, "right"), _anchor(target, "right")
        return [start, (edge, start[1]), (edge, end[1]), end]
    edge = max(node.box.y1 for node in nodes.values()) + reach
    start, end = _anchor(source, "bottom"), _anchor(target, "bottom")
    return [start, (start[0], edge), (end[0], edge), end]


def _layer_gap(spec: FlowchartSpec, fonts: ScratchFonts) -> float:
    size = spec.font_size
    gap = size * LAYER_GAP
    if spec.direction == "right":
        widest = max(
            (
                fonts.regular.text_length(edge.label.strip(), fontsize=size * LABEL_SCALE)
                for edge in spec.edges
            ),
            default=0.0,
        )
        gap = max(gap, widest + size * 2.4)
    return gap


def _layout(spec: FlowchartSpec, fonts: ScratchFonts) -> _Layout:
    nodes = _measure(spec, fonts)
    back = _back_edges(spec)
    _assign_layers(spec, nodes, back)
    gap = _layer_gap(spec, fonts)
    _place(spec, _order_layers(spec, nodes), gap)
    layout = _Layout(nodes)
    lane = 0
    for index, edge in enumerate(spec.edges):
        source, target = nodes[edge.source], nodes[edge.target]
        if index in back or target.layer <= source.layer:
            layout.routes.append(
                _Route(_back_route(spec, nodes, source, target, lane), edge.label, True)
            )
            lane += 1
        else:
            layout.routes.append(_Route(_forward_route(spec, source, target, gap), edge.label))
    return layout


def _bounds(layout: _Layout, fonts: ScratchFonts, size: float) -> pymupdf.Rect:
    xs: list[float] = []
    ys: list[float] = []
    for node in layout.nodes.values():
        box = node.box
        xs += [box.x0, box.x1]
        ys += [box.y0, box.y1]
    for route in layout.routes:
        xs += [x for x, _ in route.points]
        ys += [y for _, y in route.points]
        if route.label.strip():
            label = _label_box(route, fonts, size)
            xs += [label.x0, label.x1]
            ys += [label.y0, label.y1]
    return pymupdf.Rect(min(xs), min(ys), max(xs), max(ys))


def _label_box(route: _Route, fonts: ScratchFonts, size: float) -> pymupdf.Rect:
    small = size * LABEL_SCALE
    width = fonts.regular.text_length(route.label.strip(), fontsize=small)
    height = small * LINE_HEIGHT
    gap = size * 0.3
    segments = list(zip(route.points, route.points[1:], strict=False))

    def roomy(segment: tuple[Point, Point]) -> bool:
        (sx0, sy0), (sx1, sy1) = segment
        if abs(sx1 - sx0) >= abs(sy1 - sy0):
            return abs(sx1 - sx0) >= width + 4 * gap
        return abs(sy1 - sy0) >= height + 2 * gap

    (x0, y0), (x1, y1) = next((segment for segment in segments if roomy(segment)), segments[0])
    if abs(x1 - x0) >= abs(y1 - y0):
        left = x0 + 2 * gap if x1 >= x0 else x0 - 2 * gap - width
        top = y0 - gap - height
    else:
        left = x0 + gap
        top = y0 + gap if y1 >= y0 else y0 - gap - height
    return pymupdf.Rect(left, top, left + width, top + height)


def _draw_shape(page: pymupdf.Page, node: _Node, spec: FlowchartSpec, opacity: float) -> None:
    box = node.box
    stroke = rgb(spec.stroke)
    fill = rgb(spec.fill) if spec.fill else None
    style = {
        "color": stroke,
        "fill": fill,
        "width": max(0.75, spec.font_size / 12),
        "stroke_opacity": opacity,
        "fill_opacity": opacity,
    }
    shape = node.spec.shape
    if shape == "process":
        page.draw_rect(box, **style)
    elif shape == "terminal":
        page.draw_rect(box, radius=0.5, **style)
    elif shape == "decision":
        points = [(node.x, box.y0), (box.x1, node.y), (node.x, box.y1), (box.x0, node.y)]
        page.draw_polyline(points, closePath=True, **style)
    elif shape == "io":
        slant = spec.font_size * SLANT
        points = [
            (box.x0 + slant, box.y0),
            (box.x1, box.y0),
            (box.x1 - slant, box.y1),
            (box.x0, box.y1),
        ]
        page.draw_polyline(points, closePath=True, **style)
    else:
        page.draw_oval(box, **style)


def _draw_route(page: pymupdf.Page, route: _Route, spec: FlowchartSpec, opacity: float) -> None:
    stroke = rgb(spec.stroke)
    width = max(0.75, spec.font_size / 12)
    page.draw_polyline(
        route.points, color=stroke, width=width, stroke_opacity=opacity, closePath=False
    )
    (x0, y0), (x1, y1) = route.points[-2], route.points[-1]
    length = max(1e-6, ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5)
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    head = spec.font_size * ARROW
    base = (x1 - ux * head, y1 - uy * head)
    wing = (-uy * head * 0.55, ux * head * 0.55)
    page.draw_polyline(
        [(x1, y1), (base[0] + wing[0], base[1] + wing[1]), (base[0] - wing[0], base[1] - wing[1])],
        color=stroke,
        fill=stroke,
        width=0.1,
        closePath=True,
        stroke_opacity=opacity,
        fill_opacity=opacity,
    )


def _write(page, fonts: ScratchFonts, spec: FlowchartSpec, at: Point, text: str, size, opacity):
    font = fonts.regular
    page.insert_text(
        (at[0], at[1] + baseline_offset(font, size)),
        text,
        fontname=fonts.name_of(False),
        fontsize=size,
        color=rgb(spec.color),
        fill_opacity=opacity,
    )


def flowchart_pdf(spec: FlowchartSpec, opacity: float = 1.0) -> tuple[pymupdf.Document, str]:
    if not any(node.text.strip() for node in spec.nodes):
        raise OpError(
            ErrorCode.INVALID_PARAMS, "the flowchart has no text", {"reason": "flowchartEmpty"}
        )
    fonts = load_fonts(spec.font_id)
    layout = _layout(spec, fonts)
    size = spec.font_size
    margin = size * MARGIN
    bounds = _bounds(layout, fonts, size)
    width, height = bounds.width + 2 * margin, bounds.height + 2 * margin
    if width > MAX_SIDE or height > MAX_SIDE:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the flowchart is too large to place on a page",
            {"reason": "flowchartTooLarge"},
        )
    shift = (margin - bounds.x0, margin - bounds.y0)
    for node in layout.nodes.values():
        node.x += shift[0]
        node.y += shift[1]
    for route in layout.routes:
        route.points = [(x + shift[0], y + shift[1]) for x, y in route.points]
    document = pymupdf.open()
    page = document.new_page(width=width, height=height)
    fonts.install(page)
    step = size * LINE_HEIGHT
    for route in layout.routes:
        _draw_route(page, route, spec, opacity)
    for node in layout.nodes.values():
        _draw_shape(page, node, spec, opacity)
        top = node.y - len(node.lines) * step / 2
        for index, line in enumerate(node.lines):
            advance = fonts.regular.text_length(line, fontsize=size)
            if line:
                _write(
                    page,
                    fonts,
                    spec,
                    (node.x - advance / 2, top + index * step),
                    line,
                    size,
                    opacity,
                )
    labels = [route.label for route in layout.routes if route.label.strip()]
    for route in layout.routes:
        if route.label.strip():
            box = _label_box(route, fonts, size)
            _write(
                page,
                fonts,
                spec,
                (box.x0, box.y0),
                route.label.strip(),
                size * LABEL_SCALE,
                opacity,
            )
    text = "".join(node.text for node in spec.nodes) + "".join(labels)
    return document, fonts.missing(text, "")


@op("editor.flowchart_preview", FlowchartSpec)
def flowchart_preview(params: FlowchartSpec, _progress: Progress) -> FlowchartPreviewResult:
    document, missing = flowchart_pdf(params)
    try:
        page = document[0]
        return FlowchartPreviewResult(
            svg=page.get_svg_image(text_as_path=True),
            width=page.rect.width,
            height=page.rect.height,
            missing_glyphs=missing,
        )
    finally:
        document.close()
