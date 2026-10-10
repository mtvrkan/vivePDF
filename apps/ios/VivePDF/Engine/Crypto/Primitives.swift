import CommonCrypto
import CryptoKit
import Foundation
import Security

/// Hash algorithms used for signatures, MACs and fingerprints.
enum DigestAlgorithm: String, CaseIterable, Codable, Sendable {
    case sha1, sha256, sha384, sha512

    var oid: String {
        switch self {
        case .sha1: OID.sha1
        case .sha256: OID.sha256
        case .sha384: OID.sha384
        case .sha512: OID.sha512
        }
    }

    var hmacOID: String {
        switch self {
        case .sha1: OID.hmacWithSHA1
        case .sha256: OID.hmacWithSHA256
        case .sha384: OID.hmacWithSHA384
        case .sha512: OID.hmacWithSHA512
        }
    }

    init?(oid: String) {
        guard let match = Self.allCases.first(where: { $0.oid == oid }) else { return nil }
        self = match
    }

    init?(hmacOID: String) {
        guard let match = Self.allCases.first(where: { $0.hmacOID == hmacOID }) else { return nil }
        self = match
    }

    var length: Int {
        switch self {
        case .sha1: 20
        case .sha256: 32
        case .sha384: 48
        case .sha512: 64
        }
    }

    /// PKCS#12 KDF block size (`v` in RFC 7292 appendix B).
    var blockSize: Int { self == .sha384 || self == .sha512 ? 128 : 64 }

    var displayName: String { OID.name(oid) }

    /// AlgorithmIdentifier for CMS (`parameters` absent, as RFC 5754 recommends).
    var algorithmIdentifier: ASN1Node { ASN1.algorithm(oid) }

    func hash(_ data: Data) -> Data { hash([data]) }

    /// Hashes several chunks as one stream (PDF byte ranges).
    func hash<S: Sequence>(_ parts: S) -> Data where S.Element == Data {
        switch self {
        case .sha1: var h = Insecure.SHA1(); for p in parts { h.update(data: p) }; return Data(h.finalize())
        case .sha256: var h = SHA256(); for p in parts { h.update(data: p) }; return Data(h.finalize())
        case .sha384: var h = SHA384(); for p in parts { h.update(data: p) }; return Data(h.finalize())
        case .sha512: var h = SHA512(); for p in parts { h.update(data: p) }; return Data(h.finalize())
        }
    }

    /// Streaming hasher for large inputs read in chunks.
    func hasher() -> Hasher { Hasher(self) }

    struct Hasher {
        private var sha1 = Insecure.SHA1(), sha256 = SHA256(), sha384 = SHA384(), sha512 = SHA512()
        let algorithm: DigestAlgorithm

        init(_ algorithm: DigestAlgorithm) { self.algorithm = algorithm }

        mutating func update(_ data: Data) {
            switch algorithm {
            case .sha1: sha1.update(data: data)
            case .sha256: sha256.update(data: data)
            case .sha384: sha384.update(data: data)
            case .sha512: sha512.update(data: data)
            }
        }

        func finalize() -> Data {
            switch algorithm {
            case .sha1: Data(sha1.finalize())
            case .sha256: Data(sha256.finalize())
            case .sha384: Data(sha384.finalize())
            case .sha512: Data(sha512.finalize())
            }
        }
    }

    func hmac(key: Data, data: Data) -> Data {
        let symmetric = SymmetricKey(data: key)
        switch self {
        case .sha1: return Data(HMAC<Insecure.SHA1>.authenticationCode(for: data, using: symmetric))
        case .sha256: return Data(HMAC<SHA256>.authenticationCode(for: data, using: symmetric))
        case .sha384: return Data(HMAC<SHA384>.authenticationCode(for: data, using: symmetric))
        case .sha512: return Data(HMAC<SHA512>.authenticationCode(for: data, using: symmetric))
        }
    }

    fileprivate var pbkdfPRF: CCPseudoRandomAlgorithm {
        switch self {
        case .sha1: CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA1)
        case .sha256: CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256)
        case .sha384: CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA384)
        case .sha512: CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA512)
        }
    }
}

/// Block ciphers needed for PKCS#12, CMS EnvelopedData and PDF key envelopes.
enum SymmetricCipher: Equatable, Sendable {
    case aesCBC(keyBytes: Int)
    case tripleDESCBC
    case desCBC
    /// RC2-CBC; only the effective key length == key length case is supported by CommonCrypto.
    case rc2CBC(keyBytes: Int)
    case rc4(keyBytes: Int)

    var keyLength: Int {
        switch self {
        case .aesCBC(let bytes): bytes
        case .tripleDESCBC: 24
        case .desCBC: 8
        case .rc2CBC(let bytes), .rc4(let bytes): bytes
        }
    }

    var blockSize: Int {
        switch self {
        case .aesCBC: 16
        case .tripleDESCBC, .desCBC, .rc2CBC: 8
        case .rc4: 1
        }
    }

    var oid: String? {
        switch self {
        case .aesCBC(16): OID.aes128CBC
        case .aesCBC(24): OID.aes192CBC
        case .aesCBC(32): OID.aes256CBC
        case .tripleDESCBC: OID.desEDE3CBC
        case .desCBC: OID.desCBC
        case .rc2CBC: OID.rc2CBC
        case .rc4: OID.rc4
        default: nil
        }
    }

