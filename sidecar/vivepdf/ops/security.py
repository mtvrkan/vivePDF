import io
import secrets
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import forget_document, open_document
from vivepdf.ops._output import (
    OutputResult,
    garbage_level,
    prepare_for_save,
    prepare_output,
    save_document,
    write_atomically,
)
from vivepdf.ops._passwords import saslprepped
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

AES256_PASSWORD_BYTES = 127
LEGACY_PASSWORD_BYTES = 32
MUPDF_PASSWORD_CHARS = 40


Algorithm = Literal["aes256", "aes128", "rc4"]
ALGORITHMS = {
    "aes256": pymupdf.PDF_ENCRYPT_AES_256,
    "aes128": pymupdf.PDF_ENCRYPT_AES_128,
    "rc4": pymupdf.PDF_ENCRYPT_RC4_128,
}


class Permissions(RpcModel):
    print: bool = True
    print_high_quality: bool = True
    copy_text: bool = True
    modify: bool = True
    annotate: bool = True
    fill_forms: bool = True
    accessibility: bool = True
    assemble: bool = True

    def to_flags(self) -> int:
        flags = 0
        if self.print:
            flags |= pymupdf.PDF_PERM_PRINT
        if self.print_high_quality:
            flags |= pymupdf.PDF_PERM_PRINT_HQ
        if self.copy_text:
            flags |= pymupdf.PDF_PERM_COPY
        if self.modify:
            flags |= pymupdf.PDF_PERM_MODIFY
        if self.annotate:
            flags |= pymupdf.PDF_PERM_ANNOTATE
        if self.fill_forms:
            flags |= pymupdf.PDF_PERM_FORM
        if self.accessibility:
            flags |= pymupdf.PDF_PERM_ACCESSIBILITY
        if self.assemble:
            flags |= pymupdf.PDF_PERM_ASSEMBLE
        return flags


class EncryptParams(RpcModel):
    path: str
    password: str | None = Field(default=None, repr=False)
    output: str
    overwrite: bool = False
    user_password: str = Field(default="", repr=False)
    owner_password: str = Field(default="", repr=False)
    algorithm: Algorithm = "aes256"
    permissions: Permissions = Field(default_factory=Permissions)
    encrypt_metadata: bool = True


class EncryptResult(OutputResult):
    generated_owner_password: str = Field(default="", repr=False)


def prepare_password(value: str, algorithm: str) -> str:
    if not value:
        return value
    if algorithm == "aes256":
        prepared = saslprepped(value)
        if prepared is None:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "this password has characters a PDF password cannot hold",
                {"reason": "passwordProhibited"},
            )
        limit, size = AES256_PASSWORD_BYTES, len(prepared.encode("utf-8"))
    else:
        if not legacy_password_encodable(value):
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "this password has letters the legacy encryption cannot store",
                {"reason": "passwordCharset"},
            )
        prepared, limit, size = value, LEGACY_PASSWORD_BYTES, len(value)
    if size > limit:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"password is longer than {limit} bytes",
            {"reason": "passwordTooLong", "maxBytes": limit},
        )
    return prepared


def _plain_bytes(document: pymupdf.Document) -> bytes:
    prepare_for_save(document)
    return document.tobytes(
        garbage=garbage_level(document),
        deflate=True,
        use_objstms=False,
        encryption=pymupdf.PDF_ENCRYPT_NONE,
    )


