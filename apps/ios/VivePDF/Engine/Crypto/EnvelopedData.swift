import Foundation
import Security

/// CMS EnvelopedData (RFC 5652 §6) with RSA key transport — the building block of PDF
/// public-key security (/Adobe.PubSec).
enum CMSEnvelope {
    enum KeyTransport: String, Codable, Sendable {
        case rsaPKCS1v15
        /// RSAES-OAEP with SHA-256 (and MGF1-SHA-256).
        case rsaOAEPSHA256
        /// RSAES-OAEP with default SHA-1 parameters.
        case rsaOAEPSHA1
    }

    /// Encrypts `content` for every recipient (AES-256-CBC content encryption, like pyHanko).
    static func encrypt(_ content: Data, recipients: [X509Certificate], keyTransport: KeyTransport = .rsaPKCS1v15) throws -> Data {
        guard !recipients.isEmpty else { throw CryptoError.invalid(reason: "noCertificates") }
        let contentKey = KeyDerivation.randomBytes(32)
        let iv = KeyDerivation.randomBytes(16)
        let ciphertext = try SymmetricCipher.aesCBC(keyBytes: 32).encrypt(content, key: contentKey, iv: iv)
        let recipientInfos = try recipients.map { try recipientInfo(for: $0, contentKey: contentKey, keyTransport: keyTransport) }
        let enveloped = ASN1.sequence([
            ASN1.integer(0),
            ASN1.set(recipientInfos),
            ASN1.sequence([
                ASN1.oid(OID.data),
                ASN1.algorithm(OID.aes256CBC, ASN1.octetString(iv)),
                ASN1.implicitPrimitive(0, ciphertext),
            ]),
        ])
        return ASN1.sequence([ASN1.oid(OID.envelopedData), ASN1.explicit(0, enveloped)]).raw
    }

    private static func recipientInfo(for certificate: X509Certificate, contentKey: Data, keyTransport: KeyTransport) throws -> ASN1Node {
        guard certificate.publicKey.algorithm.isRSA else { throw CryptoError.invalid(reason: "encryptionNeedsRsa") }
        let key = try certificate.publicKey.secKey()
        let algorithm: SecKeyAlgorithm
        let identifier: ASN1Node
        switch keyTransport {
        case .rsaPKCS1v15:
            algorithm = .rsaEncryptionPKCS1
            identifier = ASN1.algorithm(OID.rsaEncryption, ASN1.null())
        case .rsaOAEPSHA1:
            algorithm = .rsaEncryptionOAEPSHA1
            identifier = ASN1.algorithm(OID.rsaesOAEP, ASN1.sequence([]))
        case .rsaOAEPSHA256:
            algorithm = .rsaEncryptionOAEPSHA256
            let hash = ASN1.algorithm(OID.sha256, ASN1.null())
            identifier = ASN1.algorithm(OID.rsaesOAEP, ASN1.sequence([ASN1.explicit(0, hash), ASN1.explicit(1, ASN1.algorithm(OID.mgf1, hash))]))
        }
        var error: Unmanaged<CFError>?
        guard let encryptedKey = SecKeyCreateEncryptedData(key, algorithm, contentKey as CFData, &error) as Data? else {
            throw CryptoError.security(-1, "encrypt key: \(error?.takeRetainedValue().localizedDescription ?? "")")
        }
        return ASN1.sequence([
            ASN1.integer(0),
            ASN1.sequence([try ASN1.raw(certificate.issuer.der), ASN1.integer(raw: certificate.serialNumber)]),
            identifier,
            ASN1.octetString(encryptedKey),
        ])
    }

    /// Whether one of the KeyTransRecipientInfos addresses `certificate`.
    static func isAddressed(to certificate: X509Certificate, envelope: Data) -> Bool {
        (try? recipientInfos(envelope))?.contains { matches($0, certificate) } ?? false
    }

