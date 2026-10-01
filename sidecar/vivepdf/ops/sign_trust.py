import datetime
import functools
import hashlib
import json
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from pydantic import Field

from vivepdf.ops import sign_verify
from vivepdf.ops._output import unlink_patiently, write_atomically
from vivepdf.ops._trust_lists import (
    EU_TRUSTED_LIST,
    MAX_LIST_BYTES,
    MAX_SOURCE_NAME,
    MAX_TERRITORY,
    EmptyTrustList,
    ListedCertificates,
    ListSource,
    looks_like_markup,
    trust_list_certificates,
)
from vivepdf.ops._xml_signature import SignatureInvalid
from vivepdf.ops.sign import _subject_label
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MAX_CERTIFICATE_FILE_BYTES = 4 * 1024 * 1024
MAX_CERTIFICATES_PER_FILE = 500
STORED_SUFFIX = ".cer"
SOURCES_FILE = "sources.json"
SOURCES_VERSION = 2
READABLE_SOURCES_VERSIONS = frozenset({1, SOURCES_VERSION})
PINS_FILE = "lotl-pins.json"
PINS_VERSION = 3
READABLE_PINS_VERSIONS = frozenset({1, 2, PINS_VERSION})
LOTL_ANCHORS: frozenset[str] = frozenset(
    {
        "C0641C4F7D56C431B1C924742DB7FCE9C1EEF7D7FD212113A2768486B3ABCDC5",
        "E0A620FBB6747362BB933AC44169D676A553444716CF5F31605F12A22B8396B1",
        "DF7E29360C34B2B8D6D5F40325C1D4D12C9922CECD33B7407674A74B2B3CA1E5",
        "B63D416744E7098BF9EC2CAA596A93BC2468E37F8284BA65ECC061711BCBAA18",
        "236103F03A8031AE8F47F9059BF8DE38564CDBFEBEDDE4A597D50F8980AA653B",
        "D2064FDD70F6982DCC516B86D9D5C56AEA939417C624B2E478C0B29DE54F8474",
    }
)
UNCHECKED_ORIGINS = frozenset({"unsigned", "unverifiable"})
DER_SEQUENCE = b"\x30"
PEM_ARMOR = b"-----BEGIN"
MAX_SOURCES_BYTES = 4 * 1024 * 1024
MANUAL = "manual"
VERIFIED = "verified"
DIGEST_PATTERN = r"^[0-9a-f]{64}$"
FINGERPRINT = re.compile(r"^[0-9A-F]{64}$")

Verification = Literal["verified", "unpinned", "pinMismatch", "unsigned", "unverifiable"]


class TrustSource(RpcModel):
    kind: Literal["euTrustedList", "euListOfLists", "securitySettings"]
    territory: str | None = Field(default=None, max_length=MAX_TERRITORY)
    name: str | None = Field(default=None, max_length=MAX_SOURCE_NAME)
    verification: Verification | None = None


class ListSigner(RpcModel):
    subject: str
    issuer: str
    fingerprint: str
    valid_from: str
    valid_until: str
    expired: bool


class ListSignature(RpcModel):
    status: Verification
    signer: ListSigner | None
    signed_at: str | None
    stale: bool
    next_update: str | None


class TrustRoot(RpcModel):
    id: str
    subject: str
    issuer: str
    fingerprint: str
    valid_from: str
    valid_until: str
    authority: bool
    self_signed: bool
    expired: bool
    lists: list[TrustSource] = Field(default_factory=list)


class TrustListParams(RpcModel):
    pass


class TrustListResult(RpcModel):
    roots: list[TrustRoot]
    unreadable: list[str]


class TrustAddParams(RpcModel):
    path: str
    expected_digest: str | None = Field(default=None, pattern=DIGEST_PATTERN)
    accept_unverified: bool = False


class TrustAddResult(RpcModel):
    added: list[TrustRoot]
    known: int
    withdrawn: int = 0
    pinned: int = 0


