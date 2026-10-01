import base64
import binascii
import datetime
import hashlib
import io
import re
import xml.etree.ElementTree as ElementTree
import zlib
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from xml.parsers import expat

from lxml import etree

from vivepdf.ops._xml_signature import (
    SignatureInvalid,
    SignatureUnsupported,
    SignedView,
    secure_parser,
    verify_enveloped,
)

MAX_LIST_BYTES = 32 * 1024 * 1024
MAX_LIST_CERTIFICATES = 5000
MAX_EMBEDDED_FILES = 64
MAX_NAME_TREE_DEPTH = 32
MAX_NAME_TREE_NODES = 1024
MAX_PIN_TERRITORIES = 100
MAX_SEQUENCE_DIGITS = 9
MAX_INFLATED_BYTES = 64 * 1024 * 1024
INFLATE_STEP = 1024 * 1024
STREAM_START = re.compile(rb"(?<!end)stream\r?\n")
PDF_HEADER = b"%PDF-"
UTF8_MARK = b"\xef\xbb\xbf"
FORBIDDEN_MARKUP = ("<!DOCTYPE", "<!ENTITY")
TSL = "{http://uri.etsi.org/02231/v2#}"
LIST_OF_LISTS = "EUlistofthelists"
TRUSTED_SERVICE_TYPES = frozenset(
    {
        "http://uri.etsi.org/TrstSvc/Svctype/CA/QC",
        "http://uri.etsi.org/TrstSvc/Svctype/TSA/QTST",
    }
)
ACTIVE_SERVICE_STATUSES = frozenset({"granted", "recognisedatnationallevel"})
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
MAX_TERRITORY = 8
MAX_SOURCE_NAME = 200
EU_TRUSTED_LIST = "euTrustedList"
EU_LIST_OF_LISTS = "euListOfLists"
SECURITY_SETTINGS = "securitySettings"
POINTER_CERTIFICATES = (
    f"{TSL}ServiceDigitalIdentities/{TSL}ServiceDigitalIdentity/{TSL}DigitalId/{TSL}X509Certificate"
)
POINTER_TERRITORY = f"{TSL}AdditionalInformation/{TSL}OtherInformation/{TSL}SchemeTerritory"


class EmptyTrustList(ValueError):
    pass


@dataclass(frozen=True)
class ListSource:
    kind: str
    territory: str | None = None
    name: str | None = None

    @property
    def key(self) -> str | None:
        identity = self.territory or self.name
        return f"{self.kind}:{identity}" if identity else None


@dataclass(frozen=True)
class ListedCertificates:
    certificates: list
    source: ListSource
    signature: SignedView | None = None
    verifiable: bool = True
    next_update: datetime.datetime | None = None
    pins: dict[str, frozenset[str]] = field(default_factory=dict)
    file_digest: str = ""
    sequence: int | None = None

    @property
    def list_of_lists(self) -> bool:
        return self.source.kind == EU_LIST_OF_LISTS


@dataclass(frozen=True)
class _Found:
    entries: list[str]
    source: ListSource
    next_update: datetime.datetime | None = None
    pins: dict[str, frozenset[str]] = field(default_factory=dict)
    sequence: int | None = None


@dataclass(frozen=True)
class _Signed:
    found: _Found | None
    signature: SignedView | None
    verifiable: bool


def _clean(value: str | None, limit: int) -> str | None:
    cleaned = " ".join((value or "").split())[:limit]
    return cleaned or None


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _refuse_declaration(*_args: Any) -> None:
    raise ValueError("trust list declares a document type")


def _refuse_declared_markup(body: bytes) -> None:
    parser = expat.ParserCreate()
    parser.StartDoctypeDeclHandler = _refuse_declaration
    parser.EntityDeclHandler = _refuse_declaration
    try:
        parser.Parse(body, True)
    except expat.ExpatError as error:
        raise ValueError("trust list is not well-formed XML") from error


def _xml_body(data: bytes) -> bytes | None:
    body = data.removeprefix(UTF8_MARK).lstrip()
    if not body.startswith(b"<"):
        return None
    if b"\x00" in body:
        raise ValueError("trust list is not UTF-8")
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("trust list is not UTF-8") from error
    if any(markup in text for markup in FORBIDDEN_MARKUP):
        raise ValueError("trust list declares a document type")
    _refuse_declared_markup(body)
    return body


