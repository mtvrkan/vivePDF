import base64

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document, unwrap_document
from vivepdf.ops.compress import (
    CUSTOM_DPI_DEFAULT,
    CUSTOM_QUALITY_DEFAULT,
    Profile,
    image_settings,
    rewrite_options,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

PREVIEW_QUALITY = 92
MEASURE_OPTIONS = {"garbage": 3, "deflate": True, "deflate_images": True, "use_objstms": True}


class CompressPreviewParams(RpcModel):
    path: str
    password: str | None = None
    page: int = Field(default=0, ge=0)
    profile: Profile = "balanced"
    custom_dpi: int = Field(default=CUSTOM_DPI_DEFAULT, ge=36, le=600)
    custom_quality: int = Field(default=CUSTOM_QUALITY_DEFAULT, ge=10, le=95)
    grayscale: bool = False
    dpi: int = Field(default=110, ge=50, le=200)


class CompressPreviewResult(RpcModel):
    before: str
    after: str
    width: int
    height: int
    page_count: int
    bytes_before: int
    bytes_after: int


def _rendered(page: pymupdf.Page, dpi: int) -> tuple[str, int, int]:
    pixmap = page.get_pixmap(dpi=dpi, alpha=False)
    encoded = base64.b64encode(pixmap.tobytes("jpeg", jpg_quality=PREVIEW_QUALITY)).decode("ascii")
    return encoded, pixmap.width, pixmap.height


def _single_page(params: CompressPreviewParams) -> tuple[pymupdf.Document, int]:
    with open_document(params.path, params.password, mutable=False) as cached:
        document = unwrap_document(cached)
        if params.page >= document.page_count:
            raise OpError(ErrorCode.INVALID_PARAMS, "page out of range", {"reason": "page"})
        single = pymupdf.open()
        single.insert_pdf(document, from_page=params.page, to_page=params.page)
        return single, document.page_count


@op("compress.preview", CompressPreviewParams)
def compress_preview(params: CompressPreviewParams, progress: Progress) -> CompressPreviewResult:
    single, page_count = _single_page(params)
    try:
        progress.check_cancelled()
        before, width, height = _rendered(single[0], params.dpi)
        bytes_before = len(single.tobytes(**MEASURE_OPTIONS))
        progress.check_cancelled()
        if params.grayscale:
            single.recolor(1)
        settings = image_settings(params.profile, params.custom_dpi, params.custom_quality)
        if settings is not None:
            single.rewrite_images(**rewrite_options(settings))
        progress.check_cancelled()
        after, _, _ = _rendered(single[0], params.dpi)
        return CompressPreviewResult(
            before=before,
            after=after,
            width=width,
            height=height,
            page_count=page_count,
            bytes_before=bytes_before,
            bytes_after=len(single.tobytes(**MEASURE_OPTIONS)),
        )
    finally:
        single.close()
