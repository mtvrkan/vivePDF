import Security
import XCTest
@testable import vivePDF

final class CryptoTests: XCTestCase {
    // MARK: ASN.1

    func testASN1RoundTrip() throws {
        let node = ASN1.sequence([
            ASN1.integer(0), ASN1.integer(127), ASN1.integer(128), ASN1.integer(-129), ASN1.integer(65_537),
            ASN1.oid(OID.sha256), ASN1.utf8String("Ayşe"), ASN1.bmpString("Ğü"), ASN1.boolean(true), ASN1.null(),
            ASN1.explicit(3, ASN1.octetString(Data([1, 2, 3]))), ASN1.octetString(Data(count: 300)),
        ])
        let parsed = try ASN1.parse(node.raw)
        XCTAssertEqual(parsed.children.count, 12)
        XCTAssertEqual(try parsed[0].intValue, 0)
        XCTAssertEqual(try parsed[2].intValue, 128)
        XCTAssertEqual(try parsed[3].intValue, -129)
        XCTAssertEqual(try parsed[4].intValue, 65_537)
        XCTAssertEqual(try parsed[5].oid, OID.sha256)
        XCTAssertEqual(try parsed[6].stringValue, "Ayşe")
        XCTAssertEqual(try parsed[7].stringValue, "Ğü")
        XCTAssertTrue(try parsed[8].boolValue)
        XCTAssertEqual(try parsed[10].context(3) == nil ? Data() : parsed[10][0].octets, Data([1, 2, 3]))
        XCTAssertEqual(try parsed[11].octets.count, 300)
        XCTAssertEqual(parsed.derEncoded(), node.raw)
        XCTAssertEqual(ASN1.encodeOID("1.2.840.113549.1.1.11").cryptoHex, "2a864886f70d01010b")
        XCTAssertEqual(try ASN1.decodeOID(Data(cryptoHex: "2a864886f70d01010b")!), "1.2.840.113549.1.1.11")
    }

    func testASN1IndefiniteLengthAndPadding() throws {
        // SEQUENCE (indefinite) { INTEGER 5 } EOC, followed by PDF-style zero padding.
        let ber = Data([0x30, 0x80, 0x02, 0x01, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00])
        let node = try ASN1.parse(ber)
        XCTAssertEqual(try node[0].intValue, 5)
        XCTAssertEqual(node.derEncoded(), Data([0x30, 0x03, 0x02, 0x01, 0x05]))
        XCTAssertThrowsError(try ASN1.parse(Data([0x30, 0x05, 0x02])))
    }

    func testTimeParsing() throws {
        let utc = try ASN1.parseTime("491231235959Z", generalized: false)
        let generalized = try ASN1.parseTime("20491231235959Z", generalized: true)
        XCTAssertEqual(utc, generalized)
        let offset = try ASN1.parseTime("20240101120000+0300", generalized: true)
        XCTAssertEqual(offset, try ASN1.parseTime("20240101090000Z", generalized: true))
        XCTAssertEqual(try ASN1.time(utc).dateValue, utc)
    }

    // MARK: Certificates

    func testSelfSignedCertificate() throws {
        for type in [SigningKeyType.rsa2048, .ecP256] {
            var subject = CertificateFactory.Subject(commonName: "Ayşe Yılmaz")
            subject.email = "ayse@örnek.com.tr"
            subject.organization = "vivePDF"
            subject.organizationalUnit = "QA"
            subject.locality = "Malatya"
            let identity = try CertificateFactory.create(.init(subject: subject, keyType: type, validDays: 365))
            let certificate = try X509Certificate(der: identity.certificate.der)
            XCTAssertEqual(certificate.subject.commonName, "Ayşe Yılmaz")
            XCTAssertEqual(certificate.subject.organizationalUnit, "QA")
            XCTAssertEqual(certificate.subject.country, "TR")
            XCTAssertEqual(certificate.email, "ayse@xn--rnek-4qa.com.tr")
            XCTAssertEqual(certificate.version, 3)
            XCTAssertTrue(certificate.isSelfSigned)
            XCTAssertTrue(certificate.allowsDocumentSigning)
            XCTAssertEqual(certificate.keyUsage, [.digitalSignature, .nonRepudiation])
            XCTAssertEqual(certificate.extendedKeyUsage, [OID.ekuEmailProtection, OID.ekuClientAuth, OID.ekuDocumentSigning])
            XCTAssertEqual(certificate.basicConstraints?.isCA, false)
            XCTAssertNotNil(certificate.subjectKeyIdentifier)
            XCTAssertNotNil(certificate.secCertificate)
            XCTAssertTrue(identity.keyMatchesCertificate())
            XCTAssertEqual(try X509Certificate.parse(Data(certificate.pem.utf8)), certificate)
            XCTAssertEqual(certificate.sha256Fingerprint.count, 64)
            if type == .ecP256 { XCTAssertEqual(certificate.publicKey.algorithm, .ec(.p256)) } else { XCTAssertEqual(certificate.publicKey.algorithm, .rsa(bits: 2048)) }
        }
    }

