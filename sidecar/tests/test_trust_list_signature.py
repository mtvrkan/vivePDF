import base64
import datetime
import hashlib
import json
import time
from pathlib import Path

import pymupdf
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.x509.oid import NameOID
from lxml import etree

from vivepdf.ops import sign_trust, sign_verify
from vivepdf.ops._sign_params import SignParams
from vivepdf.ops.sign import sign as sign_document
from vivepdf.ops.sign_certificate import CreateCertificateParams, create_certificate
from vivepdf.ops.sign_trust import (
    PINS_FILE,
    SOURCES_FILE,
    TrustAddParams,
    TrustClearParams,
    TrustListParams,
    TrustPreviewParams,
    trust_add,
    trust_clear,
    trust_list,
    trust_preview,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

FIXTURE = Path(__file__).parent / "fixtures" / "trust" / "tl-is.xml"
FIXTURE_SIGNER = "D79B88419E005F509DBC12BFC54DDEC6FE7E8944D2FD0344AFCC0249DE26A6DF"
FROZEN = datetime.datetime(2026, 9, 27, 12, 0, tzinfo=datetime.UTC)
DS_NS = "http://www.w3.org/2000/09/xmldsig#"
XADES_NS = "http://uri.etsi.org/01903/v1.3.2#"
EXC = "http://www.w3.org/2001/10/xml-exc-c14n#"
ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature"
SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256"
METHODS = {
    "rsa": "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    "pss": "http://www.w3.org/2007/05/xmldsig-more#sha256-rsa-MGF1",
    "ecdsa": "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256",
}
TSL_TYPE = "http://uri.etsi.org/TrstSvc/TrustedList/TSLType/"
SERVICE_TYPE = "http://uri.etsi.org/TrstSvc/Svctype/CA/QC"
GRANTED = "http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/granted"


@pytest.fixture
def store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    folder = tmp_path / "trust"
    folder.mkdir()
    monkeypatch.setattr(sign_verify, "user_trust_dir", lambda: folder)
    monkeypatch.setattr(sign_trust, "_now", lambda: FROZEN)
    return folder


@pytest.fixture(scope="module")
def rsa_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="module")
def ec_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def _certificate(key, name: str, days: int = 365, ca: bool = False) -> x509.Certificate:
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    start = FROZEN - datetime.timedelta(days=30)
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(start)
        .not_valid_after(FROZEN + datetime.timedelta(days=days))
    )
    if ca:
        builder = builder.add_extension(
            x509.BasicConstraints(ca=True, path_length=None), critical=True
        )
    return builder.sign(key, hashes.SHA256())


def _base64(certificate: x509.Certificate) -> str:
    return base64.b64encode(certificate.public_bytes(serialization.Encoding.DER)).decode()


def _fingerprint(certificate: x509.Certificate) -> str:
    return certificate.fingerprint(hashes.SHA256()).hex().upper()


def _authority(name: str) -> x509.Certificate:
    return _certificate(ec.generate_private_key(ec.SECP256R1()), name, ca=True)


def _tsl(
    authorities: list[x509.Certificate],
    territory: str = "IS",
    next_update: str = "2027-03-01T00:00:00Z",
    pointers: list[tuple[str, list[x509.Certificate]]] | None = None,
    sequence: int | None = None,
) -> bytes:
    kind = "EUlistofthelists" if pointers is not None else "EUgeneric"
    services = "".join(
        f'<TSPService Id="svc-{index}"><ServiceInformation>'
        f"<ServiceTypeIdentifier>{SERVICE_TYPE}</ServiceTypeIdentifier>"
        f"<ServiceDigitalIdentity><DigitalId><X509Certificate>{_base64(authority)}"
        "</X509Certificate></DigitalId></ServiceDigitalIdentity>"
        f"<ServiceStatus>{GRANTED}</ServiceStatus></ServiceInformation></TSPService>"
        for index, authority in enumerate(authorities)
    )
    links = "".join(
        "<OtherTSLPointer><ServiceDigitalIdentities>"
        + "".join(
            "<ServiceDigitalIdentity><DigitalId><X509Certificate>"
            f"{_base64(certificate)}</X509Certificate></DigitalId></ServiceDigitalIdentity>"
            for certificate in certificates
        )
        + "</ServiceDigitalIdentities><AdditionalInformation><OtherInformation>"
        f"<SchemeTerritory>{place}</SchemeTerritory></OtherInformation>"
        "</AdditionalInformation></OtherTSLPointer>"
        for place, certificates in (pointers or [])
    )
    pointer_block = f"<PointersToOtherTSL>{links}</PointersToOtherTSL>" if links else ""
    providers = (
        "<TrustServiceProviderList><TrustServiceProvider><TSPInformation><TSPName>"
        '<Name xml:lang="en">Provider</Name></TSPName></TSPInformation>'
        f"<TSPServices>{services}</TSPServices></TrustServiceProvider>"
        "</TrustServiceProviderList>"
        if pointers is None
        else ""
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<TrustServiceStatusList xmlns="http://uri.etsi.org/02231/v2#" Id="tsl-1">\n'
        "<SchemeInformation>"
        + (f"<TSLSequenceNumber>{sequence}</TSLSequenceNumber>" if sequence is not None else "")
        + f"<TSLType>{TSL_TYPE}{kind}</TSLType>"
        '<SchemeOperatorName><Name xml:lang="en">Operator</Name></SchemeOperatorName>'
        f"<SchemeTerritory>{territory}</SchemeTerritory>{pointer_block}"
        f"<NextUpdate><dateTime>{next_update}</dateTime></NextUpdate></SchemeInformation>\n"
        f"{providers}\n\n</TrustServiceStatusList>"
    ).encode()