class TrustPreviewParams(RpcModel):
    path: str


class TrustPreviewResult(RpcModel):
    source: TrustSource | None
    added: list[TrustRoot]
    known: int
    withdrawn: list[TrustRoot]
    signature: ListSignature | None = None
    digest: str
    pinned: int = 0


class TrustRemoveParams(RpcModel):
    id: str = Field(min_length=1, max_length=255)


class TrustRemoveResult(RpcModel):
    removed: int


class TrustClearParams(RpcModel):
    pass


class TrustClearResult(RpcModel):
    removed: int


STORE_LOCK = threading.Lock()


def _serialised(handler):
    @functools.wraps(handler)
    def run(params, progress):
        with STORE_LOCK:
            return handler(params, progress)

    return run


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


def _fingerprint(certificate) -> str:
    return hashlib.sha256(certificate.dump()).hexdigest().upper()


def _describe(certificate, file_id: str) -> TrustRoot:
    valid_from = certificate["tbs_certificate"]["validity"]["not_before"].native
    valid_until = certificate["tbs_certificate"]["validity"]["not_after"].native
    return TrustRoot(
        id=file_id,
        subject=_subject_label(certificate),
        issuer=_issuer_label(certificate),
        fingerprint=_fingerprint(certificate),
        valid_from=valid_from.isoformat(),
        valid_until=valid_until.isoformat(),
        authority=bool(certificate.ca),
        self_signed=certificate.self_signed != "no",
        expired=valid_until < datetime.datetime.now(datetime.UTC),
    )


def _issuer_label(certificate) -> str:
    try:
        native = certificate.issuer.native
        return str(
            native.get("common_name")
            or native.get("organization_name")
            or certificate.issuer.human_friendly
        )
    except Exception:  # noqa: BLE001
        return ""


def _stored_files(store: Path) -> list[Path]:
    return [
        path
        for path in sorted(store.iterdir())
        if path.is_file() and path.suffix.lower() in sign_verify.USER_TRUST_EXTENSIONS
    ]


def _parsed_certificates(data: bytes, name: str) -> list[tuple[Any, TrustRoot]]:
    if len(data) > MAX_CERTIFICATE_FILE_BYTES:
        raise ValueError("file too large")
    certificates = sign_verify._parse_certificate_bytes(data)
    if not certificates or len(certificates) > MAX_CERTIFICATES_PER_FILE:
        raise ValueError("no certificates")
    return [(certificate, _describe(certificate, name)) for certificate in certificates]


def _read_certificates(path: Path) -> list[tuple[Any, TrustRoot]]:
    if path.stat().st_size > MAX_CERTIFICATE_FILE_BYTES:
        raise ValueError("file too large")
    return _parsed_certificates(path.read_bytes(), path.name)


def _plain_certificate_file(path: Path, data: bytes) -> bool:
    return (
        path.suffix.lower() in sign_verify.USER_TRUST_EXTENSIONS
        and not looks_like_markup(data)
        and (data.startswith(DER_SEQUENCE) or data.lstrip().startswith(PEM_ARMOR))
    )


@dataclass
class _Read:
    certificates: list[tuple[Any, TrustRoot]]
    listed: ListedCertificates | None
    digest: str


def _read_import(path: Path, progress: Progress) -> _Read:
    with path.open("rb") as handle:
        data = handle.read(MAX_LIST_BYTES + 1)
    if len(data) > MAX_LIST_BYTES:
        raise ValueError("file too large")
    digest = hashlib.sha256(data).hexdigest()
    listed = trust_list_certificates(data, progress.check_cancelled)
    if listed is None:
        if not _plain_certificate_file(path, data):
            raise ValueError("neither a certificate file nor a recognised trust list")
        return _Read(_parsed_certificates(data, path.name), None, digest)
    if listed.list_of_lists:
        if not listed.pins:
            raise EmptyTrustList("no pointer certificates in the list of trusted lists")
        return _Read([], listed, digest)
    readable: list[tuple[Any, TrustRoot]] = []
    for certificate in listed.certificates:
        try:
            readable.append((certificate, _describe(certificate, path.name)))
        except Exception:
            continue
    if not readable:
        raise EmptyTrustList("no usable certificates in the trust list")
    return _Read(readable, listed, digest)