@op("security.encrypt", EncryptParams)
def encrypt(params: EncryptParams, progress: Progress) -> EncryptResult:
    if not params.user_password and not params.owner_password:
        raise OpError(ErrorCode.INVALID_PARAMS, "a user or owner password is required")
    user_password = prepare_password(params.user_password, params.algorithm)
    typed_owner = prepare_password(params.owner_password, params.algorithm)
    restricted = params.permissions.to_flags() != Permissions().to_flags()
    if typed_owner and typed_owner == user_password and restricted:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the owner password must differ from the open password when permissions are limited",
            {"reason": "ownerEqualsUser"},
        )
    generated = "" if typed_owner else secrets.token_urlsafe(24)
    owner_password = typed_owner or generated
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        progress.report(0.5, "progress.saving")
        fits_mupdf = max(len(user_password), len(owner_password)) <= MUPDF_PASSWORD_CHARS
        if params.encrypt_metadata and fits_mupdf:
            saved = save_document(
                document,
                target,
                encryption=ALGORITHMS[params.algorithm],
                owner_pw=owner_password,
                user_pw=user_password,
                permissions=params.permissions.to_flags(),
            )
            return EncryptResult(
                output=saved.output,
                page_count=saved.page_count,
                bytes=saved.bytes,
                generated_owner_password=generated,
            )
        plain = _plain_bytes(document)
        page_count = document.page_count
    _write_with_handler(
        plain,
        target,
        lambda writer: _standard_handler(writer, params, user_password, owner_password),
    )
    return EncryptResult(
        output=str(target),
        page_count=page_count,
        bytes=target.stat().st_size,
        generated_owner_password=generated,
    )


def legacy_password_encodable(value: str) -> bool:
    from pyhanko.pdf_utils.generic import encode_pdfdocencoding

    try:
        encode_pdfdocencoding(value)
    except (UnicodeEncodeError, KeyError):
        return False
    return True


def _apply_permissions(flags, permissions: "Permissions"):
    granted = flags.allow_everything()
    rules = (
        (permissions.print, flags.ALLOW_PRINTING),
        (permissions.print_high_quality, flags.ALLOW_HIGH_QUALITY_PRINTING),
        (permissions.copy_text, flags.ALLOW_CONTENT_EXTRACTION),
        (permissions.modify, flags.ALLOW_MODIFICATION_GENERIC),
        (permissions.annotate, flags.ALLOW_ANNOTS_FORM_FILLING),
        (permissions.fill_forms, flags.ALLOW_FORM_FILLING),
        (permissions.accessibility, flags.ALLOW_ASSISTIVE_TECHNOLOGY),
        (permissions.assemble, flags.ALLOW_REASSEMBLY),
    )
    for allowed, flag in rules:
        if not allowed:
            granted &= ~flag
    return granted


def _standard_permissions(permissions: "Permissions"):
    from pyhanko.pdf_utils.crypt.permissions import StandardPermissions

    return _apply_permissions(StandardPermissions, permissions)


def _pubkey_permissions(permissions: "Permissions"):
    from pyhanko.pdf_utils.crypt.permissions import PubKeyPermissions

    return _apply_permissions(PubKeyPermissions, permissions)


def _write_with_handler(source: bytes, target: Path, build) -> None:
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.pdf_utils.writer import copy_into_new_writer

    writer = copy_into_new_writer(PdfFileReader(io.BytesIO(source)))
    writer._assign_security_handler(build(writer))
    forget_document(str(target))

    def write(partial: Path) -> None:
        with partial.open("wb") as out:
            writer.write(out)

    write_atomically(target, write)


def _standard_handler(writer, params: "EncryptParams", user_password: str, owner_password: str):
    from pyhanko.pdf_utils.crypt import StandardSecurityHandler, StandardSecuritySettingsRevision

    perms = _standard_permissions(params.permissions)
    if params.algorithm == "aes256":
        return StandardSecurityHandler.build_from_pw(
            owner_password,
            user_password,
            perms=perms,
            encrypt_metadata=params.encrypt_metadata,
        )
    return StandardSecurityHandler.build_from_pw_legacy(
        StandardSecuritySettingsRevision.RC4_OR_AES128,
        writer._document_id[0],
        owner_password,
        user_password,
        keylen_bytes=16,
        use_aes128=params.algorithm == "aes128",
        perms=perms,
        encrypt_metadata=params.encrypt_metadata,
    )


class DecryptParams(RpcModel):
    path: str
    password: str = Field(default="", repr=False)
    output: str
    overwrite: bool = False


@op("security.decrypt", DecryptParams)
def decrypt(params: DecryptParams, progress: Progress) -> OutputResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        if not document.metadata.get("encryption"):
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "document is not password protected",
                {"reason": "notEncrypted"},
            )
        progress.report(0.5, "progress.saving")
        return save_document(document, target, encryption=pymupdf.PDF_ENCRYPT_NONE)
