import Foundation
import Security

/// An X.509 distinguished name (RDN sequence, in encoded order).
struct DistinguishedName: Hashable, Sendable, CustomStringConvertible {
    struct Attribute: Hashable, Sendable {
        let oid: String
        let value: String
        /// Universal string tag the value was encoded with (UTF8String, PrintableString, BMPString…).
        let stringTag: UInt
        var shortName: String { OID.name(oid) }
    }

    let rdns: [[Attribute]]
    /// Exact DER of the Name (used for issuer matching and IssuerAndSerialNumber).
    let der: Data

    init(node: ASN1Node) throws {
        guard node.isSequence else { throw CryptoError.malformed("bad Name") }
        rdns = try node.children.map { rdn in
            try rdn.children.map { pair in
                let value = try pair[1]
                return Attribute(oid: try pair[0].oid, value: (try? value.stringValue) ?? value.value.cryptoHex, stringTag: value.tagNumber)
            }
        }
        der = node.raw
    }

    init(der: Data) throws { try self.init(node: ASN1.parse(der)) }

    /// Builds a Name. Country, e-mail and DC use PrintableString/IA5String as RFC 5280 requires; others UTF8String.
    init(_ attributes: [(oid: String, value: String)]) {
        let rdnNodes = attributes.map { attribute -> ASN1Node in
            let value: ASN1Node = switch attribute.oid {
            case OID.countryName, OID.serialNumber: ASN1.printableString(attribute.value)
            case OID.emailAddress, OID.domainComponent: ASN1.ia5String(attribute.value)
            default: ASN1.utf8String(attribute.value)
            }
            return ASN1.set([ASN1.sequence([ASN1.oid(attribute.oid), value])])
        }
        // Built from encodable values; parsing back cannot fail.
        try! self.init(node: ASN1.sequence(rdnNodes))
    }

    var attributes: [Attribute] { rdns.flatMap { $0 } }

    func first(_ oid: String) -> String? { attributes.first { $0.oid == oid }?.value }
    func all(_ oid: String) -> [String] { attributes.filter { $0.oid == oid }.map(\.value) }

    var commonName: String? { first(OID.commonName) }
    var organization: String? { first(OID.organizationName) }
    var organizationalUnit: String? { first(OID.organizationalUnitName) }
    var email: String? { first(OID.emailAddress) }
    var country: String? { first(OID.countryName) }
    var locality: String? { first(OID.localityName) }
    var state: String? { first(OID.stateOrProvinceName) }
    var serialNumber: String? { first(OID.serialNumber) }
    var givenName: String? { first(OID.givenName) }
    var surname: String? { first(OID.surname) }
    var title: String? { first(OID.title) }

    /// Short label like the desktop `_subject_label`: CN, else O, else the full string.
    var label: String { commonName ?? organization ?? (rdns.isEmpty ? "?" : rfc4514) }

    /// RFC 4514 string (last RDN first), e-mail shown as `E=` like the desktop app.
    var rfc4514: String {
        rdns.reversed().map { rdn in
            rdn.map { "\($0.shortName)=\(Self.escape($0.value))" }.joined(separator: "+")
        }.joined(separator: ",")
    }

    var description: String { rfc4514 }

    private static func escape(_ value: String) -> String {
        var out = ""
        for (index, char) in value.enumerated() {
            if ",+\"\\<>;=".contains(char) || (index == 0 && (char == "#" || char == " ")) || (index == value.count - 1 && char == " ") {
                out.append("\\")
            }
            out.append(char)
        }
        return out
    }

    static func == (lhs: DistinguishedName, rhs: DistinguishedName) -> Bool {
        lhs.der == rhs.der || lhs.normalized == rhs.normalized
    }

    func hash(into hasher: inout Hasher) { hasher.combine(normalized) }

    /// Case-folded attribute list, so PrintableString vs UTF8String encodings of the same name match.
    private var normalized: [[String]] {
        rdns.map { rdn in rdn.map { "\($0.oid)=\($0.value.trimmingCharacters(in: .whitespaces).lowercased())" }.sorted() }
    }
}

/// KeyUsage bits (RFC 5280 §4.2.1.3).
struct KeyUsage: OptionSet, Hashable, Sendable {
    let rawValue: UInt16
    static let digitalSignature = KeyUsage(rawValue: 1 << 0)
    static let nonRepudiation = KeyUsage(rawValue: 1 << 1)
    static let keyEncipherment = KeyUsage(rawValue: 1 << 2)
    static let dataEncipherment = KeyUsage(rawValue: 1 << 3)
    static let keyAgreement = KeyUsage(rawValue: 1 << 4)
    static let keyCertSign = KeyUsage(rawValue: 1 << 5)
    static let cRLSign = KeyUsage(rawValue: 1 << 6)
    static let encipherOnly = KeyUsage(rawValue: 1 << 7)
    static let decipherOnly = KeyUsage(rawValue: 1 << 8)

