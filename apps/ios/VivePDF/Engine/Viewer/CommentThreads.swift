import CoreGraphics
import Foundation
import PDFKit
import UIKit

/// PDFKit can't create `/IRT` reply links, so replies made on iOS carry the parent's `/NM` in this key.
/// Replies read from files use the real `/IRT` (found through Core Graphics); both count as replies.
let commentReplyKey = PDFAnnotationKey(rawValue: "/VivePDFIRT")

extension PDFAnnotation {
    /// `/NM` (unique annotation name).
    var commentName: String? {
        get { (value(forAnnotationKey: PDFAnnotationKey(rawValue: "/NM")) as? String).flatMap { $0.isEmpty ? nil : $0 } }
        set { setValue(newValue ?? "", forAnnotationKey: PDFAnnotationKey(rawValue: "/NM")) }
    }

    func stringValue(_ key: String) -> String? {
        let value = value(forAnnotationKey: PDFAnnotationKey(rawValue: "/" + key))
        if let text = value as? String { return text.isEmpty ? nil : text }
        return nil
    }

    func setString(_ value: String?, for key: String) {
        setValue(value ?? "", forAnnotationKey: PDFAnnotationKey(rawValue: "/" + key))
    }

    /// Subtype without the leading slash ("Highlight", "Text"…).
    var subtypeName: String { (type ?? "").replacingOccurrences(of: "/", with: "") }
}

/// One annotation as the comments panel shows it (desktop `CommentItem`).
struct CommentRecord: Identifiable, Hashable {
    let id: String
    let annotation: PDFAnnotation
    let pageIndex: Int
    let type: String
    let author: String
    let subject: String
    let content: String
    let created: Date?
    let modified: Date?
    let color: UIColor?
    let rect: CGRect
    let quote: String
    let parentID: String?
    /// Shown review state (Accepted/Rejected/Cancelled/Completed); nil = none.
    let state: String?

    var resolved: Bool { state == CommentThreads.completed }
    var isReply: Bool { parentID != nil }

    static func == (lhs: CommentRecord, rhs: CommentRecord) -> Bool {
        lhs.id == rhs.id && lhs.content == rhs.content && lhs.state == rhs.state && lhs.parentID == rhs.parentID && lhs.modified == rhs.modified
    }

    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// Everything the panel needs, read in one pass over the document.
struct CommentCollection {
    var records: [CommentRecord] = []
    /// Every annotation by name with its parent name (state replies included), for cascading deletes.
    var nodes: [String: (annotation: PDFAnnotation, parent: String?)] = [:]
    var authors: [String] { Array(Set(records.map(\.author).filter { !$0.isEmpty })).sorted() }
    var types: [String] { Array(Set(records.map(\.type))).sorted() }

    /// All names below `roots` in the reply tree (desktop `descendants`).
    func descendants(of roots: Set<String>) -> Set<String> {
        var children: [String: [String]] = [:]
        for (name, node) in nodes { if let parent = node.parent { children[parent, default: []].append(name) } }
        var found: Set<String> = []
        var pending = Array(roots)
        while let next = pending.popLast() {
            for child in children[next] ?? [] where !found.contains(child) && !roots.contains(child) {
                found.insert(child)
                pending.append(child)
            }
        }
        return found
    }
}

/// One thread row: a record and its reply depth (desktop `commentThreads`).
struct CommentThreadEntry: Identifiable, Hashable {
    let record: CommentRecord
    let depth: Int
    var id: String { record.id }
}

enum CommentThreads {
    static let excludedTypes: Set<String> = ["Link", "Widget", "Popup"]
    static let markupTypes: Set<String> = ["Highlight", "Underline", "StrikeOut", "Squiggly"]
    static let reviewModel = "Review"
    static let completed = "Completed"
    static let cleared = "None"
    static let reviewStates = ["Accepted", "Rejected", "Cancelled", "Completed", "None"]
    static let legacyResolvedSubject = "Resolved"
    /// Flags as written by the sidecar: state replies are hidden; replies print but don't draw a second icon
    /// on screen (no-view), since PDFKit can't fold them into the parent's popup.
    static let stateFlags = 30
    static let replyFlags = 60
    static let quoteLimit = 4000

    // MARK: Names

