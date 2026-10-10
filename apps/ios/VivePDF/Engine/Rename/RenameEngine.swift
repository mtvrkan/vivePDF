import Foundation
import PDFKit
import UIKit
import Vision

/// Bulk rename by content (`ops/rename.py`): reads dates, invoice numbers, amounts, titles and metadata from the
/// first pages, renders a pattern such as `{date} {title}` (with `/` for sub-folders), detects clashes and then
/// renames in place or copies into a folder, with undo.
enum RenameEngine {
    static let titleMaxCharacters = 60
    static let maxFolderDepth = 5
    static let ocrTextThreshold = 20
    static let ocrDPI: CGFloat = 200

    enum NameCase: String, CaseIterable, Identifiable { case keep, lower, upper, title; var id: String { rawValue } }
    enum DateOrder: String, CaseIterable, Identifiable { case dmy, mdy; var id: String { rawValue } }
    enum Mode: String, CaseIterable, Identifiable { case rename, copy; var id: String { rawValue } }
    enum ConflictPolicy: String, CaseIterable, Identifiable { case number, skip, overwrite; var id: String { rawValue } }

    static let tokens = ["name", "n", "title", "date", "year", "invoice", "amount", "author", "subject", "pages"]
    static let baseTokens = tokens + ["ext", "time"]
    static let customToken = "custom"
    static let presets: [(id: String, pattern: String)] = [
        ("dateTitle", "{date} {title}"), ("invoice", "{date} {invoice} {amount}"), ("numbered", "{n} {name}"),
        ("byYear", "{year}/{date} {title}"), ("byAuthor", "{author}/{title}"),
    ]
    static let dateFormats: [(value: String, sample: String)] = [
        ("%Y-%m-%d", "2026-09-18"), ("%d.%m.%Y", "18.09.2026"), ("%Y%m%d", "20260918"), ("%d-%m-%Y", "18-09-2026"), ("%m-%d-%Y", "09-18-2026"),
    ]

    // MARK: - Field extraction

    private static func regex(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
        // Patterns are constants; a failure here is a programming error caught by the tests.
        try! NSRegularExpression(pattern: pattern, options: options)
    }