def _raw_signature(key, family: str, data: bytes) -> bytes:
    if family == "ecdsa":
        r, s = decode_dss_signature(key.sign(data, ec.ECDSA(hashes.SHA256())))
        size = (key.curve.key_size + 7) // 8
        return r.to_bytes(size, "big") + s.to_bytes(size, "big")
    if family == "pss":
        scheme = padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32)
        return key.sign(data, scheme, hashes.SHA256())
    return key.sign(data, padding.PKCS1v15(), hashes.SHA256())


def _sign(
    document: bytes,
    key,
    certificate: x509.Certificate,
    family: str = "rsa",
    uri: str = "",
    prefixes: list[str] | None = None,
    split_whitespace: bool = False,
) -> bytes:
    root = etree.fromstring(document)
    canonical = etree.tostring(
        root, method="c14n", exclusive=True, with_comments=False, inclusive_ns_prefixes=prefixes
    )
    digest = base64.b64encode(hashlib.sha256(canonical).digest()).decode()
    inclusive = (
        f'<ec:InclusiveNamespaces xmlns:ec="{EXC}" PrefixList="{" ".join(prefixes)}"/>'
        if prefixes
        else ""
    )
    certificate_digest = base64.b64encode(
        hashlib.sha256(certificate.public_bytes(serialization.Encoding.DER)).digest()
    ).decode()
    template = (
        f'<ds:Signature xmlns:ds="{DS_NS}" Id="sig-1"><ds:SignedInfo>'
        f'<ds:CanonicalizationMethod Algorithm="{EXC}"/>'
        f'<ds:SignatureMethod Algorithm="{METHODS[family]}"/>'
        f'<ds:Reference Id="ref-doc" URI="{uri}"><ds:Transforms>'
        f'<ds:Transform Algorithm="{ENVELOPED}"/><ds:Transform Algorithm="{EXC}">{inclusive}'
        f'</ds:Transform></ds:Transforms><ds:DigestMethod Algorithm="{SHA256}"/>'
        f"<ds:DigestValue>{digest}</ds:DigestValue></ds:Reference>"
        '<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#xades-1">'
        f'<ds:Transforms><ds:Transform Algorithm="{EXC}"/></ds:Transforms>'
        f'<ds:DigestMethod Algorithm="{SHA256}"/><ds:DigestValue/></ds:Reference>'
        "</ds:SignedInfo><ds:SignatureValue/>"
        "<ds:KeyInfo><ds:X509Data><ds:X509Certificate>"
        f"{_base64(certificate)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>"
        f'<ds:Object><xades:QualifyingProperties xmlns:xades="{XADES_NS}" Target="#sig-1">'
        '<xades:SignedProperties Id="xades-1"><xades:SignedSignatureProperties>'
        "<xades:SigningTime>2026-09-01T10:00:00Z</xades:SigningTime>"
        "<xades:SigningCertificateV2><xades:Cert><xades:CertDigest>"
        f'<ds:DigestMethod Algorithm="{SHA256}"/>'
        f"<ds:DigestValue>{certificate_digest}</ds:DigestValue>"
        "</xades:CertDigest></xades:Cert></xades:SigningCertificateV2>"
        "</xades:SignedSignatureProperties></xades:SignedProperties>"
        "</xades:QualifyingProperties></ds:Object></ds:Signature>"
    )
    signature = etree.fromstring(template)
    last = root[-1]
    root.append(signature)
    if split_whitespace:
        whitespace = last.tail or ""
        last.tail, signature.tail = whitespace[:1], whitespace[1:]
    properties = signature.find(f".//{{{XADES_NS}}}SignedProperties")
    references = signature.findall(f".//{{{DS_NS}}}Reference")
    references[1].find(f"{{{DS_NS}}}DigestValue").text = base64.b64encode(
        hashlib.sha256(etree.tostring(properties, method="c14n", exclusive=True)).digest()
    ).decode()
    signed_info = signature.find(f"{{{DS_NS}}}SignedInfo")
    data = etree.tostring(signed_info, method="c14n", exclusive=True)
    value = _raw_signature(key, family, data)
    signature.find(f"{{{DS_NS}}}SignatureValue").text = base64.b64encode(value).decode()
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + etree.tostring(root)


def _write(folder: Path, name: str, data: bytes) -> Path:
    path = folder / name
    path.write_bytes(data)
    return path


def _preview(path: Path):
    return trust_preview(TrustPreviewParams(path=str(path)), silent_progress())


def _add(path: Path, **options):
    options.setdefault("expected_digest", hashlib.sha256(path.read_bytes()).hexdigest())
    return trust_add(TrustAddParams(path=str(path), **options), silent_progress())


def _reason(action, *args, **options) -> str:
    with pytest.raises(OpError) as caught:
        action(*args, **options)
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    return caught.value.data["reason"]


