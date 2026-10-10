import CryptoKit
import Foundation
import Security

/// Named elliptic curves supported by Security.framework.
enum ECCurve: String, Codable, Sendable {
    case p256, p384, p521

    var oid: String {
        switch self {
        case .p256: OID.p256
        case .p384: OID.p384
        case .p521: OID.p521
        }
    }

    var bits: Int {
        switch self {
        case .p256: 256
        case .p384: 384
        case .p521: 521
        }
    }

    var coordinateBytes: Int { (bits + 7) / 8 }

    init?(oid: String) {
        switch oid {
        case OID.p256: self = .p256
        case OID.p384: self = .p384
        case OID.p521: self = .p521
        default: return nil
        }
    }

    /// Hash that matches the curve strength (used when the caller does not choose one).
    var preferredDigest: DigestAlgorithm {
        switch self {
        case .p256: .sha256
        case .p384: .sha384
        case .p521: .sha512
        }
    }
}

/// Public key algorithm as found in a certificate.
enum KeyAlgorithm: Equatable, Sendable, CustomStringConvertible {
    case rsa(bits: Int)
    case ec(ECCurve)
    case other(oid: String)

    var isRSA: Bool { if case .rsa = self { return true } else { return false } }
    var isEC: Bool { if case .ec = self { return true } else { return false } }

    var description: String {
        switch self {
        case .rsa(let bits): "RSA \(bits)"
        case .ec(let curve): "EC \(OID.name(curve.oid))"
        case .other(let oid): OID.name(oid)
        }
    }
}

/// Key sizes offered when creating a self-signed certificate.
enum SigningKeyType: String, Codable, CaseIterable, Sendable {
    case rsa2048, rsa3072, rsa4096, ecP256, ecP384

    var isRSA: Bool { rawValue.hasPrefix("rsa") }

    var bits: Int {
        switch self {
        case .rsa2048: 2048
        case .rsa3072: 3072
        case .rsa4096: 4096
        case .ecP256: 256
        case .ecP384: 384
        }
    }
}

/// SubjectPublicKeyInfo.
struct PublicKeyInfo: Hashable, Sendable {
    let algorithmOID: String
    /// Algorithm parameters (curve OID for EC), as encoded.
    let parameters: ASN1Node?
    /// BIT STRING payload: PKCS#1 RSAPublicKey for RSA, X9.63 point for EC.
    let keyBytes: Data
    /// DER of the whole SubjectPublicKeyInfo.
    let der: Data

    init(node: ASN1Node) throws {
        guard node.isSequence, node.children.count == 2, node.children[0].isSequence else {
            throw CryptoError.malformed("bad SubjectPublicKeyInfo")
        }
        let algorithm = node.children[0]
        algorithmOID = try algorithm[0].oid
        parameters = algorithm.children.count > 1 ? algorithm.children[1] : nil
        keyBytes = try node.children[1].bitStringBytes
        der = node.raw
    }

    init(der: Data) throws { try self.init(node: ASN1.parse(der)) }

    /// SubjectPublicKeyInfo for a Security.framework public key.
    init(secKey: SecKey) throws {
        guard let attributes = SecKeyCopyAttributes(secKey) as? [CFString: Any],
              let type = attributes[kSecAttrKeyType] as? String else { throw CryptoError.unsupported("key attributes") }
        var error: Unmanaged<CFError>?
        guard let external = SecKeyCopyExternalRepresentation(secKey, &error) as Data? else {
            throw CryptoError.security(-1, "export public key: \(error?.takeRetainedValue().localizedDescription ?? "")")
        }
        let node: ASN1Node
        if type == (kSecAttrKeyTypeRSA as String) {
            node = ASN1.sequence([ASN1.algorithm(OID.rsaEncryption, ASN1.null()), ASN1.bitString(external)])
        } else if type == (kSecAttrKeyTypeECSECPrimeRandom as String) {
            let bits = attributes[kSecAttrKeySizeInBits] as? Int ?? 256
            let curve: ECCurve = bits > 384 ? .p521 : bits > 256 ? .p384 : .p256
            node = ASN1.sequence([ASN1.algorithm(OID.ecPublicKey, ASN1.oid(curve.oid)), ASN1.bitString(external)])
        } else {
            throw CryptoError.unsupported("key type \(type)")
        }
        try self.init(node: node)
    }

