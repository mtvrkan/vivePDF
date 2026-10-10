import Foundation
import Security

/// PKCS#12 (.p12 / .pfx) reading and writing (RFC 7292), independent of the Keychain.
enum PKCS12 {
    /// Contents of a decoded key file.
    struct Contents: @unchecked Sendable {
        var privateKey: SecKey?
        /// PKCS#8 DER of the key, kept so it can be re-exported without touching the Keychain.
        var privateKeyPKCS8: Data?
        var certificates: [X509Certificate]
        var friendlyName: String?

        /// Certificate matching the key (via localKeyID or public key), else the first non-CA certificate.
        var leaf: X509Certificate?

        func identity() throws -> SigningIdentity {
            guard let privateKey, let leaf else { throw CryptoError.noPrivateKey }
            return SigningIdentity(privateKey: privateKey, certificate: leaf, chain: SigningIdentity.buildChain(for: leaf, from: certificates))
        }
    }

    /// Encryption profile for export.
    enum Profile: String, Codable, CaseIterable, Sendable {
        /// PBES2 / PBKDF2-HMAC-SHA256 / AES-256-CBC, HMAC-SHA256 MAC (OpenSSL 3 default).
        case modern
        /// pbeWithSHAAnd3-KeyTripleDES-CBC for key and certificates, HMAC-SHA1 MAC (Windows XP-era readers).
        case legacy
    }

    // MARK: Reading

    /// Decodes a key file. An empty password is tried both as an empty BMPString and as an absent
    /// password, like the desktop's `_passphrases`.
    static func decode(_ data: Data, password: String) throws -> Contents {
        let pfx: ASN1Node
        do { pfx = try ASN1.parse(data) } catch { throw CryptoError.noPrivateKey }
        guard pfx.isSequence, pfx.children.count >= 2, (try? pfx[0].intValue) == 3 else { throw CryptoError.noPrivateKey }
        let authSafe = try pfx[1]
        guard (try? authSafe[0].oid) == OID.data, let content = authSafe.context(0)?.children.first else {
            throw CryptoError.unsupported("public-key protected PKCS#12")
        }
        let authenticatedSafe = try content.octets
        let candidates: [(String, Bool)] = password.isEmpty ? [("", false), ("", true)] : [(password, false)]
        var lastError: Error = CryptoError.wrongPassword
        for (candidate, nullPassword) in candidates {
            do {
                if pfx.children.count > 2 { try verifyMAC(pfx.children[2], data: authenticatedSafe, password: candidate, nullPassword: nullPassword) }
                return try decodeSafes(authenticatedSafe, password: candidate, nullPassword: nullPassword)
            } catch let error as CryptoError where error == .wrongPassword {
                lastError = error
            }
        }
        throw lastError
    }

    private static func verifyMAC(_ macData: ASN1Node, data: Data, password: String, nullPassword: Bool) throws {
        let digestInfo = try macData[0]
        let algorithmOID = try digestInfo[0][0].oid
        if algorithmOID == OID.pbmac1 { throw CryptoError.unsupported("PBMAC1") }
        guard let digest = DigestAlgorithm(oid: algorithmOID) else { throw CryptoError.legacyCipher }
        let expected = try digestInfo[1].octets
        let salt = try macData[1].octets
        let iterations = macData.children.count > 2 ? try macData[2].intValue : 1
        let key = KeyDerivation.pkcs12KDF(password: KeyDerivation.pkcs12Password(password, nullPassword: nullPassword),
                                          salt: salt, id: 3, iterations: iterations, length: digest.length, digest: digest)
        guard digest.hmac(key: key, data: data) == expected else { throw CryptoError.wrongPassword }
    }