def _fixture_signer() -> x509.Certificate:
    root = etree.fromstring(FIXTURE.read_bytes())
    text = root.find(f".//{{{DS_NS}}}KeyInfo//{{{DS_NS}}}X509Certificate").text
    return x509.load_der_x509_certificate(base64.b64decode("".join(text.split())))


def _signed_list(folder: Path, rsa_key, name: str = "tl.xml", **options) -> Path:
    signer = _certificate(rsa_key, "List Signer")
    data = _sign(_tsl([_authority("Listed Root")]), rsa_key, signer, **options)
    return _write(folder, name, data)


def test_the_real_icelandic_list_verifies_and_names_its_signer(store: Path) -> None:
    preview = _preview(FIXTURE)
    signature = preview.signature
    assert signature is not None and signature.status == "unpinned"
    assert signature.signer is not None and signature.signer.fingerprint == FIXTURE_SIGNER
    assert not signature.signer.expired and not signature.stale
    assert signature.signed_at == "2026-09-03T10:40:58+00:00"
    assert preview.digest == hashlib.sha256(FIXTURE.read_bytes()).hexdigest()
    assert preview.source is not None and preview.source.territory == "IS"
    assert preview.added


def _lotl(
    folder: Path,
    key,
    signer,
    pointers,
    name: str = "lotl.xml",
    sequence: int | None = None,
    next_update: str = "2027-03-01T00:00:00Z",
) -> Path:
    document = _tsl([], "EU", next_update, pointers=pointers, sequence=sequence)
    data = _sign(document, key, signer, family="ecdsa")
    return _write(folder, name, data)


def test_an_unanchored_list_of_lists_never_makes_a_list_verified(
    store: Path, tmp_path: Path, ec_key
) -> None:
    lotl_signer = _certificate(ec_key, "Commission")
    other = _authority("Other Country Signer")
    lotl = _lotl(tmp_path, ec_key, lotl_signer, [("IS", [_fixture_signer()]), ("DE", [other])])
    preview = _preview(lotl)
    assert preview.source is not None and preview.source.kind == "euListOfLists"
    assert preview.added == [] and preview.known == 0 and preview.pinned == 2
    assert preview.signature is not None and preview.signature.status == "unpinned"
    assert preview.signature.signer.fingerprint == _fingerprint(lotl_signer)
    assert _reason(_add, lotl) == "trustListUnverified"
    assert _add(lotl, accept_unverified=True).pinned == 2
    stored = json.loads((store / PINS_FILE).read_text())
    assert stored["version"] == 3
    assert stored["pins"]["IS"] == {"anchored": False, "fingerprints": [FIXTURE_SIGNER]}
    assert trust_list(TrustListParams(), silent_progress()).roots == []
    assert _preview(FIXTURE).signature.status == "unpinned"
    assert _reason(_add, FIXTURE) == "trustListUnverified"
    trust_clear(TrustClearParams(), silent_progress())
    assert not (store / PINS_FILE).exists()


def test_an_anchored_list_of_lists_makes_the_pinned_signer_verified(
    store: Path, tmp_path: Path, ec_key, monkeypatch: pytest.MonkeyPatch
) -> None:
    lotl_signer = _certificate(ec_key, "Commission")
    monkeypatch.setattr(sign_trust, "LOTL_ANCHORS", frozenset({_fingerprint(lotl_signer)}))
    lotl = _lotl(tmp_path, ec_key, lotl_signer, [("IS", [_fixture_signer()])])
    assert _preview(lotl).signature.status == "verified"
    assert _add(lotl).pinned == 1
    assert _preview(FIXTURE).signature.status == "verified"
    assert _add(FIXTURE).added


def _anchor(monkeypatch: pytest.MonkeyPatch, *signers: x509.Certificate) -> None:
    monkeypatch.setattr(
        sign_trust, "LOTL_ANCHORS", frozenset(_fingerprint(signer) for signer in signers)
    )


def test_an_anchored_list_of_lists_stores_its_pins_and_sequence(
    store: Path, tmp_path: Path, ec_key, monkeypatch: pytest.MonkeyPatch
) -> None:
    signer = _certificate(ec_key, "Commission")
    _anchor(monkeypatch, signer)
    _add(_lotl(tmp_path, ec_key, signer, [("IS", [_fixture_signer()])], sequence=340))
    stored = json.loads((store / PINS_FILE).read_text())
    assert stored["version"] == 3 and stored["lotlSequence"] == 340
    assert stored["pins"]["IS"] == {"anchored": True, "fingerprints": [FIXTURE_SIGNER]}


def test_a_rotated_signer_in_the_anchor_set_is_verified(
    store: Path, tmp_path: Path, ec_key, monkeypatch: pytest.MonkeyPatch
) -> None:
    retiring = _certificate(ec_key, "Commission 2024")
    new_key = ec.generate_private_key(ec.SECP256R1())
    rotated = _certificate(new_key, "Commission 2026")
    _anchor(monkeypatch, retiring, rotated)
    lotl = _lotl(tmp_path, new_key, rotated, [("IS", [_fixture_signer()])], sequence=341)
    assert _preview(lotl).signature.status == "verified"