def _read_checked(path: str, progress: Progress) -> _Read:
    source = Path(path)
    if not source.is_file():
        raise OpError(ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}", {"path": path})
    try:
        return _read_import(source, progress)
    except OpError:
        raise
    except SignatureInvalid as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"the trust list signature is not valid: {source.name}",
            {"reason": "trustListSignatureInvalid"},
        ) from error
    except EmptyTrustList as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"no active certificate authority in the trust list: {source.name}",
            {"reason": "trustListEmpty"},
        ) from error
    except Exception as error:  # noqa: BLE001
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"not a certificate file: {source.name}",
            {"reason": "trustFileFormat"},
        ) from error


@dataclass
class _Sources:
    lists: dict[str, TrustSource] = field(default_factory=dict)
    roots: dict[str, list[str]] = field(default_factory=dict)


def _load_sources(store: Path, files: set[str]) -> _Sources:
    path = store / SOURCES_FILE
    try:
        if not path.is_file() or path.stat().st_size > MAX_SOURCES_BYTES:
            return _Sources()
        raw = json.loads(path.read_bytes())
    except (OSError, ValueError):
        return _Sources()
    if not isinstance(raw, dict) or raw.get("version") not in READABLE_SOURCES_VERSIONS:
        return _Sources()
    lists, roots = raw.get("lists"), raw.get("roots")
    if not isinstance(lists, dict) or not isinstance(roots, dict):
        return _Sources()
    sources = _Sources()
    for key, value in lists.items():
        try:
            sources.lists[key] = TrustSource.model_validate(value)
        except ValueError:
            continue
    for name, keys in roots.items():
        if name not in files or not isinstance(keys, list):
            continue
        kept = [
            key for key in keys if isinstance(key, str) and (key == MANUAL or key in sources.lists)
        ]
        if kept:
            sources.roots[name] = list(dict.fromkeys(kept))
    return sources


def _save_sources(store: Path, sources: _Sources) -> None:
    roots = {
        name: keys for name, keys in sorted(sources.roots.items()) if keys and keys != [MANUAL]
    }
    used = {key for keys in roots.values() for key in keys}
    lists = {
        key: source.model_dump(mode="json")
        for key, source in sorted(sources.lists.items())
        if key in used
    }
    path = store / SOURCES_FILE
    if not roots:
        unlink_patiently(path)
        return
    data = json.dumps(
        {"version": SOURCES_VERSION, "lists": lists, "roots": roots},
        ensure_ascii=False,
        indent=1,
    ).encode()
    write_atomically(path, lambda partial: partial.write_bytes(data))


def _file_names(store: Path) -> set[str]:
    return {path.name for path in _stored_files(store)}


def _labelled(root: TrustRoot, sources: _Sources) -> TrustRoot:
    keys = sources.roots.get(root.id, [])
    lists = [sources.lists[key] for key in keys if key in sources.lists]
    return root.model_copy(update={"lists": lists}) if lists else root


def _trust_source(source: ListSource, verification: str | None) -> TrustSource:
    return TrustSource.model_validate(
        {
            "kind": source.kind,
            "territory": source.territory,
            "name": source.name,
            "verification": verification,
        }
    )


@dataclass(frozen=True)
class _PinSet:
    fingerprints: frozenset[str]
    anchored: bool


