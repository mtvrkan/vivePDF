import Foundation

/// A parsed CMS / PKCS#7 SignedData (RFC 5652), e.g. a PDF signature's /Contents or an RFC 3161 token.
struct CMSSignedData: @unchecked Sendable {
    struct Attribute: @unchecked Sendable {
        let oid: String
        let values: [ASN1Node]
    }

    struct SignerInfo: @unchecked Sendable {
        let version: Int
        /// `IssuerAndSerialNumber` signer reference.
        let issuer: DistinguishedName?
        let serialNumber: Data?
        /// `[0] SubjectKeyIdentifier` signer reference (version 3).
        let subjectKeyIdentifier: Data?
        let digestAlgorithmOID: String
        let signedAttributes: [Attribute]?
        /// DER of the signed attributes as a `SET` — the bytes the signature covers.
        let signedAttributesDER: Data?
        let signatureAlgorithmIdentifier: ASN1Node
        let signature: Data
        let unsignedAttributes: [Attribute]

        var digestAlgorithm: DigestAlgorithm? { DigestAlgorithm(oid: digestAlgorithmOID) }

        func signedAttribute(_ oid: String) -> ASN1Node? { signedAttributes?.first { $0.oid == oid }?.values.first }
        func unsignedAttribute(_ oid: String) -> ASN1Node? { unsignedAttributes.first { $0.oid == oid }?.values.first }

        var messageDigest: Data? { try? signedAttribute(OID.messageDigest)?.octets }
        var contentType: String? { try? signedAttribute(OID.contentType)?.oid }
        var signingTime: Date? {
            guard let node = signedAttribute(OID.signingTime) else { return nil }
            return try? node.dateValue
        }

        /// RFC 3161 TimeStampToken (ContentInfo DER) stored as an unsigned attribute.
        var timestampToken: Data? { unsignedAttribute(OID.timeStampToken)?.raw }

        /// ESS signing-certificate(-v2) hash of the signer certificate, if present.
        var signingCertificateReference: (digest: DigestAlgorithm, hash: Data)? {
            if let v2 = signedAttribute(OID.signingCertificateV2), let first = try? v2[0][0] {
                var digest = DigestAlgorithm.sha256
                var index = 0
                if let algorithm = first.children.first, algorithm.isSequence {
                    digest = (try? algorithm[0].oid).flatMap(DigestAlgorithm.init(oid:)) ?? .sha256
                    index = 1
                }
                if let hash = try? first[index].octets { return (digest, hash) }
            }
            if let v1 = signedAttribute(OID.signingCertificate), let hash = try? v1[0][0][0].octets { return (.sha1, hash) }
            return nil
        }

        /// The signer certificate among `candidates`.
        func findCertificate(in candidates: [X509Certificate]) -> X509Certificate? {
            if let ski = subjectKeyIdentifier {
                return candidates.first { $0.subjectKeyIdentifier == ski || $0.publicKeyHash == ski }
            }
            guard let issuer, let serialNumber else { return nil }
            return candidates.first { $0.issuer == issuer && Self.sameSerial($0.serialNumber, serialNumber) }
        }

        static func sameSerial(_ a: Data, _ b: Data) -> Bool {
            func trimmed(_ d: Data) -> Data { Data(d.drop { $0 == 0 }) }
            return trimmed(a) == trimmed(b)
        }
    }

    let der: Data
    let version: Int
    let digestAlgorithmOIDs: [String]
    let encapsulatedContentType: String
    /// eContent when not detached (e.g. TSTInfo in a timestamp token, SHA-1 digest in adbe.pkcs7.sha1).
    let encapsulatedContent: Data?
    let certificates: [X509Certificate]
    let crls: [Data]
    let signerInfos: [SignerInfo]

    /// Parses a ContentInfo wrapping SignedData (zero padding after it is ignored, as in PDF /Contents).
    init(der input: Data) throws {
        let contentInfo = try ASN1.parse(input)
        guard contentInfo.isSequence, (try? contentInfo[0].oid) == OID.signedData,
              let signedData = contentInfo.context(0)?.children.first, signedData.isSequence else {
            throw CryptoError.malformed("not a CMS SignedData")
        }
        der = contentInfo.raw
        version = try signedData[0].intValue
        digestAlgorithmOIDs = try signedData[1].children.map { try $0[0].oid }
        let encap = try signedData[2]
        encapsulatedContentType = try encap[0].oid
        encapsulatedContent = try encap.context(0)?.children.first?.octets
        var certificates: [X509Certificate] = []
        var crls: [Data] = []
        var signerSet: ASN1Node?
        for field in signedData.children.dropFirst(3) {
            if field.isContext(0) {
                // Skip attribute certificates and other choices; keep plain certificates.
                certificates += field.children.filter(\.isSequence).compactMap { try? X509Certificate(node: $0) }
            } else if field.isContext(1) {
                crls += field.children.map(\.raw)
            } else if field.isSet {
                signerSet = field
            }
        }
        self.certificates = certificates
        self.crls = crls
        guard let signerSet else { throw CryptoError.malformed("SignedData without signerInfos") }
        signerInfos = try signerSet.children.map(Self.parseSignerInfo)
    }

