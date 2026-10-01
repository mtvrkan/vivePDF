import base64
import io
from pathlib import Path

import pymupdf
from PIL import Image
from pydantic import Field

from vivepdf.ops._document import open_document, unwrap_document
from vivepdf.ops._pixmaps import png_ready
from vivepdf.ops.convert import _image_bytes
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class ImageAtParams(RpcModel):
    path: str
    password: str | None = None
    page: int = Field(ge=1)
    x: float
    y: float
    preview_max_side: int | None = Field(default=None, ge=32, le=4096)


class ImageAtResult(RpcModel):
    found: bool
    xref: int | None = None
    width: int | None = None
    height: int | None = None
    ext: str | None = None
    rect: list[float] | None = None
    png_base64: str | None = None


class ImageSaveParams(ImageAtParams):
    output: str
    overwrite: bool = False


class ImageSaveResult(RpcModel):
    output: str
    ext: str
    width: int
    height: int
    bytes: int


def _visible(page: pymupdf.Page, rect: pymupdf.Rect) -> list[float]:
    shown = rect * page.rotation_matrix if page.rotation else pymupdf.Rect(rect)
    shown.normalize()
    return [round(shown.x0, 2), round(shown.y0, 2), round(shown.x1, 2), round(shown.y1, 2)]


def _image_under_point(page: pymupdf.Page, x: float, y: float) -> dict | None:
    point = pymupdf.Point(x, y)
    if page.rotation:
        point = point * page.derotation_matrix
    hits = [
        info
        for info in page.get_image_info(xrefs=True)
        if info.get("xref") and pymupdf.Rect(info["bbox"]).contains(point)
    ]
    if not hits:
        return None
    return min(hits, key=lambda info: pymupdf.Rect(info["bbox"]).get_area())


def _smask(document: pymupdf.Document, xref: int) -> int:
    try:
        kind, value = document.xref_get_key(xref, "SMask")
    except RuntimeError:
        return 0
    if kind != "xref":
        return 0
    try:
        return int(value.split()[0])
    except (ValueError, IndexError):
        return 0


def _payload(document: pymupdf.Document, xref: int) -> tuple[bytes, str] | None:
    return _image_bytes(document, xref, _smask(document, xref))


def _png(
    document: pymupdf.Document, xref: int, data: bytes, ext: str, max_side: int | None = None
) -> bytes:
    if ext == "png" and max_side is None:
        return data
    pixmap = pymupdf.Pixmap(document, xref)
    pixmap = png_ready(pixmap)
    png = pixmap.tobytes("png")
    if max_side is None or max(pixmap.width, pixmap.height) <= max_side:
        return png
    with Image.open(io.BytesIO(png)) as image:
        image.thumbnail((max_side, max_side))
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()


@op("images.at", ImageAtParams)
def image_at(params: ImageAtParams, _progress: Progress) -> ImageAtResult:
    with open_document(params.path, params.password, mutable=False) as cached:
        document = unwrap_document(cached)
        if params.page > document.page_count:
            raise OpError(ErrorCode.INVALID_PARAMS, "page out of range", {"reason": "page"})
        page = document[params.page - 1]
        hit = _image_under_point(page, params.x, params.y)
        if hit is None:
            return ImageAtResult(found=False)
        xref = int(hit["xref"])
        payload = _payload(document, xref)
        if payload is None:
            return ImageAtResult(found=False)
        data, ext = payload
        return ImageAtResult(
            found=True,
            xref=xref,
            width=int(hit.get("width") or 0),
            height=int(hit.get("height") or 0),
            ext=ext,
            rect=_visible(page, pymupdf.Rect(hit["bbox"])),
            png_base64=base64.b64encode(
                _png(document, xref, data, ext, params.preview_max_side)
            ).decode("ascii"),
        )


@op("images.save", ImageSaveParams)
def image_save(params: ImageSaveParams, _progress: Progress) -> ImageSaveResult:
    output = Path(params.output)
    if output.exists() and not params.overwrite:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"output already exists: {output.name}",
            {"exists": True, "path": str(output)},
        )
    with open_document(params.path, params.password) as document:
        if params.page > document.page_count:
            raise OpError(ErrorCode.INVALID_PARAMS, "page out of range", {"reason": "page"})
        page = document[params.page - 1]
        hit = _image_under_point(page, params.x, params.y)
        payload = _payload(document, int(hit["xref"])) if hit else None
        if hit is None or payload is None:
            raise OpError(ErrorCode.INVALID_PARAMS, "no image at point", {"reason": "noImage"})
        data, ext = payload
        if output.suffix.lower() == ".png" and ext != "png":
            data = _png(document, int(hit["xref"]), data, ext)
            ext = "png"
        elif output.suffix.lower() not in (f".{ext}", ".jpeg" if ext == "jpg" else f".{ext}"):
            output = output.with_suffix(f".{ext}")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
        return ImageSaveResult(
            output=str(output),
            ext=ext,
            width=int(hit.get("width") or 0),
            height=int(hit.get("height") or 0),
            bytes=len(data),
        )
