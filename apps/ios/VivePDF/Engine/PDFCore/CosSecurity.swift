import CommonCrypto
import CryptoKit
import Foundation

// Encryption (ISO 32000-2 §7.6). `CosCryptHandler` does per-object string/stream crypto given a file key and
// an /Encrypt dictionary — it is filter-agnostic, so the public-key handler (Engine/Crypto, /Adobe.PubSec)
// only has to derive the file key and build its own /Encrypt dictionary, then use:
//   reading:  `CosDocument(…, requireUnlock: false)` → `doc.unlock(fileKey:)`
//   writing:  `CosWriteOptions(encryption: .custom(CosCryptHandler(encryptDictionary:fileKey:)))`
// `CosStandardSecurity` implements the password-based /Standard handler (R2–R6).

/// Document permissions (`/P` bits, ISO 32000-2 Table 22). `rawValue` holds only the meaningful bits.
struct CosPermissions: OptionSet, Hashable {
    let rawValue: Int32
    init(rawValue: Int32) { self.rawValue = rawValue }

    static let print = CosPermissions(rawValue: 1 << 2)
    static let modify = CosPermissions(rawValue: 1 << 3)
    static let copy = CosPermissions(rawValue: 1 << 4)
    static let annotate = CosPermissions(rawValue: 1 << 5)
    static let fillForms = CosPermissions(rawValue: 1 << 8)
    static let extractForAccessibility = CosPermissions(rawValue: 1 << 9)
    static let assemble = CosPermissions(rawValue: 1 << 10)
    static let printHighQuality = CosPermissions(rawValue: 1 << 11)
    static let all: CosPermissions = [.print, .modify, .copy, .annotate, .fillForms, .extractForAccessibility, .assemble, .printHighQuality]

    /// From a `/P` value (signed 32-bit).
    init(pValue: Int) { self.init(rawValue: Int32(truncatingIfNeeded: pValue) & CosPermissions.all.rawValue) }

    /// The `/P` value to store: reserved bits 7–8 and 13–32 set, bits 1–2 clear.
    var pValue: Int32 { Int32(bitPattern: 0xFFFF_F0C0) | rawValue }
}

/// Per-object cipher used by a crypt filter.
enum CosCryptMethod: String, Hashable {
    case identity = "None"
    case rc4 = "V2"
    case aesV2 = "AESV2"
    case aesV3 = "AESV3"
}

/// Encrypts/decrypts strings and streams of one document. Immutable and thread-safe.
final class CosCryptHandler: @unchecked Sendable {
    /// The /Encrypt dictionary to write (and that was read).
    let encryptDictionary: CosDict
    let fileKey: [UInt8]
    let stringMethod: CosCryptMethod
    let streamMethod: CosCryptMethod
    let embeddedFileMethod: CosCryptMethod
    let encryptMetadata: Bool
    let version: Int
    let revision: Int

    /// Builds a handler from an /Encrypt dictionary and an already derived file key (any security handler).
    init(encryptDictionary dict: CosDict, fileKey: [UInt8]) {
        self.encryptDictionary = dict
        self.fileKey = fileKey
        let v = dict.int("V") ?? 0
        version = v
        revision = dict.int("R") ?? 0
        encryptMetadata = dict.bool("EncryptMetadata") ?? true
        if v >= 4 {
            let filters = dict.dict("CF") ?? CosDict()
            func cryptMethod(_ key: String) -> CosCryptMethod {
                let name = dict.name(key) ?? "Identity"
                if name == "Identity" { return .identity }
                let cfm = filters.dict(name)?.name("CFM") ?? "None"
                // Producers sometimes omit CFM for AES-256 crypt filters; infer from V.
                if cfm == "None" && v >= 5 { return .aesV3 }
                return CosCryptMethod(rawValue: cfm) ?? .identity
            }
            stringMethod = cryptMethod("StrF")
            let stm = cryptMethod("StmF")
            streamMethod = stm
            embeddedFileMethod = dict.contains("EFF") ? cryptMethod("EFF") : stm
        } else {
            stringMethod = .rc4
            streamMethod = .rc4
            embeddedFileMethod = .rc4
        }
    }

