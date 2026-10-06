import base64
import datetime
import hashlib
from pathlib import Path

import pymupdf
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from vivepdf.ops import sign_verify
from vivepdf.ops._sign_params import SignParams
from vivepdf.ops.sign import sign as sign_document
from vivepdf.ops.sign_certificate import (
    CreateCertificateParams,
    ExportCertificateParams,
    create_certificate,
    export_certificate,
)
from vivepdf.ops.sign_trust import (
    SOURCES_FILE,
    TrustAddParams,
    TrustClearParams,
    TrustListParams,
    TrustPreviewParams,
    TrustRemoveParams,
    TrustSource,
    trust_add,
    trust_clear,
    trust_list,
    trust_preview,
    trust_remove,
)
from vivepdf.ops.sign_verify import VerifyParams, verify
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    folder = tmp_path / "trust"
    folder.mkdir()
    monkeypatch.setattr(sign_verify, "user_trust_dir", lambda: folder)
    return folder


def _stored(store: Path) -> list[Path]:
    return [path for path in store.iterdir() if not path.name.lower().endswith(".tmp")]


def _authority(name: str, days: int = 365) -> tuple[x509.Certificate, ec.EllipticCurvePrivateKey]:
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    now = datetime.datetime.now(datetime.UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=2))
        .not_valid_after(now + datetime.timedelta(days=days))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    return certificate, key


def _der_file(folder: Path, name: str, certificate: x509.Certificate) -> Path:
    path = folder / name
    path.write_bytes(certificate.public_bytes(serialization.Encoding.DER))
    return path


TSL_TYPE = "http://uri.etsi.org/TrstSvc/TrustedList/TSLType/"
SERVICE_TYPE = "http://uri.etsi.org/TrstSvc/Svctype/"
SERVICE_STATUS = "http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/"


def _base64(certificate: x509.Certificate) -> str:
    return base64.b64encode(certificate.public_bytes(serialization.Encoding.DER)).decode()


def _etsi_service(service_type: str, status: str, certificates: list[x509.Certificate]) -> str:
    identities = "".join(
        f"<DigitalId><X509Certificate>{_base64(certificate)}</X509Certificate></DigitalId>"
        for certificate in certificates
    )
    return (
        "<TSPService><ServiceInformation>"
        f"<ServiceTypeIdentifier>{SERVICE_TYPE}{service_type}</ServiceTypeIdentifier>"
        '<ServiceName><Name xml:lang="en">service</Name></ServiceName>'
        f"<ServiceDigitalIdentity>{identities}</ServiceDigitalIdentity>"
        f"<ServiceStatus>{SERVICE_STATUS}{status}</ServiceStatus>"
        "</ServiceInformation></TSPService>"
    )


def _etsi_list(
    services: list[tuple[str, str, list[x509.Certificate]]],
    kind: str,
    territory: str | None = None,
    operator: str | None = None,
) -> bytes:
    blocks = "".join(_etsi_service(*service) for service in services)
    names = (
        f'<SchemeOperatorName><Name xml:lang="de">Betreiber</Name><Name xml:lang="en">{operator}'
        "</Name></SchemeOperatorName>"
        if operator
        else ""
    )
    place = f"<SchemeTerritory>{territory}</SchemeTerritory>" if territory else ""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<TrustServiceStatusList xmlns="http://uri.etsi.org/02231/v2#">'
        f"<SchemeInformation><TSLType>{TSL_TYPE}{kind}</TSLType>{names}{place}</SchemeInformation>"
        f"<TrustServiceProviderList><TrustServiceProvider><TSPServices>{blocks}"
        "</TSPServices></TrustServiceProvider></TrustServiceProviderList>"
        "</TrustServiceStatusList>"
    ).encode()


def _security_settings(identities: list[tuple[x509.Certificate, str]]) -> bytes:
    entries = "".join(
        f"<Identity><ImportAction>1</ImportAction><Certificate>{_base64(certificate)}"
        f"</Certificate><Trust><Root>{root}</Root><CertifiedDocuments>1</CertifiedDocuments>"
        "</Trust><Identification><Source>AATL</Source></Identification></Identity>"
        for certificate, root in identities
    )
    return (
        '<?xml version="1.0"?>\n<SecuritySettings><TrustedIdentities>'
        f"{entries}</TrustedIdentities></SecuritySettings>"
    ).encode()