    private static func attributes(_ node: ASN1Node) throws -> [Attribute] {
        try node.children.map { Attribute(oid: try $0[0].oid, values: try $0[1].children) }
    }

    private static func parseSignerInfo(_ node: ASN1Node) throws -> SignerInfo {
        var fields = node.children[...]
        guard let versionNode = fields.popFirst(), let sid = fields.popFirst(), let digest = fields.popFirst() else {
            throw CryptoError.malformed("short SignerInfo")
        }
        var issuer: DistinguishedName?
        var serial: Data?
        var ski: Data?
        if sid.isContext(0) { ski = sid.value } else {
            issuer = try DistinguishedName(node: sid[0])
            serial = try sid[1].integerBytes
        }
        var signed: [Attribute]?
        var signedDER: Data?
        if let next = fields.first, next.isContext(0) {
            fields = fields.dropFirst()
            signed = try attributes(next)
            // The signature covers the attributes with an explicit SET tag (RFC 5652 §5.4).
            if next.raw.count > 1, next.raw[next.raw.startIndex + 1] == 0x80 {
                // BER indefinite length: signers hash the DER form.
                signedDER = next.retagged(.universal, ASN1Node.Universal.set).derEncoded()
            } else {
                var raw = next.raw
                raw[raw.startIndex] = 0x31
                signedDER = raw
            }
        }
        guard let algorithm = fields.popFirst(), let signature = fields.popFirst() else { throw CryptoError.malformed("short SignerInfo") }
        var unsigned: [Attribute] = []
        if let next = fields.first, next.isContext(1) { unsigned = try attributes(next) }
        return SignerInfo(version: try versionNode.intValue, issuer: issuer, serialNumber: serial, subjectKeyIdentifier: ski,
                          digestAlgorithmOID: try digest[0].oid, signedAttributes: signed, signedAttributesDER: signedDER,
                          signatureAlgorithmIdentifier: algorithm, signature: try signature.octets, unsignedAttributes: unsigned)
    }
}

/// Options for `CMSSigner`.
struct CMSSignOptions: Sendable {
    /// `cades` → PDF SubFilter `ETSI.CAdES.detached` (PAdES); `pkcs7` → `adbe.pkcs7.detached`.
    enum Format: String, Codable, Sendable { case cades, pkcs7 }

    var format: Format = .cades
    var digest: DigestAlgorithm = .sha256
    /// RSA-PSS instead of PKCS#1 v1.5 (ignored for EC keys).
    var rsaPSS = false
    /// Claimed signing time. PAdES forbids the signing-time attribute (the time goes in the PDF /M),
    /// so it is only written for `pkcs7` unless `signingTimeInCAdES` is set.
    var signingTime: Date? = Date()
    var signingTimeInCAdES = false
    var includeChain = true
    var extraCertificates: [X509Certificate] = []
    /// RFC 3161 timestamp authority; the token is added as an unsigned attribute.
    var timestamp: TimestampAuthority?
    /// Extra signed attributes (e.g. Adobe revocation info archival), already encoded as `Attribute` SEQUENCEs.
    var extraSignedAttributes: [ASN1Node] = []

    init(format: Format = .cades, digest: DigestAlgorithm = .sha256, timestamp: TimestampAuthority? = nil) {
        self.format = format
        self.digest = digest
        self.timestamp = timestamp
    }

    /// PDF `/SubFilter` value for this format.
    var pdfSubFilter: String { format == .cades ? "ETSI.CAdES.detached" : "adbe.pkcs7.detached" }
}

/// Creates detached CMS SignedData for PDF signatures (PAdES B-B / B-T and adbe.pkcs7.detached).
enum CMSSigner {
    /// Signs the concatenation of `content` (e.g. the two PDF ByteRange slices).
    static func sign(content: [Data], identity: SigningIdentity, options: CMSSignOptions = CMSSignOptions()) async throws -> Data {
        try await sign(digest: options.digest.hash(content), identity: identity, options: options)
    }

    /// Signs a precomputed content digest (hash of the signed bytes with `options.digest`), requesting a
    /// timestamp when `options.timestamp` is set.
    static func sign(digest: Data, identity: SigningIdentity, options: CMSSignOptions = CMSSignOptions()) async throws -> Data {
        let signerInfo = try buildSignerInfo(digest: digest, identity: identity, options: options)
        var unsigned: [ASN1Node] = []
        if let authority = options.timestamp {
            let token = try await TimestampClient.requestToken(for: signerInfo.signature, authority: authority)
            unsigned.append(ASN1.sequence([ASN1.oid(OID.timeStampToken), ASN1.set([try ASN1.raw(token)])]))
        }
        return assemble(signerInfo, unsignedAttributes: unsigned, identity: identity, options: options)
    }