    /// Key for one object (Algorithm 1). AES-256 uses the file key directly.
    func objectKey(_ ref: CosRef, method: CosCryptMethod) -> [UInt8] {
        if method == .aesV3 { return fileKey }
        var material = fileKey
        material += [UInt8(ref.num & 0xFF), UInt8((ref.num >> 8) & 0xFF), UInt8((ref.num >> 16) & 0xFF),
                     UInt8(ref.gen & 0xFF), UInt8((ref.gen >> 8) & 0xFF)]
        if method == .aesV2 { material += [0x73, 0x41, 0x6C, 0x54] } // "sAlT"
        let digest = CosCrypto.md5(material)
        return Array(digest.prefix(min(fileKey.count + 5, 16)))
    }

    func decryptString(_ bytes: [UInt8], _ ref: CosRef) -> [UInt8] {
        CosCrypto.decrypt(bytes, method: stringMethod, key: objectKey(ref, method: stringMethod))
    }

    func encryptString(_ bytes: [UInt8], _ ref: CosRef) -> [UInt8] {
        CosCrypto.encrypt(bytes, method: stringMethod, key: objectKey(ref, method: stringMethod))
    }

    /// The method for a given stream (honours /Crypt filters, embedded files, unencrypted metadata).
    func method(forStream dict: CosDict) -> CosCryptMethod {
        if dict.type == "XRef" { return .identity }
        if !encryptMetadata, dict.type == "Metadata" { return .identity }
        // An explicit /Crypt filter selects a named crypt filter (usually /Identity).
        if case .array(let filters)? = dict["Filter"], filters.first?.name == "Crypt" {
            let parms = dict.array("DecodeParms")?.first?.dict ?? dict.dict("DecodeParms")
            let name = parms?.name("Name") ?? "Identity"
            if name == "Identity" { return .identity }
            let cfm = encryptDictionary.dict("CF")?.dict(name)?.name("CFM") ?? "None"
            return CosCryptMethod(rawValue: cfm) ?? .identity
        }
        if dict.name("Filter") == "Crypt" {
            let name = dict.dict("DecodeParms")?.name("Name") ?? "Identity"
            if name == "Identity" { return .identity }
        }
        if dict.type == "EmbeddedFile" { return embeddedFileMethod }
        return streamMethod
    }

    func decryptStream(_ data: Data, dict: CosDict, _ ref: CosRef) -> Data {
        let m = method(forStream: dict)
        if m == .identity { return data }
        return Data(CosCrypto.decrypt([UInt8](data), method: m, key: objectKey(ref, method: m)))
    }

    func encryptStream(_ data: Data, dict: CosDict, _ ref: CosRef) -> Data {
        let m = method(forStream: dict)
        if m == .identity { return data }
        return Data(CosCrypto.encrypt([UInt8](data), method: m, key: objectKey(ref, method: m)))
    }
}

/// Primitive ciphers and hashes.
enum CosCrypto {
    static func md5(_ bytes: [UInt8]) -> [UInt8] { Array(Insecure.MD5.hash(data: bytes)) }
    static func sha256(_ bytes: [UInt8]) -> [UInt8] { Array(SHA256.hash(data: bytes)) }
    static func sha384(_ bytes: [UInt8]) -> [UInt8] { Array(SHA384.hash(data: bytes)) }
    static func sha512(_ bytes: [UInt8]) -> [UInt8] { Array(SHA512.hash(data: bytes)) }

    static func randomBytes(_ count: Int) -> [UInt8] {
        var g = SystemRandomNumberGenerator()
        return (0..<count).map { _ in UInt8.random(in: 0...255, using: &g) }
    }

