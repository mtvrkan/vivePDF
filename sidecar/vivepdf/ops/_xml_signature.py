import base64
import binascii
import copy
import datetime
import hashlib
import hmac
from dataclasses import dataclass
from typing import Any

from lxml import etree

DS_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#"
DS = f"{{{DS_NAMESPACE}}}"
XADES = "{http://uri.etsi.org/01903/v1.3.2#}"
EXC_C14N_NAMESPACE = "{http://www.w3.org/2001/10/xml-exc-c14n#}"
ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature"
EXC_C14N = "http://www.w3.org/2001/10/xml-exc-c14n#"
SIGNED_PROPERTIES = "http://uri.etsi.org/01903#SignedProperties"
IDENTIFIER_ATTRIBUTES = frozenset({"Id", "ID", "id"})
MAX_SIGNATURE_BYTES = 1024

DIGESTS = {
    "http://www.w3.org/2001/04/xmlenc#sha256": "sha256",
    "http://www.w3.org/2001/04/xmldsig-more#sha384": "sha384",
    "http://www.w3.org/2001/04/xmlenc#sha512": "sha512",
}
RSA = "rsa"
RSA_PSS = "rsaPss"
ECDSA = "ecdsa"
SIGNATURE_METHODS = {
    "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256": (RSA, "sha256"),
    "http://www.w3.org/2001/04/xmldsig-more#rsa-sha384": (RSA, "sha384"),
    "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512": (RSA, "sha512"),
    "http://www.w3.org/2007/05/xmldsig-more#sha256-rsa-MGF1": (RSA_PSS, "sha256"),
    "http://www.w3.org/2007/05/xmldsig-more#sha384-rsa-MGF1": (RSA_PSS, "sha384"),
    "http://www.w3.org/2007/05/xmldsig-more#sha512-rsa-MGF1": (RSA_PSS, "sha512"),
    "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256": (ECDSA, "sha256"),
    "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384": (ECDSA, "sha384"),
    "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512": (ECDSA, "sha512"),
}


class SignatureInvalid(ValueError):
    pass


class SignatureUnsupported(ValueError):
    pass


@dataclass(frozen=True)
class SignedView:
    canonical: bytes
    signer: Any
    signed_at: datetime.datetime | None


def secure_parser() -> etree.XMLParser:
    return etree.XMLParser(
        resolve_entities=False,
        no_network=True,
        load_dtd=False,
        huge_tree=False,
        remove_comments=False,
        remove_pis=False,
    )


def _decoded(text: str | None) -> bytes:
    try:
        return base64.b64decode("".join((text or "").split()), validate=True)
    except (binascii.Error, ValueError) as error:
        raise SignatureInvalid("malformed base64 value") from error


def _only(parent: etree._Element, tag: str) -> etree._Element:
    found = parent.findall(tag)
    if len(found) != 1:
        raise SignatureInvalid(f"expected exactly one {tag}")
    return found[0]


def _algorithm(element: etree._Element | None) -> str:
    return (element.get("Algorithm") if element is not None else None) or ""


def _hash_name(method: etree._Element | None) -> str:
    name = DIGESTS.get(_algorithm(method))
    if name is None:
        raise SignatureUnsupported("digest algorithm not allowed")
    return name


def _inclusive_prefixes(method: etree._Element) -> list[str] | None:
    children = [child for child in method if isinstance(child.tag, str)]
    if not children:
        return None
    if len(children) != 1 or children[0].tag != f"{EXC_C14N_NAMESPACE}InclusiveNamespaces":
        raise SignatureUnsupported("unexpected canonicalization parameters")
    return (children[0].get("PrefixList") or "").split() or None


def _canonical(node: Any, method: etree._Element) -> bytes:
    if _algorithm(method) != EXC_C14N:
        raise SignatureUnsupported("canonicalization not allowed")
    return etree.tostring(
        node,
        method="c14n",
        exclusive=True,
        with_comments=False,
        inclusive_ns_prefixes=_inclusive_prefixes(method),
    )


def _transforms(reference: etree._Element) -> list[etree._Element]:
    holders = reference.findall(f"{DS}Transforms")
    if len(holders) > 1:
        raise SignatureInvalid("repeated transforms")
    if not holders:
        return []
    transforms = [child for child in holders[0] if isinstance(child.tag, str)]
    if any(transform.tag != f"{DS}Transform" for transform in transforms):
        raise SignatureInvalid("unexpected transform content")
    return transforms