    func testCertificateValidation() {
        XCTAssertThrowsError(try CertificateFactory.create(.init(subject: .init(commonName: "  ")))) { error in
            XCTAssertEqual(error as? CryptoError, .invalid(reason: "commonName"))
        }
        XCTAssertThrowsError(try CertificateFactory.create(.init(subject: .init(commonName: "x"), keyType: .ecP256, usage: .encryption))) { error in
            XCTAssertEqual(error as? CryptoError, .invalid(reason: "encryptionNeedsRsa"))
        }
        XCTAssertThrowsError(try CertificateFactory.create(.init(subject: .init(commonName: String(repeating: "ş", count: 33))))) { error in
            XCTAssertEqual(error as? CryptoError, .invalid(reason: "nameTooLong", detail: "commonName"))
        }
        XCTAssertThrowsError(try CertificateFactory.asciiEmail("no-at-sign"))
        XCTAssertThrowsError(try CertificateFactory.asciiEmail("ş@example.com"))
        XCTAssertEqual(try CertificateFactory.asciiEmail("a@bücher.de"), "a@xn--bcher-kva.de")
    }

    // MARK: PKCS#12

    func testPKCS12RoundTrip() throws {
        let identity = try CertificateFactory.create(.init(subject: .init(commonName: "P12"), keyType: .rsa2048))
        for profile in PKCS12.Profile.allCases {
            let p12 = try PKCS12.export(identity: identity, password: "Parola-123ş", profile: profile, iterations: 1000)
            let contents = try PKCS12.decode(p12, password: "Parola-123ş")
            XCTAssertEqual(contents.leaf, identity.certificate)
            XCTAssertEqual(contents.friendlyName, "P12")
            XCTAssertTrue(try contents.identity().keyMatchesCertificate())
            XCTAssertThrowsError(try PKCS12.decode(p12, password: "wrong")) { XCTAssertEqual($0 as? CryptoError, .wrongPassword) }
            let imported = try PKCS12.importWithSecurity(p12, password: "Parola-123ş")
            XCTAssertEqual(imported.certificate, identity.certificate)
        }
    }

    func testOpenSSLLegacyPKCS12WithChain() throws {
        let contents = try PKCS12.decode(CryptoFixtures.data(CryptoFixtures.legacyP12), password: "secret")
        let identity = try contents.identity()
        XCTAssertEqual(identity.label, "Leaf Signer")
        XCTAssertEqual(identity.chain.map(\.label), ["Test Intermediate", "Test Root CA"])
        XCTAssertTrue(identity.keyMatchesCertificate())
        XCTAssertTrue(identity.certificate.isSignedBy(identity.chain[0]))
        XCTAssertEqual(identity.certificate.crlDistributionPoints, ["http://crl.example.com/inter.crl"])
        XCTAssertEqual(identity.certificate.authorityInfoAccess.ocsp, ["http://ocsp.example.com"])
        XCTAssertEqual(identity.certificate.certificatePolicies, ["1.2.3.4.5"])
        XCTAssertThrowsError(try PKCS12.loadIdentity(Data("nope".utf8), password: "x")) { XCTAssertEqual($0 as? CryptoError, .noPrivateKey) }
    }

    // MARK: CMS

    private func chainIdentity() throws -> SigningIdentity {
        try PKCS12.decode(CryptoFixtures.data(CryptoFixtures.legacyP12), password: "secret").identity()
    }