    static let names: [(KeyUsage, String)] = [
        (.digitalSignature, "digitalSignature"), (.nonRepudiation, "nonRepudiation"), (.keyEncipherment, "keyEncipherment"),
        (.dataEncipherment, "dataEncipherment"), (.keyAgreement, "keyAgreement"), (.keyCertSign, "keyCertSign"),
        (.cRLSign, "cRLSign"), (.encipherOnly, "encipherOnly"), (.decipherOnly, "decipherOnly"),
    ]

    var bitIndices: [Int] { (0..<9).filter { rawValue & (1 << $0) != 0 } }
    var names: [String] { Self.names.filter { contains($0.0) }.map(\.1) }
}

/// A parsed X.509 v1–v3 certificate. Equality and hashing use the DER bytes.
struct X509Certificate: Hashable, Identifiable, Sendable {
    struct Extension: Hashable, Sendable {
        let oid: String
        let critical: Bool
        let value: Data
    }

    struct BasicConstraints: Hashable, Sendable {
        let isCA: Bool
        let pathLength: Int?
    }

    struct AuthorityInfoAccess: Hashable, Sendable {
        var ocsp: [String] = []
        var caIssuers: [String] = []
    }

    struct SubjectAltNames: Hashable, Sendable {
        var emails: [String] = []
        var dnsNames: [String] = []
        var uris: [String] = []
        var ipAddresses: [String] = []
        var directoryNames: [DistinguishedName] = []
    }

    let der: Data
    let version: Int
    /// Serial number as encoded (two's complement, big-endian).
    let serialNumber: Data
    let signatureAlgorithmIdentifier: ASN1Node
    let issuer: DistinguishedName
    let subject: DistinguishedName
    let notBefore: Date
    let notAfter: Date
    let publicKey: PublicKeyInfo
    let extensions: [Extension]
    /// Raw tbsCertificate (the signed bytes).
    let tbsDER: Data
    let signatureValue: Data

    var id: String { sha256Fingerprint }

    init(der: Data) throws {
        let root = try ASN1.parse(der)
        try self.init(node: root)
    }

    init(node root: ASN1Node) throws {
        guard root.isSequence, root.children.count == 3 else { throw CryptoError.malformed("not an X.509 certificate") }
        let tbs = root.children[0]
        guard tbs.isSequence else { throw CryptoError.malformed("bad tbsCertificate") }
        var fields = tbs.children[...]
        var version = 1
        if let first = fields.first, first.isContext(0) {
            version = try (first[0]).intValue + 1
            fields = fields.dropFirst()
        }
        let list = Array(fields)
        guard list.count >= 6 else { throw CryptoError.malformed("short tbsCertificate") }
        self.der = root.raw
        self.version = version
        self.serialNumber = try list[0].integerBytes
        self.signatureAlgorithmIdentifier = root.children[1]
        self.issuer = try DistinguishedName(node: list[2])
        self.notBefore = try list[3][0].dateValue
        self.notAfter = try list[3][1].dateValue
        self.subject = try DistinguishedName(node: list[4])
        self.publicKey = try PublicKeyInfo(node: list[5])
        var extensions: [Extension] = []
        if let block = list.dropFirst(6).first(where: { $0.isContext(3) }), let sequence = block.children.first {
            for item in sequence.children {
                let oid = try item[0].oid
                let critical = item.children.count == 3 ? (try item[1].boolValue) : false
                extensions.append(Extension(oid: oid, critical: critical, value: try item.children.last!.octets))
            }
        }
        self.extensions = extensions
        self.tbsDER = tbs.raw
        self.signatureValue = try root.children[2].bitStringBytes
    }

    // MARK: Import / export

    /// Reads one or more certificates from DER or PEM (`CERTIFICATE` / `X509 CERTIFICATE` blocks) bytes.
    static func parseMany(_ data: Data) throws -> [X509Certificate] {
        if let blocks = PEM.decode(data) {
            let certificates = try blocks.filter { $0.label == "CERTIFICATE" || $0.label == "X509 CERTIFICATE" || $0.label == "TRUSTED CERTIFICATE" }
                .map { try X509Certificate(der: $0.der) }
            guard !certificates.isEmpty else { throw CryptoError.malformed("no certificate in PEM") }
            return certificates
        }
        // A DER file may also be a degenerate PKCS#7 bundle (.p7b / .p7c).
        if let bundle = try? CMSSignedData(der: data), !bundle.certificates.isEmpty, (try? X509Certificate(der: data)) == nil {
            return bundle.certificates
        }
        return [try X509Certificate(der: data)]
    }