def _stdlib_root(body: bytes) -> ElementTree.Element:
    try:
        return ElementTree.fromstring(body)
    except ElementTree.ParseError as error:
        raise ValueError("trust list is not well-formed XML") from error


def _xml_root(data: bytes) -> ElementTree.Element | None:
    body = _xml_body(data)
    return None if body is None else _stdlib_root(body)


def _lxml_root(body: bytes) -> Any:
    try:
        return etree.fromstring(body, secure_parser())
    except etree.XMLSyntaxError as error:
        raise ValueError("trust list is not well-formed XML") from error


def _certificate_fingerprint(entry: str) -> str | None:
    certificate = _certificate(entry)
    return None if certificate is None else hashlib.sha256(certificate.dump()).hexdigest().upper()


def _lotl_pins(root: ElementTree.Element) -> dict[str, frozenset[str]]:
    pins: dict[str, set[str]] = {}
    total = 0
    for pointer in root.iter(f"{TSL}OtherTSLPointer"):
        territory = _clean(pointer.findtext(POINTER_TERRITORY), MAX_TERRITORY)
        if territory is None:
            continue
        for element in pointer.iterfind(POINTER_CERTIFICATES):
            fingerprint = _certificate_fingerprint(element.text or "")
            if fingerprint is None:
                continue
            total += 1
            if total > MAX_LIST_CERTIFICATES:
                raise ValueError("too many certificates in the list of trusted lists")
            pins.setdefault(territory, set()).add(fingerprint)
        if len(pins) > MAX_PIN_TERRITORIES:
            raise ValueError("too many territories in the list of trusted lists")
    return {territory: frozenset(values) for territory, values in pins.items()}


def _is_list_of_lists(root: ElementTree.Element, services: list) -> bool:
    kind = (root.findtext(f"{TSL}SchemeInformation/{TSL}TSLType") or "").strip()
    return kind.endswith(LIST_OF_LISTS) or (
        not services and root.find(f".//{TSL}OtherTSLPointer") is not None
    )


def _etsi_entries(root: ElementTree.Element) -> list[str]:
    entries: list[str] = []
    for service in root.iter(f"{TSL}TSPService"):
        information = service.find(f"{TSL}ServiceInformation")
        if information is None:
            continue
        service_type = (information.findtext(f"{TSL}ServiceTypeIdentifier") or "").strip()
        status = (information.findtext(f"{TSL}ServiceStatus") or "").strip().rsplit("/", 1)[-1]
        if service_type not in TRUSTED_SERVICE_TYPES or status not in ACTIVE_SERVICE_STATUSES:
            continue
        path = f"{TSL}ServiceDigitalIdentity/{TSL}DigitalId/{TSL}X509Certificate"
        entries.extend(element.text or "" for element in information.iterfind(path))
    return entries


def _etsi_source(root: ElementTree.Element, kind: str) -> ListSource:
    information = f"{TSL}SchemeInformation/"
    names = root.findall(f"{information}{TSL}SchemeOperatorName/{TSL}Name")
    english = next((name.text for name in names if name.get(XML_LANG) == "en"), None)
    return ListSource(
        kind,
        _clean(root.findtext(f"{information}{TSL}SchemeTerritory"), MAX_TERRITORY),
        _clean(english or (names[0].text if names else None), MAX_SOURCE_NAME),
    )


def _next_update(root: ElementTree.Element) -> datetime.datetime | None:
    text = root.findtext(f"{TSL}SchemeInformation/{TSL}NextUpdate/{TSL}dateTime") or ""
    try:
        moment = datetime.datetime.fromisoformat(text.strip())
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=datetime.UTC)


def _sequence(root: ElementTree.Element) -> int | None:
    text = (root.findtext(f"{TSL}SchemeInformation/{TSL}TSLSequenceNumber") or "").strip()
    if not text.isdigit() or len(text) > MAX_SEQUENCE_DIGITS:
        return None
    return int(text)


def _etsi_found(root: ElementTree.Element) -> _Found:
    services = list(root.iter(f"{TSL}TSPService"))
    if _is_list_of_lists(root, services):
        return _Found(
            [],
            _etsi_source(root, EU_LIST_OF_LISTS),
            _next_update(root),
            _lotl_pins(root),
            _sequence(root),
        )
    return _Found(
        _etsi_entries(root),
        _etsi_source(root, EU_TRUSTED_LIST),
        _next_update(root),
        sequence=_sequence(root),
    )