    var algorithm: KeyAlgorithm {
        switch algorithmOID {
        case OID.rsaEncryption, OID.rsassaPSS, OID.rsaesOAEP:
            if let key = try? ASN1.parse(keyBytes), let modulus = try? key[0].unsignedIntegerBytes {
                let leading = modulus.first.map { 8 - UInt8($0).leadingZeroBitCount } ?? 0
                return .rsa(bits: (modulus.count - 1) * 8 + leading)
            }
            return .rsa(bits: 0)
        case OID.ecPublicKey:
            if let curveOID = try? parameters?.oid, let curve = ECCurve(oid: curveOID) { return .ec(curve) }
            return .other(oid: OID.ecPublicKey)
        default:
            return .other(oid: algorithmOID)
        }
    }

    /// The key as a Security.framework public key.
    func secKey() throws -> SecKey {
        let type: CFString
        switch algorithm {
        case .rsa: type = kSecAttrKeyTypeRSA
        case .ec: type = kSecAttrKeyTypeECSECPrimeRandom
        case .other(let oid): throw CryptoError.unsupported("public key algorithm \(OID.name(oid))")
        }
        var error: Unmanaged<CFError>?
        let attributes: [CFString: Any] = [kSecAttrKeyType: type, kSecAttrKeyClass: kSecAttrKeyClassPublic]
        guard let key = SecKeyCreateWithData(keyBytes as CFData, attributes as CFDictionary, &error) else {
            throw CryptoError.malformed("public key: \(error?.takeRetainedValue().localizedDescription ?? "")")
        }
        return key
    }
}

/// Private key import/export/generation.
enum PrivateKeys {
    /// Imports a PKCS#8 PrivateKeyInfo (RSA or EC) as a non-permanent SecKey.
    static func secKey(pkcs8 der: Data) throws -> SecKey {
        let info = try ASN1.parse(der)
        guard info.isSequence, info.children.count >= 3 else { throw CryptoError.malformed("bad PrivateKeyInfo") }
        let algorithm = try info[1]
        let oid = try algorithm[0].oid
        let keyData = try info[2].octets
        switch oid {
        case OID.rsaEncryption, OID.rsassaPSS:
            return try create(keyData, type: kSecAttrKeyTypeRSA)
        case OID.ecPublicKey:
            let curveOID = try algorithm.children.count > 1 ? algorithm[1].oid : ""
            let ecKey = try ASN1.parse(keyData)
            if let named = try? ecKey.context(0)?.children.first?.oid, !named.isEmpty, curveOID.isEmpty {
                return try ecSecKey(ecKey, curveOID: named)
            }
            return try ecSecKey(ecKey, curveOID: curveOID)
        default:
            throw CryptoError.unsupported("private key algorithm \(OID.name(oid))")
        }
    }

    /// ECPrivateKey → Apple's X9.63 `04 || X || Y || D` private representation.
    private static func ecSecKey(_ ecKey: ASN1Node, curveOID: String) throws -> SecKey {
        guard let curve = ECCurve(oid: curveOID) else { throw CryptoError.unsupported("curve \(curveOID)") }
        var scalar = try ecKey[1].octets
        if scalar.count < curve.coordinateBytes { scalar = Data(count: curve.coordinateBytes - scalar.count) + scalar }
        if scalar.count > curve.coordinateBytes { scalar = scalar.suffix(curve.coordinateBytes).cryptoDetached }
        var point: Data
        if let embedded = ecKey.context(1)?.children.first, let bits = try? embedded.bitStringBytes {
            point = bits
        } else {
            switch curve {
            case .p256: point = try P256.Signing.PrivateKey(rawRepresentation: scalar).publicKey.x963Representation
            case .p384: point = try P384.Signing.PrivateKey(rawRepresentation: scalar).publicKey.x963Representation
            case .p521: point = try P521.Signing.PrivateKey(rawRepresentation: scalar).publicKey.x963Representation
            }
        }
        return try create(point + scalar, type: kSecAttrKeyTypeECSECPrimeRandom)
    }

    private static func create(_ data: Data, type: CFString) throws -> SecKey {
        var error: Unmanaged<CFError>?
        let attributes: [CFString: Any] = [kSecAttrKeyType: type, kSecAttrKeyClass: kSecAttrKeyClassPrivate]
        guard let key = SecKeyCreateWithData(data as CFData, attributes as CFDictionary, &error) else {
            throw CryptoError.malformed("private key: \(error?.takeRetainedValue().localizedDescription ?? "")")
        }
        return key
    }

