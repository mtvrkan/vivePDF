import Foundation
import Security

/// A private key with its certificate and (optional) issuing chain — what signing and certificate
/// decryption need. The key may live in memory (imported .p12), the Keychain or the Secure Enclave.
struct SigningIdentity: @unchecked Sendable {
    let privateKey: SecKey
    let certificate: X509Certificate
    /// Intermediate (and possibly root) certificates, leaf excluded, nearest issuer first.
    var chain: [X509Certificate]

    init(privateKey: SecKey, certificate: X509Certificate, chain: [X509Certificate] = []) {
        self.privateKey = privateKey
        self.certificate = certificate
        self.chain = chain.filter { $0 != certificate }
    }

    /// From a Security.framework identity (SecPKCS12Import / Keychain).
    init(secIdentity: SecIdentity, chain: [SecCertificate] = []) throws {
        var key: SecKey?
        var certificate: SecCertificate?
        guard SecIdentityCopyPrivateKey(secIdentity, &key) == errSecSuccess, let key,
              SecIdentityCopyCertificate(secIdentity, &certificate) == errSecSuccess, let certificate else {
            throw CryptoError.noPrivateKey
        }
        try self.init(privateKey: key, certificate: X509Certificate(secCertificate: certificate),
                      chain: chain.map { try X509Certificate(secCertificate: $0) })
    }

    var label: String { certificate.label }

    /// Leaf followed by the chain.
    var allCertificates: [X509Certificate] { [certificate] + chain }

    /// Default signature algorithm for this key.
    func signatureAlgorithm(digest: DigestAlgorithm = .sha256, pss: Bool = false) -> SignatureAlgorithm {
        .for(certificate.publicKey.algorithm, digest: digest, pss: pss)
    }

    /// Whether the private key matches the certificate (signs a probe and verifies it).
    func keyMatchesCertificate() -> Bool {
        let algorithm = signatureAlgorithm()
        let probe = DigestAlgorithm.sha256.hash(Data("vivePDF key check".utf8))
        guard let signature = try? algorithm.sign(digest: probe, with: privateKey),
              let publicKey = try? certificate.publicKey.secKey() else { return false }
        return algorithm.verify(signature: signature, digest: probe, publicKey: publicKey)
    }

    /// Orders loose certificates into a chain starting at the leaf's issuer.
    static func buildChain(for leaf: X509Certificate, from pool: [X509Certificate]) -> [X509Certificate] {
        var chain: [X509Certificate] = []
        var current = leaf
        var remaining = pool.filter { $0 != leaf }
        while !current.isSelfSignedName, let index = remaining.firstIndex(where: { current.mayBeIssuedBy($0) }) {
            let issuer = remaining.remove(at: index)
            chain.append(issuer)
            current = issuer
        }
        // Keep unrelated extras (cross-certificates) at the end rather than dropping them.
        return chain + remaining
    }
}

extension X509Certificate {
    /// Cheap self-issued test (subject == issuer) without verifying the signature.
    var isSelfSignedName: Bool { subject == issuer }
}

/// Self-signed certificate creation, mirroring `sign.create_certificate` on the desktop.
enum CertificateFactory {
    static let minimumPasswordLength = 8
    static let maximumNameBytes = 64
    static let defaultValidDays = 1095

    enum Usage: String, Codable, CaseIterable, Sendable {
        case signing, encryption, both
        var signs: Bool { self != .encryption }
        var encrypts: Bool { self != .signing }
    }

    struct Subject: Sendable {
        var commonName: String
        var email: String = ""
        var organization: String = ""
        var organizationalUnit: String = ""
        var country: String = "TR"
        var locality: String = ""
        var state: String = ""
    }

    struct Options: Sendable {
        var subject: Subject
        var keyType: SigningKeyType = .rsa3072
        var usage: Usage = .signing
        /// 1…7300 days (desktop limits); `validityYears` is a convenience setter.
        var validDays: Int = defaultValidDays
        var digest: DigestAlgorithm = .sha256
        var validityYears: Int {
            get { validDays / 365 }
            set { validDays = newValue * 365 + newValue / 4 }
        }

        init(subject: Subject, keyType: SigningKeyType = .rsa3072, usage: Usage = .signing, validDays: Int = defaultValidDays) {
            self.subject = subject
            self.keyType = keyType
            self.usage = usage
            self.validDays = validDays
        }
    }

