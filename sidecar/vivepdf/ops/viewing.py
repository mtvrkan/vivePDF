import time
import uuid
from pathlib import Path

import pymupdf
from pydantic import Field

from vivepdf.ops._appdata import user_data_dir
from vivepdf.ops._document import open_document, unwrap_document
from vivepdf.ops._inplace import rewrite_in_place
from vivepdf.ops._layers import apply_layer_choices, restore_layer_state
from vivepdf.ops._output import deduplicate_annotation_names
from vivepdf.ops._view_fonts import (
    restore_display_fonts,
    scan_display_fonts,
    substitute_display_fonts,
)
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

VIEW_COPY_LIFETIME = 24 * 60 * 60


class ViewSourceParams(RpcModel):
    path: str
    password: str | None = None


class LayerChoice(RpcModel):
    id: int
    on: bool


class ViewPrepareParams(ViewSourceParams):
    layers: list[LayerChoice] | None = Field(default=None, max_length=10000)


class ViewPrepareResult(RpcModel):
    view_path: str | None = None
    renamed: int = 0
    fonts: int = 0
    layers: int = 0


class ViewRestoreResult(RpcModel):
    restored: int = 0


def has_repeated_annotation_names(document: pymupdf.Document) -> bool:
    seen: set[str] = set()
    for page in document:
        for xref, _kind, _name in page.annot_xrefs():
            if xref <= 0:
                continue
            kind, value = document.xref_get_key(xref, "NM")
            if kind != "string" or not value:
                continue
            if value in seen:
                return True
            seen.add(value)
    return False


def view_copy_dir() -> Path:
    directory = user_data_dir() / "view-copies"
    directory.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - VIEW_COPY_LIFETIME
    for stale in directory.glob("*.pdf"):
        try:
            if stale.stat().st_mtime < cutoff:
                stale.unlink()
        except OSError:
            continue
    return directory


@op("viewer.prepare", ViewPrepareParams)
def prepare_view(params: ViewPrepareParams, progress: Progress) -> ViewPrepareResult:
    choices = {choice.id: choice.on for choice in params.layers or []}
    with open_document(params.path, params.password, mutable=False) as cached:
        source = unwrap_document(cached)
        repeated = has_repeated_annotation_names(source)
        fonts = scan_display_fonts(source, progress)
        if not repeated and not fonts and not choices:
            return ViewPrepareResult()
    with open_document(params.path, params.password) as document:
        renamed = deduplicate_annotation_names(document) if repeated else 0
        substituted = substitute_display_fonts(document, fonts, progress) if fonts else 0
        layers = apply_layer_choices(document, choices) if choices else 0
        if not renamed and not substituted and not layers:
            return ViewPrepareResult()
        target = view_copy_dir() / f"{uuid.uuid4().hex}.pdf"
        document.save(target, encryption=pymupdf.PDF_ENCRYPT_KEEP)
    return ViewPrepareResult(
        view_path=str(target), renamed=renamed, fonts=substituted, layers=layers
    )


@op("viewer.restore", ViewSourceParams)
def restore_view(params: ViewSourceParams, _progress: Progress) -> ViewRestoreResult:
    document = open_document(params.path, params.password)
    try:
        restored = restore_display_fonts(document) + restore_layer_state(document)
        if restored:
            rewrite_in_place(document, params.path)
        return ViewRestoreResult(restored=restored)
    finally:
        if not document.is_closed:
            document.close()