    /// First certificate in DER or PEM bytes.
    static func parse(_ data: Data) throws -> X509Certificate {
        guard let first = try parseMany(data).first else { throw CryptoError.malformed("no certificate") }
        return first
    }

    init(secCertificate: SecCertificate) throws {
        try self.init(der: SecCertificateCopyData(secCertificate) as Data)
    }

    var secCertificate: SecCertificate? { SecCertificateCreateWithData(nil, der as CFData) }

    var pem: String { PEM.encode(der, label: "CERTIFICATE") }

    // MARK: Fingerprints

    var sha1Fingerprint: String { DigestAlgorithm.sha1.hash(der).cryptoHex.uppercased() }
    var sha256Fingerprint: String { DigestAlgorithm.sha256.hash(der).cryptoHex.uppercased() }

    /// "AB:CD:…" formatting for display.
    static func formatFingerprint(_ hex: String) -> String {
        stride(from: 0, to: hex.count, by: 2).map { offset -> String in
            let start = hex.index(hex.startIndex, offsetBy: offset)
            return String(hex[start..<hex.index(start, offsetBy: min(2, hex.count - offset))])
        }.joined(separator: ":")
    }

    var serialNumberHex: String { serialNumber.cryptoHex.uppercased() }

    // MARK: Extensions

    func `extension`(_ oid: String) -> Extension? { extensions.first { $0.oid == oid } }

    var keyUsage: KeyUsage? {
        guard let value = `extension`(OID.keyUsage)?.value, let node = try? ASN1.parse(value), let bits = try? node.bitFlags else { return nil }
        var usage = KeyUsage()
        for (index, set) in bits.enumerated() where set && index < 9 { usage.insert(KeyUsage(rawValue: 1 << index)) }
        return usage
    }

    /// Extended key usage OIDs, nil when the extension is absent.
    var extendedKeyUsage: [String]? {
        guard let value = `extension`(OID.extendedKeyUsage)?.value, let node = try? ASN1.parse(value) else { return nil }
        return node.children.compactMap { try? $0.oid }
    }

    var basicConstraints: BasicConstraints? {
        guard let value = `extension`(OID.basicConstraints)?.value, let node = try? ASN1.parse(value) else { return nil }
        var isCA = false
        var pathLength: Int?
        for child in node.children {
            if child.isUniversal(ASN1Node.Universal.boolean) { isCA = (try? child.boolValue) ?? false }
            if child.isUniversal(ASN1Node.Universal.integer) { pathLength = try? child.intValue }
        }
        return BasicConstraints(isCA: isCA, pathLength: pathLength)
    }

    var isCA: Bool { basicConstraints?.isCA ?? false }

    var subjectKeyIdentifier: Data? {
        guard let value = `extension`(OID.subjectKeyIdentifier)?.value, let node = try? ASN1.parse(value) else { return nil }
        return try? node.octets
    }

    var authorityKeyIdentifier: Data? {
        guard let value = `extension`(OID.authorityKeyIdentifier)?.value, let node = try? ASN1.parse(value) else { return nil }
        return node.context(0)?.value
    }

    var crlDistributionPoints: [String] {
        guard let value = `extension`(OID.crlDistributionPoints)?.value, let node = try? ASN1.parse(value) else { return [] }
        // DistributionPoint ::= SEQUENCE { [0] DistributionPointName { [0] fullName GeneralNames } … }
        return node.children.flatMap { point -> [String] in
            guard let name = point.context(0), let full = name.context(0) else { return [] }
            return full.children.filter { $0.isContext(6) }.compactMap { String(data: $0.value, encoding: .utf8) }
        }
    }

    var authorityInfoAccess: AuthorityInfoAccess {
        var result = AuthorityInfoAccess()
        guard let value = `extension`(OID.authorityInfoAccess)?.value, let node = try? ASN1.parse(value) else { return result }
        for access in node.children {
            guard let method = try? access[0].oid, let location = try? access[1], location.isContext(6),
                  let uri = String(data: location.value, encoding: .utf8) else { continue }
            if method == OID.accessOCSP { result.ocsp.append(uri) }
            if method == OID.accessCAIssuers { result.caIssuers.append(uri) }
        }
        return result
    }

    /// Certificate policy OIDs.
    var certificatePolicies: [String] {
        guard let value = `extension`(OID.certificatePolicies)?.value, let node = try? ASN1.parse(value) else { return [] }
        return node.children.compactMap { try? $0[0].oid }
    }