    /// Cipher from a CMS / PBES2 `encryptionScheme` OID.
    init?(oid: String) {
        switch oid {
        case OID.aes128CBC: self = .aesCBC(keyBytes: 16)
        case OID.aes192CBC: self = .aesCBC(keyBytes: 24)
        case OID.aes256CBC: self = .aesCBC(keyBytes: 32)
        case OID.desEDE3CBC: self = .tripleDESCBC
        case OID.desCBC: self = .desCBC
        case OID.rc2CBC: self = .rc2CBC(keyBytes: 16)
        case OID.rc4: self = .rc4(keyBytes: 16)
        default: return nil
        }
    }

    func encrypt(_ data: Data, key: Data, iv: Data?) throws -> Data { try crypt(CCOperation(kCCEncrypt), data, key, iv) }
    func decrypt(_ data: Data, key: Data, iv: Data?) throws -> Data { try crypt(CCOperation(kCCDecrypt), data, key, iv) }

    private func crypt(_ operation: CCOperation, _ data: Data, _ key: Data, _ iv: Data?) throws -> Data {
        let algorithm: CCAlgorithm
        switch self {
        case .aesCBC: algorithm = CCAlgorithm(kCCAlgorithmAES)
        case .tripleDESCBC: algorithm = CCAlgorithm(kCCAlgorithm3DES)
        case .desCBC: algorithm = CCAlgorithm(kCCAlgorithmDES)
        case .rc2CBC: algorithm = CCAlgorithm(kCCAlgorithmRC2)
        case .rc4: algorithm = CCAlgorithm(kCCAlgorithmRC4)
        }
        let options: CCOptions = self.blockSize > 1 ? CCOptions(kCCOptionPKCS7Padding) : 0
        if blockSize > 1, let iv, iv.count != blockSize { throw CryptoError.malformed("bad IV length") }
        var output = Data(count: data.count + blockSize)
        var produced = 0
        let outputCapacity = output.count
        let status = output.withUnsafeMutableBytes { out in
            data.withUnsafeBytes { input in
                key.withUnsafeBytes { keyBytes in
                    (iv ?? Data()).withUnsafeBytes { ivBytes in
                        CCCrypt(operation, algorithm, options,
                                keyBytes.baseAddress, key.count,
                                iv == nil ? nil : ivBytes.baseAddress,
                                input.baseAddress, data.count,
                                out.baseAddress, outputCapacity, &produced)
                    }
                }
            }
        }
        guard status == kCCSuccess else {
            if status == kCCDecodeError || status == kCCAlignmentError { throw CryptoError.wrongPassword }
            throw CryptoError.security(OSStatus(status), "CCCrypt")
        }
        output.count = produced
        return output
    }
}

/// Key derivation and randomness helpers.
enum KeyDerivation {
    static func randomBytes(_ count: Int) -> Data {
        var data = Data(count: count)
        let status = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!) }
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
        return data
    }

    /// PBKDF2 (RFC 8018) over the raw password bytes.
    static func pbkdf2(password: Data, salt: Data, iterations: Int, keyLength: Int, prf: DigestAlgorithm) throws -> Data {
        var derived = Data(count: keyLength)
        let status = derived.withUnsafeMutableBytes { out in
            salt.withUnsafeBytes { saltBytes in
                password.withUnsafeBytes { passwordBytes in
                    CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2),
                                         passwordBytes.baseAddress?.assumingMemoryBound(to: CChar.self), password.count,
                                         saltBytes.baseAddress?.assumingMemoryBound(to: UInt8.self), salt.count,
                                         prf.pbkdfPRF, UInt32(iterations),
                                         out.baseAddress?.assumingMemoryBound(to: UInt8.self), keyLength)
                }
            }
        }
        guard status == kCCSuccess else { throw CryptoError.security(OSStatus(status), "PBKDF2") }
        return derived
    }

    /// PKCS#12 password encoding: BMPString (UTF-16BE) plus a two-byte terminator; empty password → no bytes
    /// when `nullPassword` (some tools encode "no password" that way).
    static func pkcs12Password(_ password: String, nullPassword: Bool = false) -> Data {
        if nullPassword { return Data() }
        var data = Data()
        for unit in password.utf16 { data.append(UInt8(unit >> 8)); data.append(UInt8(unit & 0xFF)) }
        data.append(contentsOf: [0, 0])
        return data
    }

    /// RFC 7292 appendix B key derivation. `id`: 1 = key, 2 = IV, 3 = MAC key.
    static func pkcs12KDF(password: Data, salt: Data, id: UInt8, iterations: Int, length: Int, digest: DigestAlgorithm) -> Data {
        let v = digest.blockSize
        let diversifier = Data(repeating: id, count: v)
        func stretch(_ input: Data) -> Data {
            guard !input.isEmpty else { return Data() }
            let total = v * ((input.count + v - 1) / v)
            var out = Data(capacity: total)
            while out.count < total { out.append(input.prefix(total - out.count)) }
            return out
        }
        var i = [UInt8](stretch(salt) + stretch(password))
        var result = Data()
        while result.count < length {
            var a = digest.hash(diversifier + Data(i))
            for _ in 1..<max(iterations, 1) { a = digest.hash(a) }
            result.append(a)
            if result.count >= length { break }
            // B = A repeated to v bytes; each v-byte block of I becomes (I_j + B + 1) mod 2^(8v).
            let b = [UInt8](stretch(a).prefix(v))
            var block = 0
            while block < i.count {
                var carry: UInt16 = 1
                for k in stride(from: v - 1, through: 0, by: -1) {
                    let sum = UInt16(i[block + k]) + UInt16(b[k]) + carry
                    i[block + k] = UInt8(sum & 0xFF)
                    carry = sum >> 8
                }
                block += v
            }
        }
        return result.prefix(length).cryptoDetached
    }
}