    /// Decrypts an EnvelopedData with the identity's private key. Returns nil when the envelope is not
    /// addressed to this identity.
    static func decrypt(_ envelope: Data, identity: SigningIdentity) throws -> Data? {
        let node = try ASN1.parse(envelope)
        guard (try? node[0].oid) == OID.envelopedData, let enveloped = node.context(0)?.children.first else {
            throw CryptoError.malformed("not a CMS EnvelopedData")
        }
        var fields = enveloped.children.dropFirst() // version
        if let first = fields.first, first.isContext(0) { fields = fields.dropFirst() } // originatorInfo
        guard let infos = fields.popFirst(), let encryptedContentInfo = fields.popFirst() else { throw CryptoError.malformed("short EnvelopedData") }
        guard let info = infos.children.first(where: { matches($0, identity.certificate) }) else { return nil }

        let transportOID = try info[2][0].oid
        let algorithm: SecKeyAlgorithm
        switch transportOID {
        case OID.rsaEncryption:
            algorithm = .rsaEncryptionPKCS1
        case OID.rsaesOAEP:
            let params = info.children[2].children.count > 1 ? info.children[2].children[1] : nil
            let hashOID = (try? params?.context(0)?.children.first?[0].oid) ?? OID.sha1
            switch hashOID {
            case OID.sha1: algorithm = .rsaEncryptionOAEPSHA1
            case OID.sha256: algorithm = .rsaEncryptionOAEPSHA256
            case OID.sha384: algorithm = .rsaEncryptionOAEPSHA384
            case OID.sha512: algorithm = .rsaEncryptionOAEPSHA512
            default: throw CryptoError.unsupported("OAEP hash \(hashOID)")
            }
        default:
            throw CryptoError.unsupported("key transport \(OID.name(transportOID))")
        }
        var error: Unmanaged<CFError>?
        guard let contentKey = SecKeyCreateDecryptedData(identity.privateKey, algorithm, try info[3].octets as CFData, &error) as Data? else {
            let code = error.map { CFErrorGetCode($0.takeRetainedValue()) } ?? -1
            if code == -2 || code == Int(errSecUserCanceled) || code == -128 { throw CryptoError.authenticationCancelled }
            throw CryptoError.invalid(reason: "certificateMismatch")
        }

        let contentAlgorithm = try encryptedContentInfo[1]
        let cipherOID = try contentAlgorithm[0].oid
        guard let payload = encryptedContentInfo.context(0) else { throw CryptoError.malformed("no encrypted content") }
        let ciphertext = payload.constructed ? Data(try payload.children.map { try $0.octets }.joined()) : payload.value
        var cipher: SymmetricCipher
        var iv: Data?
        switch cipherOID {
        case OID.rc4:
            cipher = .rc4(keyBytes: contentKey.count)
        case OID.rc2CBC:
            cipher = .rc2CBC(keyBytes: contentKey.count)
            let params = try contentAlgorithm[1]
            iv = params.isSequence ? try params.children.last?.octets : try params.octets
        default:
            guard let parsed = SymmetricCipher(oid: cipherOID) else { throw CryptoError.unsupported("cipher \(cipherOID)") }
            cipher = parsed
            iv = try contentAlgorithm[1].octets
        }
        guard contentKey.count == cipher.keyLength else { throw CryptoError.malformed("content key length") }
        return try cipher.decrypt(ciphertext, key: contentKey, iv: iv)
    }

    private static func recipientInfos(_ envelope: Data) throws -> [ASN1Node] {
        let node = try ASN1.parse(envelope)
        guard let enveloped = node.context(0)?.children.first else { return [] }
        return enveloped.children.first(where: \.isSet)?.children ?? []
    }

    private static func matches(_ info: ASN1Node, _ certificate: X509Certificate) -> Bool {
        guard info.isSequence, let rid = info.children.dropFirst().first else { return false }
        if rid.isContext(0) { return rid.value == certificate.subjectKeyIdentifier || rid.value == certificate.publicKeyHash }
        guard let issuer = try? DistinguishedName(node: rid[0]), let serial = try? rid[1].integerBytes else { return false }
        return issuer == certificate.issuer && CMSSignedData.SignerInfo.sameSerial(serial, certificate.serialNumber)
    }
}