    /// Gives every annotation a unique `/NM`, so threads, duplicates and exports can refer to it by name.
    static func ensureNames(_ pdf: PDFDocument) {
        var seen: Set<String> = []
        for index in 0..<pdf.pageCount {
            guard let page = pdf.page(at: index) else { continue }
            for annotation in page.annotations where !excludedTypes.contains(annotation.subtypeName) {
                if let name = annotation.commentName, !seen.contains(name) {
                    seen.insert(name)
                    continue
                }
                let fresh = "vivepdf-\(UUID().uuidString.lowercased())"
                annotation.commentName = fresh
                seen.insert(fresh)
            }
        }
    }

    /// The annotation's `/NM`, assigning a fresh one when it has none.
    static func name(of annotation: PDFAnnotation) -> String {
        if let name = annotation.commentName { return name }
        let fresh = "vivepdf-\(UUID().uuidString.lowercased())"
        annotation.commentName = fresh
        return fresh
    }

    // MARK: Reading

    static func collect(_ pdf: PDFDocument, password: String? = nil) -> CommentCollection {
        ensureNames(pdf)
        let raw = CommentRawSnapshot(pdf, password: password)
        var collection = CommentCollection()
        var nodes: [(annotation: PDFAnnotation, page: Int, name: String, parent: String?)] = []
        for index in 0..<pdf.pageCount {
            guard let page = pdf.page(at: index) else { continue }
            for annotation in page.annotations where !excludedTypes.contains(annotation.subtypeName) {
                guard let name = annotation.commentName else { continue }
                let parent = annotation.stringValue(String(commentReplyKey.rawValue.dropFirst())) ?? raw?.parent(of: name)
                nodes.append((annotation, index, name, parent == name ? nil : parent))
            }
        }
        let known = Set(nodes.map(\.name))
        var states: [String: String] = [:]
        for node in nodes {
            collection.nodes[node.name] = (node.annotation, node.parent.flatMap { known.contains($0) ? $0 : nil })
            if let parent = node.parent, isStateReply(node.annotation),
               (node.annotation.stringValue("StateModel") ?? "").caseInsensitiveCompare(reviewModel) == .orderedSame {
                states[parent] = node.annotation.stringValue("State") ?? ""
            }
        }
        for node in nodes {
            if node.parent != nil, isStateReply(node.annotation) { continue }
            let annotation = node.annotation
            let type = annotation.subtypeName
            let subject = annotation.stringValue("Subj") ?? ""
            var quote = ""
            if markupTypes.contains(type), let page = annotation.page {
                quote = markedText(annotation, on: page)
            }
            collection.records.append(CommentRecord(
                id: node.name,
                annotation: annotation,
                pageIndex: node.page,
                type: type,
                author: annotation.userName ?? "",
                subject: subject,
                content: annotation.contents ?? "",
                created: annotation.stringValue("CreationDate").flatMap(parseDate),
                modified: modificationDate(of: annotation),
                color: annotation.color == .clear ? nil : annotation.color,
                rect: annotation.bounds,
                quote: quote,
                parentID: node.parent.flatMap { known.contains($0) ? $0 : nil },
                state: shownState(states[node.name], subject: subject)))
        }
        return collection
    }

    /// `/M` may hold a date or (from some writers) a raw string; never let PDFKit bridge a string as a date.
    static func modificationDate(of annotation: PDFAnnotation) -> Date? {
        let value = annotation.value(forAnnotationKey: .date)
        if let date = value as? Date { return date }
        if let text = value as? String { return parseDate(text) }
        return nil
    }

    static func isStateReply(_ annotation: PDFAnnotation) -> Bool {
        annotation.stringValue("StateModel") != nil
    }

    static func shownState(_ state: String?, subject: String) -> String? {
        if let state {
            let known = reviewStates.first { $0.caseInsensitiveCompare(state) == .orderedSame }
            return known == nil || known == cleared ? nil : known
        }
        return subject.trimmingCharacters(in: .whitespaces).caseInsensitiveCompare(legacyResolvedSubject) == .orderedSame ? completed : nil
    }