    func testCMSSignAndVerify() async throws {
        let identity = try chainIdentity()
        let root = identity.chain.last!
        let trust = TrustEvaluator(userRoots: [root])
        let parts = [Data("first range".utf8), Data("second range".utf8)]
        for (format, digest, pss) in [(CMSSignOptions.Format.cades, DigestAlgorithm.sha256, false), (.pkcs7, .sha384, true), (.cades, .sha512, true)] {
            var options = CMSSignOptions(format: format, digest: digest)
            options.rsaPSS = pss
            let cms = try await CMSSigner.sign(content: parts, identity: identity, options: options)
            XCTAssertLessThanOrEqual(cms.count, CMSSigner.estimatedSize(identity: identity, options: options))
            let result = CMSVerifier.verify(cms: cms, content: parts, trust: trust)
            XCTAssertEqual(result.status, .valid, result.summary)
            XCTAssertEqual(result.trustSource, "user")
            XCTAssertTrue(result.isCAdES)
            XCTAssertEqual(result.signer, identity.certificate)
            XCTAssertEqual(result.claimedSigningTime != nil, format == .pkcs7)
            let tampered = CMSVerifier.verify(cms: cms, content: [parts[0], Data("changed".utf8)], trust: trust)
            XCTAssertEqual(tampered.status, .modified)
        }
        let untrusted = CMSVerifier.verify(cms: try CMSSigner.signWithoutTimestamp(digest: DigestAlgorithm.sha256.hash(parts), identity: identity),
                                           content: parts, trust: TrustEvaluator(useSystemRoots: true))
        XCTAssertEqual(untrusted.status, .unknownSigner)
    }

    func testECSelfSignedTrustedByUser() throws {
        let identity = try CertificateFactory.create(.init(subject: .init(commonName: "EC"), keyType: .ecP256))
        let data = Data("payload".utf8)
        let cms = try CMSSigner.signWithoutTimestamp(digest: DigestAlgorithm.sha256.hash(data), identity: identity)
        XCTAssertEqual(CMSVerifier.verify(cms: cms, content: [data]).trustProblem, "selfSigned")
        let trusted = CMSVerifier.verify(cms: cms, content: [data], trust: TrustEvaluator(userRoots: [identity.certificate]))
        XCTAssertEqual(trusted.status, .valid)
    }

    func testOpenSSLPSSSignatureWithCustomSalt() throws {
        let cms = CryptoFixtures.data(CryptoFixtures.pssSignature)
        let result = CMSVerifier.verify(cms: cms, content: [CryptoFixtures.content])
        XCTAssertTrue(result.valid)
        XCTAssertEqual(result.signatureAlgorithm?.kind, .rsaPSS)
        XCTAssertEqual(result.signatureAlgorithm?.saltLength, 32)
        XCTAssertEqual(CMSVerifier.verify(cms: cms, content: [Data("x".utf8)]).status, .modified)
    }

    func testByteRange() throws {
        let file = Data("AAAA<3082>BBBB".utf8)
        let range = try XCTUnwrap(ByteRange([0, 4, 10, 4]))
        XCTAssertEqual(range.slices(of: file), [Data("AAAA".utf8), Data("BBBB".utf8)])
        XCTAssertEqual(range.contentsGap, 4..<10)
        XCTAssertEqual(range.coverage(fileLength: file.count), .entireFile)
        XCTAssertEqual(range.coverage(fileLength: file.count + 100), .entireRevision)
        XCTAssertTrue(range.hasLaterChanges(fileLength: file.count + 1))
        XCTAssertEqual(ByteRange([5, 4, 10, 4])?.coverage(fileLength: 14), .unclear)
        XCTAssertNil(ByteRange([0, 4, 10]))
    }

    // MARK: Envelopes / PubSec

