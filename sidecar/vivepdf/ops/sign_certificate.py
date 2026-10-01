import datetime
import os
from pathlib import Path
from typing import Literal

from pydantic import Field

from vivepdf.ops._output import write_atomically
from vivepdf.ops._pkcs12 import unlock_pkcs12
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MIN_KEY_PASSWORD = 8
MAX_NAME_LENGTH = 64
DOCUMENT_SIGNING_OID = "1.3.6.1.5.5.7.3.36"


class CreateCertificateParams(RpcModel):
    output: str
    overwrite: bool = False
    replace_key: bool = False
    password: str = Field(min_length=1, repr=False)
    common_name: str = Field(min_length=1)
    email: str = ""
    organization: str = ""
    country: str = "TR"
    valid_days: int = Field(default=1095, ge=1, le=7300)
    key_type: Literal["rsa", "ec"] = "rsa"
    usage: Literal["signing", "encryption", "both"] = "signing"


class CreateCertificateResult(RpcModel):
    output: str
    bytes: int
    subject: str
    valid_until: str


def _ascii_email(value: str) -> str:
    local, separator, domain = value.rpartition("@")
    if not separator or not local or not domain or not local.isascii() or " " in value:
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"not an e-mail address: {value}", {"reason": "email"}
        )
    try:
        ascii_domain = domain.encode("idna").decode("ascii")
    except UnicodeError as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"not an e-mail address: {value}", {"reason": "email"}
        ) from error
    if "." not in ascii_domain:
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"not an e-mail address: {value}", {"reason": "email"}
        )
    return f"{local}@{ascii_domain}"


def _readable_subject(name) -> str:
    from cryptography.x509.oid import NameOID

    return name.rfc4514_string({NameOID.EMAIL_ADDRESS: "E"})


def _write_private(path: Path, data: bytes) -> None:
    descriptor = os.open(
        path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600
    )
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(data)


@op("sign.create_certificate", CreateCertificateParams)
def create_certificate(
    params: CreateCertificateParams, progress: Progress
) -> CreateCertificateResult:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec, rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    target = Path(params.output)
    if target.suffix.lower() not in (".p12", ".pfx"):
        target = target.with_suffix(".p12")
    if target.exists() and not params.overwrite:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"output already exists: {target.name}",
            {"exists": True, "path": str(target)},
        )
    if target.exists() and not params.replace_key:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"replacing an existing key file needs its own confirmation: {target.name}",
            {"reason": "replaceKey", "path": str(target)},
        )
    if len(params.password) < MIN_KEY_PASSWORD:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"the key file password needs at least {MIN_KEY_PASSWORD} characters",
            {"reason": "passwordTooShort", "minimum": MIN_KEY_PASSWORD},
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    wants_encryption = params.usage in ("encryption", "both")
    if wants_encryption and params.key_type != "rsa":
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "a certificate that receives encrypted documents has to be RSA",
            {"reason": "encryptionNeedsRsa"},
        )
    common_name = params.common_name.strip()
    if not common_name:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "the certificate needs a name", {"reason": "commonName"}
        )
    organization = params.organization.strip()
    for field, value in (("commonName", common_name), ("organization", organization)):
        if len(value.encode("utf-8")) > MAX_NAME_LENGTH:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"{field} is longer than {MAX_NAME_LENGTH} bytes",
                {"reason": "nameTooLong", "field": field, "maximum": MAX_NAME_LENGTH},
            )
    email = _ascii_email(params.email.strip()) if params.email.strip() else ""
    progress.report(0.2, "progress.generatingKey")
    key = (
        rsa.generate_private_key(public_exponent=65537, key_size=3072)
        if params.key_type == "rsa"
        else ec.generate_private_key(ec.SECP256R1())
    )
    attributes = [x509.NameAttribute(NameOID.COMMON_NAME, common_name)]
    if organization:
        attributes.append(x509.NameAttribute(NameOID.ORGANIZATION_NAME, organization))
    country = params.country.strip()
    if len(country) == 2 and country.isascii() and country.isalpha():
        attributes.append(x509.NameAttribute(NameOID.COUNTRY_NAME, country.upper()))
    if email:
        attributes.append(x509.NameAttribute(NameOID.EMAIL_ADDRESS, email))
    subject = x509.Name(attributes)
    now = datetime.datetime.now(datetime.UTC)
    not_after = now + datetime.timedelta(days=params.valid_days)
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(not_after)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=params.usage in ("signing", "both"),
                content_commitment=params.usage in ("signing", "both"),
                key_encipherment=wants_encryption,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage(
                [
                    ExtendedKeyUsageOID.EMAIL_PROTECTION,
                    ExtendedKeyUsageOID.CLIENT_AUTH,
                    *(
                        [x509.ObjectIdentifier(DOCUMENT_SIGNING_OID)]
                        if params.usage in ("signing", "both")
                        else []
                    ),
                ]
            ),
            critical=False,
        )
    )
    if email:
        builder = builder.add_extension(
            x509.SubjectAlternativeName([x509.RFC822Name(email)]), critical=False
        )
    certificate = builder.sign(key, hashes.SHA256())
    progress.report(0.8, "progress.saving")
    data = pkcs12.serialize_key_and_certificates(
        name=common_name.encode("utf-8"),
        key=key,
        cert=certificate,
        cas=None,
        encryption_algorithm=serialization.BestAvailableEncryption(params.password.encode("utf-8")),
    )
    write_atomically(target, lambda partial: _write_private(partial, data))
    return CreateCertificateResult(
        output=str(target),
        bytes=target.stat().st_size,
        subject=_readable_subject(subject),
        valid_until=not_after.isoformat(),
    )


class ExportCertificateParams(RpcModel):
    path: str
    password: str = Field(default="", repr=False)
    output: str
    overwrite: bool = False


class ExportCertificateResult(RpcModel):
    output: str
    bytes: int
    subject: str
    valid_until: str


@op("sign.export_certificate", ExportCertificateParams)
def export_certificate(
    params: ExportCertificateParams, progress: Progress
) -> ExportCertificateResult:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.serialization import pkcs12

    source = Path(params.path)
    if not source.is_file():
        raise OpError(ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}")
    target = Path(params.output)
    if target.suffix.lower() not in (".cer", ".crt", ".der"):
        target = target.with_suffix(".cer")
    if target.exists() and not params.overwrite:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"output already exists: {target.name}",
            {"exists": True, "path": str(target)},
        )
    progress.report(0.3, "progress.reading")
    data, passphrase = unlock_pkcs12(source, params.password, require_key=False)
    _key, certificate, _chain = pkcs12.load_key_and_certificates(data, passphrase)
    if certificate is None:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"no certificate inside: {source.name}",
            {"reason": "keyFileFormat"},
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    progress.report(0.8, "progress.saving")
    public = certificate.public_bytes(serialization.Encoding.DER)
    write_atomically(target, lambda partial: partial.write_bytes(public))
    return ExportCertificateResult(
        output=str(target),
        bytes=target.stat().st_size,
        subject=_readable_subject(certificate.subject),
        valid_until=certificate.not_valid_after_utc.isoformat(),
    )