def _settings_pdf(path: Path, settings: bytes) -> Path:
    document = pymupdf.open()
    document.new_page()
    document.embfile_add("notes.txt", b"not the settings")
    document.embfile_add("SecuritySettings.xml", settings)
    document.save(path)
    document.close()
    return path


def _params(path: str) -> TrustAddParams:
    source = Path(path)
    digest = hashlib.sha256(source.read_bytes()).hexdigest() if source.is_file() else None
    return TrustAddParams(path=path, accept_unverified=True, expected_digest=digest)


def _added(source: Path) -> list[str]:
    result = trust_add(_params(path=str(source)), silent_progress())
    return [root.subject for root in result.added]


def _refusal(source: Path) -> dict:
    with pytest.raises(OpError) as caught:
        trust_add(_params(path=str(source)), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    return caught.value.data


def _list() -> list[str]:
    return [root.subject for root in trust_list(TrustListParams(), silent_progress()).roots]


def test_an_empty_store_lists_nothing(store: Path) -> None:
    listed = trust_list(TrustListParams(), silent_progress())
    assert listed.roots == [] and listed.unreadable == []


def test_an_added_root_is_listed_with_its_details(store: Path, tmp_path: Path) -> None:
    certificate, _key = _authority("Kök Sertifika Hizmet Sağlayıcısı")
    source = _der_file(tmp_path, "kök.crt", certificate)
    added = trust_add(_params(path=str(source)), silent_progress())
    assert added.known == 0 and len(added.added) == 1
    root = added.added[0]
    assert root.subject == "Kök Sertifika Hizmet Sağlayıcısı"
    assert root.authority and root.self_signed and not root.expired
    assert (store / root.id).read_bytes() == source.read_bytes()
    assert len(root.fingerprint) == 64
    assert trust_list(TrustListParams(), silent_progress()).roots == [root]


def test_adding_the_same_root_twice_keeps_one_copy(store: Path, tmp_path: Path) -> None:
    certificate, _key = _authority("Tekrar")
    source = _der_file(tmp_path, "a.cer", certificate)
    trust_add(_params(path=str(source)), silent_progress())
    again = trust_add(_params(path=str(source)), silent_progress())
    assert again.added == [] and again.known == 1
    assert len(list(_stored(store))) == 1


def test_a_pem_bundle_adds_each_certificate_and_never_stores_the_key(
    store: Path, tmp_path: Path
) -> None:
    first, key = _authority("Birinci")
    second, _other = _authority("İkinci", days=-1)
    bundle = tmp_path / "zincir.pem"
    bundle.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        + first.public_bytes(serialization.Encoding.PEM)
        + second.public_bytes(serialization.Encoding.PEM)
    )
    added = trust_add(_params(path=str(bundle)), silent_progress())
    assert [root.subject for root in added.added] == ["Birinci", "İkinci"]
    assert [root.expired for root in added.added] == [False, True]
    stored = sorted(path.read_bytes() for path in _stored(store))
    assert stored == sorted(
        certificate.public_bytes(serialization.Encoding.DER) for certificate in (first, second)
    )
    assert all(b"PRIVATE" not in data for data in stored)


def test_a_file_that_is_not_a_certificate_is_refused(store: Path, tmp_path: Path) -> None:
    source = tmp_path / "not.cer"
    source.write_bytes(b"merhaba")
    with pytest.raises(OpError) as caught:
        trust_add(_params(path=str(source)), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "trustFileFormat"}
    assert list(_stored(store)) == []