def _unique_identifiers(root: etree._Element) -> dict[str, etree._Element]:
    found: dict[str, etree._Element] = {}
    for element in root.iter():
        if not isinstance(element.tag, str):
            continue
        for name, value in element.attrib.items():
            if etree.QName(name).localname not in IDENTIFIER_ATTRIBUTES:
                continue
            if value in found:
                raise SignatureInvalid("duplicate identifier")
            found[value] = element
    return found


def _check_digest(reference: etree._Element, content: bytes) -> None:
    name = _hash_name(reference.find(f"{DS}DigestMethod"))
    expected = _decoded(_only(reference, f"{DS}DigestValue").text)
    if not hmac.compare_digest(hashlib.new(name, content).digest(), expected):
        raise SignatureInvalid("reference digest mismatch")


def _enveloped_document(root: etree._Element, whole: bool) -> Any:
    tree = copy.deepcopy(root.getroottree()) if whole else None
    top = tree.getroot() if tree is not None else copy.deepcopy(root)
    signature = _only(top, f"{DS}Signature")
    tail = signature.tail
    if tail:
        previous = signature.getprevious()
        if previous is not None:
            previous.tail = (previous.tail or "") + tail
        else:
            top.text = (top.text or "") + tail
    top.remove(signature)
    return tree if tree is not None else top


@dataclass(frozen=True)
class _DocumentScope:
    whole: bool
    canonicalization: etree._Element


def _document_scope(reference: etree._Element, root_id: str | None) -> _DocumentScope:
    uri = reference.get("URI")
    if uri == "":
        whole = True
    elif root_id is not None and uri == f"#{root_id}":
        whole = False
    else:
        raise SignatureInvalid("reference does not cover the whole list")
    transforms = _transforms(reference)
    if len(transforms) != 2 or _algorithm(transforms[0]) != ENVELOPED or len(transforms[0]):
        raise SignatureInvalid("unexpected document transforms")
    return _DocumentScope(whole, transforms[1])


def _properties_scope(
    reference: etree._Element, signature: etree._Element, identifiers: dict
) -> tuple[etree._Element, etree._Element]:
    uri = reference.get("URI") or ""
    target = identifiers.get(uri[1:]) if uri.startswith("#") else None
    if target is None or target.tag != f"{XADES}SignedProperties":
        raise SignatureInvalid("signed properties reference is not local")
    if not any(ancestor is signature for ancestor in target.iterancestors()):
        raise SignatureInvalid("signed properties outside the signature")
    transforms = _transforms(reference)
    if len(transforms) != 1:
        raise SignatureInvalid("unexpected signed properties transforms")
    return target, transforms[0]


def _certificates(signature: etree._Element) -> list[Any]:
    from cryptography import x509
    from cryptography.exceptions import UnsupportedAlgorithm

    key_info = signature.find(f"{DS}KeyInfo")
    if key_info is None:
        raise SignatureUnsupported("no signer certificate")
    loaded = []
    for element in key_info.iterfind(f"{DS}X509Data/{DS}X509Certificate"):
        try:
            loaded.append(x509.load_der_x509_certificate(_decoded(element.text)))
        except (ValueError, UnsupportedAlgorithm):
            continue
    if not loaded:
        raise SignatureUnsupported("no signer certificate")
    return loaded


def _verifies(certificate: Any, family: str, hash_name: str, value: bytes, data: bytes) -> bool:
    from cryptography.exceptions import InvalidSignature, UnsupportedAlgorithm
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

    algorithm = {"sha256": hashes.SHA256, "sha384": hashes.SHA384, "sha512": hashes.SHA512}[
        hash_name
    ]()
    try:
        key = certificate.public_key()
        if family in (RSA, RSA_PSS) and isinstance(key, rsa.RSAPublicKey):
            scheme = (
                padding.PKCS1v15()
                if family == RSA
                else padding.PSS(mgf=padding.MGF1(algorithm), salt_length=algorithm.digest_size)
            )
            key.verify(value, data, scheme, algorithm)
            return True
        if family == ECDSA and isinstance(key, ec.EllipticCurvePublicKey):
            half = (key.curve.key_size + 7) // 8
            if len(value) != 2 * half:
                return False
            r = int.from_bytes(value[:half], "big")
            s = int.from_bytes(value[half:], "big")
            key.verify(encode_dss_signature(r, s), data, ec.ECDSA(algorithm))
            return True
    except (InvalidSignature, UnsupportedAlgorithm, ValueError):
        return False
    return False