    /// Text under a text-markup annotation's quadrilaterals (desktop `marked_text`).
    static func markedText(_ annotation: PDFAnnotation, on page: PDFPage) -> String {
        let origin = annotation.bounds.origin
        let points = (annotation.quadrilateralPoints ?? []).map { $0.cgPointValue }
        var areas: [CGRect] = []
        var start = 0
        while start + 3 < points.count {
            let quad = points[start..<start + 4].map { CGPoint(x: $0.x + origin.x, y: $0.y + origin.y) }
            let xs = quad.map(\.x), ys = quad.map(\.y)
            areas.append(CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!))
            start += 4
        }
        if areas.isEmpty { areas = [annotation.bounds] }
        let lines = areas.compactMap { area -> String? in
            // Shrink vertically so neighbouring lines that merely touch the box are not picked up.
            let core = area.insetBy(dx: 0, dy: area.height * 0.25)
            return page.selection(for: core)?.string?.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { !$0.isEmpty }
        var text = lines.joined(separator: " ")
        text = joinBrokenWords(text)
        text = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return String(text.prefix(quoteLimit))
    }

    static func joinBrokenWords(_ text: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: "(\\p{L})[-‐] (\\p{Ll})") else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: "$1$2")
    }

    /// Orders records into threads, keeping only roots that pass `keepRoot` (with all their replies).
    static func threads(_ records: [CommentRecord], keepRoot: (CommentRecord) -> Bool) -> [CommentThreadEntry] {
        let known = Set(records.map(\.id))
        var children: [String: [CommentRecord]] = [:]
        var roots: [CommentRecord] = []
        for record in records {
            if let parent = record.parentID, known.contains(parent), parent != record.id {
                children[parent, default: []].append(record)
            } else {
                roots.append(record)
            }
        }
        var entries: [CommentThreadEntry] = []
        var visited: Set<String> = []
        func walk(_ record: CommentRecord, _ depth: Int) {
            guard !visited.contains(record.id) else { return }
            visited.insert(record.id)
            entries.append(CommentThreadEntry(record: record, depth: depth))
            for child in children[record.id] ?? [] { walk(child, depth + 1) }
        }
        var reachable: Set<String> = []
        func reach(_ record: CommentRecord) {
            guard !reachable.contains(record.id) else { return }
            reachable.insert(record.id)
            for child in children[record.id] ?? [] { reach(child) }
        }
        roots.forEach(reach)
        for root in roots where keepRoot(root) { walk(root, 0) }
        // Reply cycles have no root: show them once, flat.
        for record in records where !visited.contains(record.id) && !reachable.contains(record.id) && keepRoot(record) { walk(record, 0) }
        return entries
    }

    // MARK: Editing (in memory; the viewer saves the document)

    /// A reply note under `parent` (sidecar `add_reply`).
    @discardableResult
    static func addReply(to parent: PDFAnnotation, content: String, author: String?) -> PDFAnnotation? {
        guard let page = parent.page else { return nil }
        let parentName = name(of: parent)
        let reply = PDFAnnotation(bounds: parent.bounds, forType: .text, withProperties: nil)
        reply.contents = content
        reply.iconType = .comment
        configureReply(reply, parentName: parentName, author: author, flags: replyFlags, prefix: "vivepdf-reply")
        reply.setString("R", for: "RT")
        page.addAnnotation(reply)
        return reply
    }

    /// A review-state reply (sidecar `add_review_state`).
    @discardableResult
    static func addState(_ state: String, to parent: PDFAnnotation, author: String?) -> PDFAnnotation? {
        guard let page = parent.page else { return nil }
        let parentName = name(of: parent)
        let reply = PDFAnnotation(bounds: parent.bounds, forType: .text, withProperties: nil)
        configureReply(reply, parentName: parentName, author: author, flags: stateFlags, prefix: "vivepdf-state")
        reply.setString(state, for: "State")
        reply.setString(reviewModel, for: "StateModel")
        page.addAnnotation(reply)
        return reply
    }

    private static func configureReply(_ reply: PDFAnnotation, parentName: String, author: String?, flags: Int, prefix: String) {
        let now = Date()
        reply.modificationDate = now
        reply.setString(pdfDate(now), for: "CreationDate")
        if let author, !author.isEmpty { reply.userName = author }
        reply.commentName = "\(prefix)-\(UUID().uuidString.lowercased())"
        reply.setValue(parentName, forAnnotationKey: commentReplyKey)
        reply.setValue(NSNumber(value: flags), forAnnotationKey: .flags)
        reply.color = .clear
    }

    // MARK: Dates

    static func pdfDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "'D:'yyyyMMddHHmmss'Z'"
        return formatter.string(from: date)
    }

    /// Parses `D:YYYYMMDDHHmmSS±HH'mm'` (every part after the year optional).
    static func parseDate(_ raw: String) -> Date? {
        let text = raw.hasPrefix("D:") ? String(raw.dropFirst(2)) : raw
        let digits = Array(text.prefix { $0.isNumber })
        guard digits.count >= 4 else { return nil }
        func part(_ start: Int, _ length: Int, _ fallback: Int) -> Int {
            guard digits.count >= start + length else { return fallback }
            return Int(String(digits[start..<start + length])) ?? fallback
        }
        var components = DateComponents()
        components.year = part(0, 4, 1970)
        components.month = part(4, 2, 1)
        components.day = part(6, 2, 1)
        components.hour = part(8, 2, 0)
        components.minute = part(10, 2, 0)
        components.second = part(12, 2, 0)
        let rest = text.dropFirst(digits.count)
        var offset = 0
        if let sign = rest.first, sign == "+" || sign == "-" {
            let zone = rest.dropFirst().filter(\.isNumber)
            let hours = Int(zone.prefix(2)) ?? 0
            let minutes = Int(zone.dropFirst(2).prefix(2)) ?? 0
            offset = (hours * 3600 + minutes * 60) * (sign == "-" ? -1 : 1)
        }
        components.timeZone = TimeZone(secondsFromGMT: offset)
        return Calendar(identifier: .gregorian).date(from: components)
    }

    /// Desktop `iso_date`: "2024-05-01 13:45:00".
    static func isoText(_ date: Date?) -> String {
        guard let date else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter.string(from: date)
    }
}