    /// Exports a private SecKey as PKCS#8 PrivateKeyInfo DER. Fails for Secure Enclave / non-extractable keys.
    static func pkcs8(_ key: SecKey) throws -> Data {
        guard let attributes = SecKeyCopyAttributes(key) as? [CFString: Any],
              let type = attributes[kSecAttrKeyType] as? String else { throw CryptoError.unsupported("key attributes") }
        var error: Unmanaged<CFError>?
        guard let external = SecKeyCopyExternalRepresentation(key, &error) as Data? else { throw CryptoError.notExportable }
        if type == (kSecAttrKeyTypeRSA as String) {
            return ASN1.sequence([ASN1.integer(0), ASN1.algorithm(OID.rsaEncryption, ASN1.null()), ASN1.octetString(external)]).raw
        }
        guard type == (kSecAttrKeyTypeECSECPrimeRandom as String) else { throw CryptoError.unsupported("key type \(type)") }
        let bits = attributes[kSecAttrKeySizeInBits] as? Int ?? 256
        let curve: ECCurve = bits > 384 ? .p521 : bits > 256 ? .p384 : .p256
        let size = curve.coordinateBytes
        guard external.count == 1 + size * 3 else { throw CryptoError.malformed("unexpected EC key length") }
        let point = external.prefix(1 + size * 2).cryptoDetached
        let scalar = external.suffix(size).cryptoDetached
        let ecPrivateKey = ASN1.sequence([
            ASN1.integer(1), ASN1.octetString(scalar),
            ASN1.explicit(0, ASN1.oid(curve.oid)), ASN1.explicit(1, ASN1.bitString(point)),
        ])
        return ASN1.sequence([ASN1.integer(0), ASN1.algorithm(OID.ecPublicKey, ASN1.oid(curve.oid)), ASN1.octetString(ecPrivateKey.raw)]).raw
    }

    static func publicKey(of key: SecKey) throws -> SecKey {
        guard let publicKey = SecKeyCopyPublicKey(key) else { throw CryptoError.unsupported("no public key") }
        return publicKey
    }

    /// Generates a key pair. `secureEnclave` (P-256 only) makes the key non-exportable; it is then
    /// necessarily permanent and must be given `keychainTag`.
    static func generate(_ type: SigningKeyType, secureEnclave: Bool = false, keychainTag: Data? = nil,
                         accessControl: SecAccessControl? = nil, label: String? = nil, dataProtectionKeychain: Bool = true) throws -> SecKey {
        var privateAttributes: [CFString: Any] = [kSecAttrIsPermanent: keychainTag != nil]
        if let keychainTag { privateAttributes[kSecAttrApplicationTag] = keychainTag }
        if let accessControl { privateAttributes[kSecAttrAccessControl] = accessControl }
        if let label { privateAttributes[kSecAttrLabel] = label }
        var attributes: [CFString: Any] = [
            kSecAttrKeyType: type.isRSA ? kSecAttrKeyTypeRSA : kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits: type.bits,
            kSecPrivateKeyAttrs: privateAttributes,
        ]
        if keychainTag != nil && dataProtectionKeychain { attributes[kSecUseDataProtectionKeychain] = true }
        if secureEnclave {
            guard type == .ecP256 else { throw CryptoError.unsupported("Secure Enclave keys are P-256 only") }
            attributes[kSecAttrTokenID] = kSecAttrTokenIDSecureEnclave
        }
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            let cfError = error?.takeRetainedValue()
            throw CryptoError.security(OSStatus(CFErrorGetCode(cfError)), "generate key: \(cfError?.localizedDescription ?? "")")
        }
        return key
    }
}

/// A signature algorithm: padding/curve family plus hash.
struct SignatureAlgorithm: Equatable, Sendable {
    enum Kind: String, Codable, Sendable { case rsaPKCS1, rsaPSS, ecdsa }

    var kind: Kind
    var digest: DigestAlgorithm
    /// PSS salt length (defaults to the hash length, the only value Security.framework produces).
    var saltLength: Int? = nil