def _security_settings_source(root: ElementTree.Element) -> ListSource:
    sources = {
        (identity.findtext("Identification/Source") or "").strip()
        for identity in root.iterfind("TrustedIdentities/Identity")
    }
    named = sorted(source for source in sources if source)
    return ListSource(SECURITY_SETTINGS, None, _clean(named[0] if named else None, MAX_SOURCE_NAME))


def _security_settings_entries(root: ElementTree.Element) -> list[str]:
    return [
        identity.findtext("Certificate") or ""
        for identity in root.iterfind("TrustedIdentities/Identity")
        if (identity.findtext("Trust/Root") or "").strip() == "1"
    ]


def _security_settings_found(root: ElementTree.Element) -> _Found:
    return _Found(_security_settings_entries(root), _security_settings_source(root))


def _xml_found(root: ElementTree.Element) -> _Found | None:
    if root.tag == f"{TSL}TrustServiceStatusList":
        return _etsi_found(root)
    if _local_name(root.tag) == "SecuritySettings":
        return _security_settings_found(root)
    return None


def _signed_xml(body: bytes) -> _Signed:
    try:
        view = verify_enveloped(_lxml_root(body))
    except SignatureUnsupported:
        return _Signed(_xml_found(_stdlib_root(body)), None, False)
    if view is None:
        return _Signed(_xml_found(_stdlib_root(body)), None, True)
    return _Signed(_xml_found(_stdlib_root(view.canonical)), view, True)


def _entry(dictionary: Any, key: str) -> Any:
    try:
        return dictionary[key]
    except (KeyError, TypeError):
        return None


def _node_identity(raw: Any) -> tuple[int, int] | None:
    reference = getattr(raw, "reference", None)
    if reference is None:
        return None
    return reference.idnum, reference.generation


def _name_tree_values(tree: Any, check_cancelled: Callable[[], None]) -> list[Any]:
    from pyhanko.pdf_utils.generic import ArrayObject, DictionaryObject

    values: list[Any] = []
    visited: set[tuple[int, int]] = set()
    pending: list[tuple[Any, int]] = [(tree, 0)]
    nodes = 0
    while pending and len(values) < MAX_EMBEDDED_FILES:
        check_cancelled()
        node, depth = pending.pop()
        nodes += 1
        if nodes > MAX_NAME_TREE_NODES:
            raise ValueError("embedded file tree too large")
        if depth > MAX_NAME_TREE_DEPTH or not isinstance(node, DictionaryObject):
            continue
        names = _entry(node, "/Names")
        if isinstance(names, ArrayObject):
            values.extend(names[index] for index in range(1, len(names), 2))
        kids = _entry(node, "/Kids")
        if not isinstance(kids, ArrayObject):
            continue
        for index in reversed(range(len(kids))):
            raw = kids.raw_get(index)
            identity = _node_identity(raw)
            if identity is not None:
                if identity in visited:
                    continue
                visited.add(identity)
            pending.append((raw.get_object(), depth + 1))
    return values[:MAX_EMBEDDED_FILES]


def _bounded_stream(stream: Any) -> bytes:
    from pyhanko.pdf_utils.generic import ArrayObject, NameObject

    filters = _entry(stream, "/Filter")
    if isinstance(filters, ArrayObject) and len(filters) == 1:
        filters = filters[0]
    raw = stream.encoded_data
    if filters is None:
        content = raw
    elif (
        isinstance(filters, NameObject)
        and filters == "/FlateDecode"
        and _entry(stream, "/DecodeParms") is None
    ):
        inflater = zlib.decompressobj()
        try:
            content = inflater.decompress(raw, MAX_LIST_BYTES + 1)
        except zlib.error as error:
            raise ValueError("damaged embedded file") from error
    else:
        raise ValueError("unsupported embedded file encoding")
    if len(content) > MAX_LIST_BYTES:
        raise ValueError("embedded trust list too large")
    return content


def _embedded_settings(
    reader: Any, check_cancelled: Callable[[], None]
) -> ElementTree.Element | None:
    tree = _entry(_entry(reader.root, "/Names"), "/EmbeddedFiles")
    found: ElementTree.Element | None = None
    total = 0
    for specification in _name_tree_values(tree, check_cancelled):
        check_cancelled()
        stream = _entry(_entry(specification.get_object(), "/EF"), "/F")
        if stream is None or not hasattr(stream, "encoded_data"):
            continue
        content = _bounded_stream(stream)
        total += len(content)
        if total > MAX_LIST_BYTES:
            raise ValueError("embedded files too large")
        try:
            root = _xml_root(content)
        except ValueError:
            continue
        if root is None or _local_name(root.tag) != "SecuritySettings":
            continue
        if found is not None:
            raise ValueError("more than one security settings file in the PDF")
        found = root
    return found