    private static func decodeSafes(_ authenticatedSafe: Data, password: String, nullPassword: Bool) throws -> Contents {
        let safes = try ASN1.parse(authenticatedSafe)
        var contents = Contents(certificates: [])
        var keyID: Data?
        var certificateIDs: [X509Certificate: Data] = [:]
        for info in safes.children {
            let type = try info[0].oid
            let safeContents: Data
            switch type {
            case OID.data:
                guard let inner = info.context(0)?.children.first else { continue }
                safeContents = try inner.octets
            case OID.encryptedData:
                guard let encrypted = info.context(0)?.children.first else { continue }
                let encryptedContentInfo = try encrypted[1]
                let algorithm = try encryptedContentInfo[1]
                guard let payload = encryptedContentInfo.context(0) else { continue }
                let ciphertext = payload.constructed ? try payload.children.map { try $0.octets }.reduce(Data(), +) : payload.value
                safeContents = try decryptPBE(algorithm: algorithm, data: ciphertext, password: password, nullPassword: nullPassword)
            default:
                continue
            }
            let bags: ASN1Node
            do { bags = try ASN1.parse(safeContents) } catch { throw CryptoError.wrongPassword }
            try collectBags(bags, into: &contents, keyID: &keyID, certificateIDs: &certificateIDs, password: password, nullPassword: nullPassword)
        }
        // Pick the certificate belonging to the key.
        if let keyID, let match = certificateIDs.first(where: { $0.value == keyID })?.key {
            contents.leaf = match
        } else if let key = contents.privateKey, let publicKey = SecKeyCopyPublicKey(key), let spki = try? PublicKeyInfo(secKey: publicKey) {
            contents.leaf = contents.certificates.first { $0.publicKey.keyBytes == spki.keyBytes }
        }
        if contents.leaf == nil { contents.leaf = contents.certificates.first { !$0.isCA } ?? contents.certificates.first }
        return contents
    }

    private static func collectBags(_ bags: ASN1Node, into contents: inout Contents, keyID: inout Data?,
                                    certificateIDs: inout [X509Certificate: Data], password: String, nullPassword: Bool) throws {
        for bag in bags.children {
            let bagID = try bag[0].oid
            guard let value = bag.context(0)?.children.first else { continue }
            var localID: Data?
            var friendly: String?
            if bag.children.count > 2, bag.children[2].isSet {
                for attribute in bag.children[2].children {
                    let oid = try attribute[0].oid
                    guard let first = try? attribute[1].children.first else { continue }
                    if oid == OID.localKeyID { localID = try? first.octets }
                    if oid == OID.friendlyName { friendly = try? first.stringValue }
                }
            }
            switch bagID {
            case OID.keyBag, OID.pkcs8ShroudedKeyBag:
                guard contents.privateKey == nil else { continue }
                var pkcs8 = value.raw
                if bagID == OID.pkcs8ShroudedKeyBag {
                    pkcs8 = try decryptPBE(algorithm: try value[0], data: try value[1].octets, password: password, nullPassword: nullPassword)
                }
                do {
                    contents.privateKey = try PrivateKeys.secKey(pkcs8: pkcs8)
                } catch let error as CryptoError {
                    if case .unsupported = error { throw error }
                    throw CryptoError.wrongPassword
                }
                contents.privateKeyPKCS8 = pkcs8
                keyID = localID
                if contents.friendlyName == nil { contents.friendlyName = friendly }
            case OID.certBag:
                guard (try? value[0].oid) == OID.x509CertificateBag, let holder = value.context(0)?.children.first else { continue }
                let certificate = try X509Certificate(der: try holder.octets)
                if !contents.certificates.contains(certificate) { contents.certificates.append(certificate) }
                if let localID { certificateIDs[certificate] = localID }
                if contents.friendlyName == nil, localID != nil { contents.friendlyName = friendly }
            case OID.safeContentsBag:
                try collectBags(value, into: &contents, keyID: &keyID, certificateIDs: &certificateIDs, password: password, nullPassword: nullPassword)
            default:
                continue
            }
        }
    }