/// PDF public-key (certificate) security, ISO 32000-2 §7.6.5: /Filter /Adobe.PubSec with
/// SubFilter adbe.pkcs7.s5 (crypt filters, AES) or adbe.pkcs7.s4.
///
/// The Crypto engine produces the /Recipients strings and the file key; PDFCore writes the /Encrypt
/// dictionary and encrypts objects with the key (AESV3 for AES-256, AESV2 for AES-128).
enum PubSec {
    enum Algorithm: String, Codable, Sendable {
        /// V 5, CFM /AESV3, 256-bit key from SHA-256.
        case aes256
        /// V 4, CFM /AESV2, 128-bit key from SHA-1.
        case aes128

        var keyLength: Int { self == .aes256 ? 32 : 16 }
        var version: Int { self == .aes256 ? 5 : 4 }
        var cryptFilterMethod: String { self == .aes256 ? "AESV3" : "AESV2" }
    }

    /// Public-key permission bits (ISO 32000-2 Table 24 / pyHanko `PubKeyPermissions`).
    struct Permissions: OptionSet, Codable, Hashable, Sendable {
        let rawValue: UInt32
        init(rawValue: UInt32) { self.rawValue = rawValue }
        static let changeEncryption = Permissions(rawValue: 2)
        static let print = Permissions(rawValue: 4)
        static let modify = Permissions(rawValue: 8)
        static let copy = Permissions(rawValue: 16)
        static let annotate = Permissions(rawValue: 32)
        static let fillForms = Permissions(rawValue: 256)
        static let accessibility = Permissions(rawValue: 512)
        static let assemble = Permissions(rawValue: 1024)
        static let printHighQuality = Permissions(rawValue: 2048)
        /// ISO 32004: readers may accept the file without a PDF MAC. Keep it set unless a MAC is written.
        static let tolerateMissingMAC = Permissions(rawValue: 4096)
        static let all: Permissions = [.changeEncryption, .print, .modify, .copy, .annotate, .fillForms, .accessibility,
                                       .assemble, .printHighQuality, .tolerateMissingMAC]

        /// Value stored in the envelope: reserved bits forced on as Acrobat expects (0xFFFFE0C1).
        var wireValue: UInt32 { rawValue | 0xFFFF_E0C1 }

        /// Big-endian 4 bytes appended to the seed.
        var wireBytes: Data { withUnsafeBytes(of: wireValue.bigEndian) { Data($0) } }

        init(wire: Data) {
            let value = wire.prefix(4).reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
            self.init(rawValue: value & Permissions.all.rawValue)
        }
    }

    /// Everything PDFCore needs to write an /Adobe.PubSec /Encrypt dictionary.
    struct Encryption: Sendable {
        let algorithm: Algorithm
        /// DER EnvelopedData blobs for the /Recipients array (write as PDF hex strings).
        let recipients: [Data]
        /// File encryption key for the object ciphers.
        let fileKey: Data
        let encryptMetadata: Bool
        let permissions: Permissions
        /// adbe.pkcs7.s5 (recipients inside /CF /DefaultCryptFilter) or s4 (recipients at the top level).
        let subFilter: String

