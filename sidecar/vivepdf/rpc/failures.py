import re
from pathlib import Path

import pymupdf
from pymupdf import mupdf

from vivepdf.rpc.errors import ErrorCode, OpError

_MUPDF_PREFIX = re.compile(r"^code=\d+:\s*")
_PYMUPDF_ROOT = Path(pymupdf.__file__).resolve().parent
LIBRARY_ERRORS = (ValueError, RuntimeError, TypeError, AttributeError, KeyError, IndexError)


def _raised_inside_pymupdf(error: BaseException) -> bool:
    trace = error.__traceback__
    innermost = None
    while trace is not None:
        innermost = trace
        trace = trace.tb_next
    if innermost is None:
        return False
    try:
        origin = Path(innermost.tb_frame.f_code.co_filename).resolve()
    except (OSError, ValueError):
        return False
    return origin.is_relative_to(_PYMUPDF_ROOT)


def _reason_text(error: BaseException) -> str:
    return _MUPDF_PREFIX.sub("", str(error)).strip()[:200] or type(error).__name__


def document_failure(error: BaseException) -> OpError | None:
    if isinstance(error, RecursionError):
        return OpError(
            ErrorCode.INVALID_PDF,
            "document structure is nested too deeply",
            {"reason": "tooDeep"},
        )
    if isinstance(error, MemoryError):
        return OpError(
            ErrorCode.INVALID_PDF,
            "document is too large to process",
            {"reason": "documentTooLarge"},
        )
    is_mupdf = isinstance(error, mupdf.FzErrorBase | pymupdf.FileDataError) or (
        isinstance(error, RuntimeError) and bool(_MUPDF_PREFIX.match(str(error)))
    )
    if is_mupdf or (isinstance(error, LIBRARY_ERRORS) and _raised_inside_pymupdf(error)):
        return OpError(
            ErrorCode.INVALID_PDF,
            f"document is damaged: {_reason_text(error)}",
            {"reason": "damaged"},
        )
    return None