    var secKeyAlgorithm: SecKeyAlgorithm {
        switch (kind, digest) {
        case (.rsaPKCS1, .sha1): .rsaSignatureDigestPKCS1v15SHA1
        case (.rsaPKCS1, .sha256): .rsaSignatureDigestPKCS1v15SHA256
        case (.rsaPKCS1, .sha384): .rsaSignatureDigestPKCS1v15SHA384
        case (.rsaPKCS1, .sha512): .rsaSignatureDigestPKCS1v15SHA512
        case (.rsaPSS, .sha1): .rsaSignatureDigestPSSSHA1
        case (.rsaPSS, .sha256): .rsaSignatureDigestPSSSHA256
        case (.rsaPSS, .sha384): .rsaSignatureDigestPSSSHA384
        case (.rsaPSS, .sha512): .rsaSignatureDigestPSSSHA512
        case (.ecdsa, .sha1): .ecdsaSignatureDigestX962SHA1
        case (.ecdsa, .sha256): .ecdsaSignatureDigestX962SHA256
        case (.ecdsa, .sha384): .ecdsaSignatureDigestX962SHA384
        case (.ecdsa, .sha512): .ecdsaSignatureDigestX962SHA512
        }
    }

    /// AlgorithmIdentifier for X.509 `signatureAlgorithm` and CMS `signatureAlgorithm`.
    var algorithmIdentifier: ASN1Node {
        switch kind {
        case .rsaPKCS1:
            let oid: String = switch digest {
            case .sha1: OID.sha1WithRSA
            case .sha256: OID.sha256WithRSA
            case .sha384: OID.sha384WithRSA
            case .sha512: OID.sha512WithRSA
            }
            return ASN1.algorithm(oid, ASN1.null())
        case .ecdsa:
            let oid: String = switch digest {
            case .sha1: OID.ecdsaWithSHA1
            case .sha256: OID.ecdsaWithSHA256
            case .sha384: OID.ecdsaWithSHA384
            case .sha512: OID.ecdsaWithSHA512
            }
            return ASN1.algorithm(oid)
        case .rsaPSS:
            let hash = ASN1.algorithm(digest.oid, ASN1.null())
            return ASN1.algorithm(OID.rsassaPSS, ASN1.sequence([
                ASN1.explicit(0, hash),
                ASN1.explicit(1, ASN1.algorithm(OID.mgf1, hash)),
                ASN1.explicit(2, ASN1.integer(saltLength ?? digest.length)),
            ]))
        }
    }

    var displayName: String {
        switch kind {
        case .rsaPKCS1: "RSA PKCS#1 v1.5 / \(digest.displayName)"
        case .rsaPSS: "RSA-PSS / \(digest.displayName)"
        case .ecdsa: "ECDSA / \(digest.displayName)"
        }
    }

    /// Parses an AlgorithmIdentifier. `rsaEncryption` / `ecPublicKey` (common in CMS SignerInfos)
    /// need the SignerInfo's digest algorithm, passed as `digestHint`.
    init(identifier: ASN1Node, digestHint: DigestAlgorithm? = nil) throws {
        let oid = try identifier[0].oid
        func hinted() throws -> DigestAlgorithm {
            guard let digestHint else { throw CryptoError.unsupported("signature algorithm without digest") }
            return digestHint
        }
        switch oid {
        case OID.sha1WithRSA: self.init(kind: .rsaPKCS1, digest: .sha1)
        case OID.sha256WithRSA: self.init(kind: .rsaPKCS1, digest: .sha256)
        case OID.sha384WithRSA: self.init(kind: .rsaPKCS1, digest: .sha384)
        case OID.sha512WithRSA: self.init(kind: .rsaPKCS1, digest: .sha512)
        case OID.rsaEncryption: self.init(kind: .rsaPKCS1, digest: try hinted())
        case OID.ecdsaWithSHA1: self.init(kind: .ecdsa, digest: .sha1)
        case OID.ecdsaWithSHA256: self.init(kind: .ecdsa, digest: .sha256)
        case OID.ecdsaWithSHA384: self.init(kind: .ecdsa, digest: .sha384)
        case OID.ecdsaWithSHA512: self.init(kind: .ecdsa, digest: .sha512)
        case OID.ecPublicKey: self.init(kind: .ecdsa, digest: try hinted())
        case OID.rsassaPSS:
            // RSASSA-PSS-params: [0] hash (default SHA-1), [1] MGF1, [2] salt (default 20).
            var hash = DigestAlgorithm.sha1
            var salt = 20
            if identifier.children.count > 1 {
                let params = identifier.children[1]
                if let hashOID = try? params.context(0)?.children.first?[0].oid {
                    guard let parsed = DigestAlgorithm(oid: hashOID) else { throw CryptoError.unsupported("PSS hash \(hashOID)") }
                    hash = parsed
                }
                if let mgfHash = try? params.context(1)?.children.first?[1][0].oid, mgfHash != hash.oid {
                    throw CryptoError.unsupported("PSS with a different MGF1 hash")
                }
                if let value = try? params.context(2)?.children.first?.intValue { salt = value }
            }
            self.init(kind: .rsaPSS, digest: hash, saltLength: salt)
        case OID.md5WithRSA, OID.md5:
            throw CryptoError.unsupported("MD5 signatures")
        default:
            throw CryptoError.unsupported("signature algorithm \(OID.name(oid))")
        }
    }

