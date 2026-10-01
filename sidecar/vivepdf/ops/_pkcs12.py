from pathlib import Path

from vivepdf.rpc.errors import ErrorCode, OpError


def _refusal(reason: str, message: str) -> OpError:
    return OpError(ErrorCode.INVALID_PARAMS, message, {"reason": reason})


def _is_pfx(data: bytes) -> bool:
    from asn1crypto import pkcs12

    try:
        pfx = pkcs12.Pfx.load(data, strict=True)
        return pfx["auth_safe"]["content_type"].native in ("data", "signed_data")
    except Exception:  # noqa: BLE001
        return False


def _passphrases(password: str) -> list[bytes | None]:
    return [password.encode("utf-8")] if password else [None, b""]


def unlock_pkcs12(
    path: Path, password: str, require_key: bool = True
) -> tuple[bytes, bytes | None]:
    from cryptography.exceptions import UnsupportedAlgorithm
    from cryptography.hazmat.primitives.serialization import pkcs12

    try:
        data = path.read_bytes()
    except OSError as error:
        raise OpError(
            ErrorCode.FILE_NOT_FOUND, f"certificate not found: {path.name}", {"path": str(path)}
        ) from error
    for passphrase in _passphrases(password):
        try:
            key, certificate, _others = pkcs12.load_key_and_certificates(data, passphrase)
        except UnsupportedAlgorithm as error:
            raise _refusal(
                "certificateLegacy", f"the key file uses an unsupported cipher: {path.name}"
            ) from error
        except (ValueError, TypeError):
            continue
        if certificate is None or (require_key and key is None):
            raise _refusal("keyFileFormat", f"no private key and certificate in: {path.name}")
        return data, passphrase
    if not _is_pfx(data):
        raise _refusal("keyFileFormat", f"not a .p12 or .pfx key file: {path.name}")
    raise _refusal("certificatePassword", f"wrong password for: {path.name}")
