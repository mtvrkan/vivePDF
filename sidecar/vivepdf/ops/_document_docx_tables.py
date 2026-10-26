import re
from collections.abc import Callable
from dataclasses import dataclass

from lxml import etree

from vivepdf.ops._document_docx_xml import element, shading, twips

SHADE = "#f3f4f6"
MAX_SPAN = 100
WIDTH = re.compile(r"(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)pt", re.IGNORECASE)
CELL_PADDING = {"top": 3.0, "bottom": 3.0, "left": 5.0, "right": 5.0}


@dataclass
class Placed:
    node: etree._Element | None
    column: int
    span: int
    rows: int
    header: bool


def _span(node: etree._Element, name: str) -> int:
    try:
        return min(MAX_SPAN, max(1, int(node.get(name) or 1)))
    except ValueError:
        return 1


def _grid(rows: list[etree._Element]) -> tuple[list[list[Placed]], int]:
    placed: list[list[Placed]] = []
    carried: dict[int, tuple[int, int]] = {}
    width = 0
    for row in rows:
        cells = [cell for cell in row if isinstance(cell.tag, str) and cell.tag in ("td", "th")]
        line: list[Placed] = []
        column = 0
        queue = list(cells)
        while queue or any(start >= column for start in carried):
            if column in carried:
                remaining, span = carried[column]
                line.append(Placed(None, column, span, remaining, False))
                if remaining > 1:
                    carried[column] = (remaining - 1, span)
                else:
                    del carried[column]
                column += span
                continue
            if not queue:
                column += 1
                continue
            cell = queue.pop(0)
            span, rows_down = _span(cell, "colspan"), _span(cell, "rowspan")
            line.append(Placed(cell, column, span, rows_down, cell.tag == "th"))
            if rows_down > 1:
                carried[column] = (rows_down - 1, span)
            column += span
        width = max(width, column)
        placed.append(line)
    return placed, width


def _widths(placed: list[list[Placed]], columns: int, available: float) -> list[float]:
    found: list[float | None] = [None] * columns
    for line in placed:
        for cell in line:
            if cell.node is None:
                continue
            match = WIDTH.search(cell.node.get("style") or "")
            if match and cell.span == 1 and found[cell.column] is None:
                found[cell.column] = float(match.group(1))
    known = sum(value for value in found if value is not None)
    missing = [index for index, value in enumerate(found) if value is None]
    share = max(available - known, 0) / len(missing) if missing else 0
    widths = [value if value is not None else share for value in found]
    if not missing or share <= 0:
        widths = [value or available / columns for value in widths]
    total = sum(widths)
    return (
        [value * available / total for value in widths]
        if total > available or not missing
        else widths
    )


def table(
    node: etree._Element,
    available: float,
    fill: Callable[[etree._Element, etree._Element, bool], None],
) -> etree._Element | None:
    rows = [row for row in node.iter("tr")]
    placed, columns = _grid(rows)
    if not columns:
        return None
    widths = _widths(placed, columns, available)
    properties = element(
        "w:tblPr",
        children=[
            element("w:tblStyle", {"w:val": "TableGrid"}),
            element("w:tblW", {"w:w": twips(sum(widths)), "w:type": "dxa"}),
            element("w:tblLayout", {"w:type": "fixed"}),
            element(
                "w:tblCellMar",
                children=[
                    element(f"w:{side}", {"w:w": twips(points), "w:type": "dxa"})
                    for side, points in CELL_PADDING.items()
                ],
            ),
        ],
    )
    grid = element(
        "w:tblGrid", children=[element("w:gridCol", {"w:w": twips(width)}) for width in widths]
    )
    result = element("w:tbl", children=[properties, grid])
    for index, line in enumerate(placed):
        header = (
            index == 0 and bool(line) and all(cell.header or cell.node is None for cell in line)
        )
        row = element("w:tr")
        if header:
            row.append(element("w:trPr", children=[element("w:tblHeader")]))
        for cell in line:
            span_width = sum(widths[cell.column : cell.column + cell.span])
            cell_properties = [element("w:tcW", {"w:w": twips(span_width), "w:type": "dxa"})]
            if cell.span > 1:
                cell_properties.append(element("w:gridSpan", {"w:val": str(cell.span)}))
            if cell.node is None:
                cell_properties.append(element("w:vMerge"))
            elif cell.rows > 1:
                cell_properties.append(element("w:vMerge", {"w:val": "restart"}))
            if cell.header:
                cell_properties.append(shading(SHADE))
            box = element("w:tc", children=[element("w:tcPr", children=cell_properties)])
            if cell.node is not None:
                fill(cell.node, box, cell.header)
            if box.find("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p") is None:
                box.append(element("w:p"))
            row.append(box)
        result.append(row)
    return result
