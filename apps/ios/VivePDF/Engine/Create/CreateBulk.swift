import CoreGraphics
import CoreText
import Foundation

struct CreateBulkOptions: Sendable {
    enum Kind: String, CaseIterable, Sendable { case certificate, invitation, badge }
    struct Signer: Sendable, Equatable { var name = ""; var role = "" }

    static let maxRows = 5000
    static let maxSigners = 3

    var data: URL
    var sheet: String?
    var kind: Kind = .certificate
    var heading = ""
    var recipient = ""
    var body = ""
    var details = ""
    var signers: [Signer] = []
    var font: StoryFontFamily = .serif
    var accent = CreateEngine.defaultAccent
    var logo: URL?
    /// One file per row (not for badges).
    var split = false
    var output: URL?
    var outputDirectory: URL?
    var pattern = "{n}"
}

/// Placeholders `{Column}` (not `{{…}}`) filled from a table row (`create_bulk.fill_placeholders`).
enum MergeFields {
    static let builtins: Set<String> = ["name", "file", "n", "total", "date", "time", "year"]

    static func placeholders(_ text: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: #"(?<!\{)\{([^{}]+)\}"#) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        return regex.matches(in: text, range: range).compactMap { Range($0.range(at: 1), in: text).map { String(text[$0]) } }
    }

    static func unknown(_ text: String, columns: [String]) -> [String] {
        let known = builtins.union(columns)
        var out: [String] = []
        for field in placeholders(text) {
            let key = String(field.split(whereSeparator: { $0 == ":" || $0 == "!" }).first ?? Substring(field))
            if !known.contains(key) && !out.contains(key) { out.append(key) }
        }
        return out
    }