def _pin_entry(value: Any, version: int) -> _PinSet | None:
    if version == 1:
        values, anchored = value, False
    elif isinstance(value, dict):
        values, anchored = value.get("fingerprints"), value.get("anchored") is True
    else:
        return None
    if not isinstance(values, list):
        return None
    fingerprints = frozenset(
        item for item in values if isinstance(item, str) and FINGERPRINT.match(item)
    )
    return _PinSet(fingerprints, anchored)


@dataclass(frozen=True)
class _StoredPins:
    pins: dict[str, _PinSet]
    lotl_sequence: int | None = None


def _stored_sequence(raw: dict) -> int | None:
    value = raw.get("lotlSequence")
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _load_pin_file(store: Path) -> _StoredPins:
    path = store / PINS_FILE
    try:
        if not path.is_file() or path.stat().st_size > MAX_SOURCES_BYTES:
            return _StoredPins({})
        raw = json.loads(path.read_bytes())
    except (OSError, ValueError):
        return _StoredPins({})
    if not isinstance(raw, dict) or raw.get("version") not in READABLE_PINS_VERSIONS:
        return _StoredPins({})
    pins = raw.get("pins")
    if not isinstance(pins, dict):
        return _StoredPins({})
    loaded: dict[str, _PinSet] = {}
    for territory, value in pins.items():
        if not isinstance(territory, str) or not 0 < len(territory) <= MAX_TERRITORY:
            continue
        entry = _pin_entry(value, raw["version"])
        if entry is not None:
            loaded[territory] = entry
    return _StoredPins(loaded, _stored_sequence(raw))


def _merged_pins(
    existing: dict[str, _PinSet], incoming: dict[str, frozenset[str]], anchored: bool
) -> dict[str, _PinSet]:
    if anchored:
        return {
            territory: _PinSet(fingerprints, True) for territory, fingerprints in incoming.items()
        }
    merged = dict(existing)
    for territory, fingerprints in incoming.items():
        current = merged.get(territory)
        if current is not None and current.anchored and not anchored:
            continue
        merged[territory] = _PinSet(fingerprints, anchored)
    return merged


def _save_pins(store: Path, pins: dict[str, _PinSet], lotl_sequence: int | None) -> None:
    data = json.dumps(
        {
            "version": PINS_VERSION,
            "lotlSequence": lotl_sequence,
            "pins": {
                territory: {"anchored": entry.anchored, "fingerprints": sorted(entry.fingerprints)}
                for territory, entry in sorted(pins.items())
            },
        },
        indent=1,
    ).encode()
    write_atomically(store / PINS_FILE, lambda partial: partial.write_bytes(data))


def _iso(moment: datetime.datetime | None) -> str | None:
    return moment.isoformat() if moment is not None else None


def _signer(certificate, now: datetime.datetime) -> ListSigner:
    valid_from = certificate["tbs_certificate"]["validity"]["not_before"].native
    valid_until = certificate["tbs_certificate"]["validity"]["not_after"].native
    return ListSigner(
        subject=_subject_label(certificate),
        issuer=_issuer_label(certificate),
        fingerprint=_fingerprint(certificate),
        valid_from=valid_from.isoformat(),
        valid_until=valid_until.isoformat(),
        expired=not valid_from <= now <= valid_until,
    )


def _current_list_of_lists(
    listed: ListedCertificates, signer: ListSigner, stale: bool, stored_sequence: int | None
) -> bool:
    if signer.fingerprint not in LOTL_ANCHORS or signer.expired or stale:
        return False
    if stored_sequence is None:
        return True
    return listed.sequence is not None and listed.sequence >= stored_sequence


def _pin_status(
    listed: ListedCertificates,
    signer: ListSigner,
    stale: bool,
    stored: _StoredPins,
) -> str:
    fingerprint = signer.fingerprint
    pins = stored.pins
    if listed.list_of_lists:
        current = _current_list_of_lists(listed, signer, stale, stored.lotl_sequence)
        return VERIFIED if current else "unpinned"
    territory = listed.source.territory
    if listed.source.kind != EU_TRUSTED_LIST or territory is None or territory not in pins:
        return "unpinned"
    entry = pins[territory]
    if fingerprint not in entry.fingerprints:
        return "pinMismatch"
    return VERIFIED if entry.anchored else "unpinned"


