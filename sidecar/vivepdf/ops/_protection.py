import io
import re
import secrets
from dataclasses import dataclass
from pathlib import Path

import pymupdf

from vivepdf.ops._document import forget_document
from vivepdf.ops._output import (
    OutputResult,
    garbage_level,
    prepare_for_save,
    save_document,
    write_atomically,
)
from vivepdf.ops._passwords import matching_password, password_variants
from vivepdf.ops.security import MUPDF_PASSWORD_CHARS, _plain_bytes, _write_with_handler

USER_ROLE = 2
OWNER_ROLE = 4
PERMISSION_VALUE = re.compile(r"/P\s*(-?\d+)")


@dataclass(frozen=True)
class Protection:
    method: int
    user_password: str
    owner_password: str
    permissions: int
    owner_password_known: bool

    def save_options(self) -> dict[str, object]:
        return {
            "encryption": self.method,
            "user_pw": self.user_password,
            "owner_pw": self.owner_password,
            "permissions": self.permissions,
        }

    def fits_mupdf(self) -> bool:
        return max(len(self.user_password), len(self.owner_password)) <= MUPDF_PASSWORD_CHARS

    def security_handler(self, writer):
        from pyhanko.pdf_utils.crypt import (
            StandardSecurityHandler,
            StandardSecuritySettingsRevision,
        )
        from pyhanko.pdf_utils.crypt.permissions import StandardPermissions

        perms = StandardPermissions.from_sint32(self.permissions)
        if self.method == pymupdf.PDF_ENCRYPT_AES_256:
            return StandardSecurityHandler.build_from_pw(
                self.owner_password, self.user_password, perms=perms
            )
        rc4_40 = self.method == pymupdf.PDF_ENCRYPT_RC4_40
        return StandardSecurityHandler.build_from_pw_legacy(
            StandardSecuritySettingsRevision.RC4_BASIC
            if rc4_40
            else StandardSecuritySettingsRevision.RC4_OR_AES128,
            writer._document_id[0],
            self.owner_password,
            self.user_password,
            keylen_bytes=5 if rc4_40 else 16,
            use_aes128=self.method == pymupdf.PDF_ENCRYPT_AES_128,
            perms=perms,
        )


def encryption_description(document: pymupdf.Document) -> str | None:
    try:
        return (document.metadata or {}).get("encryption") or None
    except Exception:  # noqa: BLE001
        return None


def is_protected(document: pymupdf.Document) -> bool:
    return encryption_description(document) is not None


def _method(description: str) -> int:
    text = description.upper()
    if "AES" in text:
        return pymupdf.PDF_ENCRYPT_AES_256 if "256" in text else pymupdf.PDF_ENCRYPT_AES_128
    if "40-BIT" in text:
        return pymupdf.PDF_ENCRYPT_RC4_40
    return pymupdf.PDF_ENCRYPT_RC4_128


def _permission_flags(document: pymupdf.Document) -> int:
    try:
        kind, value = document.xref_get_key(-1, "Encrypt")
        if kind == "xref":
            kind, value = document.xref_get_key(int(value.split()[0]), "P")
            if kind == "int":
                return int(value)
        elif kind == "dict":
            found = PERMISSION_VALUE.search(value)
            if found:
                return int(found.group(1))
    except Exception:  # noqa: BLE001
        pass
    return int(document.permissions)


def _password_roles(path: str, password: str | None) -> tuple[bool, int, str]:
    try:
        with pymupdf.open(path) as probe:
            opens_with_password = bool(probe.needs_pass)
            roles, accepted = matching_password(probe, password) if password else (0, None)
            return opens_with_password, roles, accepted or password or ""
    except Exception:  # noqa: BLE001
        return bool(password), 0, password or ""


def protection_of(document: pymupdf.Document, path: str, password: str | None) -> Protection | None:
    description = encryption_description(document)
    if description is None:
        return None
    opens_with_password, roles, typed = _password_roles(path, password)
    user_password = typed if opens_with_password else ""
    if roles & OWNER_ROLE:
        owner_password, owner_known = typed, True
    else:
        owner_password, owner_known = secrets.token_urlsafe(24), False
    return Protection(
        method=_method(description),
        user_password=user_password,
        owner_password=owner_password,
        permissions=_permission_flags(document),
        owner_password_known=owner_known,
    )


KEPT_ROOT_KEYS = ("/Type", "/Pages")


def _clear_root(pdf) -> None:
    for key in list(pdf.Root.keys()):
        if key not in KEPT_ROOT_KEYS:
            del pdf.Root[key]


class SourceSeal:
    def __init__(self, holder) -> None:
        self._holder = holder
        _clear_root(holder)

    def write(self, plain: bytes, target: Path) -> None:
        import pikepdf

        holder = self._holder
        with pikepdf.open(io.BytesIO(plain)) as content:
            del holder.pages[:]
            holder.pages.extend(content.pages)
            _clear_root(holder)
            for key, value in content.Root.items():
                if key in KEPT_ROOT_KEYS:
                    continue
                source = value if value.is_indirect else content.make_indirect(value)
                holder.Root[key] = holder.copy_foreign(source)
            write_atomically(
                target,
                lambda partial: holder.save(
                    partial, encryption=True, object_stream_mode=pikepdf.ObjectStreamMode.generate
                ),
            )

    def close(self) -> None:
        self._holder.close()

    def __enter__(self) -> "SourceSeal":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


def open_seal(path: str, password: str | None) -> SourceSeal | None:
    import pikepdf

    holder = None
    for variant in password_variants(password or ""):
        try:
            holder = pikepdf.open(path, password=variant)
            break
        except Exception:  # noqa: BLE001
            continue
    if holder is None:
        return None
    if not holder.is_encrypted:
        holder.close()
        return None
    return SourceSeal(holder)


def save_sealed(document: pymupdf.Document, target: Path, seal: SourceSeal) -> OutputResult:
    if target.exists():
        forget_document(str(target))
    prepare_for_save(document)
    seal.write(
        document.tobytes(garbage=garbage_level(document), deflate=True, use_objstms=True), target
    )
    return OutputResult(
        output=str(target), page_count=document.page_count, bytes=target.stat().st_size
    )


def _save_through_pyhanko(
    document: pymupdf.Document, target: Path, protection: Protection
) -> OutputResult:
    page_count = document.page_count
    _write_with_handler(_plain_bytes(document), target, protection.security_handler)
    return OutputResult(output=str(target), page_count=page_count, bytes=target.stat().st_size)


def save_protected(
    document: pymupdf.Document,
    target: Path,
    seal: SourceSeal | None,
    protection: Protection | None,
) -> OutputResult:
    if seal is not None:
        return save_sealed(document, target, seal)
    if protection is not None and not protection.fits_mupdf():
        return _save_through_pyhanko(document, target, protection)
    return save_document(document, target, **(protection.save_options() if protection else {}))


def protection_source(
    source: pymupdf.Document, path: str, password: str | None
) -> tuple[SourceSeal | None, Protection | None]:
    if not is_protected(source):
        return None, None
    seal = open_seal(path, password)
    if seal is not None:
        return seal, None
    return None, protection_of(source, path, password)