    static func rc4(_ data: [UInt8], key: [UInt8]) -> [UInt8] {
        guard !key.isEmpty else { return data }
        var s = [UInt8](0...255)
        var j = 0
        for i in 0..<256 {
            j = (j + Int(s[i]) + Int(key[i % key.count])) & 0xFF
            s.swapAt(i, j)
        }
        var out = [UInt8](repeating: 0, count: data.count)
        var i = 0
        j = 0
        for k in 0..<data.count {
            i = (i + 1) & 0xFF
            j = (j + Int(s[i])) & 0xFF
            s.swapAt(i, j)
            out[k] = data[k] ^ s[(Int(s[i]) + Int(s[j])) & 0xFF]
        }
        return out
    }

    /// Raw AES (no padding). `iv` nil → ECB.
    static func aes(_ data: [UInt8], key: [UInt8], iv: [UInt8]?, encrypt: Bool) -> [UInt8] {
        guard !data.isEmpty, data.count % 16 == 0 else { return [] }
        var out = [UInt8](repeating: 0, count: data.count)
        var moved = 0
        let options = CCOptions(iv == nil ? kCCOptionECBMode : 0)
        let status = CCCrypt(CCOperation(encrypt ? kCCEncrypt : kCCDecrypt), CCAlgorithm(kCCAlgorithmAES), options,
                             key, key.count, iv, data, data.count, &out, out.count, &moved)
        guard status == kCCSuccess else { return [] }
        return Array(out.prefix(moved))
    }

    static func decrypt(_ bytes: [UInt8], method: CosCryptMethod, key: [UInt8]) -> [UInt8] {
        switch method {
        case .identity: return bytes
        case .rc4: return rc4(bytes, key: key)
        case .aesV2, .aesV3:
            guard bytes.count >= 32 else { return [] } // IV + at least one block (empty strings encrypt to 32 bytes)
            let iv = Array(bytes[0..<16])
            let body = Array(bytes[16..<(16 + (bytes.count - 16) / 16 * 16)])
            var plain = aes(body, key: key, iv: iv, encrypt: false)
            if let pad = plain.last, pad >= 1, pad <= 16, plain.count >= Int(pad),
               plain.suffix(Int(pad)).allSatisfy({ $0 == pad }) {
                plain.removeLast(Int(pad))
            }
            return plain
        }
    }

    static func encrypt(_ bytes: [UInt8], method: CosCryptMethod, key: [UInt8]) -> [UInt8] {
        switch method {
        case .identity: return bytes
        case .rc4: return rc4(bytes, key: key)
        case .aesV2, .aesV3:
            let iv = randomBytes(16)
            let pad = 16 - bytes.count % 16
            let padded = bytes + [UInt8](repeating: UInt8(pad), count: pad)
            return iv + aes(padded, key: key, iv: iv, encrypt: true)
        }
    }
}

/// The password-based Standard security handler.
enum CosStandardSecurity {
    enum Method: String, CaseIterable, Hashable {
        case rc4_40, rc4_128, aes128, aes256
    }

    /// Settings for writing a password-protected file.
    struct Settings: Hashable {
        var method: Method = .aes256
        var userPassword: String = ""
        /// Empty → a random owner password (so permissions cannot be lifted with the empty password).
        var ownerPassword: String = ""
        var permissions: CosPermissions = .all
        var encryptMetadata: Bool = true

        init(method: Method = .aes256, userPassword: String = "", ownerPassword: String = "",
             permissions: CosPermissions = .all, encryptMetadata: Bool = true) {
            self.method = method
            self.userPassword = userPassword
            self.ownerPassword = ownerPassword
            self.permissions = permissions
            self.encryptMetadata = encryptMetadata
        }
    }

    /// Result of a successful authentication.
    struct Authentication {
        var fileKey: [UInt8]
        var isOwner: Bool
    }

    static let padding: [UInt8] = [0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
                                   0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A]

    /// Describes an /Encrypt dictionary for UI ("AES-256", "RC4 128-bit", …) and the method it maps to.
    static func method(of dict: CosDict) -> Method? {
        let v = dict.int("V") ?? 0
        if v >= 5 { return .aes256 }
        if v == 4 {
            let name = dict.name("StmF") ?? dict.name("StrF") ?? "Identity"
            let cfm = dict.dict("CF")?.dict(name)?.name("CFM")
            return cfm == "AESV2" ? .aes128 : (cfm == "AESV3" ? .aes256 : .rc4_128)
        }
        if v == 1 || v == 0 { return .rc4_40 }
        return (dict.int("Length") ?? 40) > 40 ? .rc4_128 : .rc4_40
    }

