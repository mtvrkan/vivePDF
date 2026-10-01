import re

import pymupdf

from vivepdf.rpc.errors import ErrorCode, OpError


def _pdf_box(page: pymupdf.Page, box: list[float]) -> tuple[float, float, float, float]:
    display = pymupdf.Rect(box)
    display.normalize()
    unrotated = display * page.derotation_matrix
    crop = page.cropbox
    media = page.mediabox
    top = media.y1 - crop.y0
    left = media.x0 + crop.x0
    return (
        left + unrotated.x0,
        top - unrotated.y1,
        left + unrotated.x1,
        top - unrotated.y0,
    )


def _check_timestamp_url(url: str | None) -> str | None:
    if not url or not url.strip():
        return None
    cleaned = url.strip()
    if not re.match(r"^https?://[^\s/]+", cleaned, re.IGNORECASE):
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"not a timestamp server address: {cleaned}",
            {"reason": "timestampUrl"},
        )
    return cleaned


def _unreadable_permissions(error: Exception) -> OpError:
    from pyhanko.pdf_utils.misc import PdfReadError

    if isinstance(error, PdfReadError):
        return OpError(ErrorCode.INVALID_PDF, f"cannot sign a damaged document: {error}")
    return OpError(
        ErrorCode.PERMISSION_DENIED,
        f"the document's signature permissions cannot be read: {error}",
        {"reason": "permissionsUnreadable"},
    )


def _certification_level(reader) -> int | None:
    try:
        perms = reader.root.get("/Perms")
        if perms is None:
            return None
        docmdp = perms.get_object().get("/DocMDP")
        if docmdp is None:
            return None
        for reference in docmdp.get_object().get("/Reference", []):
            reference = reference.get_object()
            if reference.get("/TransformMethod") == "/DocMDP":
                return int(reference.get("/TransformParams", {}).get("/P", 2))
        return 2
    except Exception as error:  # noqa: BLE001
        raise _unreadable_permissions(error) from error


def _locked_by_signature(reader) -> bool:
    from pyhanko.sign.fields import enumerate_sig_fields

    try:
        for _name, _value, field_ref in enumerate_sig_fields(reader, filled_status=True):
            lock = field_ref.get_object().get("/Lock")
            if lock is not None and int(lock.get_object().get("/P", 0)) == 1:
                return True
    except Exception as error:  # noqa: BLE001
        raise _unreadable_permissions(error) from error
    return False


def _index_encryption_dictionary(writer) -> None:
    from pyhanko.pdf_utils import generic

    encryption = getattr(writer, "_encrypt", None)
    if isinstance(encryption, generic.DictionaryObject):
        writer._encrypt = writer.add_object(encryption)


def _open_writer(source_file, password: str | None):
    from pyhanko.pdf_utils.crypt import AuthStatus
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter

    writer = IncrementalPdfFileWriter(source_file, strict=False)
    if writer.prev.encrypted:
        result = writer.encrypt(password or "")
        if result.status == AuthStatus.FAILED:
            raise OpError(
                ErrorCode.NEEDS_PASSWORD,
                "document requires a password",
                {"wrongPassword": bool(password)},
            )
        _index_encryption_dictionary(writer)
    return writer


def _signature_widgets(document: pymupdf.Document):
    for index, page in enumerate(document):
        for widget in page.widgets():
            if widget.field_type == pymupdf.PDF_WIDGET_TYPE_SIGNATURE and widget.field_name:
                signed = document.xref_get_key(widget.xref, "V")[0] != "null"
                yield index + 1, widget, signed


def _unique_field_name(preferred: str, existing: set[str]) -> str:
    if preferred not in existing:
        return preferred
    counter = 2
    while f"{preferred}-{counter}" in existing:
        counter += 1
    return f"{preferred}-{counter}"