    static func fill(_ text: String, values: [String: String]) -> String {
        guard let regex = try? NSRegularExpression(pattern: #"(?<!\{)\{([^{}]+)\}"#) else { return text }
        let ns = text as NSString
        var out = ""
        var last = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: match.range.location - last))
            let key = ns.substring(with: match.range(at: 1))
            out += values[key] ?? ns.substring(with: match.range)
            last = match.range.location + match.range.length
        }
        return out + ns.substring(from: last)
    }

    /// File name from a pattern (`_naming.render_name` + `sanitize_file_name`).
    static func fileName(_ pattern: String, values: [String: String]) -> String {
        var enriched = values
        let now = Date()
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        if enriched["date"] == nil { enriched["date"] = formatter.string(from: now) }
        formatter.dateFormat = "HH-mm-ss"
        if enriched["time"] == nil { enriched["time"] = formatter.string(from: now) }
        if enriched["year"] == nil { enriched["year"] = String(Calendar(identifier: .gregorian).component(.year, from: now)) }
        let text = fill(pattern, values: enriched)
        return sanitize(text)
    }

    static func sanitize(_ value: String) -> String {
        var text = value.replacingOccurrences(of: #"[<>:"/\\|?*\x00-\x1f]"#, with: "-", options: .regularExpression)
        text = text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        text = text.replacingOccurrences(of: #"(?:\s*-\s*)+"#, with: "-", options: .regularExpression)
        text = text.trimmingCharacters(in: CharacterSet(charactersIn: " ._-"))
        if text.count > 120 { text = String(text.prefix(120)) }
        return text.isEmpty ? "output" : text
    }

    static func unique(_ name: String, taken: inout Set<String>) -> String {
        var candidate = name
        var counter = 2
        while taken.contains(candidate.lowercased()) {
            candidate = "\(name)-\(counter)"
            counter += 1
        }
        taken.insert(candidate.lowercased())
        return candidate
    }
}

extension CreateEngine {
    static let badgeSize = CGSize(width: 85 * pointsPerMM, height: 54 * pointsPerMM)

    static func createBulk(_ options: CreateBulkOptions, progress: ProgressHandler?) async throws -> JobResult {
        let table = try withSecurityScope(options.data) { try TableDataReader.read(options.data, sheet: options.sheet) }
        guard !table.rows.isEmpty else { throw EngineError(.INVALID_PARAMS, reason: "noRows") }
        guard table.rows.count <= CreateBulkOptions.maxRows else { throw EngineError(.INVALID_PARAMS, reason: "tooManyRows") }
        let signers = options.kind == .badge ? [] : options.signers.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty || !$0.role.trimmingCharacters(in: .whitespaces).isEmpty }
        var texts = [options.heading, options.recipient, options.body, options.details] + signers.flatMap { [$0.name, $0.role] }
        let separate = options.split && options.kind != .badge
        if separate { texts.append(options.pattern) }
        let unknown = texts.flatMap { MergeFields.unknown($0, columns: table.columns) }
        if !unknown.isEmpty {
            var seen: [String] = []
            for name in unknown where !seen.contains(name) { seen.append(name) }
            throw EngineError(.INVALID_PARAMS, reason: "unknownFields", detail: seen.joined(separator: ", "))
        }
        let logo = try options.logo.map { url in try withSecurityScope(url) { try loadLogo(url) } } ?? nil
        let total = table.rows.count
        func values(_ index: Int) -> [String: String] {
            var row = table.rows[index]
            row["n"] = String(index + 1)
            row["total"] = String(total)
            return row
        }
        var resolved = options
        resolved.signers = signers

        if !separate {
            guard let output = options.output else { throw EngineError(.INVALID_PARAMS, reason: "noOutput") }
            let pages = try renderBulk(resolved, rows: Array(0..<total).map(values), first: 0, total: total, logo: logo, to: output, progress: progress)
            return JobResult(outputs: [output], summary: t("tools.create.bulk.resultCaption", ["count": total, "pages": pages]))
        }
        guard let folder = options.outputDirectory else { throw EngineError(.INVALID_PARAMS, reason: "noOutputDir") }
        Workspace.ensure(folder)
        var taken = Set<String>()
        var outputs: [URL] = []
        for index in 0..<total {
            try Task.checkCancellation()
            let name = MergeFields.unique(MergeFields.fileName(options.pattern, values: values(index)), taken: &taken)
            let target = Workspace.unique(name: name, ext: "pdf", in: folder)
            _ = try renderBulk(resolved, rows: [values(index)], first: index, total: total, logo: logo, to: target, progress: progress)
            outputs.append(target)
        }
        return JobResult(outputs: outputs, summary: t("tools.create.bulk.resultCaption", ["count": total, "pages": total]))
    }

    @discardableResult
    private static func renderBulk(_ options: CreateBulkOptions, rows: [[String: String]], first: Int, total: Int, logo: CGImage?, to url: URL, progress: ProgressHandler?) throws -> Int {
        let sheet: CGSize = switch options.kind {
        case .certificate: paperSize("a4", landscape: true)
        case .invitation: paperSize("a5")
        case .badge: paperSize("a4")
        }
        var box = CGRect(origin: .zero, size: sheet)
        guard let context = CGContext(url as CFURL, mediaBox: &box, StoryRenderer.auxiliaryInfo(StoryMetadata())) else { throw EngineError.internalError("pdf context") }
        let canvas = StoryCanvas(pageSize: sheet)
        var pages = 0
        let slots = badgeSlots(sheet)
        do {
            for (offset, values) in rows.enumerated() {
                try Task.checkCancellation()
                let number = first + offset + 1
                progress?(Double(number) / Double(total), t("progress.creating", ["current": number, "total": total]))
                switch options.kind {
                case .badge:
                    let slot = offset % slots.count
                    if slot == 0 {
                        if offset > 0 { context.endPDFPage() }
                        context.beginPDFPage(nil)
                        pages += 1
                    }
                    drawBadge(options, values: values, logo: logo, in: slots[slot], context: context, canvas: canvas)
                    if offset == rows.count - 1 { context.endPDFPage() }
                case .certificate, .invitation:
                    context.beginPDFPage(nil)
                    pages += 1
                    if options.kind == .certificate {
                        drawCertificate(options, values: values, logo: logo, context: context, canvas: canvas)
                    } else {
                        drawInvitation(options, values: values, logo: logo, context: context, canvas: canvas)
                    }
                    context.endPDFPage()
                }
            }
            context.closePDF()
        } catch {
            context.closePDF()
            try? FileManager.default.removeItem(at: url)
            throw error
        }
        return pages
    }

    static func badgeSlots(_ sheet: CGSize) -> [CGRect] {
        let gap = 4 * pointsPerMM
        let columns = 2, rows = 5
        let width = CGFloat(columns) * badgeSize.width + CGFloat(columns - 1) * gap
        let height = CGFloat(rows) * badgeSize.height + CGFloat(rows - 1) * gap
        let left = (sheet.width - width) / 2, top = (sheet.height - height) / 2
        return (0..<rows).flatMap { row in
            (0..<columns).map { column in
                CGRect(x: left + CGFloat(column) * (badgeSize.width + gap), y: top + CGFloat(row) * (badgeSize.height + gap),
                       width: badgeSize.width, height: badgeSize.height)
            }
        }
    }

    private static func accentColor(_ options: CreateBulkOptions) -> CGColor {
        StoryColor.hex(StoryColor.isValid(options.accent) ? options.accent : defaultAccent)
    }

    private static func signersRow(_ options: CreateBulkOptions, values: [String: String], in rect: CGRect, nameSize: CGFloat, context: CGContext, canvas: StoryCanvas) {
        let named = options.signers.map { (MergeFields.fill($0.name, values: values), MergeFields.fill($0.role, values: values)) }
            .filter { !$0.0.trimmingCharacters(in: .whitespaces).isEmpty || !$0.1.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !named.isEmpty else { return }
        let cell = rect.width / CGFloat(named.count)
        for (index, signer) in named.enumerated() {
            let x = rect.minX + CGFloat(index) * cell + 28
            let width = cell - 56
            context.setStrokeColor(StoryColor.hex("#333333"))
            context.setLineWidth(0.7)
            context.move(to: canvas.cg(CGPoint(x: x, y: rect.minY)))
            context.addLine(to: canvas.cg(CGPoint(x: x + width, y: rect.minY)))
            context.strokePath()
            var stack = TextStack(family: options.font, alignment: .center)
            stack.gap(2)
            stack.text(signer.0, size: nameSize)
            stack.text(signer.1, size: 9, color: StoryColor.hex("#555555"))
            stack.draw(in: CGRect(x: x, y: rect.minY, width: width, height: rect.height), placement: .top, context: context, canvas: canvas)
        }
    }

    private static func bulkStack(_ options: CreateBulkOptions, logo: CGImage?) -> TextStack {
        var stack = TextStack(family: options.font, alignment: .center)
        if let logo { stack.pieces.append(.image(logo, maxWidth: 150, maxHeight: 46)) }
        return stack
    }

    private static func drawCertificate(_ options: CreateBulkOptions, values: [String: String], logo: CGImage?, context: CGContext, canvas: StoryCanvas) {
        let accent = accentColor(options)
        let page = CGRect(origin: .zero, size: canvas.pageSize)
        let outer = page.insetBy(dx: 22, dy: 22)
        context.setStrokeColor(accent)
        context.setLineWidth(3)
        context.stroke(canvas.cg(outer))
        context.setLineWidth(0.8)
        context.stroke(canvas.cg(outer.insetBy(dx: 7, dy: 7)))
        let inner = outer.insetBy(dx: 40, dy: 34)
        let hasSigners = !options.signers.isEmpty
        let signerHeight: CGFloat = hasSigners ? 60 : 0
        var stack = bulkStack(options, logo: logo)
        stack.text(MergeFields.fill(options.heading, values: values), size: 30, bold: true, color: accent, letterSpacing: 2)
        stack.gap(10)
        stack.text(MergeFields.fill(options.recipient, values: values), size: 28, bold: true)
        stack.gap(10)
        stack.text(MergeFields.fill(options.body, values: values), size: 13)
        stack.gap(10)
        stack.text(MergeFields.fill(options.details, values: values), size: 11, color: StoryColor.hex("#444444"))
        stack.draw(in: CGRect(x: inner.minX, y: inner.minY, width: inner.width, height: inner.height - signerHeight), placement: .center, context: context, canvas: canvas)
        if hasSigners {
            signersRow(options, values: values, in: CGRect(x: inner.minX, y: inner.maxY - signerHeight + 14, width: inner.width, height: signerHeight - 14), nameSize: 11, context: context, canvas: canvas)
        }
    }

    private static func drawInvitation(_ options: CreateBulkOptions, values: [String: String], logo: CGImage?, context: CGContext, canvas: StoryCanvas) {
        let accent = accentColor(options)
        let size = canvas.pageSize
        context.setFillColor(accent)
        context.fill(canvas.cg(CGRect(x: 0, y: 0, width: size.width, height: 18)))
        context.fill(canvas.cg(CGRect(x: 0, y: size.height - 8, width: size.width, height: 8)))
        let inner = CGRect(x: 36, y: 52, width: size.width - 72, height: size.height - 92)
        let hasSigners = !options.signers.isEmpty
        var stack = bulkStack(options, logo: logo)
        stack.text(MergeFields.fill(options.heading, values: values), size: 22, bold: true, color: accent, letterSpacing: 2)
        stack.gap(12)
        stack.text(MergeFields.fill(options.recipient, values: values), size: 15, bold: true)
        stack.gap(8)
        stack.text(MergeFields.fill(options.body, values: values), size: 11.5)
        stack.gap(12)
        stack.text(MergeFields.fill(options.details, values: values), size: 11, bold: true, color: StoryColor.hex("#444444"))
        stack.draw(in: CGRect(x: inner.minX, y: inner.minY, width: inner.width, height: inner.height - (hasSigners ? 50 : 0)), placement: .center, context: context, canvas: canvas)
        if hasSigners {
            signersRow(options, values: values, in: CGRect(x: inner.minX, y: inner.maxY - 46, width: inner.width, height: 46), nameSize: 10, context: context, canvas: canvas)
        }
    }

    private static func drawBadge(_ options: CreateBulkOptions, values: [String: String], logo: CGImage?, in slot: CGRect, context: CGContext, canvas: StoryCanvas) {
        let accent = accentColor(options)
        context.saveGState()
        context.setStrokeColor(StoryColor.gray(0.75))
        context.setLineWidth(0.5)
        context.setLineDash(phase: 0, lengths: [2, 2])
        context.stroke(canvas.cg(slot))
        context.restoreGState()
        let band = CGRect(x: slot.minX, y: slot.minY, width: slot.width, height: 30)
        context.setFillColor(accent)
        context.fill(canvas.cg(band))
        var bandRect = band.insetBy(dx: 8, dy: 0)
        bandRect.origin.y += 5
        bandRect.size.height -= 9
        if let logo {
            let height: CGFloat = 20
            let width = min(bandRect.width / 3, CGFloat(logo.width) / CGFloat(logo.height) * height)
            StoryImages.drawFit(logo, in: canvas.cg(CGRect(x: bandRect.minX, y: bandRect.midY - height / 2, width: width, height: height)), align: .left, context: context)
            bandRect.origin.x += width + 4
            bandRect.size.width -= width + 4
        }
        let heading = MergeFields.fill(options.heading, values: values)
        let style = StoryTextStyle(family: options.font, size: 10, color: StoryColor.white, bold: true, lineHeight: 1.2, alignment: .center)
        StoryRenderer.drawText(style.string(heading), in: bandRect, context: context, canvas: canvas)
        var stack = TextStack(family: options.font, alignment: .center)
        stack.text(MergeFields.fill(options.recipient, values: values), size: 17, bold: true)
        stack.text(MergeFields.fill(options.body, values: values), size: 10)
        stack.text(MergeFields.fill(options.details, values: values), size: 9, color: StoryColor.hex("#444444"))
        stack.draw(in: CGRect(x: slot.minX + 8, y: band.maxY + 4, width: slot.width - 16, height: slot.maxY - 6 - band.maxY - 4), placement: .center, context: context, canvas: canvas)
    }
}
