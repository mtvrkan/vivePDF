from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._form_appearance import UnicodeAppearance, is_signed_field
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._visibility import drop_unseen
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

RasterFormat = Literal["auto", "jpeg", "png"]


class FlattenParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    annotations: bool = True
    forms: bool = True
    keep_links: bool = True
    rasterize: bool = False
    dpi: int = Field(default=150, ge=72, le=400)
    image_format: RasterFormat = "auto"
    jpeg_quality: int = Field(default=85, ge=30, le=100)
    printed_only: bool = False


class FlattenResult(OutputResult):
    fields: int
    annotations: int
    signatures: int = 0
    hidden_annotations: int = 0
    xfa: bool = False


def _catalog_flag(document: pymupdf.Document, key: str) -> bool:
    return document.xref_get_key(document.pdf_catalog(), key)[0] not in ("null", "")


def _needs_appearances(document: pymupdf.Document) -> bool:
    return document.xref_get_key(document.pdf_catalog(), "AcroForm/NeedAppearances") == (
        "bool",
        "true",
    )


def _has_appearance(document: pymupdf.Document, xref: int) -> bool:
    return document.xref_get_key(xref, "AP/N")[0] not in ("null", "")


def _regenerate_appearances(document: pymupdf.Document, progress: Progress) -> tuple[int, int]:
    stale = _needs_appearances(document)
    appearance = UnicodeAppearance(document)
    fields = 0
    signatures = 0
    for page in document:
        progress.check_cancelled()
        for widget in page.widgets():
            if widget.field_type == pymupdf.PDF_WIDGET_TYPE_SIGNATURE:
                signatures += is_signed_field(document, widget)
                continue
            fields += 1
            if not stale and _has_appearance(document, widget.xref):
                continue
            try:
                widget.update()
            except (ValueError, RuntimeError):
                continue
            appearance.redraw(widget)
    appearance.finish()
    return fields, signatures


def encode_page_picture(
    pixmap: pymupdf.Pixmap, image_format: RasterFormat, jpeg_quality: int
) -> bytes | None:
    if image_format == "png":
        return None
    jpeg = pixmap.tobytes("jpeg", jpg_quality=jpeg_quality)
    if image_format == "jpeg":
        return jpeg
    return jpeg if len(jpeg) < len(pixmap.tobytes("png")) else None


def _rasterize(
    document: pymupdf.Document,
    dpi: int,
    progress: Progress,
    image_format: RasterFormat = "png",
    jpeg_quality: int = 85,
) -> None:
    for index in range(document.page_count):
        progress.check_cancelled()
        page = document[index]
        pixmap = page.get_pixmap(dpi=dpi)
        encoded = encode_page_picture(pixmap, image_format, jpeg_quality)
        size = page.rect
        links = page.get_links()
        for link in links:
            page.delete_link(link)
        document.xref_set_key(page.xref, "Contents", "null")
        document.xref_set_key(page.xref, "Resources", "<<>>")
        page.set_rotation(0)
        page.set_mediabox(pymupdf.Rect(0, 0, size.width, size.height))
        page = document.reload_page(page)
        if encoded is None:
            page.insert_image(page.rect, pixmap=pixmap)
        else:
            page.insert_image(page.rect, stream=encoded)
        for link in links:
            page.insert_link(link)
        if index % 10 == 0:
            progress.report(
                0.3 + 0.5 * index / document.page_count,
                "progress.rendering",
                {"current": index + 1, "total": document.page_count},
            )


@op("security.flatten", FlattenParams)
def flatten(params: FlattenParams, progress: Progress) -> FlattenResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        forms = params.forms or params.rasterize
        marks = params.annotations or params.rasterize
        xfa = _catalog_flag(document, "AcroForm/XFA")
        hidden = drop_unseen(document, progress, params.printed_only, marks, forms)
        fields, signatures = _regenerate_appearances(document, progress) if forms else (0, 0)
        annotations = sum(1 for page in document for _ in page.annots()) if marks else 0
        progress.report(0.3, "progress.flattening")
        document.bake(annots=marks, widgets=forms)
        if not params.keep_links:
            for page in document:
                for link in page.get_links():
                    page.delete_link(link)
        if params.rasterize:
            _rasterize(document, params.dpi, progress, params.image_format, params.jpeg_quality)
        progress.report(0.8, "progress.saving")
        saved = save_document(document, target)
    return FlattenResult(
        **saved.model_dump(),
        fields=fields,
        annotations=annotations,
        signatures=signatures,
        hidden_annotations=hidden,
        xfa=xfa,
    )
