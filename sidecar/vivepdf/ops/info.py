import base64
from pathlib import Path

import pymupdf

from vivepdf.ops._document import open_document
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._reading_text import reading_text
from vivepdf.ops.pages import page_label_parts
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class InfoGetParams(RpcModel):
    path: str
    password: str | None = None


class PageSize(RpcModel):
    width: float
    height: float
    rotation: int


class DocumentInfo(RpcModel):
    path: str
    file_name: str
    bytes: int
    page_count: int
    encrypted: bool
    owner_only: bool = False
    pdf_version: str | None
    metadata: dict[str, str]
    page_sizes: list[PageSize]
    has_toc: bool
    has_forms: bool
    has_attachments: bool


def _opens_without_password(path: str) -> bool:
    try:
        with pymupdf.open(path) as probe:
            return not probe.needs_pass
    except Exception:  # noqa: BLE001
        return False


def _clean_metadata(raw: dict[str, object]) -> dict[str, str]:
    return {key: value for key, value in raw.items() if isinstance(value, str) and value}


@op("info.get", InfoGetParams)
def get_info(params: InfoGetParams, progress: Progress) -> DocumentInfo:
    file_path = Path(params.path)
    with open_document(params.path, params.password, mutable=False) as document:
        metadata = _clean_metadata(document.metadata or {})
        pdf_version = metadata.pop("format", None)
        encryption = metadata.pop("encryption", None)
        page_sizes = [
            PageSize(width=page.rect.width, height=page.rect.height, rotation=page.rotation)
            for page in document
        ]
        return DocumentInfo(
            path=str(file_path),
            file_name=file_path.name,
            bytes=file_path.stat().st_size,
            page_count=document.page_count,
            encrypted=encryption is not None,
            owner_only=encryption is not None and _opens_without_password(params.path),
            pdf_version=pdf_version,
            metadata=metadata,
            page_sizes=page_sizes,
            has_toc=bool(document.get_toc(simple=True)),
            has_forms=bool(document.is_form_pdf),
            has_attachments=document.embfile_count() > 0,
        )


class PageTextParams(RpcModel):
    path: str
    password: str | None = None
    pages: str | None = None


class PageText(RpcModel):
    page: int
    text: str


class PageTextResult(RpcModel):
    pages: list[PageText]
    page_count: int


@op("info.text", PageTextParams)
def page_text(params: PageTextParams, progress: Progress) -> PageTextResult:
    with open_document(params.path, params.password, mutable=False) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        pages = [PageText(page=index + 1, text=reading_text(document[index])) for index in indices]
        return PageTextResult(pages=pages, page_count=document.page_count)


class ThumbnailParams(RpcModel):
    path: str
    password: str | None = None
    page: int = 0
    width: int = 320


class ThumbnailResult(RpcModel):
    image: str
    width: int
    height: int
    page_count: int


@op("info.thumbnail", ThumbnailParams)
def thumbnail(params: ThumbnailParams, progress: Progress) -> ThumbnailResult:
    width = max(32, min(params.width, 1600))
    with open_document(params.path, params.password, mutable=False) as document:
        if params.page < 0 or params.page >= document.page_count:
            raise OpError(ErrorCode.INVALID_PARAMS, "page out of range")
        page = document[params.page]
        scale = width / max(page.rect.width, 1.0)
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
        image = base64.b64encode(pixmap.tobytes("png")).decode("ascii")
        return ThumbnailResult(
            image=image, width=pixmap.width, height=pixmap.height, page_count=document.page_count
        )


class PageLabelsParams(RpcModel):
    path: str
    password: str | None = None


class PageLabelsResult(RpcModel):
    labels: list[str] | None
    page_count: int


def printed_page_labels(document: pymupdf.Document) -> list[str] | None:
    try:
        parts = page_label_parts(document)
    except (RuntimeError, ValueError, TypeError, pymupdf.mupdf.FzErrorBase):
        return None
    if parts is None:
        return None
    labels = [
        pymupdf.utils.construct_label(style, prefix, number) for style, prefix, number in parts
    ]
    if all(label == str(index + 1) for index, label in enumerate(labels)):
        return None
    return labels


@op("info.page_labels", PageLabelsParams)
def page_labels(params: PageLabelsParams, progress: Progress) -> PageLabelsResult:
    with open_document(params.path, params.password, mutable=False) as document:
        return PageLabelsResult(
            labels=printed_page_labels(document), page_count=document.page_count
        )