def _pdf_signature(reader: Any) -> SignedView | None:
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko.sign.validation.status import SignatureCoverageLevel
    from pyhanko_certvalidator import ValidationContext

    embedded = list(reader.embedded_signatures)
    if not embedded:
        return None
    context = ValidationContext(trust_roots=[], allow_fetching=False)
    statuses = []
    for signature in embedded:
        try:
            status = validate_pdf_signature(signature, context)
        except Exception as error:
            raise SignatureInvalid("PDF signature cannot be validated") from error
        if not (status.intact and status.valid):
            raise SignatureInvalid("PDF signature does not verify")
        statuses.append((signature.signed_revision, status))
    _revision, latest = max(statuses, key=lambda item: item[0])
    if latest.coverage != SignatureCoverageLevel.ENTIRE_FILE:
        raise SignatureInvalid("PDF changed after it was signed")
    return SignedView(b"", latest.signing_cert, latest.signer_reported_dt)


def _inflated_size(chunk: bytes, budget: int, check_cancelled: Callable[[], None]) -> int:
    inflater = zlib.decompressobj()
    produced = 0
    pending = chunk
    try:
        while pending and produced <= budget:
            check_cancelled()
            produced += len(inflater.decompress(pending, INFLATE_STEP))
            pending = inflater.unconsumed_tail
    except zlib.error:
        return produced
    return produced


def _inflation_bounded(data: bytes, check_cancelled: Callable[[], None]) -> bool:
    total = 0
    for found in STREAM_START.finditer(data):
        end = data.find(b"endstream", found.end())
        chunk = data[found.end() : end if end >= 0 else len(data)]
        total += _inflated_size(chunk, MAX_INFLATED_BYTES - total, check_cancelled)
        if total > MAX_INFLATED_BYTES:
            return False
    return True


def _signed_pdf(data: bytes, check_cancelled: Callable[[], None]) -> _Signed:
    from pyhanko.pdf_utils.reader import PdfFileReader

    if not _inflation_bounded(data, check_cancelled):
        raise ValueError("PDF streams expand too far")
    try:
        reader = PdfFileReader(io.BytesIO(data), strict=False)
        encrypted = reader.encrypted
    except Exception as error:
        raise ValueError("unreadable PDF") from error
    if encrypted:
        raise ValueError("encrypted PDF")
    signature = _pdf_signature(reader)
    try:
        settings = _embedded_settings(reader, check_cancelled)
    except (KeyError, TypeError, AttributeError) as error:
        raise ValueError("unreadable PDF") from error
    found = None if settings is None else _security_settings_found(settings)
    return _Signed(found, signature, True)


def _certificate(entry: str) -> Any | None:
    from asn1crypto import x509

    try:
        return x509.Certificate.load(base64.b64decode("".join(entry.split()), validate=True))
    except (binascii.Error, ValueError, TypeError):
        return None


def _never_cancelled() -> None:
    return None


def looks_like_markup(data: bytes) -> bool:
    return PDF_HEADER in data[:1024] or data.removeprefix(UTF8_MARK).lstrip().startswith(b"<")


def trust_list_certificates(
    data: bytes, check_cancelled: Callable[[], None] = _never_cancelled
) -> ListedCertificates | None:
    if PDF_HEADER in data[:1024]:
        signed = _signed_pdf(data, check_cancelled)
    else:
        body = _xml_body(data)
        signed = None if body is None else _signed_xml(body)
    if signed is None or signed.found is None:
        return None
    found = signed.found
    if len(found.entries) > MAX_LIST_CERTIFICATES:
        raise ValueError("too many certificates in the trust list")
    certificates: list = []
    seen: set[str] = set()
    for entry in found.entries:
        certificate = _certificate(entry)
        if certificate is None:
            continue
        digest = hashlib.sha256(certificate.dump()).hexdigest()
        if digest not in seen:
            seen.add(digest)
            certificates.append(certificate)
    return ListedCertificates(
        certificates=certificates,
        source=found.source,
        signature=signed.signature,
        verifiable=signed.verifiable,
        next_update=found.next_update,
        pins=found.pins,
        file_digest=hashlib.sha256(data).hexdigest(),
        sequence=found.sequence,
    )
