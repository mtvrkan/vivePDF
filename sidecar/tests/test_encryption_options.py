import datetime
import re
from pathlib import Path

import pymupdf
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

from vivepdf.ops.security import EncryptParams, encrypt
from vivepdf.ops.security_certificate import (
    DecryptCertificateParams,
    EncryptCertificateParams,
    decrypt_certificate,
    encrypt_certificate,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def document(tmp_path: Path) -> Path:
    opened = pymupdf.open()
    opened.new_page().insert_text((72, 100), "GIZLI ICERIK", fontsize=14)
    opened.set_metadata({"title": "Acik Ustveri", "author": "QA"})
    path = tmp_path / "source.pdf"
    opened.save(path)
    opened.close()
    return path


def _recipient(tmp_path: Path, name: str, encipherment: bool) -> tuple[Path, Path]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    now = datetime.datetime.now(datetime.UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=encipherment,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )
    public = tmp_path / f"{name}.cer"
    public.write_bytes(certificate.public_bytes(serialization.Encoding.DER))
    holder = tmp_path / f"{name}.p12"
    holder.write_bytes(
        pkcs12.serialize_key_and_certificates(
            name.encode(),
            key,
            certificate,
            None,
            serialization.BestAvailableEncryption(b"holder"),
        )
    )
    return public, holder


def _encrypt_metadata_marker(path: Path) -> str | None:
    found = re.search(rb"/EncryptMetadata\s*(true|false)", path.read_bytes())
    return found.group(1).decode() if found else None


def test_metadata_stays_encrypted_by_default(document: Path, tmp_path: Path) -> None:
    target = tmp_path / "sealed.pdf"
    encrypt(
        EncryptParams(path=str(document), output=str(target), userPassword="pw"), silent_progress()
    )
    reader = pymupdf.open(target)
    assert reader.authenticate("pw")
    assert reader.metadata.get("encryption", "").startswith("Standard V5")
    reader.close()


def test_metadata_can_be_left_readable(document: Path, tmp_path: Path) -> None:
    target = tmp_path / "open-metadata.pdf"
    encrypt(
        EncryptParams(
            path=str(document), output=str(target), userPassword="pw", encryptMetadata=False
        ),
        silent_progress(),
    )
    assert _encrypt_metadata_marker(target) == "false"
    reader = pymupdf.open(target)
    assert reader.authenticate("pw")
    assert reader.page_count == 1
    reader.close()


@pytest.mark.parametrize(
    ("algorithm", "expected"),
    [("aes256", "256-bit AES"), ("aes128", "128-bit AES"), ("rc4", "128-bit RC4")],
)
def test_readable_metadata_works_for_every_algorithm(
    document: Path, tmp_path: Path, algorithm: str, expected: str
) -> None:
    target = tmp_path / f"{algorithm}.pdf"
    encrypt(
        EncryptParams(
            path=str(document),
            output=str(target),
            userPassword="pw",
            algorithm=algorithm,
            encryptMetadata=False,
        ),
        silent_progress(),
    )
    assert _encrypt_metadata_marker(target) == "false"
    reader = pymupdf.open(target)
    assert reader.authenticate("pw")
    assert expected in reader.metadata.get("encryption", "")
    reader.close()


def test_certificate_encryption_seals_for_the_recipient(document: Path, tmp_path: Path) -> None:
    public, _holder = _recipient(tmp_path, "alici", True)
    target = tmp_path / "pubsec.pdf"
    result = encrypt_certificate(
        EncryptCertificateParams(
            path=str(document), output=str(target), certificates=[str(public)]
        ),
        silent_progress(),
    )
    assert result.recipients == ["alici"]
    raw = target.read_bytes()
    assert b"/Adobe.PubSec" in raw
    assert b"/Recipients" in raw


def test_certificate_roundtrip(document: Path, tmp_path: Path) -> None:
    public, holder = _recipient(tmp_path, "alici", True)
    sealed = tmp_path / "pubsec.pdf"
    encrypt_certificate(
        EncryptCertificateParams(
            path=str(document), output=str(sealed), certificates=[str(public)]
        ),
        silent_progress(),
    )
    opened = tmp_path / "opened.pdf"
    result = decrypt_certificate(
        DecryptCertificateParams(
            path=str(sealed),
            output=str(opened),
            certificatePath=str(holder),
            certificatePassword="holder",
        ),
        silent_progress(),
    )
    assert result.page_count == 1
    reader = pymupdf.open(opened)
    assert "GIZLI ICERIK" in reader[0].get_text()
    reader.close()


def test_a_signing_certificate_is_refused_for_encryption(document: Path, tmp_path: Path) -> None:
    public, _holder = _recipient(tmp_path, "imzaci", False)
    target = tmp_path / "refused.pdf"
    with pytest.raises(OpError) as error:
        encrypt_certificate(
            EncryptCertificateParams(
                path=str(document), output=str(target), certificates=[str(public)]
            ),
            silent_progress(),
        )
    assert error.value.code is ErrorCode.INVALID_PARAMS
    assert error.value.data == {"reason": "certificateUsage"}
    assert not target.exists()


def test_a_wrong_certificate_cannot_open_a_sealed_file(document: Path, tmp_path: Path) -> None:
    public, _holder = _recipient(tmp_path, "alici", True)
    _other_public, other_holder = _recipient(tmp_path, "baskasi", True)
    sealed = tmp_path / "pubsec.pdf"
    encrypt_certificate(
        EncryptCertificateParams(
            path=str(document), output=str(sealed), certificates=[str(public)]
        ),
        silent_progress(),
    )
    opened = tmp_path / "opened.pdf"
    with pytest.raises(OpError) as error:
        decrypt_certificate(
            DecryptCertificateParams(
                path=str(sealed),
                output=str(opened),
                certificatePath=str(other_holder),
                certificatePassword="holder",
            ),
            silent_progress(),
        )
    assert error.value.code is ErrorCode.INVALID_PARAMS
    assert not opened.exists()


def test_a_file_that_is_not_a_certificate_is_refused(document: Path, tmp_path: Path) -> None:
    junk = tmp_path / "notes.txt"
    junk.write_text("not a certificate", encoding="utf-8")
    with pytest.raises(OpError) as error:
        encrypt_certificate(
            EncryptCertificateParams(
                path=str(document),
                output=str(tmp_path / "out.pdf"),
                certificates=[str(junk)],
            ),
            silent_progress(),
        )
    assert error.value.data == {"reason": "certificateFormat"}


def test_pyhanko_reads_a_copy_without_object_streams(
    document: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from vivepdf.ops import security, security_certificate

    handed: list[bytes] = []
    original = security._write_with_handler

    def capture(source: bytes, target: Path, build) -> None:
        handed.append(source)
        original(source, target, build)

    monkeypatch.setattr(security, "_write_with_handler", capture)
    monkeypatch.setattr(security_certificate, "_write_with_handler", capture)
    public, _holder = _recipient(tmp_path, "alici", True)
    encrypt(
        EncryptParams(
            path=str(document),
            output=str(tmp_path / "pw.pdf"),
            userPassword="pw",
            encryptMetadata=False,
        ),
        silent_progress(),
    )
    encrypt_certificate(
        EncryptCertificateParams(
            path=str(document), output=str(tmp_path / "cert.pdf"), certificates=[str(public)]
        ),
        silent_progress(),
    )
    assert len(handed) == 2
    assert all(b"/ObjStm" not in data for data in handed)