    private static let dateDMY = regex(#"(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?!\d)"#)
    private static let dateYMD = regex(#"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)"#)
    private static let dateDayMonth = regex(#"(?<!\d)(\d{1,2})\.?\s+([^\W\d_]{3,})\.?\s+(\d{4})(?!\d)"#)
    private static let dateMonthDay = regex(#"\b([^\W\d_]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})(?!\d)"#)
    private static let invoice = regex(
        #"(?:fatura|invoice|fi[şs]|receipt|belge|sipari[şs]|order|rechnung|facture|factura|fattura)\s*(?:no|number|nr|numaras[ıi]|#|n°|num)?\s*[:.\-]?\s*([A-Z]{0,4}[-/]?\d{3,}[A-Z0-9-/]*)"#,
        .caseInsensitive)
    private static let amountSuffix = regex(
        #"(?<![\d.,])(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(TL|₺|TRY|€|EUR|\$|USD|£|GBP)"#, .caseInsensitive)
    private static let amountPrefix = regex(#"(₺|€|\$|£)\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d.,])"#)
    private static let officePrefix = regex(#"^(?:Microsoft\s+(?:Office\s+)?(?:Word|PowerPoint|Excel)|PowerPoint|Word)\s*-\s*"#, .caseInsensitive)
    private static let sourceExtension = regex(#"\.(?:docx?|pptx?|xlsx?|odt|odp|ods|rtf|txt|pdf|indd|pages|key)$"#, .caseInsensitive)
    private static let placeholderTitles: Set<String> = [
        "untitled", "untitled document", "document", "document1", "presentation", "powerpoint presentation", "slide 1", "adsız", "başlıksız", "belge1",
    ]

    private static func groups(_ match: NSTextCheckingResult, in text: String) -> [String] {
        (0..<match.numberOfRanges).map { index in
            let range = match.range(at: index)
            guard range.location != NSNotFound, let swiftRange = Range(range, in: text) else { return "" }
            return String(text[swiftRange])
        }
    }

    private static func matches(_ regex: NSRegularExpression, _ text: String) -> [[String]] {
        regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { groups($0, in: text) }
    }

    static func validDate(_ year: Int, _ month: Int, _ day: Int) -> DateComponents? {
        var components = DateComponents(year: year, month: month, day: day)
        let calendar = Calendar(identifier: .gregorian)
        guard (1...12).contains(month), (1...31).contains(day), year >= 1,
              let date = calendar.date(from: components) else { return nil }
        let check = calendar.dateComponents([.year, .month, .day], from: date)
        guard check.year == year, check.month == month, check.day == day else { return nil }
        components.calendar = calendar
        return components
    }

    /// First date found in the text: ISO first, then numeric (day/month order configurable), then written months.
    static func findDate(_ text: String, order: DateOrder = .dmy) -> DateComponents? {
        for g in matches(dateYMD, text) {
            if let found = validDate(Int(g[1]) ?? 0, Int(g[2]) ?? 0, Int(g[3]) ?? 0) { return found }
        }
        for g in matches(dateDMY, text) {
            let (day, month) = order == .dmy ? (g[1], g[2]) : (g[2], g[1])
            if let found = validDate(Int(g[3]) ?? 0, Int(month) ?? 0, Int(day) ?? 0) { return found }
        }
        for g in matches(dateDayMonth, text) {
            if let month = DateNames.month(g[2]), let found = validDate(Int(g[3]) ?? 0, month, Int(g[1]) ?? 0) { return found }
        }
        for g in matches(dateMonthDay, text) {
            if let month = DateNames.month(g[1]), let found = validDate(Int(g[3]) ?? 0, month, Int(g[2]) ?? 0) { return found }
        }
        return nil
    }

    /// "1.234,56" / "1,234.56" / "12,5" → number (`parse_amount`).
    static func parseAmount(_ raw: String) -> Double? {
        var text = raw.trimmingCharacters(in: .whitespaces)
        if text.contains(","), text.contains(".") {
            let comma = text.range(of: ",", options: .backwards)!.lowerBound
            let dot = text.range(of: ".", options: .backwards)!.lowerBound
            let decimal: Character = comma > dot ? "," : "."
            let thousands: Character = decimal == "," ? "." : ","
            text = String(text.filter { $0 != thousands }.map { $0 == decimal ? "." : $0 })
        } else if text.contains(",") || text.contains(".") {
            let separator: Character = text.contains(",") ? "," : "."
            let parts = text.split(separator: separator, omittingEmptySubsequences: false)
            let tail = parts.last ?? ""
            let head = parts.dropLast().joined()
            text = tail.count <= 2 ? "\(head).\(tail)" : text.filter { $0 != separator }
        }
        return Double(text)
    }

    /// The largest amount written next to a currency, formatted with two decimals.
    static func findAmount(_ text: String) -> String {
        var best: Double?
        for g in matches(amountSuffix, text) { if let value = parseAmount(g[1]) { best = max(best ?? value, value) } }
        for g in matches(amountPrefix, text) { if let value = parseAmount(g[2]) { best = max(best ?? value, value) } }
        return best.map { String(format: "%.2f", locale: Locale(identifier: "en_US_POSIX"), $0) } ?? ""
    }

    static func findInvoice(_ text: String) -> String {
        guard let first = matches(invoice, text).first else { return "" }
        return first[1].trimmingCharacters(in: CharacterSet(charactersIn: " -/"))
    }

    /// Drops "Microsoft Word - " prefixes, source extensions and placeholder titles.
    static func cleanTitle(_ raw: String) -> String {
        var title = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let ns = NSMutableString(string: title)
        officePrefix.replaceMatches(in: ns, range: NSRange(location: 0, length: ns.length), withTemplate: "")
        sourceExtension.replaceMatches(in: ns, range: NSRange(location: 0, length: ns.length), withTemplate: "")
        title = (ns as String).trimmingCharacters(in: .whitespaces)
        return placeholderTitles.contains(title.lowercased()) ? "" : title
    }

    /// strftime subset (`%Y %y %m %d %B %b %H %M %S %j %%`); other directives are rejected like on desktop.
    static func formatDate(_ components: DateComponents, _ format: String) throws -> String {
        var result = ""
        var chars = Array(format)[...]
        let calendar = Calendar(identifier: .gregorian)
        let date = calendar.date(from: components) ?? Date()
        let englishMonths = DateFormatter().monthSymbols ?? []
        while let char = chars.popFirst() {
            guard char == "%" else { result.append(char); continue }
            guard var code = chars.popFirst() else { throw EngineError(.INVALID_PARAMS, reason: "dateFormat") }
            if code == "-", let next = chars.popFirst() { code = next }
            let y = components.year ?? 0, m = components.month ?? 1, d = components.day ?? 1
            switch code {
            case "Y": result += String(format: "%04d", y)
            case "y": result += String(format: "%02d", y % 100)
            case "m": result += String(format: "%02d", m)
            case "d": result += String(format: "%02d", d)
            case "B": result += englishMonths.indices.contains(m - 1) ? englishMonths[m - 1] : ""
            case "b": result += englishMonths.indices.contains(m - 1) ? String(englishMonths[m - 1].prefix(3)) : ""
            case "j": result += String(format: "%03d", calendar.ordinality(of: .day, in: .year, for: date) ?? 1)
            case "H", "M", "S": result += "00"
            case "%": result += "%"
            default: throw EngineError(.INVALID_PARAMS, reason: "dateFormat")
            }
        }
        return result
    }

    // MARK: - Document facts

    struct Facts: Sendable {
        var text: String
        var title: String
        var author: String
        var subject: String
        var pages: Int
        var metadataDate: DateComponents?
        var recognised = false
    }

    /// The longest-font line of a page (≥ 3 characters), used as a title fallback.
    static func largestTextLine(_ page: PDFPage) -> String {
        guard let attributed = page.attributedString else { return "" }
        let ns = attributed.string as NSString
        var best = ""
        var bestSize: CGFloat = 0
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: .byLines) { line, range, _, _ in
            guard let line else { return }
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.count >= 3 else { return }
            var size: CGFloat = 0
            attributed.enumerateAttribute(.font, in: range) { value, _, _ in
                if let font = value as? UIFont { size = max(size, font.pointSize) }
            }
            if size > bestSize { bestSize = size; best = trimmed }
        }
        return String(best.prefix(titleMaxCharacters))
    }

    /// Vision text recognition of a page rendered at `ocrDPI`; returns the text and its tallest line.
    static func recognise(_ page: PDFPage, languages: [String]) throws -> (text: String, title: String) {
        let bounds = page.bounds(for: .cropBox)
        let scale = ocrDPI / 72
        let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        let image = page.thumbnail(of: size, for: .cropBox)
        guard let cgImage = image.cgImage else { return ("", "") }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        if !languages.isEmpty { request.recognitionLanguages = languages }
        try VNImageRequestHandler(cgImage: cgImage).perform([request])
        let observations = (request.results ?? []).sorted { $0.boundingBox.maxY > $1.boundingBox.maxY }
        var tallest: (height: CGFloat, text: String) = (0, "")
        var lines: [String] = []
        for observation in observations {
            guard let text = observation.topCandidates(1).first?.string else { continue }
            lines.append(text)
            if text.count >= 3, observation.boundingBox.height > tallest.height { tallest = (observation.boundingBox.height, text) }
        }
        return (lines.joined(separator: "\n"), String(tallest.text.prefix(titleMaxCharacters)))
    }

    static func readFacts(_ document: PDFDocument, maxPages: Int, ocrLanguages: [String]?) throws -> Facts {
        let attributes = document.documentAttributes ?? [:]
        let count = min(maxPages, document.pageCount)
        var text = (0..<count).compactMap { document.page(at: $0)?.string }.joined(separator: "\n")
        var title = cleanTitle(attributes[PDFDocumentAttribute.titleAttribute] as? String ?? "")
        var recognised = false
        if let ocrLanguages, count > 0, text.trimmingCharacters(in: .whitespacesAndNewlines).count < ocrTextThreshold {
            var parts: [String] = []
            for index in 0..<count {
                try Task.checkCancellation()
                guard let page = document.page(at: index) else { continue }
                let found = try recognise(page, languages: ocrLanguages)
                parts.append(found.text)
                if title.isEmpty, index == 0 { title = found.title }
            }
            text = parts.joined(separator: "\n")
            recognised = true
        }
        if title.isEmpty, let first = document.page(at: 0) { title = largestTextLine(first) }
        var metadataDate: DateComponents?
        if let created = attributes[PDFDocumentAttribute.creationDateAttribute] as? Date {
            let c = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: created)
            metadataDate = validDate(c.year ?? 0, c.month ?? 0, c.day ?? 0)
        }
        return Facts(text: text, title: title,
                     author: (attributes[PDFDocumentAttribute.authorAttribute] as? String ?? "").trimmingCharacters(in: .whitespaces),
                     subject: (attributes[PDFDocumentAttribute.subjectAttribute] as? String ?? "").trimmingCharacters(in: .whitespaces),
                     pages: document.pageCount, metadataDate: metadataDate, recognised: recognised)
    }

    static func fields(_ facts: Facts, url: URL, custom: [String: NSRegularExpression], dateFormat: String, dateOrder: DateOrder) throws -> [String: String] {
        let found = findDate(facts.text, order: dateOrder) ?? facts.metadataDate
        var fields: [String: String] = [
            "name": url.deletingPathExtension().lastPathComponent,
            "ext": url.pathExtension,
            "pages": String(facts.pages),
            "title": facts.title,
            "author": facts.author,
            "subject": facts.subject,
            "date": try found.map { try formatDate($0, dateFormat) } ?? "",
            "year": found?.year.map(String.init) ?? "",
            "invoice": findInvoice(facts.text),
            "amount": findAmount(facts.text),
        ]
        for (key, pattern) in custom {
            let match = matches(pattern, facts.text).first
            let value = match.map { $0.count > 1 ? $0[1] : $0[0] } ?? ""
            fields[key] = value.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return fields
    }

    // MARK: - Names

    struct Replacement: Hashable {
        var find: String
        var replace: String
        var regex: Bool
    }

    struct Rules {
        var pattern: String
        var replacements: [(NSRegularExpression, String)]
        var nameCase: NameCase
        var turkish: Bool
    }

    static func compileReplacements(_ replacements: [Replacement]) throws -> [(NSRegularExpression, String)] {
        try replacements.filter { !$0.find.isEmpty }.map { item in
            let pattern = item.regex ? item.find : NSRegularExpression.escapedPattern(for: item.find)
            guard let compiled = try? NSRegularExpression(pattern: pattern) else { throw EngineError(.INVALID_PARAMS, reason: "replacement") }
            // Python-style \1 back-references become ICU $1; literal replacements are escaped.
            let template = item.regex ? FileNaming.replace(item.replace.replacingOccurrences(of: "$", with: "\\$"), #"\\(\d)"#, with: "\\$$1")
                                      : NSRegularExpression.escapedTemplate(for: item.replace)
            return (compiled, template)
        }
    }

    static func changeCase(_ text: String, _ nameCase: NameCase, turkish: Bool = false) -> String {
        switch nameCase {
        case .keep: return text
        case .upper:
            return (turkish ? text.replacingOccurrences(of: "i", with: "İ").replacingOccurrences(of: "ı", with: "I") : text).uppercased()
        case .lower:
            return (turkish ? text.replacingOccurrences(of: "I", with: "ı").replacingOccurrences(of: "İ", with: "i") : text).lowercased()
        case .title:
            guard let words = try? NSRegularExpression(pattern: #"[^\W\d_]+"#) else { return text }
            let ns = text as NSString
            var result = ""
            var last = 0
            for match in words.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
                result += ns.substring(with: NSRange(location: last, length: match.range.location - last))
                let word = ns.substring(with: match.range)
                result += changeCase(String(word.prefix(1)), .upper, turkish: turkish) + changeCase(String(word.dropFirst()), .lower, turkish: turkish)
                last = match.range.location + match.range.length
            }
            return result + ns.substring(from: last)
        }
    }

    static func segments(_ pattern: String) -> [String] {
        pattern.split(whereSeparator: { $0 == "/" || $0 == "\\" }).map(String.init)
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    /// Renders the pattern for one file; empty folder segments are dropped and an empty name falls back.
    static func buildName(_ rules: Rules, fields: [String: String], fallback: String) -> String {
        let parts = Array(segments(rules.pattern).suffix(maxFolderDepth + 1))
        var rendered: [String] = []
        for (position, segment) in parts.enumerated() {
            let last = position == parts.count - 1
            var text = FileNaming.fillTokens(segment, fields)
            for (regex, template) in rules.replacements {
                text = regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
            }
            text = changeCase(text, rules.nameCase, turkish: rules.turkish)
            if text.trimmingCharacters(in: CharacterSet(charactersIn: " ._-")).isEmpty {
                if last { rendered.append(FileNaming.sanitize(fallback)) }
                continue
            }
            rendered.append(FileNaming.sanitize(text))
        }
        return rendered.isEmpty ? FileNaming.sanitize(fallback) : rendered.joined(separator: "/")
    }

    static func cleanOverride(_ value: String, fallback: String) -> String {
        let parts = segments(value).map(FileNaming.sanitize).suffix(maxFolderDepth + 1)
        return parts.isEmpty ? FileNaming.sanitize(fallback) : parts.joined(separator: "/")
    }

    /// `{n}`: start + position × step, zero-padded to `digits` (0 = as wide as the last number).
    static func counter(start: Int, step: Int, digits: Int, total: Int, position: Int) -> String {
        let last = start + max(total - 1, 0) * step
        let width = max(digits, digits == 0 ? String(last).count : 0)
        let value = String(start + position * step)
        return String(repeating: "0", count: max(0, width - value.count)) + value
    }

    /// Tokens in the pattern that no field fills (shown as a warning).
    static func unknownTokens(_ pattern: String, known: [String]) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: #"\{([^{}]*)\}"#) else { return [] }
        var found: [String] = []
        for g in matches(regex, pattern) {
            let name = g[1].trimmingCharacters(in: .whitespaces)
            if !name.isEmpty, !known.contains(name), !found.contains(name) { found.append(name) }
        }
        return found
    }

    // MARK: - Preview

    struct Options: Sendable {
        var pattern = "{date} {title}"
        var customRegex = ""
        var dateFormat = "%Y-%m-%d"
        var dateOrder: DateOrder = .dmy
        var counterStart = 1
        var counterStep = 1
        var counterDigits = 0
        var nameCase: NameCase = .keep
        var turkishCase = false
        var replacements: [Replacement] = []
        var overrides: [URL: String] = [:]
        var passwords: [URL: String] = [:]
        /// Vision languages; nil = no OCR.
        var ocrLanguages: [String]?
        var maxPages = 2
    }

    struct Item: Identifiable, Sendable, Hashable {
        var url: URL
        var newName: String
        var fields: [String: String]
        var conflict = false
        var error: EngineError.Code?
        var bytes: Int64 = 0
        var modified: Date?
        var recognised = false
        var id: URL { url }
    }

    private static let factsCache = FactsCache()

    static func preview(_ urls: [URL], options: Options, progress: ProgressHandler? = nil) async throws -> [Item] {
        guard !options.pattern.trimmingCharacters(in: .whitespaces).isEmpty else { return [] }
        var custom: [String: NSRegularExpression] = [:]
        if !options.customRegex.trimmingCharacters(in: .whitespaces).isEmpty {
            guard let compiled = try? NSRegularExpression(pattern: options.customRegex, options: .caseInsensitive) else {
                throw EngineError(.INVALID_PARAMS, detail: options.customRegex)
            }
            custom[customToken] = compiled
        }
        _ = try formatDate(DateComponents(year: 2000, month: 1, day: 31), options.dateFormat)
        let rules = Rules(pattern: options.pattern, replacements: try compileReplacements(options.replacements),
                          nameCase: options.nameCase, turkish: options.turkishCase)
        let reporter = ProgressReporter(total: urls.count, progress)
        let timeFormatter = DateFormatter()
        timeFormatter.dateFormat = "HH-mm-ss"
        var items: [Item] = []
        for (position, url) in urls.enumerated() {
            try Task.checkCancellation()
            let stem = url.deletingPathExtension().lastPathComponent
            let values = withSecurityScope(url) { try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey]) }
            var item = Item(url: url, newName: stem, fields: [:], bytes: Int64(values?.fileSize ?? 0), modified: values?.contentModificationDate)
            do {
                let facts = try factsCache.facts(for: url, modified: item.modified, size: item.bytes, password: options.passwords[url],
                                                 maxPages: options.maxPages, ocrLanguages: options.ocrLanguages)
                var fields = try self.fields(facts, url: url, custom: custom, dateFormat: options.dateFormat, dateOrder: options.dateOrder)
                fields["n"] = fields["n"] ?? counter(start: options.counterStart, step: options.counterStep, digits: options.counterDigits,
                                                     total: urls.count, position: position)
                fields["time"] = fields["time"] ?? timeFormatter.string(from: Date())
                if let override = options.overrides[url], !override.trimmingCharacters(in: .whitespaces).isEmpty {
                    item.newName = cleanOverride(override, fallback: stem)
                } else {
                    item.newName = buildName(rules, fields: fields, fallback: stem)
                }
                item.fields = fields
                item.recognised = facts.recognised
            } catch let error as EngineError where error.code == .NEEDS_PASSWORD || error.code == .INVALID_PDF || error.code == .FILE_NOT_FOUND {
                item.error = error.code
            }
            items.append(item)
            try reporter.step(position + 1)
        }
        markConflicts(&items)
        return items
    }

    static func target(of item: Item, base: URL? = nil) -> URL {
        let parts = segments(item.newName)
        var directory = base ?? item.url.deletingLastPathComponent()
        for folder in parts.dropLast() { directory.appendPathComponent(folder, isDirectory: true) }
        let name = parts.last ?? FileNaming.fallbackName
        return directory.appendingPathComponent(name).appendingPathExtension(item.url.pathExtension)
    }

    /// Two files claiming one name, or a name already used by another file, is a conflict.
    static func markConflicts(_ items: inout [Item]) {
        let vacating = Set(items.filter { $0.error == nil && $0.newName != $0.url.deletingPathExtension().lastPathComponent }
            .map { $0.url.standardizedFileURL.path.lowercased() })
        var claimed = Set<String>()
        for index in items.indices where items[index].error == nil {
            let item = items[index]
            let target = target(of: item)
            let key = target.standardizedFileURL.path.lowercased()
            let source = item.url.standardizedFileURL.path.lowercased()
            let exists = withSecurityScope(item.url) { FileManager.default.fileExists(atPath: target.path) }
            let occupied = exists && !vacating.contains(key) && key != source
            items[index].conflict = claimed.contains(key) || occupied
            claimed.insert(key)
        }
    }

    // MARK: - Apply & undo

    struct Outcome: Hashable, Sendable {
        var source: URL
        var output: URL?
        var ok: Bool
        var error: String?
        var replaced = false
        /// Renaming in place was refused by the file provider, so a renamed copy went to the vivePDF folder.
        var copiedInstead = false
    }

    struct ApplyResult: Sendable {
        var outcomes: [Outcome]
        var renamed: Int
        var createdDirectories: [URL]
        var undo: UndoPlan? {
            let moves = outcomes.filter { $0.ok && !$0.copiedInstead && $0.output != nil && $0.output != $0.source }
                .map { (current: $0.output!, original: $0.source) }
            return moves.isEmpty ? nil : UndoPlan(moves: moves, directories: createdDirectories, replaced: outcomes.filter(\.replaced).count)
        }
    }

    struct UndoPlan: Sendable {
        var moves: [(current: URL, original: URL)]
        var directories: [URL]
        var replaced: Int
    }

    private static func coordinatedMove(from source: URL, to target: URL, replacing: Bool) throws {
        var coordError: NSError?
        var moveError: Error?
        NSFileCoordinator().coordinate(writingItemAt: source, options: .forMoving, writingItemAt: target, options: .forReplacing, error: &coordError) { from, to in
            do {
                if replacing, FileManager.default.fileExists(atPath: to.path), from.standardizedFileURL != to.standardizedFileURL {
                    _ = try FileManager.default.replaceItemAt(to, withItemAt: from)
                } else {
                    try FileManager.default.moveItem(at: from, to: to)
                }
            } catch { moveError = error }
        }
        if let error = coordError ?? moveError { throw error }
    }

    private static func coordinatedCopy(from source: URL, to target: URL, replacing: Bool) throws {
        var coordError: NSError?
        var copyError: Error?
        NSFileCoordinator().coordinate(readingItemAt: source, options: .withoutChanges, error: &coordError) { from in
            do {
                if replacing, FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
                try FileManager.default.copyItem(at: from, to: target)
            } catch { copyError = error }
        }
        if let error = coordError ?? copyError { throw error }
    }

    /// Renames (or copies into `outputDirectory`) every item. Name clashes follow `policy`; files that cannot be
    /// renamed where they are (read-only file providers) get a renamed copy in the vivePDF folder instead.
    static func apply(_ items: [Item], mode: Mode, outputDirectory: URL?, policy: ConflictPolicy, progress: ProgressHandler? = nil) async throws -> ApplyResult {
        let fm = FileManager.default
        let reporter = ProgressReporter(total: items.count, progress)
        var outcomes: [Outcome] = []
        var created: [URL] = []
        var taken: [String: Set<String>] = [:]
        var renamed = 0
        let leaving = Set(items.map { $0.url.standardizedFileURL.path.lowercased() })

        func takenNames(in directory: URL, ext: String) -> Set<String> {
            let key = directory.standardizedFileURL.path.lowercased() + "|" + ext.lowercased()
            if let cached = taken[key] { return cached }
            let listed = ((try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [])
                .filter { $0.pathExtension.lowercased() == ext.lowercased() }
                .filter { mode == .copy || !leaving.contains($0.standardizedFileURL.path.lowercased()) }
                .map { $0.deletingPathExtension().lastPathComponent.lowercased() }
            taken[key] = Set(listed)
            return taken[key]!
        }

        for (position, item) in items.enumerated() {
            try Task.checkCancellation()
            let scoped = item.url.startAccessingSecurityScopedResource()
            defer { if scoped { item.url.stopAccessingSecurityScopedResource() } }
            var target = target(of: item, base: mode == .copy ? outputDirectory : nil)
            let directory = target.deletingLastPathComponent()
            let ext = item.url.pathExtension
            let sameFile = target.standardizedFileURL.path.lowercased() == item.url.standardizedFileURL.path.lowercased()
            var names = takenNames(in: directory, ext: ext)
            var name = target.deletingPathExtension().lastPathComponent
            if !sameFile {
                switch policy {
                case .number:
                    name = FileNaming.unique(name, taken: &names)
                    target = directory.appendingPathComponent(name).appendingPathExtension(ext)
                case .skip:
                    if names.contains(name.lowercased()) || fm.fileExists(atPath: target.path) {
                        outcomes.append(Outcome(source: item.url, output: target, ok: false, error: "EXISTS"))
                        try reporter.step(position + 1)
                        continue
                    }
                    names.insert(name.lowercased())
                case .overwrite:
                    names.insert(name.lowercased())
                }
            }
            taken[directory.standardizedFileURL.path.lowercased() + "|" + ext.lowercased()] = names
            if sameFile, mode == .rename, target.lastPathComponent == item.url.lastPathComponent {
                outcomes.append(Outcome(source: item.url, output: item.url, ok: true))
                try reporter.step(position + 1)
                continue
            }
            do {
                var missing: [URL] = []
                var current = directory
                let base = mode == .copy ? (outputDirectory ?? directory) : item.url.deletingLastPathComponent()
                while !fm.fileExists(atPath: current.path), current.standardizedFileURL.path.count > base.standardizedFileURL.path.count {
                    missing.append(current)
                    current = current.deletingLastPathComponent()
                }
                if !missing.isEmpty {
                    try fm.createDirectory(at: directory, withIntermediateDirectories: true)
                    created += missing.reversed()
                }
                let replaced = !sameFile && fm.fileExists(atPath: target.path)
                if mode == .rename {
                    try coordinatedMove(from: item.url, to: target, replacing: policy == .overwrite)
                } else {
                    try coordinatedCopy(from: item.url, to: target, replacing: policy == .overwrite)
                }
                renamed += 1
                outcomes.append(Outcome(source: item.url, output: target, ok: true, replaced: replaced))
            } catch {
                if mode == .rename, (error as NSError).domain == NSCocoaErrorDomain {
                    // No write access to the file's folder (single file picked from another app): copy instead.
                    let fallback = Workspace.unique(name: name, ext: ext, in: Workspace.outputFolder)
                    if (try? coordinatedCopy(from: item.url, to: fallback, replacing: false)) != nil {
                        renamed += 1
                        outcomes.append(Outcome(source: item.url, output: fallback, ok: true, copiedInstead: true))
                        try reporter.step(position + 1)
                        continue
                    }
                }
                outcomes.append(Outcome(source: item.url, output: nil, ok: false, error: error.localizedDescription))
            }
            try reporter.step(position + 1)
        }
        return ApplyResult(outcomes: outcomes, renamed: renamed, createdDirectories: created)
    }

    /// Moves renamed files back; folders the rename created are removed when empty.
    static func undo(_ plan: UndoPlan) async throws -> (restored: Int, failed: Int, moved: [URL: URL]) {
        var restored = 0, failed = 0
        var moved: [URL: URL] = [:]
        for move in plan.moves {
            try Task.checkCancellation()
            let scoped = move.original.startAccessingSecurityScopedResource()
            defer { if scoped { move.original.stopAccessingSecurityScopedResource() } }
            if FileManager.default.fileExists(atPath: move.original.path) { failed += 1; continue }
            do {
                try coordinatedMove(from: move.current, to: move.original, replacing: false)
                moved[move.current] = move.original
                restored += 1
            } catch {
                failed += 1
            }
        }
        for directory in plan.directories.sorted(by: { $0.path.count > $1.path.count }) {
            if (try? FileManager.default.contentsOfDirectory(atPath: directory.path))?.isEmpty == true {
                try? FileManager.default.removeItem(at: directory)
            }
        }
        return (restored, failed, moved)
    }
}

/// Facts keyed by file + modification date + size + OCR settings, so editing the pattern does not re-read files.
private final class FactsCache: @unchecked Sendable {
    private var storage: [String: RenameEngine.Facts] = [:]
    private var order: [String] = []
    private let lock = NSLock()
    private let limit = 400

    func facts(for url: URL, modified: Date?, size: Int64, password: String?, maxPages: Int, ocrLanguages: [String]?) throws -> RenameEngine.Facts {
        let key = "\(url.path)|\(modified?.timeIntervalSince1970 ?? 0)|\(size)|\(maxPages)|\(ocrLanguages?.joined(separator: "+") ?? "")"
        lock.lock()
        if let cached = storage[key] { lock.unlock(); return cached }
        lock.unlock()
        let facts: RenameEngine.Facts = try withSecurityScope(url) {
            guard FileManager.default.fileExists(atPath: url.path) else { throw EngineError(.FILE_NOT_FOUND) }
            guard let document = PDFDocument(url: url) else { throw EngineError(.INVALID_PDF) }
            if document.isLocked {
                guard let password, document.unlock(withPassword: password) else { throw EngineError(.NEEDS_PASSWORD) }
            }
            return try RenameEngine.readFacts(document, maxPages: maxPages, ocrLanguages: ocrLanguages)
        }
        lock.lock()
        storage[key] = facts
        order.append(key)
        if order.count > limit { storage[order.removeFirst()] = nil }
        lock.unlock()
        return facts
    }
}