    var subjectAltNames: SubjectAltNames {
        var result = SubjectAltNames()
        guard let value = `extension`(OID.subjectAltName)?.value, let node = try? ASN1.parse(value) else { return result }
        for name in node.children where name.tagClass == .contextSpecific {
            switch name.tagNumber {
            case 1: if let text = String(data: name.value, encoding: .utf8) { result.emails.append(text) }
            case 2: if let text = String(data: name.value, encoding: .utf8) { result.dnsNames.append(text) }
            case 6: if let text = String(data: name.value, encoding: .utf8) { result.uris.append(text) }
            case 7:
                if name.value.count == 4 { result.ipAddresses.append(name.value.map(String.init).joined(separator: ".")) }
                else { result.ipAddresses.append(name.value.cryptoHex) }
            case 4: if let inner = name.children.first, let dn = try? DistinguishedName(node: inner) { result.directoryNames.append(dn) }
            default: break
            }
        }
        return result
    }

    /// E-mail from the subject or the subjectAltName.
    var email: String? { subject.email ?? subjectAltNames.emails.first }

    // MARK: Validity & signatures

    var signatureAlgorithm: SignatureAlgorithm? { try? SignatureAlgorithm(identifier: signatureAlgorithmIdentifier) }

    func isValid(at date: Date = Date()) -> Bool { notBefore <= date && date <= notAfter }
    var isExpired: Bool { notAfter < Date() }

    var label: String { subject.label }

    /// Subject equals issuer and the certificate verifies with its own key.
    var isSelfSigned: Bool { subject == issuer && isSignedBy(self) }

    /// Whether `issuer`'s key produced this certificate's signature.
    func isSignedBy(_ issuer: X509Certificate) -> Bool {
        guard let algorithm = signatureAlgorithm, let key = try? issuer.publicKey.secKey() else { return false }
        return algorithm.verify(signature: signatureValue, digest: algorithm.digest.hash(tbsDER), publicKey: key)
    }

    /// Likely issued by `candidate` (name + key identifier match), without checking the signature.
    func mayBeIssuedBy(_ candidate: X509Certificate) -> Bool {
        guard issuer == candidate.subject else { return false }
        if let aki = authorityKeyIdentifier, let ski = candidate.subjectKeyIdentifier { return aki == ski }
        return true
    }

    /// Usable for document signatures per the desktop's key usage rules
    /// (digitalSignature or nonRepudiation; EKU, when present, must allow signing documents).
    var allowsDocumentSigning: Bool {
        if let usage = keyUsage, usage.isDisjoint(with: [.digitalSignature, .nonRepudiation]) { return false }
        if let eku = extendedKeyUsage {
            let allowed: Set<String> = [OID.ekuEmailProtection, OID.ekuAdobeAuthenticDocuments, OID.ekuDocumentSigning, OID.ekuAny]
            return eku.contains { allowed.contains($0) }
        }
        return true
    }

    /// RSA key with keyEncipherment (or no KeyUsage), as PDF certificate encryption requires.
    var allowsKeyEncipherment: Bool {
        guard publicKey.algorithm.isRSA else { return false }
        if let usage = keyUsage { return usage.contains(.keyEncipherment) }
        return true
    }

    /// SHA-1 of the subjectPublicKey bits (RFC 5280 method 1), for key identifiers.
    var publicKeyHash: Data { DigestAlgorithm.sha1.hash(publicKey.keyBytes) }

    static func == (lhs: X509Certificate, rhs: X509Certificate) -> Bool { lhs.der == rhs.der }
    func hash(into hasher: inout Hasher) { hasher.combine(der) }
}

/// PEM armour helpers.
enum PEM {
    struct Block {
        let label: String
        let der: Data
    }

    /// Decodes all PEM blocks, or nil when `data` has no PEM armour.
    static func decode(_ data: Data) -> [Block]? {
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1),
              text.contains("-----BEGIN ") else { return nil }
        var blocks: [Block] = []
        var label: String?
        var body = ""
        for rawLine in text.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("-----BEGIN "), line.hasSuffix("-----") {
                label = String(line.dropFirst(11).dropLast(5))
                body = ""
            } else if line.hasPrefix("-----END "), let current = label {
                if let der = Data(base64Encoded: body, options: .ignoreUnknownCharacters) { blocks.append(Block(label: current, der: der)) }
                label = nil
            } else if label != nil, !line.contains(":") {
                body += line
            }
        }
        return blocks
    }

    static func encode(_ der: Data, label: String) -> String {
        let base64 = der.base64EncodedString(options: [.lineLength64Characters, .endLineWithLineFeed])
        return "-----BEGIN \(label)-----\n\(base64)\n-----END \(label)-----\n"
    }
}
