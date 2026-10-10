import CryptoKit
import Foundation
import LocalAuthentication
import Security

/// A signing identity saved on the device. The private key lives in the Keychain (or Secure Enclave);
/// the public certificate, chain and display metadata live in a JSON file next to the app data.
struct StoredIdentity: Codable, Identifiable, Hashable, Sendable {
    enum KeyStorage: String, Codable, Sendable { case keychain, secureEnclave }

    let id: String
    /// User-editable display name.
    var name: String
    let certificateDER: Data
    let chainDER: [Data]
    let createdAt: Date
    let keyStorage: KeyStorage
    /// Face ID / Touch ID / passcode is required before each use of the key.
    let requiresUserPresence: Bool
    /// The key may be exported back to a .p12 file.
    let exportable: Bool

    var certificate: X509Certificate? { try? X509Certificate(der: certificateDER) }
    var chain: [X509Certificate] { chainDER.compactMap { try? X509Certificate(der: $0) } }
    var keyTag: Data { Data("com.vivepdf.identity.\(id)".utf8) }
}

/// Saved signing identities (desktop: the remembered .p12 path + password, here a Keychain store).
final class CertificateStore: @unchecked Sendable {
    /// How a newly stored key is protected.
    struct Protection: Sendable {
        /// Require Face ID / Touch ID / device passcode for every signature or decryption.
        var userPresence = false
        /// Generate the key inside the Secure Enclave (P-256 only, never exportable). Creation only.
        var secureEnclave = false
        /// Allow exporting the identity back to a .p12. Ignored (false) for Secure Enclave keys.
        var exportable = true

        init(userPresence: Bool = false, secureEnclave: Bool = false, exportable: Bool = true) {
            self.userPresence = userPresence
            self.secureEnclave = secureEnclave
            self.exportable = exportable && !secureEnclave
        }
    }

    static let shared = CertificateStore(directory: Workspace.supportFolder("identities"))

    let directory: URL
    /// Uses the iOS-style data protection keychain (always on iOS; on macOS it needs a signed app).
    let dataProtectionKeychain: Bool
    private let lock = NSLock()
    private var metadataURL: URL { directory.appendingPathComponent("identities.json") }

    init(directory: URL, dataProtectionKeychain: Bool = true) {
        self.directory = directory
        self.dataProtectionKeychain = dataProtectionKeychain
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    // MARK: Listing

    func list() -> [StoredIdentity] {
        lock.lock()
        defer { lock.unlock() }
        return load()
    }

    func identity(id: String) -> StoredIdentity? { list().first { $0.id == id } }

    private func load() -> [StoredIdentity] {
        guard let data = try? Data(contentsOf: metadataURL) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([StoredIdentity].self, from: data)) ?? []
    }

