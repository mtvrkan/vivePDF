import hashlib
from pathlib import Path

from vivepdf.ops.sign import PERMISSION_NAMES, _subject_label
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

USER_TRUST_EXTENSIONS = {".cer", ".crt", ".pem", ".der"}
PEM_CERTIFICATE_KINDS = frozenset({"CERTIFICATE", "X509 CERTIFICATE"})
SIGNING_KEY_USAGES = frozenset({"digital_signature", "non_repudiation"})
SIGNING_EXTENDED_KEY_USAGES = frozenset(
    {"email_protection", "adobe_authentic_documents_trust", "1.3.6.1.5.5.7.3.36"}
)


def user_trust_dir() -> Path:
    from vivepdf.ops._appdata import user_data_dir

    directory = user_data_dir() / "trust"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _parse_certificate_bytes(data: bytes) -> list:
    from asn1crypto import pem, x509

    if pem.detect(data):
        return [
            x509.Certificate.load(der)
            for kind, _, der in pem.unarmor(data, multiple=True)
            if kind in PEM_CERTIFICATE_KINDS
        ]
    return [x509.Certificate.load(data)]


def _user_trust_roots() -> tuple:
    roots = []
    for path in sorted(user_trust_dir().glob("*")):
        if path.suffix.lower() not in USER_TRUST_EXTENSIONS or not path.is_file():
            continue
        try:
            roots.extend(_parse_certificate_bytes(path.read_bytes()))
        except Exception:  # noqa: BLE001
            continue
    return tuple(roots)


TRUST_PROBLEMS = {
    "NO_CERTIFICATE_CHAIN_FOUND": "noChain",
    "NO_SIGNING_CERTIFICATE_FOUND": "noChain",
    "CERTIFICATE_CHAIN_GENERAL_FAILURE": "noChain",
    "CHAIN_CONSTRAINTS_FAILURE": "notForSigning",
    "SIG_CONSTRAINTS_FAILURE": "notForSigning",
    "EXPIRED": "expired",
    "OUT_OF_BOUNDS_NO_POE": "expired",
    "OUT_OF_BOUNDS_NOT_REVOKED": "expired",
    "NOT_YET_VALID": "notYetValid",
    "REVOKED": "revoked",
    "REVOKED_NO_POE": "revoked",
    "REVOKED_CA_NO_POE": "revoked",
    "TRY_LATER": "revocationUnknown",
    "REVOCATION_OUT_OF_BOUNDS_NO_POE": "revocationUnknown",
    "CRYPTO_CONSTRAINTS_FAILURE": "weakAlgorithm",
    "CRYPTO_CONSTRAINTS_FAILURE_NO_POE": "weakAlgorithm",
}


def _trust_problem(status) -> str | None:
    if status.trusted:
        return None
    certificate = getattr(status, "signing_cert", None)
    if certificate is not None and certificate.self_signed != "no":
        return "selfSigned"
    indicator = status.trust_problem_indic
    if indicator is None:
        return "other"
    return TRUST_PROBLEMS.get(indicator.name, "other")


def _certificate_digest(certificate) -> bytes:
    return hashlib.sha256(certificate.dump()).digest()


def _trust_source(status, user: frozenset[bytes]) -> str:
    path = getattr(status, "validation_path", None)
    anchor = getattr(path, "trust_anchor", None) if path is not None else None
    certificate = getattr(anchor, "certificate", None)
    if certificate is None:
        return "none"
    return "user" if _certificate_digest(certificate) in user else "none"


def _signing_key_usage():
    from pyhanko.sign.validation.settings import KeyUsageConstraints

    return KeyUsageConstraints(
        key_usage=SIGNING_KEY_USAGES,
        extd_key_usage=SIGNING_EXTENDED_KEY_USAGES,
        explicit_extd_key_usage_required=False,
    )


class VerifyParams(RpcModel):
    path: str
    password: str | None = None
    online: bool = False