    /// Validates the subject like the desktop (name required, 64-byte limit, e-mail syntax, RSA for encryption)
    /// and returns the Name attributes to encode.
    static func validatedAttributes(_ options: Options) throws -> [(oid: String, value: String)] {
        let subject = options.subject
        guard (1...7300).contains(options.validDays) else { throw CryptoError.invalid(reason: "validDays") }
        if options.usage.encrypts && !options.keyType.isRSA { throw CryptoError.invalid(reason: "encryptionNeedsRsa") }
        let commonName = subject.commonName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !commonName.isEmpty else { throw CryptoError.invalid(reason: "commonName") }
        let organization = subject.organization.trimmingCharacters(in: .whitespacesAndNewlines)
        let unit = subject.organizationalUnit.trimmingCharacters(in: .whitespacesAndNewlines)
        let locality = subject.locality.trimmingCharacters(in: .whitespacesAndNewlines)
        let state = subject.state.trimmingCharacters(in: .whitespacesAndNewlines)
        for (field, value) in [("commonName", commonName), ("organization", organization), ("organizationalUnit", unit),
                               ("locality", locality), ("state", state)] where value.utf8.count > maximumNameBytes {
            throw CryptoError.invalid(reason: "nameTooLong", detail: field)
        }
        var attributes: [(oid: String, value: String)] = [(OID.commonName, commonName)]
        if !organization.isEmpty { attributes.append((OID.organizationName, organization)) }
        if !unit.isEmpty { attributes.append((OID.organizationalUnitName, unit)) }
        if !locality.isEmpty { attributes.append((OID.localityName, locality)) }
        if !state.isEmpty { attributes.append((OID.stateOrProvinceName, state)) }
        let country = subject.country.trimmingCharacters(in: .whitespaces)
        if country.count == 2, country.allSatisfy({ $0.isASCII && $0.isLetter }) { attributes.append((OID.countryName, country.uppercased())) }
        let email = subject.email.trimmingCharacters(in: .whitespacesAndNewlines)
        if !email.isEmpty { attributes.append((OID.emailAddress, try asciiEmail(email))) }
        return attributes
    }

    /// `local@domain` with an IDNA (punycode) domain; local part must be ASCII (desktop `_ascii_email`).
    static func asciiEmail(_ value: String) throws -> String {
        guard let at = value.lastIndex(of: "@") else { throw CryptoError.invalid(reason: "email") }
        let local = String(value[..<at])
        let domain = String(value[value.index(after: at)...])
        guard !local.isEmpty, !domain.isEmpty, local.allSatisfy(\.isASCII), !value.contains(" ") else { throw CryptoError.invalid(reason: "email") }
        guard let asciiDomain = Punycode.idnaDomain(domain), asciiDomain.contains(".") else { throw CryptoError.invalid(reason: "email") }
        return "\(local)@\(asciiDomain)"
    }