def test_a_signer_outside_a_filled_anchor_set_stays_unpinned_and_cannot_displace_anchored_pins(
    store: Path, tmp_path: Path, ec_key, rsa_key, monkeypatch: pytest.MonkeyPatch
) -> None:
    commission = _certificate(ec_key, "Commission")
    _anchor(monkeypatch, commission)
    _add(_lotl(tmp_path, ec_key, commission, [("IS", [_fixture_signer()])], "a.xml", 340))
    impostor = _certificate(rsa_key, "Impostor")
    forged = _write(
        tmp_path,
        "forged.xml",
        _sign(_tsl([], "EU", pointers=[("IS", [impostor])], sequence=999), rsa_key, impostor),
    )
    assert _preview(forged).signature.status == "unpinned"
    assert _reason(_add, forged) == "trustListUnverified"
    _add(forged, accept_unverified=True)
    stored = json.loads((store / PINS_FILE).read_text())
    assert stored["pins"]["IS"] == {"anchored": True, "fingerprints": [FIXTURE_SIGNER]}
    assert stored["lotlSequence"] == 340
    assert _preview(FIXTURE).signature.status == "verified"


def test_an_expired_anchor_does_not_verify(
    store: Path, tmp_path: Path, ec_key, monkeypatch: pytest.MonkeyPatch
) -> None:
    expired = _certificate(ec_key, "Commission", days=-1)
    _anchor(monkeypatch, expired)
    lotl = _lotl(tmp_path, ec_key, expired, [("IS", [_fixture_signer()])], sequence=340)
    signature = _preview(lotl).signature
    assert signature.signer.expired and signature.status == "unpinned"
    assert _reason(_add, lotl) == "trustListUnverified"


def test_a_stale_anchored_list_of_lists_does_not_verify(
    store: Path, tmp_path: Path, ec_key, monkeypatch: pytest.MonkeyPatch
) -> None:
    signer = _certificate(ec_key, "Commission")
    _anchor(monkeypatch, signer)
    lotl = _lotl(
        tmp_path,
        ec_key,
        signer,
        [("IS", [_fixture_signer()])],
        sequence=340,
        next_update="2026-09-01T00:00:00Z",
    )
    signature = _preview(lotl).signature
    assert signature.stale and signature.status == "unpinned"


def test_an_older_anchored_list_of_lists_is_a_rollback_and_changes_nothing(
    store: Path, tmp_path: Path, ec_key, monkeypatch: pytest.MonkeyPatch
) -> None:
    signer = _certificate(ec_key, "Commission")
    _anchor(monkeypatch, signer)
    current = _authority("Current Iceland Signer")
    retired = _authority("Retired Iceland Signer")
    _add(_lotl(tmp_path, ec_key, signer, [("IS", [current])], "new.xml", 341))
    old = _lotl(tmp_path, ec_key, signer, [("IS", [retired])], "old.xml", 340)
    assert _preview(old).signature.status == "unpinned"
    assert _reason(_add, old) == "trustListUnverified"
    _add(old, accept_unverified=True)
    stored = json.loads((store / PINS_FILE).read_text())
    assert stored["lotlSequence"] == 341
    assert stored["pins"]["IS"] == {"anchored": True, "fingerprints": [_fingerprint(current)]}
    unnumbered = _lotl(tmp_path, ec_key, signer, [("IS", [current])], "unnumbered.xml")
    assert _preview(unnumbered).signature.status == "unpinned"
    same = _lotl(tmp_path, ec_key, signer, [("IS", [current])], "same.xml", 341)
    assert _preview(same).signature.status == "verified"


def test_an_anchored_list_of_lists_drops_countries_it_no_longer_lists(
    store: Path, tmp_path: Path, ec_key, monkeypatch: pytest.MonkeyPatch
) -> None:
    signer = _certificate(ec_key, "Commission")
    _anchor(monkeypatch, signer)
    leaving = _authority("Leaving Country Signer")
    staying = _authority("German Signer")
    _add(_lotl(tmp_path, ec_key, signer, [("UK", [leaving]), ("DE", [staying])], "a.xml", 100))
    _add(_lotl(tmp_path, ec_key, signer, [("DE", [staying])], "b.xml", 101))
    pins = json.loads((store / PINS_FILE).read_text())["pins"]
    assert set(pins) == {"DE"}


def test_a_version_2_pin_file_still_loads_without_a_sequence(
    store: Path, tmp_path: Path, ec_key, monkeypatch: pytest.MonkeyPatch
) -> None:
    (store / PINS_FILE).write_text(
        json.dumps(
            {"version": 2, "pins": {"IS": {"anchored": True, "fingerprints": [FIXTURE_SIGNER]}}}
        )
    )
    assert _preview(FIXTURE).signature.status == "verified"
    signer = _certificate(ec_key, "Commission")
    _anchor(monkeypatch, signer)
    assert (
        _preview(_lotl(tmp_path, ec_key, signer, [("IS", [_fixture_signer()])])).signature.status
        == "verified"
    )


def test_built_in_anchors_are_upper_case_sha256_fingerprints() -> None:
    assert all(sign_trust.FINGERPRINT.match(anchor) for anchor in sign_trust.LOTL_ANCHORS)