    /// Decrypts PBES2 or PKCS#12 PBE (SHA-1 + 3DES/RC2/RC4) data.
    static func decryptPBE(algorithm: ASN1Node, data: Data, password: String, nullPassword: Bool = false) throws -> Data {
        let oid = try algorithm[0].oid
        let params = try algorithm[1]
        if oid == OID.pbes2 {
            let kdf = try params[0]
            guard try kdf[0].oid == OID.pbkdf2 else { throw CryptoError.legacyCipher }
            let kdfParams = try kdf[1]
            let salt = try kdfParams[0].octets
            let iterations = try kdfParams[1].intValue
            var prf = DigestAlgorithm.sha1
            var keyLength: Int?
            for extra in kdfParams.children.dropFirst(2) {
                if extra.isUniversal(ASN1Node.Universal.integer) { keyLength = try extra.intValue }
                if extra.isSequence {
                    guard let parsed = DigestAlgorithm(hmacOID: try extra[0].oid) else { throw CryptoError.legacyCipher }
                    prf = parsed
                }
            }
            let scheme = try params[1]
            guard let cipher = SymmetricCipher(oid: try scheme[0].oid) else { throw CryptoError.legacyCipher }
            let iv = try scheme[1].octets
            let key = try KeyDerivation.pbkdf2(password: Data(password.utf8), salt: salt, iterations: iterations,
                                               keyLength: keyLength ?? cipher.keyLength, prf: prf)
            return try cipher.decrypt(data, key: key, iv: iv)
        }
        let cipher: SymmetricCipher
        switch oid {
        case OID.pbeSHA1TripleDES: cipher = .tripleDESCBC
        case OID.pbeSHA1TwoKeyTripleDES: cipher = .tripleDESCBC
        case OID.pbeSHA1RC2_40: cipher = .rc2CBC(keyBytes: 5)
        case OID.pbeSHA1RC2_128: cipher = .rc2CBC(keyBytes: 16)
        case OID.pbeSHA1RC4_40: cipher = .rc4(keyBytes: 5)
        case OID.pbeSHA1RC4_128: cipher = .rc4(keyBytes: 16)
        default: throw CryptoError.legacyCipher
        }
        let salt = try params[0].octets
        let iterations = try params[1].intValue
        let passwordBytes = KeyDerivation.pkcs12Password(password, nullPassword: nullPassword)
        var key = KeyDerivation.pkcs12KDF(password: passwordBytes, salt: salt, id: 1, iterations: iterations,
                                          length: oid == OID.pbeSHA1TwoKeyTripleDES ? 16 : cipher.keyLength, digest: .sha1)
        if oid == OID.pbeSHA1TwoKeyTripleDES { key += key.prefix(8) }
        let iv: Data? = cipher.blockSize > 1
            ? KeyDerivation.pkcs12KDF(password: passwordBytes, salt: salt, id: 2, iterations: iterations, length: cipher.blockSize, digest: .sha1)
            : nil
        return try cipher.decrypt(data, key: key, iv: iv)
    }

    /// Imports through Security.framework (handles anything Apple supports, returns a SecIdentity).
    static func importWithSecurity(_ data: Data, password: String) throws -> SigningIdentity {
        var items: CFArray?
        let status = SecPKCS12Import(data as CFData, [kSecImportExportPassphrase: password] as CFDictionary, &items)
        switch status {
        case errSecSuccess: break
        case errSecAuthFailed, errSecPkcs12VerifyFailure: throw CryptoError.wrongPassword
        case errSecDecode, errSecUnknownFormat: throw CryptoError.noPrivateKey
        default: throw CryptoError.security(status, "SecPKCS12Import")
        }
        guard let list = items as? [[String: Any]], let first = list.first,
              let identityRef = first[kSecImportItemIdentity as String] else { throw CryptoError.noPrivateKey }
        let identity = identityRef as! SecIdentity
        let chain = (first[kSecImportItemCertChain as String] as? [SecCertificate]) ?? []
        return try SigningIdentity(secIdentity: identity, chain: chain)
    }

    /// Opens a key file: own decoder first (keeps the PKCS#8 for re-export), Security.framework as fallback.
    /// Errors map to the desktop reasons certificatePassword / keyFileFormat / certificateLegacy.
    static func loadIdentity(_ data: Data, password: String) throws -> (identity: SigningIdentity, contents: Contents?) {
        do {
            let contents = try decode(data, password: password)
            return (try contents.identity(), contents)
        } catch let error as CryptoError {
            switch error {
            case .wrongPassword, .noPrivateKey: throw error
            default:
                if let identity = try? importWithSecurity(data, password: password) { return (identity, nil) }
                throw error
            }
        }
    }

    // MARK: Writing

    /// Builds a password-protected .p12 containing the key, its certificate and chain.
    static func export(identity: SigningIdentity, password: String, friendlyName: String? = nil,
                       profile: Profile = .modern, iterations: Int? = nil) throws -> Data {
        let pkcs8 = try PrivateKeys.pkcs8(identity.privateKey)
        return try export(privateKeyPKCS8: pkcs8, certificate: identity.certificate, chain: identity.chain,
                          password: password, friendlyName: friendlyName ?? identity.label, profile: profile, iterations: iterations)
    }

