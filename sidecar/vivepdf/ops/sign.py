import re
from pathlib import Path

import pymupdf

from vivepdf.ops._document import forget_document, open_document
from vivepdf.ops._output import prepare_output, write_atomically
from vivepdf.ops._pkcs12 import unlock_pkcs12
from vivepdf.ops._sign_params import SignParams, SignResult
from vivepdf.ops._sign_stamp import _stamp_image, _stamp_style
from vivepdf.ops._sign_writer import (
    _certification_level,
    _check_timestamp_url,
    _locked_by_signature,
    _open_writer,
    _pdf_box,
    _signature_widgets,
    _unique_field_name,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


def _load_signer(certificate_path: str, certificate_password: str):
    from pyhanko.sign import signers

    source = Path(certificate_path)
    if not source.is_file():
        raise OpError(
            ErrorCode.FILE_NOT_FOUND,
            f"certificate not found: {source.name}",
            {"path": certificate_path},
        )
    data, passphrase = unlock_pkcs12(source, certificate_password)
    try:
        signer = signers.SimpleSigner.load_pkcs12_data(data, (), passphrase=passphrase)
    except Exception as error:  # noqa: BLE001
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"cannot load certificate: {error}",
            {"reason": "certificate"},
        ) from error
    if signer is None:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "certificate could not be loaded",
            {"reason": "certificate"},
        )
    return signer


def _subject_label(certificate) -> str:
    subject = certificate.subject
    try:
        native = subject.native
        return str(
            native.get("common_name") or native.get("organization_name") or subject.human_friendly
        )
    except Exception:  # noqa: BLE001
        return "signer"


def _signer_name(signer) -> str:
    return _subject_label(signer.signing_cert)


CERTIFY_PERMISSIONS = {"none": 1, "forms": 2, "annotations": 3}
PERMISSION_NAMES = {value: key for key, value in CERTIFY_PERMISSIONS.items()}


@op("sign.run", SignParams)
def sign(params: SignParams, progress: Progress) -> SignResult:
    from pyhanko.pdf_utils.misc import PdfReadError
    from pyhanko.sign import signers
    from pyhanko.sign.fields import (
        FieldMDPAction,
        FieldMDPSpec,
        MDPPerm,
        SigFieldSpec,
        SigSeedSubFilter,
    )
    from pyhanko.sign.timestamps import HTTPTimeStamper
    from pyhanko.sign.timestamps.common_utils import TimestampRequestError

    target = prepare_output(params.output, [params.path], params.overwrite)
    timestamp_url = _check_timestamp_url(params.timestamp_url)
    signer = _load_signer(params.certificate_path, params.certificate_password)
    signer_name = _signer_name(signer)
    image = _stamp_image(params) if params.visible else None
    with open_document(params.path, params.password) as document:
        page_count = document.page_count
        widgets = list(_signature_widgets(document))
        signed_count = sum(1 for _page, _widget, signed in widgets if signed)
        empty_fields: dict[str, int] = {}
        for page_number, widget, signed in widgets:
            if not signed:
                empty_fields.setdefault(widget.field_name, page_number)
        if params.existing_field:
            if params.existing_field not in empty_fields:
                raise OpError(
                    ErrorCode.INVALID_PARAMS,
                    f"no empty signature field named {params.existing_field}",
                    {"reason": "fieldNotFound", "field": params.existing_field},
                )
            field_name = params.existing_field
            page_number = empty_fields[field_name]
        else:
            field_name = _unique_field_name(
                params.field_name, {widget.field_name for _page, widget, _signed in widgets}
            )
            page_number = params.page
        if page_number > page_count:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"page {page_number} is outside 1..{page_count}",
                {"reason": "pageOutOfRange", "page": page_number, "pageCount": page_count},
            )
        page = document[page_number - 1]
        rotation = page.rotation % 360
        box = None
        if params.visible and not params.existing_field:
            page_rect = page.rect
            box = _pdf_box(
                page,
                params.box
                or [
                    page_rect.width - 240,
                    page_rect.height - 96,
                    page_rect.width - 40,
                    page_rect.height - 36,
                ],
            )
    if params.certify and signed_count:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "only the first signature of a document can certify it",
            {"reason": "certifyNotFirst"},
        )
    progress.report(0.2, "progress.signing")
    field_spec = None
    if not params.existing_field:
        field_spec = SigFieldSpec(
            sig_field_name=field_name,
            on_page=page_number - 1,
            box=box,
            field_mdp_spec=FieldMDPSpec(FieldMDPAction.ALL) if params.lock else None,
            doc_mdp_update_value=MDPPerm.NO_CHANGES if params.lock else None,
        )
    metadata = signers.PdfSignatureMetadata(
        field_name=field_name,
        reason=params.reason or None,
        location=params.location or None,
        contact_info=params.contact or None,
        subfilter=SigSeedSubFilter.PADES,
        certify=params.certify,
        docmdp_permissions=MDPPerm(CERTIFY_PERMISSIONS[params.certify_permission]),
    )
    timestamper = HTTPTimeStamper(timestamp_url) if timestamp_url else None
    pdf_signer = signers.PdfSigner(
        metadata,
        signer=signer,
        timestamper=timestamper,
        stamp_style=_stamp_style(params, signer_name, rotation, image) if params.visible else None,
        new_field_spec=field_spec,
    )
    with open(params.path, "rb") as source_file:
        try:
            writer = _open_writer(source_file, params.password)
        except OpError:
            raise
        except Exception as error:  # noqa: BLE001
            raise OpError(ErrorCode.INVALID_PDF, f"cannot read the document: {error}") from error
        level = _certification_level(writer.prev)
        if _locked_by_signature(writer.prev):
            raise OpError(
                ErrorCode.PERMISSION_DENIED,
                "a signature locked the document against further changes",
                {"reason": "lockedBySignature"},
            )
        if level == 1:
            raise OpError(
                ErrorCode.PERMISSION_DENIED,
                "the document is certified and allows no further changes",
                {"reason": "certifiedNoChanges"},
            )
        if level is not None and not params.existing_field:
            raise OpError(
                ErrorCode.PERMISSION_DENIED,
                "a certified document can only be signed in one of its empty signature fields",
                {"reason": "certifiedNeedsField", "fields": sorted(empty_fields)},
            )

        def write(partial: Path) -> None:
            with open(partial, "wb") as output_file:
                pdf_signer.sign_pdf(writer, output=output_file)

        try:
            forget_document(str(target))
            write_atomically(target, write)
        except TimestampRequestError as error:
            raise OpError(
                ErrorCode.NETWORK,
                f"the timestamp server could not be reached: {timestamp_url}",
                {"reason": "timestamp"},
            ) from error
        except PdfReadError as error:
            raise OpError(
                ErrorCode.INVALID_PDF, f"cannot sign a damaged document: {error}"
            ) from error
        except Exception as error:  # noqa: BLE001
            raise OpError(ErrorCode.INTERNAL, f"signing failed: {error}") from error
    progress.report(0.95, "progress.saving")
    return SignResult(
        output=str(target), page_count=page_count, bytes=target.stat().st_size, signer=signer_name
    )


