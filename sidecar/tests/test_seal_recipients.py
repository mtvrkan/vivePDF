import datetime
from pathlib import Path

import pymupdf
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID
from pyhanko.pdf_utils.reader import PdfFileReader

from vivepdf.ops.security_certificate import (
    DecryptCertificateParams,
    EncryptCertificateParams,
    decrypt_certificate,
    encrypt_certificate,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _holder(
    tmp_path: Path, name: str, kind: str, password: bytes = b"", expired: bool = False
) -> tuple[Path, Path]:
    key = (
        rsa.generate_private_key(public_exponent=65537, key_size=2048)
        if kind == "rsa"
        else ec.generate_private_key(ec.SECP256R1())
    )
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    now = datetime.datetime.now(datetime.UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=60 if expired else 0))
        .not_valid_after(now + datetime.timedelta(days=-1 if expired else 30))
        .sign(key, hashes.SHA256())
    )
    public = tmp_path / f"{name}.cer"
    public.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    private = tmp_path / f"{name}.p12"
    protection = (
        serialization.BestAvailableEncryption(password)
        if password
        else serialization.NoEncryption()
    )
    private.write_bytes(
        pkcs12.serialize_key_and_certificates(name.encode(), key, certificate, None, protection)
    )
    return public, private


def test_an_ec_certificate_is_refused_as_a_recipient(sample_pdf: Path, tmp_path: Path) -> None:
    rsa_public, _ = _holder(tmp_path, "rsa", "rsa")
    ec_public, _ = _holder(tmp_path, "ec", "ec")
    target = tmp_path / "sealed.pdf"
    with pytest.raises(OpError) as caught:
        encrypt_certificate(
            EncryptCertificateParams(
                path=str(sample_pdf),
                output=str(target),
                certificates=[str(rsa_public), str(ec_public)],
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "encryptionNeedsRsa"}
    assert not target.exists()


def test_every_recipient_can_open_and_a_stranger_cannot(sample_pdf: Path, tmp_path: Path) -> None:
    first = _holder(tmp_path, "Ayşe Çınar", "rsa", "şifre".encode())
    second = _holder(tmp_path, "Bob", "rsa")
    stranger = _holder(tmp_path, "Eve", "rsa")
    sealed = tmp_path / "sealed.pdf"
    result = encrypt_certificate(
        EncryptCertificateParams(
            path=str(sample_pdf), output=str(sealed), certificates=[str(first[0]), str(second[0])]
        ),
        silent_progress(),
    )
    assert result.recipients == ["Ayşe Çınar", "Bob"]
    for label, holder, password in (("first", first[1], "şifre"), ("second", second[1], "")):
        opened = tmp_path / f"{label}.pdf"
        decrypt_certificate(
            DecryptCertificateParams(
                path=str(sealed),
                output=str(opened),
                certificate_path=str(holder),
                certificate_password=password,
            ),
            silent_progress(),
        )
        with pymupdf.open(opened) as document:
            assert not document.needs_pass
            assert "Page 1" in document[0].get_text()
    with pytest.raises(OpError) as caught:
        decrypt_certificate(
            DecryptCertificateParams(
                path=str(sealed),
                output=str(tmp_path / "stranger.pdf"),
                certificate_path=str(stranger[1]),
            ),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "certificateMismatch"}
    assert not (tmp_path / "stranger.pdf").exists()


def test_a_password_protected_file_is_named_as_such(encrypted_pdf: Path, tmp_path: Path) -> None:
    _, private = _holder(tmp_path, "Bob", "rsa")
    with pytest.raises(OpError) as caught:
        decrypt_certificate(
            DecryptCertificateParams(
                path=str(encrypted_pdf),
                output=str(tmp_path / "out.pdf"),
                certificate_path=str(private),
            ),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "passwordNotCertificate"}


@pytest.mark.parametrize(("algorithm", "version"), [("aes256", 5), ("aes128", 4)])
def test_the_chosen_algorithm_reaches_the_sealed_file(
    sample_pdf: Path, tmp_path: Path, algorithm: str, version: int
) -> None:
    public, private = _holder(tmp_path, "Bob", "rsa")
    sealed = tmp_path / f"{algorithm}.pdf"
    encrypt_certificate(
        EncryptCertificateParams(
            path=str(sample_pdf),
            output=str(sealed),
            certificates=[str(public)],
            algorithm=algorithm,
        ),
        silent_progress(),
    )
    with sealed.open("rb") as handle:
        encryption = PdfFileReader(handle).encrypt_dict
        assert encryption["/V"] == version
        if algorithm != "aes256":
            method = encryption["/CF"]["/DefaultCryptFilter"]["/CFM"]
            assert method == ("/AESV2" if algorithm == "aes128" else "/V2")
    opened = tmp_path / f"{algorithm}-open.pdf"
    decrypt_certificate(
        DecryptCertificateParams(
            path=str(sealed), output=str(opened), certificate_path=str(private)
        ),
        silent_progress(),
    )
    with pymupdf.open(opened) as document:
        assert "Page 1" in document[0].get_text()


def test_rc4_is_refused_for_a_certificate_seal(sample_pdf: Path, tmp_path: Path) -> None:
    public, _ = _holder(tmp_path, "Carol", "rsa")
    target = tmp_path / "rc4.pdf"
    with pytest.raises(OpError) as caught:
        encrypt_certificate(
            EncryptCertificateParams(
                path=str(sample_pdf),
                output=str(target),
                certificates=[str(public)],
                algorithm="rc4",
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "rc4NotForCertificates"}
    assert not target.exists()


def _sealed_for(sample_pdf: Path, tmp_path: Path, public: Path) -> Path:
    sealed = tmp_path / "sealed-for.pdf"
    encrypt_certificate(
        EncryptCertificateParams(
            path=str(sample_pdf), output=str(sealed), certificates=[str(public)]
        ),
        silent_progress(),
    )
    return sealed


def _open_with(sealed: Path, tmp_path: Path, holder: Path, password: str) -> Path:
    opened = tmp_path / "opened.pdf"
    decrypt_certificate(
        DecryptCertificateParams(
            path=str(sealed),
            output=str(opened),
            overwrite=True,
            certificate_path=str(holder),
            certificate_password=password,
        ),
        silent_progress(),
    )
    return opened


def test_a_key_file_without_a_password_opens_the_seal(sample_pdf: Path, tmp_path: Path) -> None:
    public, private = _holder(tmp_path, "Dave", "rsa")
    opened = _open_with(_sealed_for(sample_pdf, tmp_path, public), tmp_path, private, "")
    with pymupdf.open(opened) as document:
        assert "Page 1" in document[0].get_text()


def test_a_wrong_key_file_password_is_named(sample_pdf: Path, tmp_path: Path) -> None:
    public, private = _holder(tmp_path, "Erin", "rsa", password=b"right-one")
    sealed = _sealed_for(sample_pdf, tmp_path, public)
    with pytest.raises(OpError) as caught:
        _open_with(sealed, tmp_path, private, "wrong-one")
    assert caught.value.data == {"reason": "certificatePassword"}
    with pytest.raises(OpError) as missing:
        _open_with(sealed, tmp_path, private, "")
    assert missing.value.data == {"reason": "certificatePassword"}
    with pymupdf.open(_open_with(sealed, tmp_path, private, "right-one")) as document:
        assert "Page 1" in document[0].get_text()


def test_a_file_that_is_not_a_key_file_is_named(sample_pdf: Path, tmp_path: Path) -> None:
    public, _ = _holder(tmp_path, "Faye", "rsa")
    sealed = _sealed_for(sample_pdf, tmp_path, public)
    with pytest.raises(OpError) as caught:
        _open_with(sealed, tmp_path, public, "")
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "keyFileFormat"}


def test_an_expired_recipient_is_reported_but_still_sealed(
    sample_pdf: Path, tmp_path: Path
) -> None:
    current, _ = _holder(tmp_path, "Gail", "rsa")
    expired, _ = _holder(tmp_path, "Hank", "rsa", expired=True)
    result = encrypt_certificate(
        EncryptCertificateParams(
            path=str(sample_pdf),
            output=str(tmp_path / "mixed.pdf"),
            certificates=[str(current), str(expired)],
        ),
        silent_progress(),
    )
    assert result.recipients == ["Gail", "Hank"]
    assert result.expired_recipients == ["Hank"]