def _list_signature(listed: ListedCertificates, stored: _StoredPins) -> ListSignature:
    now = _now()
    stale = listed.next_update is not None and listed.next_update < now
    if listed.signature is None:
        return ListSignature(
            status="unsigned" if listed.verifiable else "unverifiable",
            signer=None,
            signed_at=None,
            stale=stale,
            next_update=_iso(listed.next_update),
        )
    signer = _signer(listed.signature.signer, now)
    return ListSignature(
        status=_pin_status(listed, signer, stale, stored),
        signer=signer,
        signed_at=_iso(listed.signature.signed_at),
        stale=stale,
        next_update=_iso(listed.next_update),
    )


@dataclass
class _Import:
    store: Path
    source: TrustSource | None
    sources: _Sources
    fresh: list[tuple[bytes, TrustRoot]]
    known: int
    withdrawn: list[TrustRoot]
    retired: list[str]
    digest: str
    signature: ListSignature | None = None
    pins: dict[str, frozenset[str]] | None = None
    sequence: int | None = None


def _plan_import(path: str, progress: Progress) -> _Import:
    read = _read_checked(path, progress)
    certificates = read.certificates
    store = sign_verify.user_trust_dir()
    files = _file_names(store)
    sources = _load_sources(store, files)
    found = read.listed
    signature = _list_signature(found, _load_pin_file(store)) if found is not None else None
    listed: ListSource | None = found.source if found is not None else None
    source = (
        _trust_source(listed, signature.status if signature is not None else None)
        if listed is not None
        else None
    )
    if found is not None and found.list_of_lists:
        return _Import(
            store=store,
            source=source,
            sources=sources,
            fresh=[],
            known=0,
            withdrawn=[],
            retired=[],
            digest=read.digest,
            signature=signature,
            pins=found.pins,
            sequence=found.sequence,
        )
    existing, _unreadable = _stored_roots(store)
    key = listed.key if listed is not None else None
    mark = key or MANUAL
    by_fingerprint: dict[str, str] = {}
    for root in existing:
        by_fingerprint.setdefault(root.fingerprint, root.id)
    fresh: list[tuple[bytes, TrustRoot]] = []
    listed_files: set[str] = set()
    for certificate, root in certificates:
        progress.check_cancelled()
        file_id = by_fingerprint.get(root.fingerprint)
        if file_id is None:
            file_id = f"{root.fingerprint[:32].lower()}{STORED_SUFFIX}"
            by_fingerprint[root.fingerprint] = file_id
            fresh.append((certificate.dump(), root.model_copy(update={"id": file_id})))
        listed_files.add(file_id)
    for file_id in listed_files:
        keys = sources.roots.get(file_id, [MANUAL] if file_id in files else [])
        sources.roots[file_id] = keys if mark in keys else [*keys, mark]
    retired: list[str] = []
    if key is not None and source is not None:
        sources.lists[key] = source
        for file_id, keys in list(sources.roots.items()):
            if key not in keys or file_id in listed_files:
                continue
            rest = [other for other in keys if other != key]
            if rest:
                sources.roots[file_id] = rest
            else:
                del sources.roots[file_id]
                retired.append(file_id)
    return _Import(
        store=store,
        source=source,
        sources=sources,
        fresh=[(data, _labelled(root, sources)) for data, root in fresh],
        known=len(certificates) - len(fresh),
        withdrawn=[root for root in existing if root.id in retired],
        retired=retired,
        digest=read.digest,
        signature=signature,
    )


