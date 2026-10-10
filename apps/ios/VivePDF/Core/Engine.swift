import Foundation

/// Error codes shared with the desktop engine (`RpcErrorCode`), localised through `errors.<CODE>`.
struct EngineError: LocalizedError, Equatable {
    enum Code: String {
        case ENCRYPTED, NEEDS_PASSWORD, INVALID_PDF, CERTIFICATE_SEALED, FILE_NOT_FOUND
        case CANCELLED, PERMISSION_DENIED, INVALID_PARAMS, UNSUPPORTED, INTERNAL, NETWORK
    }

    let code: Code
    /// Optional `errors.reasons.<reason>` key for a more specific message.
    var reason: String?
    var detail: String?

    init(_ code: Code, reason: String? = nil, detail: String? = nil) {
        self.code = code
        self.reason = reason
        self.detail = detail
    }

    var errorDescription: String? {
        if let reason, L10n.shared.has("errors.reasons.\(reason)") { return t("errors.reasons.\(reason)") }
        let base = t("errors.\(code.rawValue)")
        if let detail, !detail.isEmpty { return "\(base) (\(detail))" }
        return base
    }

    static let cancelled = EngineError(.CANCELLED)
    static func invalid(_ detail: String? = nil) -> EngineError { EngineError(.INVALID_PARAMS, detail: detail) }
    static func internalError(_ detail: String? = nil) -> EngineError { EngineError(.INTERNAL, detail: detail) }
}

/// Progress callback used by every engine operation: fraction 0…1 plus an optional status line.
typealias ProgressHandler = @Sendable (_ fraction: Double, _ message: String?) -> Void

/// Lets long loops honour task cancellation and report progress uniformly.
struct ProgressReporter: Sendable {
    let handler: ProgressHandler?
    let total: Int

    init(total: Int, _ handler: ProgressHandler?) {
        self.total = max(total, 1)
        self.handler = handler
    }

    func step(_ index: Int, _ message: String? = nil) throws {
        try Task.checkCancellation()
        handler?(min(1, Double(index) / Double(total)), message)
    }
}

/// Parses desktop-style page ranges ("1-3, 5, 8-", "even", "odd", "last") into zero-based indices.
enum PageRanges {
    static func parse(_ text: String, pageCount: Int) -> [Int]? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if trimmed.isEmpty || trimmed == "all" { return Array(0..<pageCount) }
        var result: [Int] = []
        for rawPart in trimmed.split(whereSeparator: { $0 == "," || $0 == ";" }) {
            let part = rawPart.trimmingCharacters(in: .whitespaces)
            switch part {
            case "even": result += stride(from: 1, to: pageCount, by: 2); continue
            case "odd": result += stride(from: 0, to: pageCount, by: 2); continue
            case "last", "z": result.append(pageCount - 1); continue
            default: break
            }
            let bounds = part.split(separator: "-", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
            func value(_ s: String, default fallback: Int) -> Int? {
                if s.isEmpty { return fallback }
                if s == "last" || s == "z" { return pageCount }
                return Int(s)
            }
            if bounds.count == 1 {
                guard let page = value(bounds[0], default: 0), page >= 1, page <= pageCount else { return nil }
                result.append(page - 1)
            } else if bounds.count == 2 {
                guard let lo = value(bounds[0], default: 1), let hi = value(bounds[1], default: pageCount),
                      lo >= 1, hi <= pageCount else { return nil }
                if lo <= hi { result += Array((lo - 1)...(hi - 1)) } else { result += Array((hi - 1)...(lo - 1)).reversed() }
            } else {
                return nil
            }
        }
        return result
    }

    /// Formats zero-based indices compactly: [0,1,2,4] → "1-3, 5".
    static func format(_ indices: [Int]) -> String {
        let sorted = Array(Set(indices)).sorted()
        var parts: [String] = []
        var i = 0
        while i < sorted.count {
            var j = i
            while j + 1 < sorted.count && sorted[j + 1] == sorted[j] + 1 { j += 1 }
            parts.append(i == j ? "\(sorted[i] + 1)" : "\(sorted[i] + 1)-\(sorted[j] + 1)")
            i = j + 1
        }
        return parts.joined(separator: ", ")
    }
}