    func testEnvelopeAndPubSec() throws {
        let holder = try chainIdentity()
        XCTAssertEqual(try CMSEnvelope.decrypt(CryptoFixtures.data(CryptoFixtures.envelope), identity: holder), Data("openssl-secret".utf8))
        for transport in [CMSEnvelope.KeyTransport.rsaPKCS1v15, .rsaOAEPSHA256] {
            let envelope = try CMSEnvelope.encrypt(Data("secret".utf8), recipients: [holder.certificate], keyTransport: transport)
            XCTAssertEqual(try CMSEnvelope.decrypt(envelope, identity: holder), Data("secret".utf8))
        }
        let encryption = try PubSec.encrypt(recipients: [holder.certificate], permissions: [.print, .tolerateMissingMAC])
        XCTAssertEqual(encryption.fileKey.count, 32)
        XCTAssertTrue(encryption.dictionarySource.contains("/SubFilter /adbe.pkcs7.s5"))
        let recovered = try PubSec.recoverFileKey(recipients: encryption.recipients, identity: holder, algorithm: .aes256)
        XCTAssertEqual(recovered.fileKey, encryption.fileKey)
        XCTAssertEqual(recovered.permissions, [.print, .tolerateMissingMAC])
        let other = try CertificateFactory.create(.init(subject: .init(commonName: "Other"), keyType: .rsa2048, usage: .both))
        XCTAssertThrowsError(try PubSec.recoverFileKey(recipients: encryption.recipients, identity: other, algorithm: .aes256)) {
            XCTAssertEqual($0 as? CryptoError, .invalid(reason: "certificateMismatch"))
        }
        let signingOnly = try CertificateFactory.create(.init(subject: .init(commonName: "Sign"), keyType: .rsa2048, usage: .signing))
        XCTAssertThrowsError(try PubSec.validateRecipient(signingOnly.certificate)) {
            XCTAssertEqual($0 as? CryptoError, .invalid(reason: "certificateUsage"))
        }
        // AES-128 uses SHA-1 and 16 bytes; unencrypted metadata appends FF FF FF FF.
        let seed = Data(repeating: 7, count: 20)
        XCTAssertEqual(PubSec.fileKey(seed: seed, recipients: [Data([1])], algorithm: .aes128, encryptMetadata: true),
                       DigestAlgorithm.sha1.hash(seed + Data([1])).prefix(16))
        XCTAssertEqual(PubSec.fileKey(seed: seed, recipients: [Data([1])], algorithm: .aes256, encryptMetadata: false),
                       DigestAlgorithm.sha256.hash(seed + Data([1, 0xFF, 0xFF, 0xFF, 0xFF])))
    }

    // MARK: Passwords

    func testPasswordStrengthMatchesDesktop() {
        // Scores computed with apps/desktop/src/shared/lib/passwordStrength.ts.
        let expected: [String: Int] = ["": 0, "abc": 0, "password": 1, "Password1": 3, "P@ssw0rd!": 4, "qwerty123": 2,
                                       "Tr0ub4dor&3": 4, "correct horse battery staple": 3, "Şifre-2024!x": 5, "aaaaaaaaaaaa": 0]
        for (password, score) in expected { XCTAssertEqual(PasswordStrength.score(password), score, password) }
        XCTAssertEqual(PasswordStrength.of("zxQ!9#lpT$2m"), .strong)
        XCTAssertEqual(PasswordStrength.of("zxQ!9#lpT$2m", breached: true), .weak)
        XCTAssertEqual(PasswordStrength.of("qwerty123"), .fair)
    }

    func testPasswordBreachOffline() async throws {
        guard PasswordBreach.listURL != nil else { throw XCTSkip("breached password list not bundled") }
        let exact = try await PasswordBreach.check("password")
        XCTAssertEqual(exact, PasswordBreach.Result(breached: true, source: .offline, match: .exact))
        let variant = try await PasswordBreach.check("P@ssw0rd!")
        XCTAssertEqual(variant.match, .variant)
        let fine = try await PasswordBreach.check("zxQ!9#lpT$2m")
        XCTAssertFalse(fine.breached)
        XCTAssertEqual(PasswordBreach.count(in: Data("0018A45C4D1DEF81644B54AB7F969B88D65:1\r\nABCDEF:42".utf8), suffix: "ABCDEF"), 42)
    }

    // MARK: Stores