def _signing_certificate_matches(properties: etree._Element, certificate: Any) -> None:
    from cryptography.hazmat.primitives.serialization import Encoding

    der = certificate.public_bytes(Encoding.DER)
    signed = properties.find(f"{XADES}SignedSignatureProperties")
    holders = (
        []
        if signed is None
        else [
            *signed.findall(f"{XADES}SigningCertificateV2"),
            *signed.findall(f"{XADES}SigningCertificate"),
        ]
    )
    if not holders:
        raise SignatureUnsupported("signed properties do not name the signer")
    for cert in (cert for holder in holders for cert in holder.iterfind(f"{XADES}Cert")):
        digest = cert.find(f"{XADES}CertDigest")
        if digest is None:
            continue
        name = _hash_name(digest.find(f"{DS}DigestMethod"))
        expected = _decoded(digest.findtext(f"{DS}DigestValue"))
        if hmac.compare_digest(hashlib.new(name, der).digest(), expected):
            return
    raise SignatureInvalid("signing certificate does not match the signer")


def _signing_time(properties: etree._Element | None) -> datetime.datetime | None:
    if properties is None:
        return None
    text = properties.findtext(f"{XADES}SignedSignatureProperties/{XADES}SigningTime") or ""
    try:
        moment = datetime.datetime.fromisoformat(text.strip())
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=datetime.UTC)


def _split_references(
    signed_info: etree._Element,
) -> tuple[etree._Element, etree._Element | None]:
    references = signed_info.findall(f"{DS}Reference")
    documents = [item for item in references if item.get("Type") != SIGNED_PROPERTIES]
    properties = [item for item in references if item.get("Type") == SIGNED_PROPERTIES]
    if len(documents) != 1 or len(properties) > 1:
        raise SignatureInvalid("unexpected references")
    return documents[0], (properties[0] if properties else None)


def verify_enveloped(root: etree._Element) -> SignedView | None:
    from asn1crypto import x509 as asn1_x509
    from cryptography.hazmat.primitives.serialization import Encoding

    signatures = list(root.iter(f"{DS}Signature"))
    if not signatures:
        return None
    if len(signatures) != 1 or signatures[0].getparent() is not root:
        raise SignatureInvalid("signature is not the single enveloped signature")
    signature = signatures[0]
    identifiers = _unique_identifiers(root)
    signed_info = _only(signature, f"{DS}SignedInfo")
    canonicalization = _only(signed_info, f"{DS}CanonicalizationMethod")
    method_element = _only(signed_info, f"{DS}SignatureMethod")
    document, properties_reference = _split_references(signed_info)
    scope = _document_scope(document, root.get("Id"))
    properties_target = (
        _properties_scope(properties_reference, signature, identifiers)
        if properties_reference is not None
        else None
    )
    value = _decoded(_only(signature, f"{DS}SignatureValue").text)
    if not value or len(value) > MAX_SIGNATURE_BYTES:
        raise SignatureInvalid("malformed signature value")
    canonical = _canonical(_enveloped_document(root, scope.whole), scope.canonicalization)
    _check_digest(document, canonical)
    properties = None
    if properties_reference is not None and properties_target is not None:
        properties, properties_canonicalization = properties_target
        _check_digest(properties_reference, _canonical(properties, properties_canonicalization))
    method = SIGNATURE_METHODS.get(_algorithm(method_element))
    if method is None:
        raise SignatureUnsupported("signature algorithm not allowed")
    canonical_info = _canonical(signed_info, canonicalization)
    family, hash_name = method
    signer = next(
        (
            certificate
            for certificate in _certificates(signature)
            if _verifies(certificate, family, hash_name, value, canonical_info)
        ),
        None,
    )
    if signer is None:
        raise SignatureInvalid("signature does not verify")
    if properties is not None:
        _signing_certificate_matches(properties, signer)
    return SignedView(
        canonical=canonical,
        signer=asn1_x509.Certificate.load(signer.public_bytes(Encoding.DER)),
        signed_at=_signing_time(properties),
    )
