import datetime
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from vivepdf.ops import sign_verify
from vivepdf.ops._sign_params import SignParams
from vivepdf.ops.sign import _load_signer
from vivepdf.ops.sign import sign as sign_document
from vivepdf.ops.sign_certificate import CreateCertificateParams, create_certificate
from vivepdf.ops.sign_verify import VerifyParams, verify
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def certificate(tmp_path: Path) -> Path:
    result = create_certificate(
        CreateCertificateParams(
            output=str(tmp_path / "me.p12"),
            password="pw-12345",
            common_name="Ayşe Yılmaz",
            email="ayse@example.com",
            organization="vivePDF",
            key_type="ec",
        ),
        silent_progress(),
    )
    return Path(result.output)


@pytest.fixture
def signed_pdf(sample_pdf: Path, certificate: Path, tmp_path: Path) -> Path:
    result = sign_document(
        SignParams(
            path=str(sample_pdf),
            output=str(tmp_path / "signed.pdf"),
            certificate_path=str(certificate),
            certificate_password="pw-12345",
            page=1,
        ),
        silent_progress(),
    )
    return Path(result.output)


def test_self_signed_signature_is_intact_but_not_trusted(signed_pdf: Path) -> None:
    verified = verify(VerifyParams(path=str(signed_pdf)), silent_progress())
    assert len(verified.signatures) == 1
    signature = verified.signatures[0]
    assert signature.intact and signature.valid
    assert not signature.trusted
    assert signature.trust_source == "none"
    assert signature.revoked is None


def test_certificate_in_user_trust_folder_makes_signature_trusted(
    signed_pdf: Path, certificate: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = tmp_path / "trust"
    store.mkdir()
    monkeypatch.setattr(sign_verify, "user_trust_dir", lambda: store)
    signer = _load_signer(str(certificate), "pw-12345")
    (store / "me.der").write_bytes(signer.signing_cert.dump())

    verified = verify(VerifyParams(path=str(signed_pdf)), silent_progress())
    signature = verified.signatures[0]
    assert signature.trusted
    assert signature.trust_source == "user"


def test_online_defaults_to_false_and_never_fetches(
    signed_pdf: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    params = VerifyParams(path=str(signed_pdf))
    assert params.online is False

    def _fail_if_called(*_args, **_kwargs):
        raise AssertionError("network fetch attempted during offline verification")

    monkeypatch.setattr(
        "pyhanko_certvalidator.fetchers.requests_fetchers.RequestsFetcherBackend.get_fetcher",
        _fail_if_called,
        raising=False,
    )
    verified = verify(params, silent_progress())
    assert len(verified.signatures) == 1
    assert verified.signatures[0].revoked is None


def test_trust_source_comes_from_the_single_validation(
    signed_pdf: Path, certificate: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pyhanko.sign import validation

    store = tmp_path / "trust"
    store.mkdir()
    monkeypatch.setattr(sign_verify, "user_trust_dir", lambda: store)
    signer = _load_signer(str(certificate), "pw-12345")
    (store / "me.der").write_bytes(signer.signing_cert.dump())
    calls: list[object] = []
    original = validation.validate_pdf_signature

    def counting(*args: object, **kwargs: object) -> object:
        calls.append(args[0])
        return original(*args, **kwargs)

    monkeypatch.setattr(validation, "validate_pdf_signature", counting)
    verified = verify(VerifyParams(path=str(signed_pdf)), silent_progress())
    assert [item.trust_source for item in verified.signatures] == ["user"]
    assert len(calls) == len(verified.signatures) == 1


def test_an_anchor_is_named_user_only_when_it_is_in_the_user_folder(certificate: Path) -> None:
    root = _load_signer(str(certificate), "pw-12345").signing_cert
    anchor = type("Anchor", (), {"certificate": root})()
    path = type("Path", (), {"trust_anchor": anchor})()
    status = type("Status", (), {"validation_path": path})()
    digests = frozenset({sign_verify._certificate_digest(root)})
    assert sign_verify._trust_source(status, digests) == "user"
    assert sign_verify._trust_source(status, frozenset()) == "none"


def _authority() -> tuple[object, x509.Certificate]:
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Public Web CA")])
    now = datetime.datetime.now(datetime.UTC)
    authority = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )
    return key, authority


def _issued_holder(
    tmp_path: Path, authority_key: object, authority: x509.Certificate, purposes: list
) -> Path:
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.datetime.now(datetime.UTC)
    leaf = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "shop.example")]))
        .issuer_name(authority.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(hours=1))
        .not_valid_after(now + datetime.timedelta(days=90))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.ExtendedKeyUsage(purposes), critical=False)
        .sign(authority_key, hashes.SHA256())
    )
    holder = tmp_path / f"leaf-{len(purposes)}-{purposes[0].dotted_string}.p12"
    holder.write_bytes(
        pkcs12.serialize_key_and_certificates(
            b"leaf", key, leaf, [authority], serialization.BestAvailableEncryption(b"pw-12345")
        )
    )
    return holder


def _signed_with(sample_pdf: Path, holder: Path, tmp_path: Path) -> Path:
    result = sign_document(
        SignParams(
            path=str(sample_pdf),
            output=str(tmp_path / f"signed-{holder.stem}.pdf"),
            certificate_path=str(holder),
            certificate_password="pw-12345",
            page=1,
        ),
        silent_progress(),
    )
    return Path(result.output)