class SignatureInfo(RpcModel):
    field_name: str
    signer: str
    signed_at: str | None
    intact: bool
    valid: bool
    trusted: bool
    revoked: bool | None
    trust_source: str
    trust_problem: str | None = None
    coverage: str
    modification_level: str | None
    reason: str | None
    location: str | None
    summary: str
    modified: bool = False
    certified: bool = False
    permission: str | None = None


def _is_certification(embedded) -> bool:
    try:
        references = embedded.sig_object.get("/Reference") or []
        return any(
            reference.get_object().get("/TransformMethod") == "/DocMDP" for reference in references
        )
    except Exception:  # noqa: BLE001
        return False


def _permission_name(embedded) -> str | None:
    try:
        level = embedded.docmdp_level
    except Exception:  # noqa: BLE001
        return None
    return PERMISSION_NAMES.get(level.value) if level is not None else None


class VerifyResult(RpcModel):
    signatures: list[SignatureInfo]


@op("sign.verify", VerifyParams)
def verify(params: VerifyParams, progress: Progress) -> VerifyResult:
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko_certvalidator import ValidationContext

    source = Path(params.path)
    if not source.is_file():
        raise OpError(
            ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}", {"path": params.path}
        )
    user_roots = _user_trust_roots()
    user_digests = frozenset(_certificate_digest(root) for root in user_roots)
    context = ValidationContext(trust_roots=list(user_roots), allow_fetching=params.online)
    key_usage = _signing_key_usage()
    signatures: list[SignatureInfo] = []
    try:
        with open(source, "rb") as handle:
            reader = PdfFileReader(handle, strict=False)
            if reader.encrypted:
                from pyhanko.pdf_utils.crypt import AuthStatus

                if reader.decrypt(params.password or "").status == AuthStatus.FAILED:
                    raise OpError(
                        ErrorCode.NEEDS_PASSWORD,
                        "document requires a password",
                        {"wrongPassword": bool(params.password)},
                    )
            for embedded in reader.embedded_signatures:
                progress.check_cancelled()
                try:
                    status = validate_pdf_signature(embedded, context, key_usage_settings=key_usage)
                    signer_name = (
                        _subject_label(status.signing_cert) if status.signing_cert else "?"
                    )
                    signed_at = (
                        status.signer_reported_dt.isoformat() if status.signer_reported_dt else None
                    )
                    trust_problem = _trust_problem(status)
                    revoked = trust_problem == "revoked" if params.online else None
                    trust_source = _trust_source(status, user_digests) if status.trusted else "none"
                    signatures.append(
                        SignatureInfo(
                            field_name=embedded.field_name,
                            signer=signer_name,
                            signed_at=signed_at,
                            intact=bool(status.intact),
                            valid=bool(status.valid),
                            trusted=bool(status.trusted),
                            revoked=revoked,
                            trust_source=trust_source,
                            trust_problem=trust_problem,
                            coverage=str(status.coverage.name if status.coverage else "UNKNOWN"),
                            modification_level=status.modification_level.name
                            if status.modification_level
                            else None,
                            reason=embedded.sig_object.get("/Reason"),
                            location=embedded.sig_object.get("/Location"),
                            summary=status.summary(),
                            modified=status.docmdp_ok is False,
                            certified=_is_certification(embedded),
                            permission=_permission_name(embedded),
                        )
                    )
                except Exception as error:  # noqa: BLE001
                    signatures.append(
                        SignatureInfo(
                            field_name=embedded.field_name,
                            signer="?",
                            signed_at=None,
                            intact=False,
                            valid=False,
                            trusted=False,
                            revoked=None,
                            trust_source="none",
                            coverage="UNKNOWN",
                            modification_level=None,
                            reason=None,
                            location=None,
                            summary=f"validation failed: {error}",
                        )
                    )
    except OpError:
        raise
    except Exception as error:  # noqa: BLE001
        raise OpError(ErrorCode.INVALID_PDF, f"cannot read signatures: {error}") from error
    return VerifyResult(signatures=signatures)
