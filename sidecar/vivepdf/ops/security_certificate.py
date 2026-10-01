from pathlib import Path

import pymupdf
from pydantic import Field

from vivepdf.ops._document import _is_certificate_sealed, open_document
from vivepdf.ops._output import (
    OutputResult,
    prepare_output,
)
from vivepdf.ops._pkcs12 import unlock_pkcs12
from vivepdf.ops.security import (
    Algorithm,
    Permissions,
    _plain_bytes,
    _pubkey_permissions,
    _write_with_handler,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

CERTIFICATE_EXTENSIONS = {".cer", ".crt", ".pem", ".der"}
CERTIFICATE_MAX_BYTES = 1024 * 1024


def load_recipients(paths: list[str]) -> list:
    from asn1crypto import pem, x509

    recipients = []
    for entry in paths:
        source = Path(entry)
        if source.suffix.lower() not in CERTIFICATE_EXTENSIONS:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"not a certificate file: {source.name}",
                {"reason": "certificateFormat"},
            )
        if not source.is_file():
            raise OpError(
                ErrorCode.FILE_NOT_FOUND, f"certificate not found: {source.name}", {"path": entry}
            )
        if source.stat().st_size > CERTIFICATE_MAX_BYTES:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"certificate is too large: {source.name}",
                {"reason": "certificateFormat"},
            )
        data = source.read_bytes()
        try:
            if pem.detect(data):
                _type, _headers, data = pem.unarmor(data)
            certificate = x509.Certificate.load(data)
            algorithm = certificate.public_key.algorithm
        except Exception as error:  # noqa: BLE001
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"cannot read certificate: {source.name}",
                {"reason": "certificateFormat"},
            ) from error
        if algorithm != "rsa":
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"only an RSA certificate can receive a sealed document: {source.name}",
                {"reason": "encryptionNeedsRsa"},
            )
        usage = certificate.key_usage_value
        if usage is not None and "key_encipherment" not in usage.native:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"certificate cannot be used for encryption: {source.name}",
                {"reason": "certificateUsage"},
            )
        recipients.append(certificate)
    if not recipients:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "at least one certificate is required",
            {"reason": "noCertificates"},
        )
    return recipients


class EncryptCertificateParams(RpcModel):
    path: str
    password: str | None = Field(default=None, repr=False)
    output: str
    overwrite: bool = False
    certificates: list[str] = Field(min_length=1)
    algorithm: Algorithm = "aes256"
    permissions: Permissions = Field(default_factory=Permissions)
    encrypt_metadata: bool = True


class EncryptCertificateResult(OutputResult):
    recipients: list[str]
    expired_recipients: list[str] = Field(default_factory=list)


def _expired(certificate) -> bool:
    import datetime

    try:
        not_after = certificate["tbs_certificate"]["validity"]["not_after"].native
    except Exception:  # noqa: BLE001
        return False
    return not_after < datetime.datetime.now(datetime.UTC)


@op("security.encrypt_certificate", EncryptCertificateParams)
def encrypt_certificate(
    params: EncryptCertificateParams, progress: Progress
) -> EncryptCertificateResult:
    from pyhanko.pdf_utils.crypt import PubKeySecurityHandler, SecurityHandlerVersion
    from pyhanko.pdf_utils.crypt.pubkey import RecipientEncryptionPolicy

    if params.algorithm == "rc4":
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "RC4 cannot seal a document with certificates",
            {"reason": "rc4NotForCertificates"},
        )
    recipients = load_recipients(params.certificates)
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        progress.report(0.4, "progress.saving")
        plain = _plain_bytes(document)
        page_count = document.page_count
    try:
        _write_with_handler(
            plain,
            target,
            lambda _writer: PubKeySecurityHandler.build_from_certs(
                recipients,
                keylen_bytes=32 if params.algorithm == "aes256" else 16,
                version=SecurityHandlerVersion.AES256
                if params.algorithm == "aes256"
                else SecurityHandlerVersion.RC4_OR_AES128,
                use_aes=params.algorithm != "rc4",
                perms=_pubkey_permissions(params.permissions),
                encrypt_metadata=params.encrypt_metadata,
                policy=RecipientEncryptionPolicy(ignore_key_usage=True),
            ),
        )
    except OpError:
        raise
    except Exception as error:  # noqa: BLE001
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "certificate cannot be used for encryption",
            {"reason": "certificateUsage"},
        ) from error
    return EncryptCertificateResult(
        output=str(target),
        page_count=page_count,
        bytes=target.stat().st_size,
        recipients=[_certificate_label(entry) for entry in recipients],
        expired_recipients=[_certificate_label(entry) for entry in recipients if _expired(entry)],
    )


def _certificate_label(certificate) -> str:
    try:
        subject = certificate.subject.native
    except Exception:  # noqa: BLE001
        return "?"
    for key in ("common_name", "organization_name", "email_address"):
        value = subject.get(key)
        if value:
            return str(value)
    return "?"


def _refuse_unsealed(source: Path) -> None:
    try:
        with pymupdf.open(source) as document:
            protected = document.needs_pass or bool(document.metadata.get("encryption"))
    except Exception as error:  # noqa: BLE001
        raise OpError(ErrorCode.INVALID_PDF, f"cannot open: {source.name}") from error
    if protected:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "document is protected with a password, not a certificate",
            {"reason": "passwordNotCertificate"},
        )
    raise OpError(
        ErrorCode.INVALID_PARAMS,
        "document is not password protected",
        {"reason": "notEncrypted"},
    )


class DecryptCertificateParams(RpcModel):
    path: str
    output: str
    overwrite: bool = False
    certificate_path: str
    certificate_password: str = Field(default="", repr=False)


@op("security.decrypt_certificate", DecryptCertificateParams)
def decrypt_certificate(params: DecryptCertificateParams, progress: Progress) -> OutputResult:
    from pyhanko.pdf_utils.crypt.pubkey import SimpleEnvelopeKeyDecrypter
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.pdf_utils.writer import copy_into_new_writer

    source = Path(params.path)
    if not source.is_file():
        raise OpError(
            ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}", {"path": params.path}
        )
    holder = Path(params.certificate_path)
    if not holder.is_file():
        raise OpError(
            ErrorCode.FILE_NOT_FOUND,
            f"certificate not found: {holder.name}",
            {"path": params.certificate_path},
        )
    if not _is_certificate_sealed(source):
        _refuse_unsealed(source)
    target = prepare_output(params.output, [params.path], params.overwrite)
    _data, passphrase = unlock_pkcs12(holder, params.certificate_password)
    decrypter = SimpleEnvelopeKeyDecrypter.load_pkcs12(str(holder), passphrase)
    if decrypter is None:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the certificate could not be opened",
            {"reason": "keyFileFormat"},
        )
    progress.report(0.4, "progress.saving")
    try:
        with source.open("rb") as handle:
            reader = PdfFileReader(handle)
            if not reader.encrypted:
                raise OpError(
                    ErrorCode.INVALID_PARAMS,
                    "document is not password protected",
                    {"reason": "notEncrypted"},
                )
            reader.decrypt_pubkey(decrypter)
            writer = copy_into_new_writer(reader)
            with target.open("wb") as out:
                writer.write(out)
    except OpError:
        target.unlink(missing_ok=True)
        raise
    except Exception as error:  # noqa: BLE001
        target.unlink(missing_ok=True)
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "this certificate does not open the document",
            {"reason": "certificateMismatch"},
        ) from error
    with open_document(str(target), None) as document:
        page_count = document.page_count
    return OutputResult(output=str(target), page_count=page_count, bytes=target.stat().st_size)