def test_a_chain_to_an_unlisted_public_authority_is_not_trusted(
    sample_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = tmp_path / "trust"
    store.mkdir()
    monkeypatch.setattr(sign_verify, "user_trust_dir", lambda: store)
    authority_key, authority = _authority()
    holder = _issued_holder(
        tmp_path, authority_key, authority, [ExtendedKeyUsageOID.EMAIL_PROTECTION]
    )
    signature = verify(
        VerifyParams(path=str(_signed_with(sample_pdf, holder, tmp_path))), silent_progress()
    ).signatures[0]
    assert signature.intact
    assert not signature.trusted
    assert signature.trust_source == "none"


def test_a_user_listed_authority_is_trusted_for_a_document_signing_certificate(
    sample_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = tmp_path / "trust"
    store.mkdir()
    monkeypatch.setattr(sign_verify, "user_trust_dir", lambda: store)
    authority_key, authority = _authority()
    (store / "authority.pem").write_bytes(authority.public_bytes(serialization.Encoding.PEM))
    holder = _issued_holder(
        tmp_path, authority_key, authority, [ExtendedKeyUsageOID.EMAIL_PROTECTION]
    )
    signature = verify(
        VerifyParams(path=str(_signed_with(sample_pdf, holder, tmp_path))), silent_progress()
    ).signatures[0]
    assert signature.trusted
    assert signature.trust_source == "user"


def test_a_web_server_certificate_is_not_trusted_for_documents(
    sample_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = tmp_path / "trust"
    store.mkdir()
    monkeypatch.setattr(sign_verify, "user_trust_dir", lambda: store)
    authority_key, authority = _authority()
    (store / "authority.pem").write_bytes(authority.public_bytes(serialization.Encoding.PEM))
    holder = _issued_holder(tmp_path, authority_key, authority, [ExtendedKeyUsageOID.SERVER_AUTH])
    signature = verify(
        VerifyParams(path=str(_signed_with(sample_pdf, holder, tmp_path))), silent_progress()
    ).signatures[0]
    assert not signature.trusted
    assert signature.trust_source == "none"


def test_verification_never_reads_the_web_root_bundle(
    signed_pdf: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import certifi

    def _refuse() -> str:
        raise AssertionError("web root bundle was read")

    monkeypatch.setattr(certifi, "where", _refuse)
    assert len(verify(VerifyParams(path=str(signed_pdf)), silent_progress()).signatures) == 1


def test_the_reason_a_signature_is_not_trusted_is_named(
    sample_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = tmp_path / "trust"
    store.mkdir()
    monkeypatch.setattr(sign_verify, "user_trust_dir", lambda: store)
    authority_key, authority = _authority()
    signer = _issued_holder(
        tmp_path, authority_key, authority, [ExtendedKeyUsageOID.EMAIL_PROTECTION]
    )
    web = _issued_holder(tmp_path, authority_key, authority, [ExtendedKeyUsageOID.SERVER_AUTH])
    signed = _signed_with(sample_pdf, signer, tmp_path)
    web_signed = _signed_with(sample_pdf, web, tmp_path)
    unlisted = verify(VerifyParams(path=str(signed)), silent_progress()).signatures[0]
    assert unlisted.trust_problem == "noChain"
    (store / "authority.pem").write_bytes(authority.public_bytes(serialization.Encoding.PEM))
    listed = verify(VerifyParams(path=str(signed)), silent_progress()).signatures[0]
    assert listed.trusted
    assert listed.trust_problem is None
    wrong_use = verify(VerifyParams(path=str(web_signed)), silent_progress()).signatures[0]
    assert wrong_use.trust_problem == "notForSigning"


def test_a_self_signed_signature_is_named_as_such(signed_pdf: Path) -> None:
    signature = verify(VerifyParams(path=str(signed_pdf)), silent_progress()).signatures[0]
    assert signature.trust_problem == "selfSigned"


@pytest.mark.parametrize(
    ("indicator", "problem"),
    [
        ("EXPIRED", "expired"),
        ("OUT_OF_BOUNDS_NO_POE", "expired"),
        ("NOT_YET_VALID", "notYetValid"),
        ("REVOKED", "revoked"),
        ("REVOKED_CA_NO_POE", "revoked"),
        ("TRY_LATER", "revocationUnknown"),
        ("POLICY_PROCESSING_ERROR", "other"),
    ],
)
def test_every_trust_indicator_maps_to_a_known_reason(indicator: str, problem: str) -> None:
    from types import SimpleNamespace

    from pyhanko.sign.ades.report import AdESFailure, AdESIndeterminate

    member = (
        AdESIndeterminate[indicator]
        if indicator in AdESIndeterminate.__members__
        else AdESFailure[indicator]
    )
    status = SimpleNamespace(trusted=False, trust_problem_indic=member)
    assert sign_verify._trust_problem(status) == problem
    assert (
        sign_verify._trust_problem(SimpleNamespace(trusted=True, trust_problem_indic=member))
        is None
    )
    assert (
        sign_verify._trust_problem(SimpleNamespace(trusted=False, trust_problem_indic=None))
        == "other"
    )
