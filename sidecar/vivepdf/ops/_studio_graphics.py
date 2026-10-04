from typing import Annotated, Literal

import pymupdf
from pydantic import Field

from vivepdf.ops.create_bulk import PLACEHOLDER, fill_placeholders
from vivepdf.ops.editor_chart import ChartSpec, chart_pdf
from vivepdf.ops.editor_flowchart import FlowchartSpec, flowchart_pdf
from vivepdf.ops.editor_table import TableSpec, table_pdf
from vivepdf.rpc.protocol import RpcModel

FIT_TOLERANCE = 0.5


class StudioTableGraphic(RpcModel):
    kind: Literal["table"]
    spec: TableSpec


class StudioChartGraphic(RpcModel):
    kind: Literal["chart"]
    spec: ChartSpec


class StudioFlowchartGraphic(RpcModel):
    kind: Literal["flowchart"]
    spec: FlowchartSpec


StudioGraphic = Annotated[
    StudioTableGraphic | StudioChartGraphic | StudioFlowchartGraphic,
    Field(discriminator="kind"),
]


def graphic_has_placeholders(graphic: StudioGraphic) -> bool:
    if not isinstance(graphic, StudioTableGraphic):
        return False
    return any(PLACEHOLDER.search(text) for row in graphic.spec.cells for text in row)


def _filled_table(spec: TableSpec, values: dict[str, str]) -> TableSpec:
    cells = [[fill_placeholders(text, values) for text in row] for row in spec.cells]
    return spec.model_copy(update={"cells": cells})


def _fitted(document: pymupdf.Document, width: float, height: float) -> pymupdf.Document:
    source = document[0].rect
    wanted = source.width * height / width
    if abs(source.height - wanted) <= FIT_TOLERANCE:
        return document
    scale = min(1.0, wanted / source.height)
    placed_width = source.width * scale
    left = (source.width - placed_width) / 2
    fitted = pymupdf.open()
    page = fitted.new_page(width=source.width, height=wanted)
    page.show_pdf_page(
        pymupdf.Rect(left, 0, left + placed_width, source.height * scale),
        document,
        0,
        keep_proportion=False,
    )
    document.close()
    return fitted


def graphic_document(
    graphic: StudioGraphic, values: dict[str, str], width: float, height: float
) -> pymupdf.Document:
    if isinstance(graphic, StudioTableGraphic):
        if not graphic_has_placeholders(graphic):
            return table_pdf(graphic.spec)[0]
        document = table_pdf(_filled_table(graphic.spec, values))[0]
        return _fitted(document, width, height)
    if isinstance(graphic, StudioChartGraphic):
        return chart_pdf(graphic.spec)[0]
    return flowchart_pdf(graphic.spec)[0]
