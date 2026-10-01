import base64
import io
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageFilter, ImageOps
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._output import prepare_output, save_document
from vivepdf.ops._placement import insertion_matrix
from vivepdf.ops.photo import otsu_threshold
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MAX_SIGNATURE_SIDE = 1600
PADDING = 12


class SignatureCleanParams(RpcModel):
    path: str
    ink_color: str | None = None


class SignatureCleanResult(RpcModel):
    png_base64: str
    width: int
    height: int


def _rgb(value: str) -> tuple[int, int, int]:
    raw = value.lstrip("#")
    if len(raw) != 6:
        return (20, 20, 40)
    return (int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16))


def clean_signature(image: Image.Image, ink_color: str | None) -> Image.Image:
    image = ImageOps.exif_transpose(image).convert("RGB")
    scale = min(1.0, MAX_SIGNATURE_SIDE / max(image.size))
    if scale < 1:
        image = image.resize((max(1, int(image.width * scale)), max(1, int(image.height * scale))))
    gray = np.asarray(
        ImageOps.grayscale(image).filter(ImageFilter.GaussianBlur(radius=0.6)), dtype=np.uint8
    )
    threshold = otsu_threshold(gray)
    ink = gray < threshold
    if not ink.any():
        raise OpError(ErrorCode.INVALID_PARAMS, "no ink found in the image", {"reason": "noInk"})
    darkness = np.clip((threshold - gray.astype(np.float64)) / max(1.0, threshold * 0.6), 0, 1)
    alpha = (darkness * 255).astype(np.uint8)
    alpha[~ink] = 0
    if ink_color:
        color = np.zeros((*gray.shape, 3), dtype=np.uint8)
        color[:] = _rgb(ink_color)
    else:
        color = np.asarray(image, dtype=np.uint8)
    rgba = np.dstack([color, alpha])
    ys, xs = np.nonzero(alpha > 40)
    top = max(0, int(ys.min()) - PADDING)
    bottom = min(gray.shape[0], int(ys.max()) + PADDING + 1)
    left = max(0, int(xs.min()) - PADDING)
    right = min(gray.shape[1], int(xs.max()) + PADDING + 1)
    return Image.fromarray(rgba[top:bottom, left:right], mode="RGBA")


@op("signature.clean", SignatureCleanParams)
def clean(params: SignatureCleanParams, _progress: Progress) -> SignatureCleanResult:
    source = Path(params.path)
    if not source.is_file():
        raise OpError(
            ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}", {"path": params.path}
        )
    try:
        with Image.open(source) as opened:
            cleaned = clean_signature(opened, params.ink_color)
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"cannot read image: {source.name}",
            {"reason": "imageUnreadable", "path": params.path},
        ) from error
    buffer = io.BytesIO()
    cleaned.save(buffer, format="PNG", optimize=True)
    return SignatureCleanResult(
        png_base64=base64.b64encode(buffer.getvalue()).decode("ascii"),
        width=cleaned.width,
        height=cleaned.height,
    )


class SignaturePlacement(RpcModel):
    page: int = Field(ge=1)
    x0: float
    y0: float
    x1: float
    y1: float
    png_base64: str = Field(min_length=8)


class SignaturePlaceParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    placements: list[SignaturePlacement] = Field(min_length=1)


class SignaturePlaceResult(RpcModel):
    output: str
    page_count: int
    bytes: int
    placed: int


@op("signature.place", SignaturePlaceParams)
def place(params: SignaturePlaceParams, progress: Progress) -> SignaturePlaceResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        for index, item in enumerate(params.placements):
            progress.check_cancelled()
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
            try:
                data = base64.b64decode(item.png_base64)
            except ValueError as error:
                raise OpError(
                    ErrorCode.INVALID_PARAMS, "signature image is not valid base64"
                ) from error
            page = document[item.page - 1]
            rect = pymupdf.Rect(item.x0, item.y0, item.x1, item.y1)
            rect.normalize()
            page.insert_image(
                rect * insertion_matrix(page),
                stream=data,
                keep_proportion=True,
                rotate=page.rotation,
                overlay=True,
            )
            progress.report(
                (index + 1) / len(params.placements),
                "progress.placing",
                {"current": index + 1, "total": len(params.placements)},
            )
        progress.report(0.95, "progress.saving")
        saved = save_document(document, target)
        return SignaturePlaceResult(
            output=saved.output,
            page_count=saved.page_count,
            bytes=saved.bytes,
            placed=len(params.placements),
        )