    // MARK: Authentication

    /// Tries `password` as owner, then as user password. nil when it matches neither.
    static func authenticate(_ dict: CosDict, documentID id0: [UInt8], password: String) -> Authentication? {
        let r = dict.int("R") ?? 2
        let o = dict.string("O")?.bytes ?? []
        let u = dict.string("U")?.bytes ?? []
        if r >= 5 {
            let pw = prepareUTF8(password)
            guard o.count >= 48, u.count >= 48 else { return nil }
            let u48 = Array(u[0..<48])
            if hash(pw, salt: Array(o[32..<40]), udata: u48, revision: r) == Array(o[0..<32]),
               let oe = dict.string("OE")?.bytes, oe.count >= 32 {
                let k = hash(pw, salt: Array(o[40..<48]), udata: u48, revision: r)
                let key = CosCrypto.aes(Array(oe[0..<32]), key: k, iv: [UInt8](repeating: 0, count: 16), encrypt: false)
                if key.count == 32 { return Authentication(fileKey: key, isOwner: true) }
            }
            if hash(pw, salt: Array(u[32..<40]), udata: [], revision: r) == Array(u[0..<32]),
               let ue = dict.string("UE")?.bytes, ue.count >= 32 {
                let k = hash(pw, salt: Array(u[40..<48]), udata: [], revision: r)
                let key = CosCrypto.aes(Array(ue[0..<32]), key: k, iv: [UInt8](repeating: 0, count: 16), encrypt: false)
                if key.count == 32 { return Authentication(fileKey: key, isOwner: false) }
            }
            return nil
        }
        let pw = legacyPassword(password)
        // Owner: recover the user password from /O, then authenticate with it.
        if let userPw = recoverUserPassword(dict, ownerPassword: pw), let key = checkUser(dict, id0: id0, padded: userPw) {
            return Authentication(fileKey: key, isOwner: true)
        }
        if let key = checkUser(dict, id0: id0, padded: pw) { return Authentication(fileKey: key, isOwner: false) }
        return nil
    }

    private static func keyLength(_ dict: CosDict) -> Int {
        let r = dict.int("R") ?? 2
        if r == 2 { return 5 }
        var bits = dict.int("Length") ?? 40
        if r == 4, let name = dict.name("StmF"), let cfLength = dict.dict("CF")?.dict(name)?.int("Length") {
            bits = cfLength <= 32 ? cfLength * 8 : cfLength
        }
        if bits <= 0 { bits = 40 } // Length in bytes by mistake or missing
        if bits <= 16 { bits *= 8 }
        return max(5, min(16, bits / 8))
    }

    /// Algorithm 2 (R2–R4).
    static func legacyFileKey(_ dict: CosDict, id0: [UInt8], padded pw: [UInt8]) -> [UInt8] {
        let r = dict.int("R") ?? 2
        let n = keyLength(dict)
        var material = pw
        material += (dict.string("O")?.bytes ?? []).prefix(32)
        let p = UInt32(bitPattern: Int32(truncatingIfNeeded: dict.int("P") ?? -4))
        material += [UInt8(p & 0xFF), UInt8((p >> 8) & 0xFF), UInt8((p >> 16) & 0xFF), UInt8(p >> 24)]
        material += id0
        if r >= 4, !(dict.bool("EncryptMetadata") ?? true) { material += [0xFF, 0xFF, 0xFF, 0xFF] }
        var digest = CosCrypto.md5(material)
        if r >= 3 {
            for _ in 0..<50 { digest = CosCrypto.md5(Array(digest.prefix(n))) }
        }
        return Array(digest.prefix(n))
    }

