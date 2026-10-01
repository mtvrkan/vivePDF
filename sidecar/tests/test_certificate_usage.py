import os
import stat
from pathlib import Path

import pymupdf
import pytest
from cryptography import x509
from cryptography.hazmat.primitives.serialization import pkcs12

from vivepdf.ops.security_certificate import EncryptCertificateParams, encrypt_certificate
from vivepdf.ops.sign_certificate import (
    CreateCertificateParams,
    ExportCertificateParams,
    create_certificate,
    export_certificate,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _made(tmp_path: Path, name: str, usage: str, key_type: str = "rsa") -> Path:
    result = create_certificate(
        CreateCertificateParams(
            output=str(tmp_path / f"{name}.p12"),
            password="holder-password",
            common_name=name,
            usage=usage,
            key_type=key_type,
        ),
        silent_progress(),
    )
    return Path(result.output)


def _usage(holder: Path) -> x509.KeyUsage:
    _key, certificate, _chain = pkcs12.load_key_and_certificates(
        holder.read_bytes(), b"holder-password"
    )
    assert certificate is not None
    return certificate.extensions.get_extension_for_class(x509.KeyUsage).value


def test_a_signing_certificate_only_signs(tmp_path: Path):
    usage = _usage(_made(tmp_path, "imza", "signing"))
    assert usage.digital_signature
    assert not usage.key_encipherment


def test_a_certificate_for_receiving_documents_can_receive_a_key(tmp_path: Path):
    usage = _usage(_made(tmp_path, "alici", "encryption"))
    assert usage.key_encipherment
    assert not usage.digital_signature


def test_a_certificate_can_do_both(tmp_path: Path):
    usage = _usage(_made(tmp_path, "ikisi", "both"))
    assert usage.digital_signature
    assert usage.key_encipherment


def test_an_elliptic_curve_key_cannot_receive_documents(tmp_path: Path):
    with pytest.raises(OpError):
        create_certificate(
            CreateCertificateParams(
                output=str(tmp_path / "ec.p12"),
                password="holder-password",
                common_name="ec",
                usage="encryption",
                key_type="ec",
            ),
            silent_progress(),
        )


def test_the_public_half_can_be_exported_and_used_to_seal(tmp_path: Path):
    holder = _made(tmp_path, "alici", "encryption")
    public = export_certificate(
        ExportCertificateParams(
            path=str(holder), password="holder-password", output=str(tmp_path / "alici.cer")
        ),
        silent_progress(),
    )
    assert Path(public.output).suffix == ".cer"
    assert "CN=alici" in public.subject

    document = pymupdf.open()
    document.new_page().insert_text((72, 100), "GIZLI", fontsize=14)
    source = tmp_path / "source.pdf"
    document.save(source)
    document.close()

    sealed = tmp_path / "sealed.pdf"
    encrypt_certificate(
        EncryptCertificateParams(
            path=str(source), output=str(sealed), certificates=[public.output]
        ),
        silent_progress(),
    )
    assert b"/Adobe.PubSec" in sealed.read_bytes()


def test_the_wrong_password_is_refused_by_name(tmp_path: Path):
    holder = _made(tmp_path, "imza", "signing")
    with pytest.raises(OpError):
        export_certificate(
            ExportCertificateParams(
                path=str(holder), password="yanlis", output=str(tmp_path / "out.cer")
            ),
            silent_progress(),
        )


def _params(tmp_path: Path, **extra) -> CreateCertificateParams:
    values = {
        "output": str(tmp_path / "key.p12"),
        "password": "holder-password",
        "common_name": "Ayşe",
        "key_type": "ec",
    }
    values.update(extra)
    return CreateCertificateParams(**values)


def test_a_short_key_password_is_refused(tmp_path: Path):
    with pytest.raises(OpError) as raised:
        create_certificate(_params(tmp_path, password="1234567"), silent_progress())
    assert raised.value.code == ErrorCode.INVALID_PARAMS
    assert raised.value.data == {"reason": "passwordTooShort", "minimum": 8}
    assert not (tmp_path / "key.p12").exists()


@pytest.mark.parametrize("field", ["common_name", "organization"])
def test_a_name_longer_than_the_standard_allows_is_refused(tmp_path: Path, field: str):
    with pytest.raises(OpError) as raised:
        create_certificate(_params(tmp_path, **{field: "ş" * 33}), silent_progress())
    assert raised.value.data["reason"] == "nameTooLong"
    assert create_certificate(_params(tmp_path, **{field: "ş" * 32}), silent_progress()).subject
    assert create_certificate(
        _params(tmp_path, output=str(tmp_path / "ascii.p12"), **{field: "a" * 64}),
        silent_progress(),
    ).subject


def test_an_existing_key_file_needs_its_own_confirmation(tmp_path: Path):
    first = Path(create_certificate(_params(tmp_path), silent_progress()).output)
    before = first.read_bytes()
    with pytest.raises(OpError) as asked:
        create_certificate(_params(tmp_path), silent_progress())
    assert asked.value.data["exists"] is True
    with pytest.raises(OpError) as refused:
        create_certificate(_params(tmp_path, overwrite=True), silent_progress())
    assert refused.value.data["reason"] == "replaceKey"
    assert first.read_bytes() == before
    create_certificate(_params(tmp_path, overwrite=True, replace_key=True), silent_progress())
    assert first.read_bytes() != before
    assert not list(tmp_path.glob(".vivepdf-*.part"))


def test_a_signing_certificate_names_document_signing(tmp_path: Path):
    holder = Path(create_certificate(_params(tmp_path), silent_progress()).output)
    _key, certificate, _chain = pkcs12.load_key_and_certificates(
        holder.read_bytes(), b"holder-password"
    )
    purposes = certificate.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value
    assert x509.ObjectIdentifier("1.3.6.1.5.5.7.3.36") in purposes
    receiving = _made(tmp_path, "alici", "encryption")
    _key, receiver, _chain = pkcs12.load_key_and_certificates(
        receiving.read_bytes(), b"holder-password"
    )
    receiver_purposes = receiver.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value
    assert x509.ObjectIdentifier("1.3.6.1.5.5.7.3.36") not in receiver_purposes


@pytest.mark.skipif(os.name == "nt", reason="POSIX file modes")
def test_the_key_file_is_readable_only_by_its_owner(tmp_path: Path):
    holder = Path(create_certificate(_params(tmp_path), silent_progress()).output)
    assert stat.S_IMODE(holder.stat().st_mode) == 0o600


def test_export_names_a_wrong_password_and_a_non_key_file(tmp_path: Path):
    holder = _made(tmp_path, "imza", "signing")
    with pytest.raises(OpError) as wrong:
        export_certificate(
            ExportCertificateParams(
                path=str(holder), password="yanlis", output=str(tmp_path / "a.cer")
            ),
            silent_progress(),
        )
    assert wrong.value.data == {"reason": "certificatePassword"}
    stray = tmp_path / "notes.p12"
    stray.write_bytes(b"not a key file")
    with pytest.raises(OpError) as stranger:
        export_certificate(
            ExportCertificateParams(path=str(stray), output=str(tmp_path / "b.cer")),
            silent_progress(),
        )
    assert stranger.value.data == {"reason": "keyFileFormat"}


def test_signing_names_a_wrong_key_file_password(tmp_path: Path):
    from vivepdf.ops.sign import _load_signer

    holder = _made(tmp_path, "imza", "signing")
    with pytest.raises(OpError) as raised:
        _load_signer(str(holder), "yanlis-parola")
    assert raised.value.data == {"reason": "certificatePassword"}
    assert _load_signer(str(holder), "holder-password") is not None