def test_an_unsigned_or_unverifiable_list_of_lists_cannot_pin_even_with_the_override(
    store: Path, tmp_path: Path, rsa_key
) -> None:
    attacker = _certificate(rsa_key, "Fake Regulator")
    unsigned = _write(tmp_path, "lotl.xml", _tsl([], "EU", pointers=[("DE", [attacker])]))
    assert _preview(unsigned).signature.status == "unsigned"
    assert _reason(_add, unsigned, accept_unverified=True) == "trustListUnverified"
    signed = _sign(_tsl([], "EU", pointers=[("DE", [attacker])]), rsa_key, attacker)
    weak = signed.replace(METHODS["rsa"].encode(), b"http://www.w3.org/2000/09/xmldsig#rsa-sha1")
    unverifiable = _write(tmp_path, "weak-lotl.xml", weak)
    assert _preview(unverifiable).signature.status == "unverifiable"
    assert _reason(_add, unverifiable, accept_unverified=True) == "trustListUnverified"
    assert not (store / PINS_FILE).exists()


def test_lists_of_lists_merge_pins_per_country(store: Path, tmp_path: Path, ec_key) -> None:
    signer = _certificate(ec_key, "Commission")
    first = _authority("Iceland Signer")
    second = _authority("German Signer")
    _add(_lotl(tmp_path, ec_key, signer, [("IS", [first])], "a.xml"), accept_unverified=True)
    _add(_lotl(tmp_path, ec_key, signer, [("DE", [second])], "b.xml"), accept_unverified=True)
    pins = json.loads((store / PINS_FILE).read_text())["pins"]
    assert pins["IS"]["fingerprints"] == [_fingerprint(first)]
    assert pins["DE"]["fingerprints"] == [_fingerprint(second)]


def test_another_countrys_signer_claiming_germany_is_a_mismatch(
    store: Path, tmp_path: Path, rsa_key, ec_key
) -> None:
    lotl_signer = _certificate(ec_key, "Commission")
    german = _authority("German Signer")
    icelandic = _certificate(rsa_key, "Icelandic Signer")
    lotl = _lotl(tmp_path, ec_key, lotl_signer, [("DE", [german]), ("IS", [icelandic])])
    _add(lotl, accept_unverified=True)
    claim = _write(
        tmp_path, "de.xml", _sign(_tsl([_authority("Root")], territory="DE"), rsa_key, icelandic)
    )
    assert _preview(claim).signature.status == "pinMismatch"
    assert _reason(_add, claim) == "trustListUnverified"


def test_a_signer_missing_from_the_pins_is_a_mismatch_that_needs_the_override(
    store: Path, tmp_path: Path, rsa_key
) -> None:
    (store / PINS_FILE).write_text(
        json.dumps({"version": 1, "pins": {"IS": [_fingerprint(_authority("Someone"))]}})
    )
    assert _preview(FIXTURE).signature.status == "pinMismatch"
    assert _reason(_add, FIXTURE) == "trustListUnverified"
    assert _add(FIXTURE, accept_unverified=True).added


@pytest.mark.parametrize("family", ["rsa", "pss", "ecdsa"])
def test_synthetic_lists_verify_with_each_allowed_algorithm(
    store: Path, tmp_path: Path, rsa_key, ec_key, family: str
) -> None:
    key = ec_key if family == "ecdsa" else rsa_key
    signer = _certificate(key, "Signer")
    path = _write(tmp_path, "tl.xml", _sign(_tsl([_authority("Root")]), key, signer, family))
    signature = _preview(path).signature
    assert signature.status == "unpinned"
    assert signature.signer.fingerprint == _fingerprint(signer)
    assert signature.signed_at == "2026-09-01T10:00:00+00:00"


@pytest.mark.parametrize(
    "options",
    [{"uri": ""}, {"uri": "#tsl-1"}, {"prefixes": ["xml"]}, {"split_whitespace": True}],
    ids=["whole-document", "root-id", "inclusive-namespaces", "whitespace"],
)
def test_reference_variants_verify(store: Path, tmp_path: Path, rsa_key, options: dict) -> None:
    path = _signed_list(tmp_path, rsa_key, **options)
    assert _preview(path).signature.status == "unpinned"


def test_an_expired_signer_and_a_stale_list_are_flagged(
    store: Path, tmp_path: Path, rsa_key
) -> None:
    signer = _certificate(rsa_key, "Old Signer", days=-1)
    path = _write(
        tmp_path,
        "tl.xml",
        _sign(_tsl([_authority("Root")], next_update="2026-01-01T00:00:00Z"), rsa_key, signer),
    )
    signature = _preview(path).signature
    assert signature.status == "unpinned"
    assert signature.signer.expired and signature.stale
    assert signature.next_update == "2026-01-01T00:00:00+00:00"


def test_a_version_one_source_record_still_loads(store: Path, tmp_path: Path) -> None:
    certificate = _authority("Kayıtlı")
    name = f"{_fingerprint(certificate)[:32].lower()}.cer"
    (store / name).write_bytes(certificate.public_bytes(serialization.Encoding.DER))
    (store / SOURCES_FILE).write_text(
        json.dumps(
            {
                "version": 1,
                "lists": {"euTrustedList:DE": {"kind": "euTrustedList", "territory": "DE"}},
                "roots": {name: ["euTrustedList:DE"]},
            }
        )
    )
    roots = trust_list(TrustListParams(), silent_progress()).roots
    assert [(source.territory, source.verification) for source in roots[0].lists] == [("DE", None)]


