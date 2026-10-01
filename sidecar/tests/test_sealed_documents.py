import datetime
from pathlib import Path

import pymupdf
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from vivepdf.ops._document import open_document
from vivepdf.ops.security import EncryptParams, encrypt
from vivepdf.ops.security_certificate import EncryptCertificateParams, encrypt_certificate
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def plain(tmp_path: Path) -> Path:
    document = pymupdf.open()
    document.new_page().insert_text((72, 100), "GIZLI ICERIK", fontsize=14)
    path = tmp_path / "source.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def sealed(tmp_path: Path, plain: Path) -> Path:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "alan")])
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
                key_encipherment=True,
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
    public = tmp_path / "alan.cer"
    public.write_bytes(certificate.public_bytes(serialization.Encoding.DER))
    target = tmp_path / "sealed.pdf"
    encrypt_certificate(
        EncryptCertificateParams(path=str(plain), output=str(target), certificates=[str(public)]),
        silent_progress(),
    )
    return target


def test_a_certificate_sealed_file_says_what_it_is(sealed: Path):
    with pytest.raises(OpError) as raised, open_document(str(sealed), None):
        pass
    assert raised.value.code == ErrorCode.CERTIFICATE_SEALED


def test_a_password_protected_file_still_asks_for_a_password(plain: Path, tmp_path: Path):
    target = tmp_path / "locked.pdf"
    encrypt(
        EncryptParams(path=str(plain), output=str(target), userPassword="pw"), silent_progress()
    )
    with pytest.raises(OpError) as raised, open_document(str(target), None):
        pass
    assert raised.value.code == ErrorCode.NEEDS_PASSWORD


def test_a_file_that_is_simply_broken_is_still_called_broken(tmp_path: Path):
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"not a pdf at all\n" * 40)
    with pytest.raises(OpError) as raised, open_document(str(path), None):
        pass
    assert raised.value.code == ErrorCode.INVALID_PDF