    private func save(_ identities: [StoredIdentity]) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(identities).write(to: metadataURL, options: [.atomic, .completeFileProtection])
    }

    // MARK: Adding

    /// Imports a .p12/.pfx into the store.
    @discardableResult
    func importPKCS12(_ data: Data, password: String, name: String? = nil, protection: Protection = Protection()) throws -> StoredIdentity {
        let loaded = try PKCS12.loadIdentity(data, password: password)
        return try add(loaded.identity, name: name ?? loaded.contents?.friendlyName ?? loaded.identity.label, protection: protection)
    }

    /// Stores an in-memory identity (its key is copied into the Keychain).
    @discardableResult
    func add(_ identity: SigningIdentity, name: String? = nil, protection: Protection = Protection()) throws -> StoredIdentity {
        let id = UUID().uuidString
        let entry = StoredIdentity(id: id, name: name ?? identity.label, certificateDER: identity.certificate.der,
                                   chainDER: identity.chain.map(\.der), createdAt: Date(), keyStorage: .keychain,
                                   requiresUserPresence: protection.userPresence, exportable: protection.exportable)
        var query = baseQuery(entry)
        query[kSecValueRef] = identity.privateKey
        query[kSecAttrLabel] = entry.name
        query[kSecAttrIsExtractable] = protection.exportable
        if protection.userPresence {
            query[kSecAttrAccessControl] = try accessControl(userPresence: true)
        } else {
            query[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        }
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw CryptoError.security(status, "store key") }
        try append(entry)
        return entry
    }

    /// Creates a self-signed certificate whose key is generated directly in the Keychain / Secure Enclave.
    @discardableResult
    func create(_ options: CertificateFactory.Options, name: String? = nil, protection: Protection = Protection()) throws -> StoredIdentity {
        _ = try CertificateFactory.validatedAttributes(options)
        let id = UUID().uuidString
        let tag = Data("com.vivepdf.identity.\(id)".utf8)
        let key: SecKey
        if protection.secureEnclave {
            key = try PrivateKeys.generate(.ecP256, secureEnclave: true, keychainTag: tag,
                                           accessControl: try accessControl(userPresence: protection.userPresence, privateKeyUsage: true),
                                           label: name ?? options.subject.commonName, dataProtectionKeychain: dataProtectionKeychain)
        } else {
            // Generate in memory, sign the certificate, then store (keeps exportability explicit).
            key = try PrivateKeys.generate(options.keyType)
        }
        let identity: SigningIdentity
        do {
            var adjusted = options
            if protection.secureEnclave { adjusted.keyType = .ecP256 }
            identity = try CertificateFactory.create(adjusted, privateKey: key)
        } catch {
            if protection.secureEnclave { deleteKey(tag: tag) }
            throw error
        }
        if protection.secureEnclave {
            let entry = StoredIdentity(id: id, name: name ?? identity.label, certificateDER: identity.certificate.der, chainDER: [],
                                       createdAt: Date(), keyStorage: .secureEnclave, requiresUserPresence: protection.userPresence, exportable: false)
            try append(entry)
            return entry
        }
        return try add(identity, name: name, protection: protection)
    }

    // MARK: Using

    /// Loads the key reference. With `requiresUserPresence`, the system prompt appears when the key is
    /// first used (signing/decrypting); pass an `LAContext` that was already evaluated to reuse it.
    func signingIdentity(for entry: StoredIdentity, context: LAContext? = nil, prompt: String? = nil) throws -> SigningIdentity {
        guard let certificate = entry.certificate else { throw CryptoError.malformed("stored certificate") }
        var query = baseQuery(entry)
        query[kSecReturnRef] = true
        query[kSecMatchLimit] = kSecMatchLimitOne
        let authentication = context ?? LAContext()
        if let prompt { authentication.localizedReason = prompt }
        query[kSecUseAuthenticationContext] = authentication
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess: break
        case errSecUserCanceled: throw CryptoError.authenticationCancelled
        case errSecItemNotFound: throw CryptoError.noPrivateKey
        default: throw CryptoError.security(status, "load key")
        }
        let key = result as! SecKey
        return SigningIdentity(privateKey: key, certificate: certificate, chain: entry.chain)
    }

    // MARK: Editing

    func rename(id: String, to name: String) throws {
        lock.lock()
        defer { lock.unlock() }
        var all = load()
        guard let index = all.firstIndex(where: { $0.id == id }) else { return }
        all[index].name = name
        try save(all)
    }

    /// Replaces the stored chain (e.g. after the user adds the issuing CA certificates).
    func updateChain(id: String, chain: [X509Certificate]) throws {
        lock.lock()
        defer { lock.unlock() }
        var all = load()
        guard let index = all.firstIndex(where: { $0.id == id }) else { return }
        let old = all[index]
        all[index] = StoredIdentity(id: old.id, name: old.name, certificateDER: old.certificateDER, chainDER: chain.map(\.der),
                                    createdAt: old.createdAt, keyStorage: old.keyStorage,
                                    requiresUserPresence: old.requiresUserPresence, exportable: old.exportable)
        try save(all)
    }

    func delete(id: String) throws {
        lock.lock()
        defer { lock.unlock() }
        var all = load()
        guard let index = all.firstIndex(where: { $0.id == id }) else { return }
        deleteKey(tag: all[index].keyTag)
        all.remove(at: index)
        try save(all)
    }

    // MARK: Export

    /// Exports a stored identity to a password-protected .p12 (refused for non-exportable keys).
    func exportPKCS12(id: String, password: String, profile: PKCS12.Profile = .modern, context: LAContext? = nil) throws -> Data {
        guard let entry = identity(id: id) else { throw CryptoError.noPrivateKey }
        guard entry.exportable, entry.keyStorage == .keychain else { throw CryptoError.notExportable }
        guard password.count >= CertificateFactory.minimumPasswordLength else { throw CryptoError.invalid(reason: "passwordTooShort") }
        let identity = try signingIdentity(for: entry, context: context)
        return try PKCS12.export(identity: identity, password: password, friendlyName: entry.name, profile: profile)
    }

    /// Public certificate as .cer (DER) or .pem — never contains the key.
    func exportCertificate(id: String, pem: Bool = false) throws -> Data {
        guard let certificate = identity(id: id)?.certificate else { throw CryptoError.noPrivateKey }
        return pem ? Data(certificate.pem.utf8) : certificate.der
    }

    // MARK: Keychain helpers

    private func baseQuery(_ entry: StoredIdentity) -> [CFString: Any] {
        var query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrKeyClass: kSecAttrKeyClassPrivate,
            kSecAttrApplicationTag: entry.keyTag,
        ]
        if dataProtectionKeychain { query[kSecUseDataProtectionKeychain] = true }
        return query
    }

    private func deleteKey(tag: Data) {
        var query: [CFString: Any] = [kSecClass: kSecClassKey, kSecAttrApplicationTag: tag]
        if dataProtectionKeychain { query[kSecUseDataProtectionKeychain] = true }
        SecItemDelete(query as CFDictionary)
    }

    private func append(_ entry: StoredIdentity) throws {
        lock.lock()
        defer { lock.unlock() }
        var all = load()
        all.append(entry)
        try save(all)
    }

    private func accessControl(userPresence: Bool, privateKeyUsage: Bool = false) throws -> SecAccessControl {
        var flags: SecAccessControlCreateFlags = []
        if userPresence { flags.insert(.userPresence) }
        if privateKeyUsage { flags.insert(.privateKeyUsage) }
        var error: Unmanaged<CFError>?
        guard let control = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, flags, &error) else {
            throw CryptoError.security(-1, "access control: \(error?.takeRetainedValue().localizedDescription ?? "")")
        }
        return control
    }

    /// Whether the device can show a Face ID / Touch ID / passcode prompt.
    static var userPresenceAvailable: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    /// Whether this device has a Secure Enclave for key generation.
    static var secureEnclaveAvailable: Bool { SecureEnclave.isAvailable }
}

extension UserTrustStore {
    /// The app's trusted-certificate folder (desktop `user_data_dir()/trust`).
    static var standard: UserTrustStore { UserTrustStore(directory: Workspace.supportFolder("trust")) }
}
