import hashlib
import hmac
import secrets
import threading
from collections import OrderedDict
from pathlib import Path

import pymupdf

from vivepdf.ops._inline_annotations import promote_inline_annotations
from vivepdf.ops._passwords import authenticate_password
from vivepdf.rpc.errors import ErrorCode, OpError

CERTIFICATE_HANDLER = b"/Adobe.PubSec"
SEAL_SCAN_BYTES = 1_000_000

CACHE_MAX_ENTRIES = 3
CACHE_MAX_BYTES = 400_000_000

_cache_lock = threading.Lock()
_password_salt = secrets.token_bytes(32)


class _CacheEntry:
    def __init__(self, document: pymupdf.Document, mtime_ns: int, size: int) -> None:
        self.document = document
        self.mtime_ns = mtime_ns
        self.size = size
        self.lock = threading.Lock()


_cache: "OrderedDict[tuple[str, str | None], _CacheEntry]" = OrderedDict()


class CachedDocument:
    def __init__(self, document: pymupdf.Document, entry_lock: threading.Lock) -> None:
        object.__setattr__(self, "_vivepdf_document", document)
        object.__setattr__(self, "_vivepdf_lock", entry_lock)

    def __getattr__(self, name: str) -> object:
        return getattr(object.__getattribute__(self, "_vivepdf_document"), name)

    def __setattr__(self, name: str, value: object) -> None:
        setattr(object.__getattribute__(self, "_vivepdf_document"), name, value)

    def __len__(self) -> int:
        return len(object.__getattribute__(self, "_vivepdf_document"))

    def __getitem__(self, index: object) -> object:
        return object.__getattribute__(self, "_vivepdf_document")[index]

    def __iter__(self):
        return iter(object.__getattribute__(self, "_vivepdf_document"))

    def __enter__(self) -> "CachedDocument":
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> bool:
        object.__getattribute__(self, "_vivepdf_lock").release()
        return False

    def close(self) -> None:
        object.__getattribute__(self, "_vivepdf_lock").release()


def unwrap_document(document: "pymupdf.Document | CachedDocument") -> pymupdf.Document:
    if isinstance(document, CachedDocument):
        return object.__getattribute__(document, "_vivepdf_document")
    return document


def _stat(file_path: Path) -> tuple[int, int]:
    info = file_path.stat()
    return info.st_mtime_ns, info.st_size


def _is_certificate_sealed(file_path: Path) -> bool:
    try:
        with file_path.open("rb") as handle:
            if CERTIFICATE_HANDLER in handle.read(SEAL_SCAN_BYTES):
                return True
            size = file_path.stat().st_size
            if size <= SEAL_SCAN_BYTES:
                return False
            handle.seek(max(0, size - SEAL_SCAN_BYTES))
            return CERTIFICATE_HANDLER in handle.read(SEAL_SCAN_BYTES)
    except OSError:
        return False


def _open_fresh(
    file_path: Path, password: str | None, require_pdf: bool, detached: bool = False
) -> pymupdf.Document:
    try:
        if detached:
            document = pymupdf.open(stream=file_path.read_bytes(), filetype="pdf")
        else:
            document = pymupdf.open(file_path)
    except PermissionError as error:
        raise OpError(ErrorCode.PERMISSION_DENIED, f"cannot read: {file_path.name}") from error
    except (pymupdf.FileDataError, RuntimeError, ValueError) as error:
        if _is_certificate_sealed(file_path):
            raise OpError(
                ErrorCode.CERTIFICATE_SEALED,
                f"sealed with a certificate: {file_path.name}",
                {"path": str(file_path)},
            ) from error
        raise OpError(ErrorCode.INVALID_PDF, f"cannot open: {file_path.name}") from error
    if require_pdf and not document.is_pdf:
        document.close()
        raise OpError(ErrorCode.INVALID_PDF, f"not a PDF: {file_path.name}")
    if document.needs_pass and not authenticate_password(document, password):
        document.close()
        if _is_certificate_sealed(file_path):
            raise OpError(
                ErrorCode.CERTIFICATE_SEALED,
                f"sealed with a certificate: {file_path.name}",
                {"path": str(file_path)},
            )
        raise OpError(
            ErrorCode.NEEDS_PASSWORD,
            "document requires a password",
            {"wrongPassword": password is not None},
        )
    if require_pdf and document.page_count == 0:
        document.close()
        raise OpError(ErrorCode.INVALID_PDF, f"no pages could be read: {file_path.name}")
    promote_inline_annotations(document)
    return document


def _password_digest(password: str | None) -> str | None:
    if password is None:
        return None
    return hmac.new(_password_salt, password.encode("utf-8"), hashlib.sha256).hexdigest()


def _over_budget() -> bool:
    held = sum(entry.size for entry in _cache.values())
    return len(_cache) > CACHE_MAX_ENTRIES or held > CACHE_MAX_BYTES


def _trim_cache() -> None:
    for key in list(_cache)[:-1]:
        if not _over_budget():
            return
        entry = _cache[key]
        if not entry.lock.acquire(blocking=False):
            continue
        try:
            _cache.pop(key)
            entry.document.close()
        finally:
            entry.lock.release()


def _acquire_cache_entry(file_path: Path, password: str | None, require_pdf: bool) -> _CacheEntry:
    resolved = str(file_path.resolve())
    key = (resolved, _password_digest(password))
    mtime_ns, size = _stat(file_path)
    with _cache_lock:
        entry = _cache.get(key)
        if entry is not None and (entry.mtime_ns != mtime_ns or entry.size != size):
            _cache.pop(key)
            entry.document.close()
            entry = None
        if entry is None:
            document = _open_fresh(file_path, password, require_pdf, detached=require_pdf)
            entry = _CacheEntry(document, mtime_ns, size)
            _cache[key] = entry
            _trim_cache()
        else:
            _cache.move_to_end(key)
        return entry


def _close_entries(entries: list[_CacheEntry]) -> int:
    for entry in entries:
        with entry.lock:
            entry.document.close()
    return len(entries)


def forget_document(path: str) -> int:
    resolved = str(Path(path).resolve())
    with _cache_lock:
        stale = [_cache.pop(key) for key in [key for key in _cache if key[0] == resolved]]
    return _close_entries(stale)


def forget_all_documents() -> int:
    with _cache_lock:
        stale = list(_cache.values())
        _cache.clear()
    return _close_entries(stale)


def open_document(
    path: str,
    password: str | None = None,
    require_pdf: bool = True,
    mutable: bool = True,
) -> pymupdf.Document:
    file_path = Path(path)
    if not file_path.is_file():
        raise OpError(ErrorCode.FILE_NOT_FOUND, f"file not found: {file_path.name}", {"path": path})
    if mutable:
        return _open_fresh(file_path, password, require_pdf)
    entry = _acquire_cache_entry(file_path, password, require_pdf)
    entry.lock.acquire()
    return CachedDocument(entry.document, entry.lock)
