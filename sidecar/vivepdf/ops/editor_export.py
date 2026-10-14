import base64
from typing import Literal

import pymupdf
from pydantic import Field, model_validator

from vivepdf.ops._output import prepare_data_output, write_atomically
from vivepdf.ops._pixmaps import png_ready
from vivepdf.ops._svg import drawing_pdf, placed_svg
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.paths import WritePath
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MAX_DRAWING_SVG_CHARS = 4_000_000
MAX_SIDE_POINTS = 14_400.0
PIXELS_PER_POINT = 4 / 3
MAX_PIXEL_SIDE = 12_000
MAX_PIXELS = 80_000_000


class DrawingImageParams(RpcModel):
    svg: str = Field(min_length=1, max_length=MAX_DRAWING_SVG_CHARS)
    width: float = Field(gt=0, le=MAX_SIDE_POINTS)
    height: float = Field(gt=0, le=MAX_SIDE_POINTS)
    format: Literal["png", "svg"] = "png"
    scale: float = Field(default=2.0, ge=0.25, le=8.0)
    output: WritePath | None = None
    overwrite: bool = False

    @model_validator(mode="after")
    def _svg_needs_output(self) -> "DrawingImageParams":
        if self.format == "svg" and not self.output:
            raise ValueError("an svg export needs an output path")
        return self


class DrawingImageResult(RpcModel):
    output: str | None = None
    width: int
    height: int
    bytes: int
    png_base64: str | None = None


def pixel_size(width: float, height: float, scale: float) -> tuple[int, int]:
    wide = width * PIXELS_PER_POINT * scale
    tall = height * PIXELS_PER_POINT * scale
    shrink = min(1.0, MAX_PIXEL_SIDE / max(wide, tall), (MAX_PIXELS / (wide * tall)) ** 0.5)
    return max(1, round(wide * shrink)), max(1, round(tall * shrink))


def _png(raw: bytes, width: int, height: int) -> bytes:
    with drawing_pdf(raw, "drawing") as document:
        page = document[0]
        matrix = pymupdf.Matrix(width / page.rect.width, height / page.rect.height)
        pixmap = png_ready(page.get_pixmap(matrix=matrix, alpha=True))
        return pixmap.tobytes("png")


@op("editor.drawing_image", DrawingImageParams)
def drawing_image(params: DrawingImageParams, _progress: Progress) -> DrawingImageResult:
    raw = params.svg.encode("utf-8")
    if params.format == "svg":
        payload = placed_svg(raw, "drawing", params.width, params.height)
        width, height = round(params.width), round(params.height)
    else:
        width, height = pixel_size(params.width, params.height, params.scale)
        try:
            payload = _png(raw, width, height)
        except OpError:
            raise
        except Exception as error:  # noqa: BLE001
            raise OpError(
                ErrorCode.INVALID_PARAMS, "the drawing could not be drawn", {"reason": "notSvg"}
            ) from error
    if not params.output:
        return DrawingImageResult(
            width=width,
            height=height,
            bytes=len(payload),
            png_base64=base64.b64encode(payload).decode("ascii"),
        )
    target = prepare_data_output(params.output, params.format, params.overwrite)
    write_atomically(target, lambda partial: partial.write_bytes(payload))
    return DrawingImageResult(output=str(target), width=width, height=height, bytes=len(payload))