    static func export(privateKeyPKCS8: Data, certificate: X509Certificate, chain: [X509Certificate], password: String,
                       friendlyName: String?, profile: Profile = .modern, iterations: Int? = nil) throws -> Data {
        let rounds = iterations ?? (profile == .modern ? 10_000 : 2048)
        let localKeyID = DigestAlgorithm.sha1.hash(certificate.der)
        func attributes(_ withID: Bool) -> [ASN1Node] {
            var list: [ASN1Node] = []
            if let friendlyName { list.append(ASN1.sequence([ASN1.oid(OID.friendlyName), ASN1.set([ASN1.bmpString(friendlyName)])])) }
            if withID { list.append(ASN1.sequence([ASN1.oid(OID.localKeyID), ASN1.set([ASN1.octetString(localKeyID)])])) }
            return list
        }
        func certBag(_ cert: X509Certificate, leaf: Bool) -> ASN1Node {
            let value = ASN1.sequence([ASN1.oid(OID.x509CertificateBag), ASN1.explicit(0, ASN1.octetString(cert.der))])
            let attrs = leaf ? attributes(true) : []
            return ASN1.sequence([ASN1.oid(OID.certBag), ASN1.explicit(0, value)] + (attrs.isEmpty ? [] : [ASN1.set(attrs, sort: false)]))
        }
        let certificateSafe = ASN1.sequence([certBag(certificate, leaf: true)] + chain.map { certBag($0, leaf: false) })
        let (keyAlgorithm, encryptedKey) = try encryptPBE(privateKeyPKCS8, password: password, profile: profile, iterations: rounds)
        let shroudedKey = ASN1.sequence([keyAlgorithm, ASN1.octetString(encryptedKey)])
        let keySafe = ASN1.sequence([ASN1.sequence([ASN1.oid(OID.pkcs8ShroudedKeyBag), ASN1.explicit(0, shroudedKey), ASN1.set(attributes(true), sort: false)])])

        let (certAlgorithm, encryptedCerts) = try encryptPBE(certificateSafe.raw, password: password, profile: profile, iterations: rounds)
        let encryptedData = ASN1.sequence([
            ASN1.integer(0),
            ASN1.sequence([ASN1.oid(OID.data), certAlgorithm, ASN1.implicitPrimitive(0, encryptedCerts)]),
        ])
        let authenticatedSafe = ASN1.sequence([
            ASN1.sequence([ASN1.oid(OID.encryptedData), ASN1.explicit(0, encryptedData)]),
            ASN1.sequence([ASN1.oid(OID.data), ASN1.explicit(0, ASN1.octetString(keySafe.raw))]),
        ])
        let macDigest: DigestAlgorithm = profile == .modern ? .sha256 : .sha1
        let macSalt = KeyDerivation.randomBytes(profile == .modern ? 16 : 8)
        let macKey = KeyDerivation.pkcs12KDF(password: KeyDerivation.pkcs12Password(password), salt: macSalt, id: 3,
                                             iterations: rounds, length: macDigest.length, digest: macDigest)
        let mac = macDigest.hmac(key: macKey, data: authenticatedSafe.raw)
        let pfx = ASN1.sequence([
            ASN1.integer(3),
            ASN1.sequence([ASN1.oid(OID.data), ASN1.explicit(0, ASN1.octetString(authenticatedSafe.raw))]),
            ASN1.sequence([
                ASN1.sequence([ASN1.algorithm(macDigest.oid, ASN1.null()), ASN1.octetString(mac)]),
                ASN1.octetString(macSalt),
                ASN1.integer(rounds),
            ]),
        ])
        return pfx.raw
    }

    private static func encryptPBE(_ data: Data, password: String, profile: Profile, iterations: Int) throws -> (ASN1Node, Data) {
        switch profile {
        case .modern:
            let salt = KeyDerivation.randomBytes(16)
            let iv = KeyDerivation.randomBytes(16)
            let key = try KeyDerivation.pbkdf2(password: Data(password.utf8), salt: salt, iterations: iterations, keyLength: 32, prf: .sha256)
            let ciphertext = try SymmetricCipher.aesCBC(keyBytes: 32).encrypt(data, key: key, iv: iv)
            let algorithm = ASN1.algorithm(OID.pbes2, ASN1.sequence([
                ASN1.algorithm(OID.pbkdf2, ASN1.sequence([
                    ASN1.octetString(salt), ASN1.integer(iterations), ASN1.algorithm(OID.hmacWithSHA256, ASN1.null()),
                ])),
                ASN1.algorithm(OID.aes256CBC, ASN1.octetString(iv)),
            ]))
            return (algorithm, ciphertext)
        case .legacy:
            let salt = KeyDerivation.randomBytes(8)
            let passwordBytes = KeyDerivation.pkcs12Password(password)
            let key = KeyDerivation.pkcs12KDF(password: passwordBytes, salt: salt, id: 1, iterations: iterations, length: 24, digest: .sha1)
            let iv = KeyDerivation.pkcs12KDF(password: passwordBytes, salt: salt, id: 2, iterations: iterations, length: 8, digest: .sha1)
            let ciphertext = try SymmetricCipher.tripleDESCBC.encrypt(data, key: key, iv: iv)
            return (ASN1.algorithm(OID.pbeSHA1TripleDES, ASN1.sequence([ASN1.octetString(salt), ASN1.integer(iterations)])), ciphertext)
        }
    }
}