def _flip_provider_name(data: bytes) -> bytes:
    start = data.index(b"<TSPName>")
    position = data.index(b'">', start) + 2
    changed = b"A" if data[position : position + 1] != b"A" else b"B"
    return data[:position] + changed + data[position + 1 :]


def test_a_flipped_byte_in_the_real_list_is_a_hard_block(store: Path, tmp_path: Path) -> None:
    path = _write(tmp_path, "tl.xml", _flip_provider_name(FIXTURE.read_bytes()))
    assert _reason(_preview, path) == "trustListSignatureInvalid"
    assert _reason(_add, path, accept_unverified=True) == "trustListSignatureInvalid"
    assert list(store.iterdir()) == []


def _tampered_certificate(data: bytes) -> bytes:
    start = data.index(b"<X509Certificate>") + len(b"<X509Certificate>") + 40
    changed = b"A" if data[start : start + 1] != b"A" else b"B"
    return data[:start] + changed + data[start + 1 :]


@pytest.mark.parametrize(
    "tamper",
    [
        _tampered_certificate,
        lambda data: data.replace(b"2026-09-01T10:00:00Z", b"2026-09-02T10:00:00Z"),
        lambda data: data.replace(b'<Name xml:lang="en">Provider', b'<Name xml:lang="en">Evil'),
    ],
    ids=["certificate", "signed-properties", "provider"],
)
def test_tampered_synthetic_lists_are_refused(store: Path, tmp_path: Path, rsa_key, tamper) -> None:
    signed = _signed_list(tmp_path, rsa_key).read_bytes()
    tampered = tamper(signed)
    assert tampered != signed
    path = _write(tmp_path, "bad.xml", tampered)
    assert _reason(_add, path, accept_unverified=True) == "trustListSignatureInvalid"


def _wrapped(data: bytes) -> bytes:
    body = data.split(b"?>", 1)[1]
    return b'<Wrapper xmlns="urn:wrapper">' + body + b"</Wrapper>"


def _duplicate_id(data: bytes) -> bytes:
    return data.replace(b"<SchemeInformation>", b'<SchemeInformation Id="tsl-1">', 1)


def _second_signature(data: bytes) -> bytes:
    root = etree.fromstring(data)
    signature = root[-1]
    root[0].append(etree.fromstring(etree.tostring(signature)))
    return etree.tostring(root)


def _nested_signature(data: bytes) -> bytes:
    root = etree.fromstring(data)
    signature = root[-1]
    root.remove(signature)
    root[0].append(signature)
    return etree.tostring(root)


def _sub_element(data: bytes) -> bytes:
    return data.replace(b'URI=""', b'URI="#svc-0"', 1)


@pytest.mark.parametrize(
    "attack",
    [_wrapped, _duplicate_id, _second_signature, _nested_signature, _sub_element],
    ids=["wrapper", "duplicate-id", "second-signature", "nested-signature", "sub-element"],
)
def test_signature_wrapping_is_a_hard_block(store: Path, tmp_path: Path, rsa_key, attack) -> None:
    uri = "#tsl-1" if attack is _wrapped else ""
    signed = _signed_list(tmp_path, rsa_key, uri=uri).read_bytes()
    path = _write(tmp_path, "bad.xml", attack(signed))
    assert _reason(_add, path, accept_unverified=True) == "trustListSignatureInvalid"
    assert list(store.iterdir()) == []


@pytest.mark.parametrize(
    "downgrade",
    [
        lambda data: data.replace(
            METHODS["rsa"].encode(), b"http://www.w3.org/2000/09/xmldsig#hmac-sha1"
        ),
        lambda data: data.replace(
            METHODS["rsa"].encode(), b"http://www.w3.org/2000/09/xmldsig#rsa-sha1"
        ),
        lambda data: data.replace(SHA256.encode(), b"http://www.w3.org/2000/09/xmldsig#sha1", 1),
        lambda data: data.replace(
            METHODS["rsa"].encode(), b"http://www.w3.org/2000/09/xmldsig#dsa-sha1"
        ),
    ],
    ids=["hmac", "rsa-sha1", "sha1-digest", "dsa"],
)
def test_unsupported_profiles_are_unverifiable_and_need_the_override(
    store: Path, tmp_path: Path, rsa_key, downgrade
) -> None:
    path = _write(tmp_path, "tl.xml", downgrade(_signed_list(tmp_path, rsa_key).read_bytes()))
    preview = _preview(path)
    assert preview.signature.status == "unverifiable" and preview.signature.signer is None
    assert _reason(_add, path) == "trustListUnverified"
    assert _add(path, accept_unverified=True).added


