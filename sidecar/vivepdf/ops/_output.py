import contextlib
import time
import uuid
from collections.abc import Callable
from pathlib import Path

import pymupdf

from vivepdf.ops._document import forget_document
from vivepdf.ops._font_unicode import use_ascii_for_shared_glyphs
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.protocol import RpcModel

DEDUPLICATE_OBJECT_LIMIT = 5000
SHARING_ERRORS = frozenset({5, 32})
SHARING_RETRIES = 6
SHARING_PAUSE = 0.05


class OutputResult(RpcModel):
    output: str
    page_count: int
    bytes: int


def prepare_output(output: str, inputs: list[str], overwrite: bool) -> Path:
    target = Path(output)
    if target.suffix.lower() != ".pdf":
        target = target.with_suffix(".pdf")
    resolved = target.resolve()
    for source in inputs:
        if Path(source).resolve() == resolved:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "output must differ from the input file",
                {"reason": "sameAsInput"},
            )
    if resolved.exists() and not overwrite:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"output already exists: {resolved.name}",
            {"exists": True, "path": str(resolved)},
        )
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def prepare_data_output(output: str, extension: str, overwrite: bool) -> Path:
    target = Path(output)
    if target.suffix.lower() != f".{extension}":
        target = target.with_suffix(f".{extension}")
    if target.exists() and not overwrite:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"output already exists: {target.name}",
            {"exists": True, "path": str(target)},
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def deduplicate_annotation_names(document: pymupdf.Document) -> int:
    if not document.is_pdf:
        return 0
    seen: set[str] = set()
    renamed = 0
    for page in document:
        for xref, _kind, _name in page.annot_xrefs():
            if xref <= 0:
                continue
            kind, value = document.xref_get_key(xref, "NM")
            if kind != "string" or not value:
                continue
            if value in seen:
                unique = f"{value}-{xref}"
                while unique in seen:
                    unique = f"{unique}-{xref}"
                document.xref_set_key(xref, "NM", pymupdf.get_pdf_str(unique))
                value = unique
                renamed += 1
            seen.add(value)
    return renamed


def prepare_for_save(document: pymupdf.Document) -> None:
    deduplicate_annotation_names(document)
    use_ascii_for_shared_glyphs(document)


def garbage_level(document: pymupdf.Document, deduplicating: int = 3) -> int:
    if document.xref_length() <= DEDUPLICATE_OBJECT_LIMIT:
        return deduplicating
    return 2


def _patiently(action: Callable[[], object]) -> None:
    for attempt in range(1, SHARING_RETRIES + 1):
        try:
            action()
            return
        except PermissionError as error:
            if getattr(error, "winerror", None) not in SHARING_ERRORS or attempt == SHARING_RETRIES:
                raise
            time.sleep(SHARING_PAUSE * attempt)


def replace_patiently(source: Path, target: Path) -> None:
    _patiently(lambda: source.replace(target))


def unlink_patiently(path: Path) -> None:
    _patiently(lambda: path.unlink(missing_ok=True))


def _finish_partial(partial: Path, target: Path, write: Callable[[Path], None]) -> None:
    try:
        write(partial)
        replace_patiently(partial, target)
    except BaseException:
        with contextlib.suppress(OSError):
            unlink_patiently(partial)
        raise


def write_atomically(target: Path, write: Callable[[Path], None]) -> None:
    partial = target.parent / f".vivepdf-{uuid.uuid4().hex[:12]}.part"
    _finish_partial(partial, target, write)


def save_document(document: pymupdf.Document, target: Path, **overrides: object) -> OutputResult:
    options: dict[str, object] = {
        "garbage": garbage_level(document),
        "deflate": True,
        "use_objstms": True,
        "encryption": pymupdf.PDF_ENCRYPT_KEEP,
    }
    options.update(overrides)
    if target.exists():
        forget_document(str(target))
    prepare_for_save(document)
    partial = target.parent / f".vivepdf-{uuid.uuid4().hex[:12]}.part"
    _finish_partial(partial, target, lambda path: document.save(path, **options))
    return OutputResult(
        output=str(target), page_count=document.page_count, bytes=target.stat().st_size
    )
