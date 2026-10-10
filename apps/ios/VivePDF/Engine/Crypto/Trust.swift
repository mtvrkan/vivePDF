import Foundation
import Security

/// Chain building and trust evaluation with SecTrust plus the user's own trusted roots.
struct TrustEvaluator: @unchecked Sendable {
    struct Outcome: Sendable {
        var trusted: Bool
        /// "user" when the anchor is one of the user's trusted certificates, "system" for the OS store, else "none".
        var source: String
        /// Desktop `trust_problem` codes: selfSigned, noChain, expired, notYetValid, revoked,
        /// revocationUnknown, notForSigning, weakAlgorithm, other.
        var problem: String?
        /// Revocation result; nil when not checked (offline) or unknown.
        var revoked: Bool?
        /// Evaluated chain, leaf first.
        var chain: [X509Certificate]
    }

    var userRoots: [X509Certificate]
    var useSystemRoots = true
    /// Allow network fetching (AIA intermediates, OCSP/CRL revocation).
    var online = false

    init(userRoots: [X509Certificate] = [], useSystemRoots: Bool = true, online: Bool = false) {
        self.userRoots = userRoots
        self.useSystemRoots = useSystemRoots
        self.online = online
    }

    /// Evaluates `leaf` at `date` (the trusted signing time, or now).
    func evaluate(_ leaf: X509Certificate, intermediates: [X509Certificate], at date: Date) -> Outcome {
        let userFingerprints = Set(userRoots.map(\.sha256Fingerprint))
        let localChain = [leaf] + SigningIdentity.buildChain(for: leaf, from: intermediates + userRoots)
        guard let leafRef = leaf.secCertificate else {
            return Outcome(trusted: false, source: "none", problem: "other", revoked: nil, chain: [leaf])
        }
        let certificates = [leafRef] + intermediates.filter { $0 != leaf }.compactMap(\.secCertificate)
        var policies: [SecPolicy] = [SecPolicyCreateBasicX509()]
        if online, let revocation = SecPolicyCreateRevocation(kSecRevocationUseAnyAvailableMethod) { policies.append(revocation) }
        var trustRef: SecTrust?
        guard SecTrustCreateWithCertificates(certificates as CFArray, policies as CFArray, &trustRef) == errSecSuccess, let trust = trustRef else {
            return Outcome(trusted: false, source: "none", problem: "other", revoked: nil, chain: localChain)
        }
        let anchors = userRoots.compactMap(\.secCertificate)
        if !anchors.isEmpty || !useSystemRoots {
            SecTrustSetAnchorCertificates(trust, anchors as CFArray)
            SecTrustSetAnchorCertificatesOnly(trust, !useSystemRoots)
        }
        SecTrustSetVerifyDate(trust, date as CFDate)
        SecTrustSetNetworkFetchAllowed(trust, online)
        var error: CFError?
        let trusted = SecTrustEvaluateWithError(trust, &error)
        let evaluated = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.compactMap { try? X509Certificate(secCertificate: $0) } ?? localChain
        if trusted {
            let anchor = evaluated.last ?? leaf
            let source = userFingerprints.contains(anchor.sha256Fingerprint) ? "user" : "system"
            return Outcome(trusted: true, source: source, problem: nil, revoked: online ? false : nil, chain: evaluated)
        }
        let code = error.map { CFErrorGetCode($0) } ?? 0
        let problem: String
        var revoked: Bool?
        switch OSStatus(code) {
        case errSecCertificateRevoked:
            problem = "revoked"
            revoked = true
        case errSecCertificateExpired:
            problem = date < leaf.notBefore ? "notYetValid" : "expired"
        case errSecIncompleteCertRevocationCheck, errSecOCSPNotTrustedToAnchor, errSecNetworkFailure:
            problem = "revocationUnknown"
        default:
            if !leaf.isValid(at: date) { problem = date < leaf.notBefore ? "notYetValid" : "expired" }
            else if leaf.isSelfSignedName { problem = "selfSigned" }
            else { problem = "noChain" }
        }
        // Without trust, a self-issued leaf is reported as self-signed like the desktop.
        let reported = leaf.isSelfSignedName && problem != "revoked" && problem != "expired" && problem != "notYetValid" ? "selfSigned" : problem
        return Outcome(trusted: false, source: "none", problem: reported, revoked: revoked, chain: evaluated)
    }
}