@pytest.mark.parametrize(
    "attack",
    [
        lambda data: data.replace(
            ENVELOPED.encode(), b"http://www.w3.org/TR/1999/REC-xpath-19991116"
        ),
        lambda data: data.replace(b"Provider", b"Evil").replace(
            METHODS["rsa"].encode(), b"http://www.w3.org/2000/09/xmldsig#rsa-sha1"
        ),
        lambda data: data.replace(b'URI=""', b'URI="#svc-0"', 1).replace(
            METHODS["rsa"].encode(), b"http://www.w3.org/2000/09/xmldsig#rsa-sha1"
        ),
        lambda data: data.replace(b'URI=""', b'URI="#svc-0"', 1).replace(
            b'<ds:CanonicalizationMethod Algorithm="' + EXC.encode(),
            b'<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11',
        ),
        lambda data: data.replace(
            b"<SchemeInformation>",
            b'<SchemeInformation xml:id="tsl-1">',
            1,
        ),
    ],
    ids=["xpath", "tampered-weak", "sub-element-weak", "sub-element-c14n11", "xml-id-duplicate"],
)
def test_tampering_behind_a_weak_algorithm_is_still_a_hard_block(
    store: Path, tmp_path: Path, rsa_key, attack
) -> None:
    data = attack(_signed_list(tmp_path, rsa_key).read_bytes())
    path = _write(tmp_path, "bad.xml", data)
    assert _reason(_preview, path) == "trustListSignatureInvalid"


def _with_key_info(data: bytes, certificates: list[str]) -> bytes:
    root = etree.fromstring(data)
    x509_data = root.find(f".//{{{DS_NS}}}X509Data")
    for element in list(x509_data):
        x509_data.remove(element)
    for text in certificates:
        etree.SubElement(x509_data, f"{{{DS_NS}}}X509Certificate").text = text
    return etree.tostring(root)


def test_key_info_skips_unrelated_and_unreadable_certificates(
    store: Path, tmp_path: Path, rsa_key
) -> None:
    signer = _certificate(rsa_key, "Signer")
    signed = _sign(_tsl([_authority("Root")]), rsa_key, signer)
    garbage = base64.b64encode(b"\x30\x03\x02\x01\x01").decode()
    unrelated = _base64(_authority("Unrelated"))
    data = _with_key_info(signed, [garbage, unrelated, _base64(signer)])
    signature = _preview(_write(tmp_path, "tl.xml", data)).signature
    assert signature.status == "unpinned"
    assert signature.signer.fingerprint == _fingerprint(signer)
    only_wrong = _with_key_info(signed, [garbage, unrelated])
    path = _write(tmp_path, "wrong.xml", only_wrong)
    assert _reason(_preview, path) == "trustListSignatureInvalid"


@pytest.mark.parametrize(
    ("name", "data"),
    [
        ("unknown.xml", b'<?xml version="1.0"?>\n<Foo>\n{pem}</Foo>\n'),
        (
            "wrong-namespace.xml",
            b'<TrustServiceStatusList xmlns="urn:x">\n{pem}</TrustServiceStatusList>',
        ),
        ("list.xml", b"{pem}"),
        ("list.pdf", b"{pdf}\n{pem}"),
    ],
    ids=["unknown-root", "wrong-namespace", "pem-with-list-extension", "pdf-without-settings"],
)
def test_unrecognised_markup_or_extension_never_takes_the_certificate_path(
    store: Path, tmp_path: Path, name: str, data: bytes
) -> None:
    pem = _authority("Smuggled Root").public_bytes(serialization.Encoding.PEM)
    document = pymupdf.open()
    document.new_page()
    pdf = document.tobytes()
    document.close()
    content = data.replace(b"{pem}", pem).replace(b"{pdf}", pdf)
    path = _write(tmp_path, name, content)
    assert _reason(_preview, path) == "trustFileFormat"
    assert _reason(_add, path, accept_unverified=True) == "trustFileFormat"
    assert list(store.iterdir()) == []


def test_a_certificate_file_is_read_once(
    store: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = _authority("Original")
    swapped = _authority("Swapped")
    path = _write(tmp_path, "root.cer", original.public_bytes(serialization.Encoding.DER))
    swapped_bytes = swapped.public_bytes(serialization.Encoding.DER)
    real_read = Path.read_bytes

    def swapping(self: Path) -> bytes:
        return swapped_bytes if self == path else real_read(self)

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    monkeypatch.setattr(Path, "read_bytes", swapping)
    added = _add(path, expected_digest=digest).added
    assert [root.fingerprint for root in added] == [_fingerprint(original)]


def _name_tree_bomb(fan_out: int) -> bytes:
    kids = " ".join(["4 0 R"] * fan_out)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 4 0 R >> >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>",
        f"<< /Kids [{kids} 5 0 R] >>".encode(),
        f"<< /Kids [{kids}] >>".encode(),
    ]
    out = b"%PDF-1.7\n"
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    start = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        start,
    )
    return out


def test_a_self_referencing_embedded_file_tree_finishes_fast(store: Path, tmp_path: Path) -> None:
    path = _write(tmp_path, "bomb.pdf", _name_tree_bomb(200))
    started = time.monotonic()
    assert _reason(_preview, path) == "trustFileFormat"
    assert time.monotonic() - started < 5


def test_a_list_import_needs_the_previewed_digest(store: Path, tmp_path: Path) -> None:
    path = _write(tmp_path, "tl.xml", _tsl([_authority("Root")]))
    assert _reason(_add, path, accept_unverified=True, expected_digest=None) == "trustListChanged"


