import Foundation

/// Password strength meter, identical to the desktop `shared/lib/passwordStrength.ts`.
enum PasswordStrength: String, CaseIterable, Sendable {
    case weak, fair, good, strong

    /// Localisation key (`password.strength.<value>`).
    var labelKey: String { "password.strength.\(rawValue)" }

    /// 0…3 step for the four-segment meter.
    var step: Int { Self.allCases.firstIndex(of: self)! }

    static func score(_ value: String) -> Int {
        guard !value.isEmpty else { return 0 }
        let lower = Set("abcdefghijklmnopqrstuvwxyzçğıöşü")
        let upper = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZÇĞİÖŞÜ")
        let scalars = value.unicodeScalars
        var variety = 0
        if value.contains(where: { lower.contains($0) }) { variety += 1 }
        if value.contains(where: { upper.contains($0) }) { variety += 1 }
        if scalars.contains(where: { ("0"..."9").contains($0) }) { variety += 1 }
        let letters: Set<Unicode.GeneralCategory> = [.uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter]
        if scalars.contains(where: { !letters.contains($0.properties.generalCategory) && !("0"..."9").contains($0) }) { variety += 1 }
        let unique = Set(scalars).count
        // JS `value.length` counts UTF-16 code units.
        let length = value.utf16.count
        if length < 6 || unique <= 2 { return 0 }
        var score = 0
        if length >= 8 { score += 1 }
        if length >= 12 { score += 1 }
        if variety >= 2 { score += 1 }
        if variety >= 3 { score += 1 }
        if variety == 4 && unique >= 8 { score += 1 }
        return score
    }

    static func of(_ value: String, breached: Bool = false) -> PasswordStrength {
        if breached { return .weak }
        switch score(value) {
        case ...1: return .weak
        case 2: return .fair
        case 3...4: return .good
        default: return .strong
        }
    }
}

/// Breached-password check (desktop `security.password_breach`): an offline list of the 100 000 most
/// common breached passwords (8-byte SHA-1 prefixes) plus an optional k-anonymity Have I Been Pwned
/// range query that only sends the first five hex digits of the SHA-1.
enum PasswordBreach {
    enum Source: String, Sendable { case offline, online }
    enum Match: String, Sendable { case exact, variant }

    struct Result: Equatable, Sendable {
        var breached: Bool
        var count: Int?
        var source: Source
        var match: Match?
    }

    static let maxPasswordLength = 1024
    static let rangeURL = URL(string: "https://api.pwnedpasswords.com/range/")!
    static let requestTimeout: TimeInterval = 5
    static let maxResponseBytes = 2 * 1024 * 1024
    static let minVariantBase = 4
    private static let digestBytes = 8

    /// Override for tests / tools; defaults to the bundled `common-sha1-64.bin`.
    nonisolated(unsafe) static var listURL: URL? = Bundle.main.url(forResource: "common-sha1-64", withExtension: "bin")
    nonisolated(unsafe) private static var cachedList: Data?
    private static let listLock = NSLock()

    /// Checks a password; `online` adds the HIBP range query and falls back to the offline answer when
    /// the network is unavailable (as the desktop does).
    static func check(_ password: String, online: Bool = false) async throws -> Result {
        guard password.count <= maxPasswordLength else { throw CryptoError.invalid(reason: "tooLong") }
        if password.isEmpty { return Result(breached: false, source: .offline) }
        let offline = try offlineMatch(password)
        guard online else { return Result(breached: offline != nil, source: .offline, match: offline) }
        try Task.checkCancellation()
        guard let count = await onlineCount(password) else { return Result(breached: offline != nil, source: .offline, match: offline) }
        let match: Match? = count > 0 ? .exact : offline
        return Result(breached: match != nil, count: count, source: .online, match: match)
    }

    /// Desktop `normalized`: trimmed, NFKC, case-folded.
    static func normalized(_ password: String) -> String {
        password.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCompatibilityMapping
            .folding(options: .caseInsensitive, locale: nil)
    }

    static func offlineMatch(_ password: String) throws -> Match? {
        let base = normalized(password)
        if base.isEmpty { return nil }
        let list = try commonList()
        if contains(list, digest(base)) { return .exact }
        return variantBases(password).contains { contains(list, digest($0)) } ? .variant : nil
    }