class SignaturesPresentParams(RpcModel):
    path: str
    password: str | None = None


class SignaturesPresentResult(RpcModel):
    count: int


@op("sign.count", SignaturesPresentParams)
def count_signatures(
    params: SignaturesPresentParams, _progress: Progress
) -> SignaturesPresentResult:
    with open_document(params.path, params.password) as document:
        count = 0
        for page in document:
            for widget in page.widgets():
                if widget.field_type != pymupdf.PDF_WIDGET_TYPE_SIGNATURE:
                    continue
                if document.xref_get_key(widget.xref, "V")[0] != "null":
                    count += 1
        return SignaturesPresentResult(count=count)


class SignatureFieldsParams(RpcModel):
    path: str
    password: str | None = None


class SignatureFieldInfo(RpcModel):
    name: str
    page: int
    signed: bool


class SignatureFieldsResult(RpcModel):
    fields: list[SignatureFieldInfo]
    certification: str | None
    locked: bool = False


@op("sign.fields", SignatureFieldsParams)
def signature_fields(params: SignatureFieldsParams, _progress: Progress) -> SignatureFieldsResult:
    fields: dict[str, SignatureFieldInfo] = {}
    locked = False
    with open_document(params.path, params.password) as document:
        for page_number, widget, signed in _signature_widgets(document):
            if signed and document.xref_get_key(widget.xref, "Lock/P") == ("int", "1"):
                locked = True
            known = fields.get(widget.field_name)
            if known is None or (signed and not known.signed):
                fields[widget.field_name] = SignatureFieldInfo(
                    name=widget.field_name, page=page_number, signed=signed
                )
        certification = None
        try:
            catalog = document.pdf_catalog()
            kind, value = document.xref_get_key(catalog, "Perms/DocMDP")
            if kind == "xref":
                signature_xref = int(value.split()[0])
                reference = document.xref_get_key(signature_xref, "Reference")[1]
                match = re.search(r"/P\s+(\d)", reference)
                certification = PERMISSION_NAMES.get(int(match.group(1)) if match else 2)
        except Exception:  # noqa: BLE001
            certification = None
    return SignatureFieldsResult(
        fields=list(fields.values()), certification=certification, locked=locked
    )