def test_a_comment_splitting_a_certificate_is_harmless(
    store: Path, tmp_path: Path, rsa_key
) -> None:
    authority = _authority("Split Root")
    signer = _certificate(rsa_key, "Signer")
    signed = _sign(_tsl([authority]), rsa_key, signer)
    encoded = _base64(authority).encode()
    split = signed.replace(encoded, encoded[:20] + b"<!-- x -->" + encoded[20:])
    assert split != signed
    added = _add(_write(tmp_path, "tl.xml", split), accept_unverified=True).added
    assert [root.fingerprint for root in added] == [_fingerprint(authority)]


def test_a_document_type_is_refused_before_the_signature_is_read(
    store: Path, tmp_path: Path, rsa_key
) -> None:
    signed = _signed_list(tmp_path, rsa_key).read_bytes()
    body = signed.split(b"?>", 1)[1]
    path = _write(tmp_path, "tl.xml", b"<!DOCTYPE TrustServiceStatusList []>" + body)
    assert _reason(_add, path, accept_unverified=True) == "trustFileFormat"


def test_an_unsigned_list_needs_the_override_and_a_changed_file_is_refused(
    store: Path, tmp_path: Path
) -> None:
    path = _write(tmp_path, "tl.xml", _tsl([_authority("Unsigned Root")]))
    preview = _preview(path)
    assert preview.signature.status == "unsigned" and preview.signature.signer is None
    assert _reason(_add, path) == "trustListUnverified"
    path.write_bytes(_tsl([_authority("Swapped Root")]))
    assert (
        _reason(_add, path, accept_unverified=True, expected_digest=preview.digest)
        == "trustListChanged"
    )
    assert list(store.iterdir()) == []
    assert _add(path, accept_unverified=True).added


def test_a_malformed_expected_digest_is_rejected(store: Path, tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        TrustAddParams(path=str(tmp_path / "x.xml"), expected_digest="ABC")


def _settings(certificate: x509.Certificate) -> bytes:
    return (
        '<?xml version="1.0"?>\n<SecuritySettings><TrustedIdentities><Identity>'
        f"<Certificate>{_base64(certificate)}</Certificate><Trust><Root>1</Root></Trust>"
        "<Identification><Source>AATL</Source></Identification></Identity>"
        "</TrustedIdentities></SecuritySettings>"
    ).encode()


def _settings_pdf(path: Path, *settings: bytes) -> Path:
    document = pymupdf.open()
    document.new_page()
    for index, content in enumerate(settings):
        document.embfile_add(f"SecuritySettings{index}.xml", content)
    document.save(path)
    document.close()
    return path


def _signed_pdf(tmp_path: Path, source: Path) -> Path:
    key_file = create_certificate(
        CreateCertificateParams(
            output=str(tmp_path / "adobe.p12"), password="pw-12345", common_name="Adobe Test"
        ),
        silent_progress(),
    ).output
    return Path(
        sign_document(
            SignParams(
                path=str(source),
                output=str(tmp_path / "signed-settings.pdf"),
                certificate_path=key_file,
                certificate_password="pw-12345",
                page=1,
            ),
            silent_progress(),
        ).output
    )


def test_a_signed_security_settings_pdf_is_unpinned(store: Path, tmp_path: Path) -> None:
    root = _authority("AATL Root")
    signed = _signed_pdf(tmp_path, _settings_pdf(tmp_path / "aatl.pdf", _settings(root)))
    preview = _preview(signed)
    assert preview.signature.status == "unpinned"
    assert preview.signature.signer.subject == "Adobe Test"
    assert [item.fingerprint for item in _add(signed, accept_unverified=True).added] == [
        _fingerprint(root)
    ]


def test_an_update_after_signing_a_security_settings_pdf_is_a_hard_block(
    store: Path, tmp_path: Path
) -> None:
    signed = _signed_pdf(tmp_path, _settings_pdf(tmp_path / "aatl.pdf", _settings(_authority("A"))))
    document = pymupdf.open(signed)
    document.embfile_add("Extra.xml", _settings(_authority("Injected")))
    document.saveIncr()
    document.close()
    assert _reason(_preview, signed) == "trustListSignatureInvalid"


def test_an_unsigned_security_settings_pdf_is_unsigned(store: Path, tmp_path: Path) -> None:
    path = _settings_pdf(tmp_path / "aatl.pdf", _settings(_authority("Plain")))
    assert _preview(path).signature.status == "unsigned"


def test_a_pdf_with_two_security_settings_files_is_refused(store: Path, tmp_path: Path) -> None:
    path = _settings_pdf(
        tmp_path / "aatl.pdf", _settings(_authority("One")), _settings(_authority("Two"))
    )
    assert _reason(_preview, path) == "trustFileFormat"


def test_a_pdf_whose_streams_inflate_past_the_budget_is_refused_quickly(
    store: Path, tmp_path: Path
) -> None:
    import time
    import zlib

    path = _settings_pdf(tmp_path / "aatl.pdf", _settings(_authority("Bomb")))
    document = pymupdf.open(path)
    xref = document.get_new_xref()
    document.update_object(xref, "<< /Filter /FlateDecode >>")
    document.update_stream(xref, zlib.compress(b"\0" * (200 * 1024 * 1024), 9), compress=False)
    document.xref_set_key(document.pdf_catalog(), "Filler", f"{xref} 0 R")
    document.saveIncr()
    document.close()
    started = time.perf_counter()
    assert _reason(_preview, path) == "trustFileFormat"
    assert time.perf_counter() - started < 10