    func testUserTrustStore() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = UserTrustStore(directory: directory)
        let identity = try chainIdentity()
        let pem = identity.chain.map(\.pem).joined()
        let added = try store.add(Data(pem.utf8))
        XCTAssertEqual(added.added.count, 2)
        XCTAssertEqual(try store.add(identity.chain[1]).known, 1)
        XCTAssertEqual(store.list().roots.count, 2)
        XCTAssertEqual(try store.remove(id: added.added[0].id), 1)
        XCTAssertEqual(store.clear(), 1)
    }

    func testCertificateStoreKeychain() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = CertificateStore(directory: directory)
        let identity = try chainIdentity()
        let entry: StoredIdentity
        do { entry = try store.add(identity, name: "Leaf") } catch CryptoError.security(let status, _) where status == errSecMissingEntitlement {
            throw XCTSkip("keychain unavailable in this test host")
        }
        defer { try? store.delete(id: entry.id) }
        let loaded = try store.signingIdentity(for: entry)
        XCTAssertTrue(loaded.keyMatchesCertificate())
        XCTAssertEqual(loaded.chain.count, 2)
        try store.rename(id: entry.id, to: "Renamed")
        XCTAssertEqual(store.identity(id: entry.id)?.name, "Renamed")
        let p12 = try store.exportPKCS12(id: entry.id, password: "12345678")
        XCTAssertTrue(try PKCS12.decode(p12, password: "12345678").identity().keyMatchesCertificate())
        let sealed = try store.create(.init(subject: .init(commonName: "Locked"), keyType: .ecP256), protection: .init(exportable: false))
        defer { try? store.delete(id: sealed.id) }
        XCTAssertThrowsError(try store.exportPKCS12(id: sealed.id, password: "12345678")) { XCTAssertEqual($0 as? CryptoError, .notExportable) }
        XCTAssertTrue(try store.signingIdentity(for: sealed).keyMatchesCertificate())
        try store.delete(id: entry.id)
        XCTAssertThrowsError(try store.signingIdentity(for: entry))
    }
}

/// OpenSSL 3.5-generated fixtures: a legacy (RC2-40 + 3DES, SHA-1 MAC) .p12 with a two-level CA chain
/// (password "secret"), an RSA-PSS (SHA-512, salt 32) detached CMS over `content`, and an AES-256
/// EnvelopedData for the same leaf holding "openssl-secret".
enum CryptoFixtures {
    static let content = Data("%PDF-1.7 pretend byte range onesecond byte range".utf8)
    static let legacyP12 = """
    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
    YTgr069eEkY7Blp5clYECAUkVMyl7bouAgIIAA==
    """
    static let pssSignature = """
    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
    twHglpS0cOAvxhmu7oxy/x7qCHM=
    """
    static let envelope = """
    MIIBugYJKoZIhvcNAQcDoIIBqzCCAacCAQAxggFiMIIBXgIBADBGMC4xGjAYBgNVBAMMEVRlc3QgSW50ZXJtZWRpYXRlMRAwDgYD
    VQQKDAd2aXZlUERGAhRox3dMVS4TrffFpL5mGLI0HgECZDANBgkqhkiG9w0BAQEFAASCAQAFUU692z1IFvoahTbuSSLEeJiyqTNo
    eQOhfLXRFPbJBi1Jbc1ogUfqeNHNAYQ9eXjwM9dFsPh10BVCbuUCiXIPapSq/B8oq4a836/I5N6g3N1QYngxCekAyQDE2qiFI9B9
    kzszCUQkjPtY4Wy7LL0RB/FOxbLl8yu+VocoVppChxxRPxbVxTDeMkxj7mpHBu1tRd/xwQBSNwbcmNiGLV+GJgc2SDlagAyxaNLp
    aqKTo3aPz5MpYfUl4nGQtpraetAkWVM06DnmopqP07zJ8QbGYOC6SCGE0FzeL8RRm9bzyWvXZyEKtfRZXZb38PFpmzDF+GaTLNOS
    9/Q++3wZoo54MDwGCSqGSIb3DQEHATAdBglghkgBZQMEASoEEFbE5xBhZFjvFhWPuhcPkK2AEDBGvd3aDO7lvbk/kHc/N9k=
    """

    static func data(_ base64: String) -> Data { Data(base64Encoded: base64, options: .ignoreUnknownCharacters)! }
}