def _stored_roots(store: Path) -> tuple[list[TrustRoot], list[str]]:
    roots: list[TrustRoot] = []
    unreadable: list[str] = []
    for path in _stored_files(store):
        try:
            roots.extend(root for _certificate, root in _read_certificates(path))
        except Exception:  # noqa: BLE001
            unreadable.append(path.name)
    return roots, unreadable


@op("sign.trust_list", TrustListParams)
def trust_list(params: TrustListParams, progress: Progress) -> TrustListResult:
    store = sign_verify.user_trust_dir()
    roots, unreadable = _stored_roots(store)
    sources = _load_sources(store, _file_names(store))
    return TrustListResult(
        roots=[_labelled(root, sources) for root in roots], unreadable=unreadable
    )


@op("sign.trust_preview", TrustPreviewParams)
def trust_preview(params: TrustPreviewParams, progress: Progress) -> TrustPreviewResult:
    planned = _plan_import(params.path, progress)
    return TrustPreviewResult(
        source=planned.source,
        added=[root for _data, root in planned.fresh],
        known=planned.known,
        withdrawn=planned.withdrawn,
        signature=planned.signature,
        digest=planned.digest,
        pinned=len(planned.pins or {}),
    )


@op("sign.trust_add", TrustAddParams)
@_serialised
def trust_add(params: TrustAddParams, progress: Progress) -> TrustAddResult:
    planned = _plan_import(params.path, progress)
    digest_required = planned.signature is not None
    if (params.expected_digest is None and digest_required) or (
        params.expected_digest is not None and params.expected_digest != planned.digest
    ):
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the trust list changed after it was previewed",
            {"reason": "trustListChanged"},
        )
    if (
        planned.signature is not None
        and planned.signature.status != VERIFIED
        and not params.accept_unverified
    ):
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the trust list signer is not verified",
            {"reason": "trustListUnverified"},
        )
    if planned.pins is not None:
        status = planned.signature.status if planned.signature is not None else "unsigned"
        if status in UNCHECKED_ORIGINS:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "a list of trusted lists without a checked signature cannot pin signers",
                {"reason": "trustListUnverified"},
            )
        stored = _load_pin_file(planned.store)
        anchored = status == VERIFIED
        pins = _merged_pins(stored.pins, planned.pins, anchored)
        sequence = planned.sequence if anchored else stored.lotl_sequence
        _save_pins(planned.store, pins, sequence)
    for file_id in planned.retired:
        unlink_patiently(planned.store / file_id)
    for data, root in planned.fresh:
        target = planned.store / root.id
        write_atomically(target, lambda partial, data=data: partial.write_bytes(data))
    _save_sources(planned.store, planned.sources)
    return TrustAddResult(
        added=[root for _data, root in planned.fresh],
        known=planned.known,
        withdrawn=len(planned.withdrawn),
        pinned=len(planned.pins or {}),
    )


@op("sign.trust_remove", TrustRemoveParams)
@_serialised
def trust_remove(params: TrustRemoveParams, progress: Progress) -> TrustRemoveResult:
    store = sign_verify.user_trust_dir()
    target = next((path for path in _stored_files(store) if path.name == params.id), None)
    if target is None:
        raise OpError(
            ErrorCode.FILE_NOT_FOUND, "trusted certificate not found", {"reason": "trustMissing"}
        )
    try:
        removed = len(_read_certificates(target))
    except Exception:  # noqa: BLE001
        removed = 0
    unlink_patiently(target)
    _save_sources(store, _load_sources(store, _file_names(store)))
    return TrustRemoveResult(removed=removed)


@op("sign.trust_clear", TrustClearParams)
@_serialised
def trust_clear(params: TrustClearParams, progress: Progress) -> TrustClearResult:
    store = sign_verify.user_trust_dir()
    removed = 0
    for path in _stored_files(store):
        progress.check_cancelled()
        unlink_patiently(path)
        removed += 1
    unlink_patiently(store / SOURCES_FILE)
    unlink_patiently(store / PINS_FILE)
    return TrustClearResult(removed=removed)