        /// The /Encrypt dictionary as PDF syntax, for writers that accept raw object text.
        var dictionarySource: String {
            let recipientsArray = "[" + recipients.map { "<\($0.cryptoHex)>" }.joined(separator: " ") + "]"
            let metadata = encryptMetadata ? "true" : "false"
            if subFilter == "adbe.pkcs7.s4" {
                return "<< /Filter /Adobe.PubSec /SubFilter /adbe.pkcs7.s4 /V \(algorithm.version) /Length \(algorithm.keyLength * 8) /Recipients \(recipientsArray) /EncryptMetadata \(metadata) >>"
            }
            return "<< /Filter /Adobe.PubSec /SubFilter /adbe.pkcs7.s5 /V \(algorithm.version) /Length \(algorithm.keyLength * 8)"
                + " /CF << /DefaultCryptFilter << /Type /CryptFilter /CFM /\(algorithm.cryptFilterMethod) /AuthEvent /DocOpen"
                + " /Length \(algorithm.keyLength * 8) /Recipients \(recipientsArray) /EncryptMetadata \(metadata) >> >>"
                + " /StmF /DefaultCryptFilter /StrF /DefaultCryptFilter /EncryptMetadata \(metadata) >>"
        }
    }

    /// Checks recipient certificates like the desktop `load_recipients`: RSA and keyEncipherment.
    static func validateRecipient(_ certificate: X509Certificate) throws {
        guard certificate.publicKey.algorithm.isRSA else { throw CryptoError.invalid(reason: "encryptionNeedsRsa") }
        guard certificate.allowsKeyEncipherment else { throw CryptoError.invalid(reason: "certificateUsage") }
    }

    /// Creates the recipient envelopes (one envelope listing all recipients) and derives the file key.
    static func encrypt(recipients: [X509Certificate], algorithm: Algorithm = .aes256, permissions: Permissions = .all,
                        encryptMetadata: Bool = true, keyTransport: CMSEnvelope.KeyTransport = .rsaPKCS1v15,
                        subFilter: String = "adbe.pkcs7.s5") throws -> Encryption {
        guard !recipients.isEmpty else { throw CryptoError.invalid(reason: "noCertificates") }
        for certificate in recipients { try validateRecipient(certificate) }
        let seed = KeyDerivation.randomBytes(20)
        let envelope = try CMSEnvelope.encrypt(seed + permissions.wireBytes, recipients: recipients, keyTransport: keyTransport)
        let key = fileKey(seed: seed, recipients: [envelope], algorithm: algorithm, encryptMetadata: encryptMetadata)
        return Encryption(algorithm: algorithm, recipients: [envelope], fileKey: key, encryptMetadata: encryptMetadata,
                          permissions: permissions, subFilter: subFilter)
    }

    /// File key: hash(seed ‖ every /Recipients string ‖ [FF FF FF FF if metadata is not encrypted]),
    /// SHA-256 for AES-256, SHA-1 for AES-128 / RC4, truncated to the key length.
    static func fileKey(seed: Data, recipients: [Data], algorithm: Algorithm, encryptMetadata: Bool) -> Data {
        let digest: DigestAlgorithm = algorithm == .aes256 ? .sha256 : .sha1
        var parts = [seed] + recipients
        if !encryptMetadata { parts.append(Data([0xFF, 0xFF, 0xFF, 0xFF])) }
        return digest.hash(parts).prefix(algorithm.keyLength).cryptoDetached
    }

    /// Recovers the file key from /Recipients with the holder's identity (desktop `decrypt_certificate`).
    /// Throws `certificateMismatch` when no envelope is addressed to this certificate.
    static func recoverFileKey(recipients: [Data], identity: SigningIdentity, algorithm: Algorithm,
                               encryptMetadata: Bool = true) throws -> (fileKey: Data, permissions: Permissions?) {
        for envelope in recipients where CMSEnvelope.isAddressed(to: identity.certificate, envelope: envelope) {
            guard let content = try CMSEnvelope.decrypt(envelope, identity: identity), content.count >= 20 else { continue }
            let seed = content.prefix(20).cryptoDetached
            let permissions = content.count >= 24 ? Permissions(wire: content.dropFirst(20).cryptoDetached) : nil
            return (fileKey(seed: seed, recipients: recipients, algorithm: algorithm, encryptMetadata: encryptMetadata), permissions)
        }
        throw CryptoError.invalid(reason: "certificateMismatch")
    }
}