    init(kind: Kind, digest: DigestAlgorithm, saltLength: Int? = nil) {
        self.kind = kind
        self.digest = digest
        self.saltLength = saltLength
    }

    /// Default algorithm for a key: PKCS#1 v1.5 (or PSS) for RSA, ECDSA for EC.
    static func `for`(_ key: KeyAlgorithm, digest: DigestAlgorithm = .sha256, pss: Bool = false) -> SignatureAlgorithm {
        key.isEC ? SignatureAlgorithm(kind: .ecdsa, digest: digest) : SignatureAlgorithm(kind: pss ? .rsaPSS : .rsaPKCS1, digest: digest)
    }

    /// Signs a precomputed digest.
    func sign(digest value: Data, with key: SecKey) throws -> Data {
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(key, secKeyAlgorithm, value as CFData, &error) as Data? else {
            let cfError = error?.takeRetainedValue()
            let code = cfError.map { CFErrorGetCode($0) } ?? -1
            // LAError.userCancel / errSecUserCanceled
            if code == -2 || code == Int(errSecUserCanceled) || code == -128 { throw CryptoError.authenticationCancelled }
            throw CryptoError.security(OSStatus(code), "sign: \(cfError?.localizedDescription ?? "")")
        }
        return signature
    }

    /// Verifies a signature over a precomputed digest.
    func verify(signature: Data, digest value: Data, publicKey: SecKey) -> Bool {
        if kind == .rsaPSS, let saltLength, saltLength != digest.length {
            // Security.framework only checks salt == hash length; verify other salts by hand.
            return RSAPSS.verify(signature: signature, digest: value, hash: digest, saltLength: saltLength, publicKey: publicKey)
        }
        var error: Unmanaged<CFError>?
        return SecKeyVerifySignature(publicKey, secKeyAlgorithm, value as CFData, signature as CFData, &error)
    }
}

/// EMSA-PSS verification (RFC 8017 §9.1.2) on top of the raw RSA public operation.
enum RSAPSS {
    static func verify(signature: Data, digest mHash: Data, hash: DigestAlgorithm, saltLength: Int, publicKey: SecKey) -> Bool {
        var error: Unmanaged<CFError>?
        guard let em = SecKeyCreateEncryptedData(publicKey, .rsaEncryptionRaw, signature as CFData, &error) as Data?,
              let info = try? PublicKeyInfo(secKey: publicKey), case .rsa(let modBits) = info.algorithm else { return false }
        let emBits = modBits - 1
        let emLen = (emBits + 7) / 8
        let bytes = [UInt8](em.suffix(emLen))
        let hLen = hash.length
        guard bytes.count == emLen, emLen >= hLen + saltLength + 2, bytes.last == 0xBC else { return false }
        let maskedDB = Array(bytes[0..<(emLen - hLen - 1)])
        let h = Data(bytes[(emLen - hLen - 1)..<(emLen - 1)])
        let zeroBits = 8 * emLen - emBits
        if zeroBits > 0, maskedDB[0] & ~(0xFF >> UInt8(zeroBits)) != 0 { return false }
        let mask = [UInt8](mgf1(seed: h, length: maskedDB.count, hash: hash))
        var db = zip(maskedDB, mask).map { $0 ^ $1 }
        if zeroBits > 0 { db[0] &= 0xFF >> UInt8(zeroBits) }
        let psLength = emLen - hLen - saltLength - 2
        guard db[0..<psLength].allSatisfy({ $0 == 0 }), db[psLength] == 0x01 else { return false }
        let salt = Data(db.suffix(saltLength))
        let mPrime = Data(count: 8) + mHash + salt
        return hash.hash(mPrime) == h
    }

    static func mgf1(seed: Data, length: Int, hash: DigestAlgorithm) -> Data {
        var output = Data()
        var counter: UInt32 = 0
        while output.count < length {
            var c = counter.bigEndian
            output.append(hash.hash(seed + Data(bytes: &c, count: 4)))
            counter += 1
        }
        return output.prefix(length).cryptoDetached
    }
}