    /// Synchronous variant without a timestamp (`options.timestamp` is ignored).
    static func signWithoutTimestamp(digest: Data, identity: SigningIdentity, options: CMSSignOptions = CMSSignOptions()) throws -> Data {
        let signerInfo = try buildSignerInfo(digest: digest, identity: identity, options: options)
        return assemble(signerInfo, unsignedAttributes: [], identity: identity, options: options)
    }

    /// Bytes to reserve for `/Contents` (binary length; double it for hex) — signature, certificates,
    /// attributes, plus room for a timestamp token.
    static func estimatedSize(identity: SigningIdentity, options: CMSSignOptions = CMSSignOptions()) -> Int {
        let certificates = identity.certificate.der.count + (options.includeChain ? identity.chain.reduce(0) { $0 + $1.der.count } : 0)
            + options.extraCertificates.reduce(0) { $0 + $1.der.count }
        let signature: Int = switch identity.certificate.publicKey.algorithm {
        case .rsa(let bits): bits / 8
        case .ec(let curve): curve.coordinateBytes * 2 + 12
        case .other: 1024
        }
        let timestamp = options.timestamp == nil ? 0 : 8192
        return certificates + signature + 1536 + options.extraSignedAttributes.reduce(0) { $0 + $1.raw.count } + timestamp
    }

    struct BuiltSignerInfo {
        let fields: [ASN1Node]
        let signature: Data
    }

    static func buildSignerInfo(digest: Data, identity: SigningIdentity, options: CMSSignOptions) throws -> BuiltSignerInfo {
        guard digest.count == options.digest.length else { throw CryptoError.invalid(reason: "digest", detail: "wrong digest length") }
        let certificate = identity.certificate
        let algorithm = identity.signatureAlgorithm(digest: options.digest, pss: options.rsaPSS)
        func attribute(_ oid: String, _ value: ASN1Node) -> ASN1Node { ASN1.sequence([ASN1.oid(oid), ASN1.set([value])]) }

        var attributes = [
            attribute(OID.contentType, ASN1.oid(OID.data)),
            attribute(OID.messageDigest, ASN1.octetString(digest)),
        ]
        if let time = options.signingTime, options.format == .pkcs7 || options.signingTimeInCAdES {
            attributes.append(attribute(OID.signingTime, ASN1.time(time)))
        }
        // ESS signing-certificate-v2 binds the certificate to the signature (required by PAdES).
        let issuerSerial = ASN1.sequence([
            ASN1.sequence([ASN1.explicit(4, try ASN1.raw(certificate.issuer.der))]),
            ASN1.integer(raw: certificate.serialNumber),
        ])
        var essCertID = [ASN1Node]()
        if options.digest != .sha256 { essCertID.append(options.digest.algorithmIdentifier) }
        essCertID += [ASN1.octetString(options.digest.hash(certificate.der)), issuerSerial]
        attributes.append(attribute(OID.signingCertificateV2, ASN1.sequence([ASN1.sequence([ASN1.sequence(essCertID)])])))
        // RFC 6211 algorithm protection guards against algorithm substitution.
        attributes.append(attribute(OID.cmsAlgorithmProtection, ASN1.sequence([
            options.digest.algorithmIdentifier,
            ASN1.implicitConstructed(1, algorithm.algorithmIdentifier.children),
        ])))
        attributes += options.extraSignedAttributes

        let signedSet = ASN1.set(attributes)
        let signature = try algorithm.sign(digest: options.digest.hash(signedSet.raw), with: identity.privateKey)
        let fields: [ASN1Node] = [
            ASN1.integer(1),
            ASN1.sequence([try ASN1.raw(certificate.issuer.der), ASN1.integer(raw: certificate.serialNumber)]),
            options.digest.algorithmIdentifier,
            signedSet.retagged(.contextSpecific, 0),
            algorithm.algorithmIdentifier,
            ASN1.octetString(signature),
        ]
        return BuiltSignerInfo(fields: fields, signature: signature)
    }

    static func assemble(_ signerInfo: BuiltSignerInfo, unsignedAttributes: [ASN1Node], identity: SigningIdentity, options: CMSSignOptions) -> Data {
        var fields = signerInfo.fields
        if !unsignedAttributes.isEmpty { fields.append(ASN1.implicitConstructed(1, unsignedAttributes)) }
        var certificates = [identity.certificate]
        if options.includeChain { certificates += identity.chain }
        for extra in options.extraCertificates where !certificates.contains(extra) { certificates.append(extra) }
        let certificateNodes = certificates.compactMap { try? ASN1.raw($0.der) }
        let signedData = ASN1.sequence([
            ASN1.integer(1),
            ASN1.set([options.digest.algorithmIdentifier]),
            ASN1.sequence([ASN1.oid(OID.data)]),
            ASN1.implicitConstructed(0, certificateNodes),
            ASN1.set([ASN1.sequence(fields)]),
        ])
        return ASN1.sequence([ASN1.oid(OID.signedData), ASN1.explicit(0, signedData)]).raw
    }
}