// MARK: - Raw view of the in-memory document

/// One annotation dictionary as written by PDFKit (keys PDFKit does not expose: /IRT, /CA, /BS, /AP…).
struct CommentRawEntry {
    let pageIndex: Int
    let name: String
    let subtype: String
    /// The dictionary without page/parent/action links (`CommentCGReader.droppedKeys`).
    let raw: [String: CommentPDFValue]
    let parentName: String?
}

/// Serialises the live `PDFDocument` and reads its annotation dictionaries through Core Graphics.
struct CommentRawSnapshot {
    let entries: [CommentRawEntry]
    private let parents: [String: String]

    init?(_ pdf: PDFDocument, password: String? = nil) {
        guard let data = pdf.dataRepresentation(),
              let provider = CGDataProvider(data: data as CFData),
              let document = CGPDFDocument(provider) else { return nil }
        if document.isEncrypted, !document.isUnlocked {
            if !document.unlockWithPassword(""), let password { _ = document.unlockWithPassword(password) }
        }
        var entries: [CommentRawEntry] = []
        var parents: [String: String] = [:]
        var reader = CommentCGReader()
        for pageNumber in stride(from: 1, through: document.numberOfPages, by: 1) {
            guard let page = document.page(at: pageNumber), let pageDict = page.dictionary else { continue }
            var annots: CGPDFArrayRef?
            guard CGPDFDictionaryGetArray(pageDict, "Annots", &annots), let annots else { continue }
            for index in 0..<CGPDFArrayGetCount(annots) {
                var dict: CGPDFDictionaryRef?
                guard CGPDFArrayGetDictionary(annots, index, &dict), let dict else { continue }
                let subtype = CommentCGReader.name(dict, "Subtype") ?? ""
                guard !CommentThreads.excludedTypes.contains(subtype) else { continue }
                let name = CommentCGReader.string(dict, "NM") ?? "vivepdf-p\(pageNumber)-\(index)"
                var parent: String?
                var irt: CGPDFDictionaryRef?
                if CGPDFDictionaryGetDictionary(dict, "IRT", &irt), let irt {
                    parent = CommentCGReader.string(irt, "NM")
                }
                if parent == nil { parent = CommentCGReader.string(dict, String(commentReplyKey.rawValue.dropFirst())) }
                if let parent, parent != name { parents[name] = parent }
                reader = CommentCGReader()
                guard case .dict(var raw) = reader.dictionary(dict, dropping: CommentCGReader.droppedKeys) else { continue }
                raw.removeValue(forKey: String(commentReplyKey.rawValue.dropFirst()))
                entries.append(CommentRawEntry(pageIndex: pageNumber - 1, name: name, subtype: subtype, raw: raw, parentName: parents[name]))
            }
        }
        self.entries = entries
        self.parents = parents
    }

    func parent(of name: String) -> String? { parents[name] }
}