    /// Algorithms 4/5: computes /U for a key.
    static func computeU(revision r: Int, key: [UInt8], id0: [UInt8]) -> [UInt8] {
        if r == 2 { return CosCrypto.rc4(padding, key: key) }
        var value = CosCrypto.rc4(CosCrypto.md5(padding + id0), key: key)
        for i in 1...19 { value = CosCrypto.rc4(value, key: key.map { $0 ^ UInt8(i) }) }
        return value + [UInt8](repeating: 0, count: 16)
    }

    private static func checkUser(_ dict: CosDict, id0: [UInt8], padded: [UInt8]) -> [UInt8]? {
        let r = dict.int("R") ?? 2
        let u = dict.string("U")?.bytes ?? []
        let key = legacyFileKey(dict, id0: id0, padded: padded)
        let computed = computeU(revision: r, key: key, id0: id0)
        let n = r == 2 ? 32 : 16
        guard u.count >= n, Array(computed.prefix(n)) == Array(u.prefix(n)) else { return nil }
        return key
    }

    /// Algorithm 3 key (RC4 key derived from the owner password).
    private static func ownerKey(revision r: Int, length n: Int, ownerPassword pw: [UInt8]) -> [UInt8] {
        var digest = CosCrypto.md5(pw)
        if r >= 3 { for _ in 0..<50 { digest = CosCrypto.md5(digest) } }
        return Array(digest.prefix(n))
    }

    private static func recoverUserPassword(_ dict: CosDict, ownerPassword pw: [UInt8]) -> [UInt8]? {
        let r = dict.int("R") ?? 2
        guard let o = dict.string("O")?.bytes, o.count >= 32 else { return nil }
        let key = ownerKey(revision: r, length: keyLength(dict), ownerPassword: pw)
        var value = Array(o.prefix(32))
        if r == 2 {
            value = CosCrypto.rc4(value, key: key)
        } else {
            for i in stride(from: 19, through: 0, by: -1) { value = CosCrypto.rc4(value, key: key.map { $0 ^ UInt8(i) }) }
        }
        return value
    }

    /// Password bytes for R2–R4: PDFDocEncoding (Latin-1 fallback), padded/truncated to 32 bytes.
    static func legacyPassword(_ password: String) -> [UInt8] {
        let bytes = PDFDocEncoding.encode(password) ?? password.unicodeScalars.map { UInt8(truncatingIfNeeded: $0.value) }
        let truncated = Array(bytes.prefix(32))
        return truncated + padding.prefix(32 - truncated.count)
    }

    /// Password bytes for R5/R6: SASLprep approximated by NFKC, UTF-8, at most 127 bytes.
    static func prepareUTF8(_ password: String) -> [UInt8] {
        Array(Array(password.precomposedStringWithCompatibilityMapping.utf8).prefix(127))
    }

    /// Algorithm 2.A/2.B hash (R5: plain SHA-256; R6: iterated).
    static func hash(_ pw: [UInt8], salt: [UInt8], udata: [UInt8], revision: Int) -> [UInt8] {
        var k = CosCrypto.sha256(pw + salt + udata)
        guard revision >= 6 else { return k }
        var round = 0
        while true {
            let block = pw + k + udata
            var k1 = [UInt8]()
            k1.reserveCapacity(block.count * 64)
            for _ in 0..<64 { k1 += block }
            let e = CosCrypto.aes(k1, key: Array(k[0..<16]), iv: Array(k[16..<32]), encrypt: true)
            guard e.count >= 16 else { return Array(k.prefix(32)) }
            let sum = e[0..<16].reduce(0) { $0 + Int($1) }
            switch sum % 3 {
            case 0: k = CosCrypto.sha256(e)
            case 1: k = CosCrypto.sha384(e)
            default: k = CosCrypto.sha512(e)
            }
            round += 1
            if round >= 64, Int(e[e.count - 1]) <= round - 32 { break }
        }
        return Array(k.prefix(32))
    }

    // MARK: Building