def test_a_missing_file_is_reported(store: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as caught:
        trust_add(
            _params(path=str(tmp_path / "yok.cer")),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.FILE_NOT_FOUND


def test_unreadable_files_in_the_store_are_named_and_can_be_removed(store: Path) -> None:
    (store / "bozuk.pem").write_bytes(b"-----BEGIN CERTIFICATE-----\nAAAA\n")
    (store / "notlar.txt").write_bytes(b"ignored")
    listed = trust_list(TrustListParams(), silent_progress())
    assert listed.roots == [] and listed.unreadable == ["bozuk.pem"]
    removed = trust_remove(TrustRemoveParams(id="bozuk.pem"), silent_progress())
    assert removed.removed == 0
    assert sorted(path.name for path in _stored(store)) == ["notlar.txt"]


def test_removing_a_root_deletes_its_file(store: Path, tmp_path: Path) -> None:
    certificate, _key = _authority("Silinecek")
    added = trust_add(
        _params(path=str(_der_file(tmp_path, "s.der", certificate))),
        silent_progress(),
    )
    result = trust_remove(TrustRemoveParams(id=added.added[0].id), silent_progress())
    assert result.removed == 1
    assert _list() == []


@pytest.mark.parametrize("name", ["../dış.cer", "notlar.txt", "yok.cer", "..", "trust"])
def test_only_files_listed_in_the_store_can_be_removed(
    store: Path, tmp_path: Path, name: str
) -> None:
    certificate, _key = _authority("Dış")
    outside = _der_file(tmp_path, "dış.cer", certificate)
    (store / "notlar.txt").write_bytes(b"x")
    with pytest.raises(OpError) as caught:
        trust_remove(TrustRemoveParams(id=name), silent_progress())
    assert caught.value.code == ErrorCode.FILE_NOT_FOUND
    assert caught.value.data == {"reason": "trustMissing"}
    assert outside.exists() and (store / "notlar.txt").exists()


def test_an_added_self_made_certificate_makes_its_signature_trusted(
    store: Path, sample_pdf: Path, tmp_path: Path
) -> None:
    key_file = create_certificate(
        CreateCertificateParams(
            output=str(tmp_path / "ben.p12"), password="pw-12345", common_name="Ayşe"
        ),
        silent_progress(),
    ).output
    signed = sign_document(
        SignParams(
            path=str(sample_pdf),
            output=str(tmp_path / "imzalı.pdf"),
            certificate_path=key_file,
            certificate_password="pw-12345",
            page=1,
        ),
        silent_progress(),
    ).output
    assert not verify(VerifyParams(path=signed), silent_progress()).signatures[0].trusted
    public = export_certificate(
        ExportCertificateParams(
            path=key_file, password="pw-12345", output=str(tmp_path / "ben.cer")
        ),
        silent_progress(),
    ).output
    trust_add(_params(path=public), silent_progress())
    signature = verify(VerifyParams(path=signed), silent_progress()).signatures[0]
    assert signature.trusted and signature.trust_source == "user"


def test_a_national_trusted_list_adds_active_qualified_authorities_and_timestamps(
    store: Path, tmp_path: Path
) -> None:
    active, _key = _authority("Nitelikli Kök")
    renewed, _key = _authority("Nitelikli Kök 2")
    withdrawn, _key = _authority("Geri Çekilmiş")
    stamps, _key = _authority("Zaman Damgası")
    responder, _key = _authority("OCSP")
    source = tmp_path / "tl.xml"
    source.write_bytes(
        _etsi_list(
            [
                ("CA/QC", "granted", [active, renewed]),
                ("CA/QC", "withdrawn", [withdrawn]),
                ("TSA/QTST", "granted", [stamps]),
                ("OCSP/QC", "granted", [responder]),
                ("CA/QC", "recognisedatnationallevel", [active]),
            ],
            "EUgeneric",
        )
    )
    assert _added(source) == ["Nitelikli Kök", "Nitelikli Kök 2", "Zaman Damgası"]
    assert sorted(_list()) == ["Nitelikli Kök", "Nitelikli Kök 2", "Zaman Damgası"]
    again = trust_add(_params(path=str(source)), silent_progress())
    assert again.added == [] and again.known == 3


def test_a_security_settings_file_adds_only_identities_trusted_as_roots(
    store: Path, tmp_path: Path
) -> None:
    root, _key = _authority("AATL Kök")
    intermediate, _key = _authority("AATL Ara")
    settings = _security_settings([(root, "1"), (intermediate, "0")])
    packaged = _settings_pdf(tmp_path / "aatl.acrobatsecuritysettings", settings)
    assert _added(packaged) == ["AATL Kök"]
    trust_clear(TrustClearParams(), silent_progress())
    plain = tmp_path / "SecuritySettings.xml"
    plain.write_bytes(settings)
    assert _added(plain) == ["AATL Kök"]


def test_a_list_of_lists_without_pointers_and_a_list_without_authorities_are_explained(
    store: Path, tmp_path: Path
) -> None:
    withdrawn, _key = _authority("Eski")
    pointers = tmp_path / "eu-lotl.xml"
    pointers.write_bytes(_etsi_list([], "EUlistofthelists"))
    assert _refusal(pointers) == {"reason": "trustListEmpty"}
    inactive = tmp_path / "tl.xml"
    inactive.write_bytes(_etsi_list([("CA/QC", "withdrawn", [withdrawn])], "EUgeneric"))
    assert _refusal(inactive) == {"reason": "trustListEmpty"}
    no_roots = tmp_path / "settings.xml"
    no_roots.write_bytes(_security_settings([(withdrawn, "0")]))
    assert _refusal(no_roots) == {"reason": "trustListEmpty"}
    assert list(_stored(store)) == []


@pytest.mark.parametrize(
    "content",
    [
        b'<?xml version="1.0"?><!DOCTYPE s [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;">]>'
        b"<SecuritySettings><TrustedIdentities>&b;</TrustedIdentities></SecuritySettings>",
        b"<SecuritySettings><TrustedIdentities><Identity>",
        "<SecuritySettings>\u015e</SecuritySettings>".encode("utf-16"),
        '<!DOCTYPE s [<!ENTITY a "x">]><SecuritySettings>&a;</SecuritySettings>'.encode(
            "utf-16-le"
        ),
        b"<html><body>not a trust list</body></html>",
        b"%PDF-1.7\nnot really a pdf",
    ],
    ids=["entities", "unclosed", "utf16", "utf16le-no-mark", "html", "broken-pdf"],
)
def test_malformed_or_foreign_markup_is_refused_as_an_unreadable_trust_file(
    store: Path, tmp_path: Path, content: bytes
) -> None:
    source = tmp_path / "list.xml"
    source.write_bytes(content)
    assert _refusal(source) == {"reason": "trustFileFormat"}
    assert list(_stored(store)) == []


def test_broken_entries_in_a_trust_list_are_skipped(store: Path, tmp_path: Path) -> None:
    good, _key = _authority("Sağlam")
    settings = _security_settings([(good, "1")]).replace(
        b"<TrustedIdentities>",
        b"<TrustedIdentities><Identity><Certificate>@@@</Certificate><Trust><Root>1</Root>"
        b"</Trust></Identity><Identity><Certificate>AAAA</Certificate><Trust><Root>1</Root>"
        b"</Trust></Identity>",
    )
    source = tmp_path / "settings.xml"
    source.write_bytes(settings)
    assert _added(source) == ["Sağlam"]


def test_clearing_the_store_removes_every_root_file(store: Path, tmp_path: Path) -> None:
    first, _key = _authority("Bir")
    second, _key = _authority("İki")
    trust_add(
        _params(path=str(_der_file(tmp_path, "1.cer", first))),
        silent_progress(),
    )
    trust_add(
        _params(path=str(_der_file(tmp_path, "2.cer", second))),
        silent_progress(),
    )
    (store / "bozuk.pem").write_bytes(b"-----BEGIN CERTIFICATE-----\nAAAA\n")
    (store / "notlar.txt").write_bytes(b"kept")
    assert trust_clear(TrustClearParams(), silent_progress()).removed == 3
    assert sorted(path.name for path in _stored(store)) == ["notlar.txt"]
    assert trust_clear(TrustClearParams(), silent_progress()).removed == 0


def _national(
    folder: Path, name: str, certificates: list[x509.Certificate], territory: str = "DE"
) -> Path:
    source = folder / name
    source.write_bytes(
        _etsi_list([("CA/QC", "granted", certificates)], "EUgeneric", territory, "Federal Agency")
    )
    return source


def _preview(source: Path):
    return trust_preview(TrustPreviewParams(path=str(source)), silent_progress())


def _sources() -> dict[str, list[TrustSource]]:
    return {
        root.subject: root.lists for root in trust_list(TrustListParams(), silent_progress()).roots
    }


GERMAN = TrustSource(
    kind="euTrustedList", territory="DE", name="Federal Agency", verification="unsigned"
)


def test_a_newer_trusted_list_withdraws_the_providers_it_dropped(
    store: Path, tmp_path: Path
) -> None:
    kept, _key = _authority("Kalan")
    dropped, _key = _authority("Çıkarılan")
    joined, _key = _authority("Yeni Gelen")
    assert _added(_national(tmp_path, "de-1.xml", [kept, dropped])) == ["Kalan", "Çıkarılan"]
    assert _sources() == {"Kalan": [GERMAN], "Çıkarılan": [GERMAN]}
    newer = _national(tmp_path, "de-2.xml", [kept, joined])
    before = sorted(path.read_bytes() for path in _stored(store))
    preview = _preview(newer)
    assert preview.source == GERMAN
    assert [root.subject for root in preview.added] == ["Yeni Gelen"]
    assert preview.added[0].lists == [GERMAN]
    assert preview.known == 1
    assert [root.subject for root in preview.withdrawn] == ["Çıkarılan"]
    assert sorted(path.read_bytes() for path in _stored(store)) == before
    result = trust_add(_params(path=str(newer)), silent_progress())
    assert [root.subject for root in result.added] == ["Yeni Gelen"]
    assert result.known == 1 and result.withdrawn == 1
    assert _sources() == {"Kalan": [GERMAN], "Yeni Gelen": [GERMAN]}
    assert len([path for path in _stored(store) if path.suffix == ".cer"]) == 2


def test_a_root_added_by_hand_or_by_another_list_outlives_its_withdrawal(
    store: Path, tmp_path: Path
) -> None:
    by_hand, _key = _authority("Elle Önce")
    later, _key = _authority("Elle Sonra")
    shared, _key = _authority("İki Listede")
    only, _key = _authority("Yalnız Almanya")
    trust_add(
        _params(path=str(_der_file(tmp_path, "el.cer", by_hand))),
        silent_progress(),
    )
    _added(_national(tmp_path, "de-1.xml", [by_hand, later, shared, only]))
    _added(_national(tmp_path, "fr.xml", [shared], territory="FR"))
    trust_add(
        _params(path=str(_der_file(tmp_path, "sonra.cer", later))),
        silent_progress(),
    )
    french = TrustSource(
        kind="euTrustedList", territory="FR", name="Federal Agency", verification="unsigned"
    )
    assert _sources()["İki Listede"] == [GERMAN, french]
    withdrawn, _key = _authority("Boş Olmasın")
    result = trust_add(
        _params(path=str(_national(tmp_path, "de-2.xml", [withdrawn]))),
        silent_progress(),
    )
    assert result.withdrawn == 1
    assert _sources() == {
        "Elle Önce": [],
        "Elle Sonra": [],
        "İki Listede": [french],
        "Boş Olmasın": [GERMAN],
    }


def test_a_list_without_a_territory_or_operator_is_not_tracked(store: Path, tmp_path: Path) -> None:
    first, _key = _authority("İsimsiz Bir")
    second, _key = _authority("İsimsiz İki")
    unnamed = tmp_path / "tl.xml"
    unnamed.write_bytes(_etsi_list([("CA/QC", "granted", [first])], "EUgeneric"))
    _added(unnamed)
    unnamed.write_bytes(_etsi_list([("CA/QC", "granted", [second])], "EUgeneric"))
    preview = _preview(unnamed)
    assert preview.source == TrustSource(kind="euTrustedList", verification="unsigned")
    assert preview.withdrawn == []
    _added(unnamed)
    assert _sources() == {"İsimsiz Bir": [], "İsimsiz İki": []}
    assert not (store / SOURCES_FILE).exists()


def test_the_adobe_list_is_named_by_its_source(store: Path, tmp_path: Path) -> None:
    root, _key = _authority("AATL Kök")
    source = tmp_path / "SecuritySettings.xml"
    source.write_bytes(_security_settings([(root, "1")]))
    adobe = TrustSource(kind="securitySettings", name="AATL", verification="unsigned")
    assert _preview(source).source == adobe
    _added(source)
    assert _sources() == {"AATL Kök": [adobe]}


@pytest.mark.parametrize(
    "record",
    [
        b"not json",
        b'{"version": 99, "lists": {}, "roots": {}}',
        b'{"version": 1, "lists": [], "roots": {}}',
        b'{"version": 1, "lists": {"x": {"kind": "other"}}, "roots": {"a.cer": ["x", [1], 3]}}',
    ],
    ids=["garbage", "version", "shape", "entries"],
)
def test_a_damaged_source_record_leaves_every_root_as_added_by_hand(
    store: Path, tmp_path: Path, record: bytes
) -> None:
    certificate, _key = _authority("Kayıtsız")
    _der_file(store, "a.cer", certificate)
    (store / SOURCES_FILE).write_bytes(record)
    assert _sources() == {"Kayıtsız": []}
    other, _key = _authority("Listeden")
    _added(_national(tmp_path, "de.xml", [other]))
    assert _sources() == {"Kayıtsız": [], "Listeden": [GERMAN]}


def test_removing_a_listed_root_forgets_its_source_and_clearing_drops_the_record(
    store: Path, tmp_path: Path
) -> None:
    first, _key = _authority("Bir")
    second, _key = _authority("İki")
    added = trust_add(
        _params(path=str(_national(tmp_path, "de.xml", [first, second]))),
        silent_progress(),
    ).added
    trust_remove(TrustRemoveParams(id=added[0].id), silent_progress())
    assert added[0].id not in (store / SOURCES_FILE).read_text(encoding="utf-8")
    assert _sources() == {"İki": [GERMAN]}
    trust_remove(TrustRemoveParams(id=added[1].id), silent_progress())
    assert not (store / SOURCES_FILE).exists()
    _added(_national(tmp_path, "de.xml", [first]))
    assert trust_clear(TrustClearParams(), silent_progress()).removed == 1
    assert list(_stored(store)) == []


def test_the_preview_refuses_what_the_import_refuses(store: Path, tmp_path: Path) -> None:
    pointers = tmp_path / "eu-lotl.xml"
    pointers.write_bytes(_etsi_list([], "EUlistofthelists", "EU", "European Commission"))
    with pytest.raises(OpError) as caught:
        _preview(pointers)
    assert caught.value.data == {"reason": "trustListEmpty"}
    with pytest.raises(OpError) as missing:
        _preview(tmp_path / "yok.xml")
    assert missing.value.code == ErrorCode.FILE_NOT_FOUND
    assert list(_stored(store)) == []


def test_a_root_imported_from_a_security_settings_pdf_makes_its_signature_trusted(
    store: Path, sample_pdf: Path, tmp_path: Path
) -> None:
    key_file = create_certificate(
        CreateCertificateParams(
            output=str(tmp_path / "ben.p12"), password="pw-12345", common_name="Zeynep"
        ),
        silent_progress(),
    ).output
    signed = sign_document(
        SignParams(
            path=str(sample_pdf),
            output=str(tmp_path / "imzalı.pdf"),
            certificate_path=key_file,
            certificate_password="pw-12345",
            page=1,
        ),
        silent_progress(),
    ).output
    public = export_certificate(
        ExportCertificateParams(
            path=key_file, password="pw-12345", output=str(tmp_path / "ben.cer")
        ),
        silent_progress(),
    ).output
    certificate = x509.load_der_x509_certificate(Path(public).read_bytes())
    settings = _settings_pdf(tmp_path / "tl.pdf", _security_settings([(certificate, "1")]))
    assert _added(settings) == ["Zeynep"]
    signature = verify(VerifyParams(path=signed), silent_progress()).signatures[0]
    assert signature.trusted and signature.trust_source == "user"


def test_lists_added_at_the_same_time_both_keep_their_source(
    store: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import threading
    import time

    from vivepdf.ops import sign_trust

    first, _key = _authority("Birinci Kök")
    second, _key = _authority("İkinci Kök")
    sources = []
    for name, certificate, territory in (("a.xml", first, "DE"), ("b.xml", second, "AT")):
        path = tmp_path / name
        services = [("CA/QC", "granted", [certificate])]
        path.write_bytes(_etsi_list(services, "EUgeneric", territory, f"Operator {territory}"))
        sources.append(path)
    original = sign_trust._load_sources

    def slow_load(*arguments):
        loaded = original(*arguments)
        time.sleep(0.2)
        return loaded

    monkeypatch.setattr(sign_trust, "_load_sources", slow_load)
    failures: list[BaseException] = []

    def add(path: Path) -> None:
        try:
            trust_add(_params(path=str(path)), silent_progress())
        except BaseException as error:
            failures.append(error)

    workers = [threading.Thread(target=add, args=(path,)) for path in sources]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()
    monkeypatch.setattr(sign_trust, "_load_sources", original)
    assert failures == []
    listed = sign_trust.trust_list(sign_trust.TrustListParams(), silent_progress())
    assert sorted(root.subject for root in listed.roots if root.lists) == [
        "Birinci Kök",
        "İkinci Kök",
    ]