    /// Common substitutions: digits/symbols around a word, leetspeak (desktop `variant_bases`).
    static func variantBases(_ password: String) -> Set<String> {
        let base = normalized(password)
        let stripped = stripAffixes(base)
        var candidates: Set<String> = [stripped]
        for text in [base, stripped] {
            let decoded = translate(text, leet)
            candidates.insert(decoded)
            candidates.insert(stripAffixes(decoded))
            candidates.insert(translate(translate(text, leetL), leet))
        }
        candidates.remove(base)
        return candidates.filter { $0.unicodeScalars.count >= minVariantBase }
    }

    private static let leet: [Character: Character] = ["@": "a", "4": "a", "3": "e", "1": "i", "!": "i", "0": "o", "$": "s", "5": "s", "7": "t"]
    private static let leetL: [Character: Character] = ["1": "l", "!": "l"]

    private static func translate(_ text: String, _ table: [Character: Character]) -> String {
        String(text.map { table[$0] ?? $0 })
    }

    /// Removes leading/trailing runs of digits, symbols and underscores (`^[\d\W_]+|[\d\W_]+$`).
    private static func stripAffixes(_ text: String) -> String {
        func isAffix(_ c: Character) -> Bool { c.isNumber || c == "_" || !(c.isLetter || c.isNumber) }
        var chars = Substring(text)
        while let first = chars.first, isAffix(first) { chars = chars.dropFirst() }
        while let last = chars.last, isAffix(last) { chars = chars.dropLast() }
        return String(chars)
    }

    private static func digest(_ text: String) -> Data { DigestAlgorithm.sha1.hash(Data(text.utf8)).prefix(digestBytes).cryptoDetached }

    private static func commonList() throws -> Data {
        listLock.lock()
        defer { listLock.unlock() }
        if let cachedList { return cachedList }
        guard let url = listURL, let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
            throw EngineError(.UNSUPPORTED, reason: "listMissing")
        }
        guard !data.isEmpty, data.count % digestBytes == 0 else { throw EngineError(.UNSUPPORTED, reason: "listDamaged") }
        cachedList = data
        return data
    }

    /// Binary search over the sorted 8-byte records.
    private static func contains(_ list: Data, _ needle: Data) -> Bool {
        let target = [UInt8](needle)
        return list.withUnsafeBytes { raw -> Bool in
            let bytes = raw.bindMemory(to: UInt8.self)
            var low = 0
            var high = list.count / digestBytes
            while low < high {
                let mid = (low + high) / 2
                let offset = mid * digestBytes
                var order = 0
                for i in 0..<digestBytes where bytes[offset + i] != target[i] {
                    order = bytes[offset + i] < target[i] ? -1 : 1
                    break
                }
                if order == 0 { return true }
                if order < 0 { low = mid + 1 } else { high = mid }
            }
            return false
        }
    }

    /// HIBP range query; nil on any network problem.
    static func onlineCount(_ password: String) async -> Int? {
        let hex = DigestAlgorithm.sha1.hash(Data(password.utf8)).cryptoHex.uppercased()
        let prefix = String(hex.prefix(5))
        let suffix = String(hex.dropFirst(5))
        var request = URLRequest(url: rangeURL.appendingPathComponent(prefix), timeoutInterval: requestTimeout)
        request.setValue("vivePDF-password-check", forHTTPHeaderField: "User-Agent")
        request.setValue("true", forHTTPHeaderField: "Add-Padding")
        request.setValue("text/plain", forHTTPHeaderField: "Accept")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = requestTimeout
        let session = URLSession(configuration: configuration, delegate: RefuseRedirects(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        guard let (data, response) = try? await session.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200, data.count <= maxResponseBytes else { return nil }
        return count(in: data, suffix: suffix)
    }

    /// Count for `suffix` in a range response body (0 when absent).
    static func count(in payload: Data, suffix: String) -> Int? {
        guard let text = String(data: payload, encoding: .ascii) else { return nil }
        for line in text.split(whereSeparator: \.isNewline) {
            let parts = line.trimmingCharacters(in: .whitespaces).split(separator: ":", maxSplits: 1)
            if parts.count == 2, parts[0].uppercased() == suffix { return Int(parts[1]) ?? 0 }
        }
        return 0
    }

    private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest) async -> URLRequest? { nil }
    }
}