    /// Creates a key (unless `privateKey` is supplied, e.g. a Secure Enclave or Keychain key) and a
    /// self-signed certificate for it.
    static func create(_ options: Options, privateKey suppliedKey: SecKey? = nil, now: Date = Date()) throws -> SigningIdentity {
        let attributes = try validatedAttributes(options)
        let privateKey = try suppliedKey ?? PrivateKeys.generate(options.keyType)
        let publicKey = try PrivateKeys.publicKey(of: privateKey)
        let spki = try PublicKeyInfo(secKey: publicKey)
        let name = DistinguishedName(attributes)
        let email = attributes.first { $0.oid == OID.emailAddress }?.value

        var extensions: [ASN1Node] = []
        func add(_ oid: String, critical: Bool, _ value: ASN1Node) {
            extensions.append(ASN1.sequence([ASN1.oid(oid)] + (critical ? [ASN1.boolean(true)] : []) + [ASN1.octetString(value.raw)]))
        }
        add(OID.basicConstraints, critical: true, ASN1.sequence([]))
        var usage: KeyUsage = []
        if options.usage.signs { usage.formUnion([.digitalSignature, .nonRepudiation]) }
        if options.usage.encrypts { usage.insert(.keyEncipherment) }
        add(OID.keyUsage, critical: true, ASN1.namedBits(usage.bitIndices))
        var ekus = [OID.ekuEmailProtection, OID.ekuClientAuth]
        if options.usage.signs { ekus.append(OID.ekuDocumentSigning) }
        add(OID.extendedKeyUsage, critical: false, ASN1.sequence(ekus.map(ASN1.oid)))
        if let email { add(OID.subjectAltName, critical: false, ASN1.sequence([ASN1.implicitPrimitive(1, Data(email.utf8))])) }
        let keyIdentifier = DigestAlgorithm.sha1.hash(spki.keyBytes)
        add(OID.subjectKeyIdentifier, critical: false, ASN1.octetString(keyIdentifier))
        add(OID.authorityKeyIdentifier, critical: false, ASN1.sequence([ASN1.implicitPrimitive(0, keyIdentifier)]))

        var serial = KeyDerivation.randomBytes(19)
        serial[0] &= 0x7F
        serial[0] |= 0x01
        let algorithm = SignatureAlgorithm.for(spki.algorithm, digest: options.digest)
        let tbs = ASN1.sequence([
            ASN1.explicit(0, ASN1.integer(2)),
            ASN1.integer(unsigned: serial),
            algorithm.algorithmIdentifier,
            try ASN1.raw(name.der),
            ASN1.sequence([ASN1.time(now.addingTimeInterval(-300)), ASN1.time(now.addingTimeInterval(Double(options.validDays) * 86400))]),
            try ASN1.raw(name.der),
            try ASN1.raw(spki.der),
            ASN1.explicit(3, ASN1.sequence(extensions)),
        ])
        let signature = try algorithm.sign(digest: algorithm.digest.hash(tbs.raw), with: privateKey)
        let certificate = ASN1.sequence([tbs, algorithm.algorithmIdentifier, ASN1.bitString(signature)])
        return SigningIdentity(privateKey: privateKey, certificate: try X509Certificate(der: certificate.raw))
    }
}

/// Minimal RFC 3492 punycode for IDNA domains (lower-cased, NFKC-normalised labels).
enum Punycode {
    static func idnaDomain(_ domain: String) -> String? {
        let labels = domain.precomposedStringWithCompatibilityMapping.lowercased().split(separator: ".", omittingEmptySubsequences: false)
        var out: [String] = []
        for label in labels {
            guard !label.isEmpty else { return nil }
            if label.allSatisfy(\.isASCII) { out.append(String(label)); continue }
            guard let encoded = encode(String(label)) else { return nil }
            out.append("xn--" + encoded)
        }
        let result = out.joined(separator: ".")
        return result.count <= 253 ? result : nil
    }

    static func encode(_ input: String) -> String? {
        let base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700
        let scalars = input.unicodeScalars.map { Int($0.value) }
        var output = scalars.filter { $0 < 0x80 }.compactMap { Unicode.Scalar($0).map { String(Character($0)) } }.joined()
        let basicCount = output.count
        var handled = basicCount
        if basicCount > 0 { output += "-" }
        var n = 0x80, delta = 0, bias = 72
        func adapt(_ delta: Int, _ count: Int, _ first: Bool) -> Int {
            var delta = first ? delta / damp : delta / 2
            delta += delta / count
            var k = 0
            while delta > ((base - tMin) * tMax) / 2 { delta /= base - tMin; k += base }
            return k + (base - tMin + 1) * delta / (delta + skew)
        }
        func digit(_ d: Int) -> Character { Character(Unicode.Scalar(UInt8(d < 26 ? d + 97 : d + 22))) }
        while handled < scalars.count {
            guard let m = scalars.filter({ $0 >= n }).min() else { return nil }
            delta += (m - n) * (handled + 1)
            n = m
            for c in scalars {
                if c < n { delta += 1 }
                if c == n {
                    var q = delta
                    var k = base
                    while true {
                        let t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias)
                        if q < t { break }
                        output.append(digit(t + (q - t) % (base - t)))
                        q = (q - t) / (base - t)
                        k += base
                    }
                    output.append(digit(q))
                    bias = adapt(delta, handled + 1, handled == basicCount)
                    delta = 0
                    handled += 1
                }
            }
            delta += 1
            n += 1
        }
        return output
    }
}
