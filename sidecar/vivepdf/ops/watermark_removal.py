from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._original_fonts import FontCodes
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._watermark_scan_removal import _repaint_scan
from vivepdf.ops._watermark_structure_removal import (
    _forget_layers,
    _pages_using,
    _remove_annotations,
    _remove_image,
    _remove_structures,
    _repeated_image_xrefs,
    shared_holders,
)
from vivepdf.ops._watermark_text_removal import _remove_text
from vivepdf.ops.watermark_detection import (
    STAMP_ANNOT_TYPES,
    WATERMARK_ANNOT_TYPES,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class RemoveWatermarkParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    text: str | None = None
    texts: list[str] = Field(default_factory=list)
    annotations: bool = True
    stamp_annotations: bool = False
    repeated_images: bool = True
    image_digests: list[str] = Field(default_factory=list)
    tagged: bool = False
    artifacts: bool = False
    layers: list[int] = Field(default_factory=list)
    raster: bool = False
    pages: str | None = None


class RemoveWatermarkResult(OutputResult):
    removed_text: int = 0
    removed_annotations: int = 0
    removed_images: int = 0
    removed_marks: int = 0
    repainted_pages: int = 0
    solid_ink_pages: int = 0


@op("security.remove_watermark", RemoveWatermarkParams)
def remove_watermark(params: RemoveWatermarkParams, progress: Progress) -> RemoveWatermarkResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    needle = (params.text or "").strip()
    if (
        not needle
        and not any(item.strip() for item in params.texts)
        and not params.annotations
        and not params.stamp_annotations
        and not params.repeated_images
        and not params.image_digests
        and not params.tagged
        and not params.artifacts
        and not params.layers
        and not params.raster
    ):
        raise OpError(ErrorCode.INVALID_PARAMS, "nothing selected to remove")
    needles = [value for value in [needle, *(item.strip() for item in params.texts)] if value]
    removed_text = removed_annotations = removed_images = removed_marks = 0
    repainted = solid_left = 0
    layers = {layer for layer in params.layers if layer > 0}
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        selected_digests = {digest for digest in params.image_digests if digest}
        shared = shared_holders(document)
        codes = FontCodes(document)
        repeated = (
            _repeated_image_xrefs(document, indices, selected_digests or None)
            if params.repeated_images or selected_digests
            else {}
        )
        chosen = set(indices)
        users = _pages_using(document, {xref for xrefs in repeated.values() for xref in xrefs})
        annotation_types = (
            *(WATERMARK_ANNOT_TYPES if params.annotations else ()),
            *(STAMP_ANNOT_TYPES if params.stamp_annotations else ()),
        )
        for position, index in enumerate(indices):
            progress.check_cancelled()
            page = document[index]
            if annotation_types:
                removed_annotations += _remove_annotations(page, annotation_types)
            removed_marks += _remove_structures(
                document, page, layers, params.tagged, params.artifacts, shared
            )
            for xref in sorted(repeated.get(index, ())):
                if _remove_image(document, page, xref, not users[xref] <= chosen):
                    removed_images += 1
            if needles:
                removed_text += _remove_text(page, needles, codes)
            if position % 20 == 0:
                progress.report(
                    position / len(indices),
                    "progress.cleaning",
                    {"current": position + 1, "total": len(indices)},
                )
        if layers and removed_marks and len(chosen) == document.page_count:
            _forget_layers(document, layers)
        if params.raster:
            repainted, solid_left = _repaint_scan(document, indices, progress)
        progress.report(0.9, "progress.saving")
        saved = save_document(document, target)
    return RemoveWatermarkResult(
        **saved.model_dump(),
        removed_text=removed_text,
        removed_annotations=removed_annotations,
        removed_images=removed_images,
        removed_marks=removed_marks,
        repainted_pages=repainted,
        solid_ink_pages=solid_left,
    )
