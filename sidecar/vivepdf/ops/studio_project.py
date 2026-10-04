import base64
from pathlib import Path

import pymupdf

from vivepdf.ops._output import prepare_data_output, write_atomically
from vivepdf.ops._studio_models import (
    StudioDesignOfResult,
    StudioPage,
    StudioProjectOpenParams,
    StudioProjectOpenResult,
    StudioProjectSaveParams,
    StudioProjectSaveResult,
    StudioThumbnailParams,
    StudioThumbnailResult,
)
from vivepdf.ops._studio_project import (
    CATALOG_KEY,
    MAX_PROJECT_BYTES,
    PROJECT_EXTENSION,
    build_archive,
    embedded_archive,
    read_archive,
    refusal,
    too_large,
)
from vivepdf.ops._studio_text import TextFaces
from vivepdf.ops._studio_thumbnails import cached_thumbnail
from vivepdf.ops.studio import Cache, draw_page
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.registry import op

THUMBNAIL_SIDE = 320
PDF_SIGNATURE = b"%PDF"


def _thumbnail(page_spec: StudioPage, language: str) -> bytes:
    return _rendered_thumbnail(page_spec, language, THUMBNAIL_SIDE)[0]


def _rendered_thumbnail(page_spec: StudioPage, language: str, side: int) -> tuple[bytes, int, int]:
    cache: Cache = {}
    faces: dict[str | None, TextFaces] = {}
    document = pymupdf.open()
    try:
        draw_page(document, page_spec, 0, {}, language, cache, faces)
        page = document[0]
        scale = side / max(page.rect.width, page.rect.height)
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
        return pixmap.tobytes(output="jpg", jpg_quality=80), pixmap.width, pixmap.height
    finally:
        document.close()
        for source, _ in cache.values():
            source.close()


def _missing(path: str) -> OpError:
    return OpError(ErrorCode.FILE_NOT_FOUND, f"file not found: {Path(path).name}", {"path": path})


def _is_pdf(path: Path) -> bool:
    with path.open("rb") as handle:
        return handle.read(len(PDF_SIGNATURE)) == PDF_SIGNATURE


def _pdf_archive(path: Path, password: str | None) -> bytes | None:
    try:
        document = pymupdf.open(str(path))
    except Exception as error:  # noqa: BLE001
        raise OpError(ErrorCode.INVALID_PDF, f"{path.name} could not be read") from error
    with document:
        if document.needs_pass and not (password and document.authenticate(password)):
            raise OpError(ErrorCode.NEEDS_PASSWORD, f"{path.name} needs a password")
        return embedded_archive(document)


@op("studio.save_project", StudioProjectSaveParams)
def save_project(params: StudioProjectSaveParams, progress: Progress) -> StudioProjectSaveResult:
    target = prepare_data_output(params.output, PROJECT_EXTENSION, params.overwrite)
    progress.report(0.1, "progress.rendering")
    thumbnail = _thumbnail(params.preview, params.language) if params.preview else b""
    progress.check_cancelled()
    progress.report(0.5, "progress.saving")
    archive = build_archive(params.design, params.assets, thumbnail)
    write_atomically(target, lambda path: path.write_bytes(archive))
    return StudioProjectSaveResult(
        output=str(target),
        bytes=len(archive),
        thumbnail=base64.b64encode(thumbnail).decode("ascii"),
    )


@op("studio.thumbnail", StudioThumbnailParams)
def render_thumbnail(params: StudioThumbnailParams, _progress: Progress) -> StudioThumbnailResult:
    image, width, height = cached_thumbnail(
        params.page,
        params.language,
        params.side,
        lambda: _rendered_thumbnail(params.page, params.language, params.side),
    )
    return StudioThumbnailResult(
        image=base64.b64encode(image).decode("ascii"), width=width, height=height
    )


@op("studio.open_project", StudioProjectOpenParams)
def open_project(params: StudioProjectOpenParams, _progress: Progress) -> StudioProjectOpenResult:
    source = Path(params.path)
    if not source.is_file():
        raise _missing(params.path)
    if source.stat().st_size > MAX_PROJECT_BYTES * 2:
        raise too_large()
    if _is_pdf(source):
        archive = _pdf_archive(source, params.password)
        if archive is None:
            raise refusal("noDesign", f"{source.name} holds no Studio design")
        design, thumbnail = read_archive(archive, source.name)
        kind = "pdf"
    else:
        design, thumbnail = read_archive(source, source.name)
        kind = "project"
    return StudioProjectOpenResult(
        design=design, thumbnail=base64.b64encode(thumbnail).decode("ascii"), source=kind
    )


@op("studio.design_of", StudioProjectOpenParams)
def design_of(params: StudioProjectOpenParams, _progress: Progress) -> StudioDesignOfResult:
    source = Path(params.path)
    if not source.is_file() or not _is_pdf(source):
        return StudioDesignOfResult(found=False)
    try:
        document = pymupdf.open(str(source))
    except Exception:  # noqa: BLE001
        return StudioDesignOfResult(found=False)
    with document:
        if document.needs_pass and not (params.password and document.authenticate(params.password)):
            return StudioDesignOfResult(found=False)
        catalog = document.pdf_catalog()
        found = catalog > 0 and document.xref_get_key(catalog, CATALOG_KEY)[0] == "xref"
    return StudioDesignOfResult(found=found)