    /// Builds the /Encrypt dictionary and file key for `settings`. `id0` is the first /ID element.
    static func makeHandler(_ s: Settings, documentID id0: [UInt8]) -> CosCryptHandler {
        let owner = s.ownerPassword.isEmpty
            ? CosCrypto.randomBytes(24).map { String(format: "%02x", $0) }.joined()
            : s.ownerPassword
        let p = Int(s.permissions.pValue)
        var dict: CosDict = ["Filter": "Standard"]
        switch s.method {
        case .aes256:
            let fileKey = CosCrypto.randomBytes(32)
            let upw = prepareUTF8(s.userPassword), opw = prepareUTF8(owner)
            let uv = CosCrypto.randomBytes(8), uk = CosCrypto.randomBytes(8)
            let u = hash(upw, salt: uv, udata: [], revision: 6) + uv + uk
            let ue = CosCrypto.aes(fileKey, key: hash(upw, salt: uk, udata: [], revision: 6), iv: [UInt8](repeating: 0, count: 16), encrypt: true)
            let ov = CosCrypto.randomBytes(8), ok = CosCrypto.randomBytes(8)
            let o = hash(opw, salt: ov, udata: u, revision: 6) + ov + ok
            let oe = CosCrypto.aes(fileKey, key: hash(opw, salt: ok, udata: u, revision: 6), iv: [UInt8](repeating: 0, count: 16), encrypt: true)
            let pBits = UInt32(bitPattern: Int32(truncatingIfNeeded: p))
            var perms: [UInt8] = [UInt8(pBits & 0xFF), UInt8((pBits >> 8) & 0xFF), UInt8((pBits >> 16) & 0xFF), UInt8(pBits >> 24),
                                  0xFF, 0xFF, 0xFF, 0xFF, s.encryptMetadata ? 0x54 : 0x46, 0x61, 0x64, 0x62]
            perms += CosCrypto.randomBytes(4)
            let permsEnc = CosCrypto.aes(perms, key: fileKey, iv: nil, encrypt: true)
            dict["V"] = 5
            dict["R"] = 6
            dict["Length"] = 256
            dict["CF"] = ["StdCF": ["AuthEvent": "DocOpen", "CFM": "AESV3", "Length": 32]]
            dict["StmF"] = "StdCF"
            dict["StrF"] = "StdCF"
            dict["O"] = .bytes(Data(o))
            dict["U"] = .bytes(Data(u))
            dict["OE"] = .bytes(Data(oe))
            dict["UE"] = .bytes(Data(ue))
            dict["P"] = .int(p)
            dict["Perms"] = .bytes(Data(permsEnc))
            if !s.encryptMetadata { dict["EncryptMetadata"] = false }
            return CosCryptHandler(encryptDictionary: dict, fileKey: fileKey)
        case .aes128, .rc4_128, .rc4_40:
            let r: Int, n: Int
            switch s.method {
            case .rc4_40: r = 2; n = 5; dict["V"] = 1; dict["R"] = 2; dict["Length"] = 40
            case .rc4_128: r = 3; n = 16; dict["V"] = 2; dict["R"] = 3; dict["Length"] = 128
            default:
                r = 4; n = 16
                dict["V"] = 4; dict["R"] = 4; dict["Length"] = 128
                dict["CF"] = ["StdCF": ["AuthEvent": "DocOpen", "CFM": "AESV2", "Length": 16]]
                dict["StmF"] = "StdCF"
                dict["StrF"] = "StdCF"
                if !s.encryptMetadata { dict["EncryptMetadata"] = false }
            }
            let upw = legacyPassword(s.userPassword), opw = legacyPassword(owner)
            // /O (Algorithm 3)
            let okey = ownerKey(revision: r, length: n, ownerPassword: opw)
            var o = CosCrypto.rc4(upw, key: okey)
            if r >= 3 { for i in 1...19 { o = CosCrypto.rc4(o, key: okey.map { $0 ^ UInt8(i) }) } }
            dict["O"] = .bytes(Data(o))
            dict["P"] = .int(p)
            let fileKey = legacyFileKey(dict, id0: id0, padded: upw)
            dict["U"] = .bytes(Data(computeU(revision: r, key: fileKey, id0: id0)))
            return CosCryptHandler(encryptDictionary: dict, fileKey: fileKey)
        }
    }
}