/// The user's own trusted certificates (desktop "Trusted certificates" list): plain .cer files in a folder.
/// EU trusted lists / Adobe security settings (XML-DSig verified lists) are not handled here.
struct UserTrustStore: @unchecked Sendable {
    struct Root: Identifiable, Hashable, Sendable {
        /// File name in the store (desktop `TrustRoot.id`).
        let id: String
        let certificate: X509Certificate
        var subject: String { certificate.subject.label }
        var issuer: String { certificate.issuer.label }
        var fingerprint: String { certificate.sha256Fingerprint }
        var validFrom: Date { certificate.notBefore }
        var validUntil: Date { certificate.notAfter }
        var authority: Bool { certificate.isCA }
        var selfSigned: Bool { certificate.isSelfSignedName }
        var expired: Bool { certificate.isExpired }
    }

    static let maxFileBytes = 4 * 1024 * 1024
    static let maxCertificatesPerFile = 500

    let directory: URL

    init(directory: URL) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// Stored roots plus names of files that could not be read.
    func list() -> (roots: [Root], unreadable: [String]) {
        var roots: [Root] = []
        var unreadable: [String] = []
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        for file in files.sorted(by: { $0.lastPathComponent < $1.lastPathComponent })
        where ["cer", "crt", "pem", "der"].contains(file.pathExtension.lowercased()) {
            guard let data = try? Data(contentsOf: file), let certificates = try? X509Certificate.parseMany(data) else {
                unreadable.append(file.lastPathComponent)
                continue
            }
            roots += certificates.map { Root(id: file.lastPathComponent, certificate: $0) }
        }
        return (roots, unreadable)
    }

    var certificates: [X509Certificate] { list().roots.map(\.certificate) }

    /// Certificates in a file that would be added, and how many are already known.
    func preview(_ data: Data) throws -> (added: [X509Certificate], known: Int) {
        guard data.count <= Self.maxFileBytes else { throw CryptoError.invalid(reason: "trustFileFormat") }
        let parsed: [X509Certificate]
        do { parsed = try X509Certificate.parseMany(data) } catch { throw CryptoError.invalid(reason: "trustFileFormat") }
        guard !parsed.isEmpty, parsed.count <= Self.maxCertificatesPerFile else { throw CryptoError.invalid(reason: "trustFileFormat") }
        let existing = Set(certificates.map(\.sha256Fingerprint))
        var seen = Set<String>()
        let fresh = parsed.filter { existing.contains($0.sha256Fingerprint) == false && seen.insert($0.sha256Fingerprint).inserted }
        return (fresh, parsed.count - fresh.count)
    }

    /// Adds every certificate in a .cer/.crt/.pem/.der (or .p7b) file; one DER file per certificate.
    @discardableResult
    func add(_ data: Data) throws -> (added: [Root], known: Int) {
        let (fresh, known) = try preview(data)
        var added: [Root] = []
        for certificate in fresh {
            let name = "\(certificate.sha256Fingerprint.prefix(32).lowercased()).cer"
            try certificate.der.write(to: directory.appendingPathComponent(name), options: .atomic)
            added.append(Root(id: name, certificate: certificate))
        }
        return (added, known)
    }

    func add(_ certificate: X509Certificate) throws { try add(certificate.der) }

    /// Removes a stored file; returns how many certificates it held.
    @discardableResult
    func remove(id: String) throws -> Int {
        let file = directory.appendingPathComponent((id as NSString).lastPathComponent)
        guard FileManager.default.fileExists(atPath: file.path) else { throw CryptoError.invalid(reason: "trustMissing") }
        let count = (try? Data(contentsOf: file)).flatMap { try? X509Certificate.parseMany($0).count } ?? 0
        try FileManager.default.removeItem(at: file)
        return count
    }

    @discardableResult
    func clear() -> Int {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        var removed = 0
        for file in files where (try? FileManager.default.removeItem(at: file)) != nil { removed += 1 }
        return removed
    }

    func contains(_ certificate: X509Certificate) -> Bool { certificates.contains(certificate) }
}
