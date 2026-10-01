import sys
from pathlib import Path

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._inplace import (
    INCREMENTAL_SAVE_ERRORS,
    replace_through_temporary,
    rewrite_in_place,
    save_incrementally,
)
from vivepdf.ops._naming import sanitize_file_name
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024


def safe_file_name(name: str) -> str:
    candidate = name.replace("\\", "/").rsplit("/", 1)[-1]
    stem, dot, extension = candidate.rpartition(".")
    if not dot:
        return sanitize_file_name(candidate)
    cleaned_extension = sanitize_file_name(extension) if extension else ""
    cleaned_stem = sanitize_file_name(stem)
    if not cleaned_extension:
        return cleaned_stem
    return f"{cleaned_stem}.{cleaned_extension}"


def target_inside(directory: Path, name: str) -> Path:
    target = (directory / name).resolve()
    root = directory.resolve()
    if root != target and root not in target.parents:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"attachment name escapes the output folder: {name}",
            {"reason": "unsafeName"},
        )
    return target


def unique_file_name(name: str, taken: set[str]) -> str:
    lowered = {item.lower() for item in taken}
    if name.lower() not in lowered:
        return name
    source = Path(name)
    counter = 2
    while f"{source.stem}-{counter}{source.suffix}".lower() in lowered:
        counter += 1
    return f"{source.stem}-{counter}{source.suffix}"


class AttachmentItem(RpcModel):
    name: str
    file_name: str
    size: int
    description: str
    modified: str


class AttachmentsListParams(RpcModel):
    path: str
    password: str | None = None


class AttachmentsListResult(RpcModel):
    items: list[AttachmentItem]
    count: int


def _items(document: pymupdf.Document) -> list[AttachmentItem]:
    items: list[AttachmentItem] = []
    for name in document.embfile_names():
        info = document.embfile_info(name)
        items.append(
            AttachmentItem(
                name=name,
                file_name=info.get("filename") or info.get("ufilename") or name,
                size=int(info.get("size") or info.get("length") or 0),
                description=info.get("description") or info.get("desc") or "",
                modified=info.get("modDate") or "",
            )
        )
    return items


@op("attachments.list", AttachmentsListParams)
def list_attachments(params: AttachmentsListParams, _progress: Progress) -> AttachmentsListResult:
    with open_document(params.path, params.password, mutable=False) as document:
        items = _items(document)
        return AttachmentsListResult(items=items, count=len(items))


def _save_in_place(document: pymupdf.Document, path: str) -> None:
    try:
        save_incrementally(document, path)
    except INCREMENTAL_SAVE_ERRORS as error:
        print(f"[attachments] incremental save failed, rewriting: {error}", file=sys.stderr)
        replace_through_temporary(document, path, garbage=0, deflate=True)


class AttachmentsAddParams(RpcModel):
    path: str
    password: str | None = None
    files: list[str] = Field(min_length=1)
    description: str = ""


class AttachmentsChangedResult(RpcModel):
    changed: int
    names: list[str]


@op("attachments.add", AttachmentsAddParams)
def add_attachments(params: AttachmentsAddParams, progress: Progress) -> AttachmentsChangedResult:
    sources = [Path(item) for item in params.files]
    for source in sources:
        if not source.is_file():
            raise OpError(
                ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}", {"path": str(source)}
            )
        if source.stat().st_size > MAX_ATTACHMENT_BYTES:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"attachment too large: {source.name}",
                {"reason": "tooLarge"},
            )
    document = open_document(params.path, params.password)
    try:
        existing = set(document.embfile_names())
        names: list[str] = []
        for index, source in enumerate(sources):
            progress.check_cancelled()
            name = unique_file_name(source.name, existing)
            existing.add(name)
            document.embfile_add(
                name,
                source.read_bytes(),
                filename=name,
                ufilename=name,
                desc=params.description,
            )
            names.append(name)
            progress.report(
                (index + 1) / len(sources),
                "progress.attaching",
                {"current": index + 1, "total": len(sources)},
            )
        _save_in_place(document, params.path)
        return AttachmentsChangedResult(changed=len(names), names=names)
    finally:
        if not document.is_closed:
            document.close()


class AttachmentsNamesParams(RpcModel):
    path: str
    password: str | None = None
    names: list[str] = Field(min_length=1)


@op("attachments.remove", AttachmentsNamesParams)
def remove_attachments(
    params: AttachmentsNamesParams, _progress: Progress
) -> AttachmentsChangedResult:
    document = open_document(params.path, params.password)
    try:
        present = set(document.embfile_names())
        removed = [name for name in params.names if name in present]
        for name in removed:
            document.embfile_del(name)
        if removed:
            rewrite_in_place(document, params.path)
        return AttachmentsChangedResult(changed=len(removed), names=removed)
    finally:
        if not document.is_closed:
            document.close()


class AttachmentsExtractParams(AttachmentsNamesParams):
    output_dir: str


class AttachmentsExtractResult(RpcModel):
    outputs: list[str]


@op("attachments.extract", AttachmentsExtractParams)
def extract_attachments(
    params: AttachmentsExtractParams, progress: Progress
) -> AttachmentsExtractResult:
    output_dir = Path(params.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[str] = []
    with open_document(params.path, params.password) as document:
        present = set(document.embfile_names())
        taken = {entry.name for entry in output_dir.iterdir()}
        for index, name in enumerate(params.names):
            progress.check_cancelled()
            if name not in present:
                raise OpError(
                    ErrorCode.INVALID_PARAMS,
                    f"attachment not found: {name}",
                    {"reason": "missingAttachment"},
                )
            info = document.embfile_info(name)
            file_name = unique_file_name(
                safe_file_name(info.get("filename") or info.get("ufilename") or name), taken
            )
            taken.add(file_name)
            target = target_inside(output_dir, file_name)
            target.write_bytes(document.embfile_get(name))
            outputs.append(str(target))
            progress.report(
                (index + 1) / len(params.names),
                "progress.extracting",
                {"current": index + 1, "total": len(params.names)},
            )
    return AttachmentsExtractResult(outputs=outputs)
