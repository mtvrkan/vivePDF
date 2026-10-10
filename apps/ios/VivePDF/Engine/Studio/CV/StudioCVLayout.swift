import Foundation

/// Port of `cv/cvLayout.ts`: flows a CV profile into Studio pages — header, main column and optional
/// sidebar, section titles kept with their first item, entries split across pages at line breaks.
struct StudioCVLabels {
    var sections: [String: String]
    var present: String
    var levels: [String]
    var languageLevels: [String]
    var contacts: [StudioCVContactKind: String]

    /// `cvLabels(t)` for the CV language.
    static func make(_ t: (String) -> String) -> StudioCVLabels {
        var sections: [String: String] = [:]
        for key in StudioCVSection.allCases.map(\.rawValue) + ["contact"] { sections[key] = t("studio.cv.sections.\(key)") }
        var contacts: [StudioCVContactKind: String] = [:]
        for kind in StudioCVContactKind.allCases { contacts[kind] = t("studio.cv.contactKinds.\(kind.rawValue)") }
        return StudioCVLabels(
            sections: sections,
            present: t("studio.cv.present"),
            levels: (1...StudioCVLimits.maxLevel).map { t("studio.cv.levels.\($0)") },
            languageLevels: (1...StudioCVLimits.maxLevel).map { t("studio.cv.languageLevels.\($0)") },
            contacts: contacts
        )
    }
}

struct StudioCVPalette {
    var page: String
    var text: String
    var muted: String
    var accent: String
    var soft: String
    var line: String
    var sideFill: String?
    var sideText: String
    var sideMuted: String
    var sideAccent: String
    var sideSoft: String
}

enum StudioCVTone { case main, side }
enum StudioCVTitleStyle { case rule, band, underline, leftBar, plain, centered }
enum StudioCVEntryStyle { case stacked, dateLeft, timeline }
enum StudioCVLevelBar { case line, thin, segmented }

struct StudioCVColumn { var x: Double; var width: Double; var top: Double; var bottom: Double }
struct StudioCVFrame { var decor: [StudioElement]; var main: StudioCVColumn; var side: StudioCVColumn? }
struct StudioCVHeader { var elements: [StudioElement]; var mainTop: Double; var sideTop: Double }

struct StudioCVSpec {
    var id: StudioCVLayoutId
    var accent: String
    var fonts: (heading: String, body: String)
    var palette: (String) -> StudioCVPalette
    var frame: (StudioCVContext, Int) -> StudioCVFrame
    var header: (StudioCVContext, StudioCVFrame) -> StudioCVHeader
    /// Sections drawn in the sidebar ("contact" plus section keys).
    var side: [String]
    var title: StudioCVTitleStyle
    var sideTitle: StudioCVTitleStyle? = nil
    var entry: StudioCVEntryStyle
    var photo: Bool
    var contactIcons = false
    var levelBar: StudioCVLevelBar = .line
    var photoRing = false
}

struct StudioCVOverflow: Equatable {
    var items = 0
    var sections: [StudioCVSection] = []
}

struct StudioCVTextStyle {
    var font: String? = nil
    var size: Double
    var color: String
    var bold = false
    var italic = false
    var upper = false
    var spacing: Double = 0
    var lineHeight: Double = 1.35
    var align: StudioTextAlign = .left
}

final class StudioCVContext {
    let profile: StudioCVProfile
    let theme: StudioCVTheme
    let labels: StudioCVLabels
    let palette: StudioCVPalette
    let fonts: (heading: String, body: String)
    let width: Double
    let height: Double
    let emptyPhoto: Bool
    let scale: Double
    let gap: Double
    let contactIcons: Bool
    let levelBar: StudioCVLevelBar
    private let photoRing: Bool
    private let measure: StudioCVMeasure.Measure
    private let allowPhoto: Bool

    init(spec: StudioCVSpec, profile: StudioCVProfile, theme: StudioCVTheme, labels: StudioCVLabels, measure: @escaping StudioCVMeasure.Measure, emptyPhoto: Bool) {
        self.profile = profile
        self.theme = theme
        self.labels = labels
        self.measure = measure
        self.emptyPhoto = emptyPhoto
        allowPhoto = spec.photo
        contactIcons = spec.contactIcons
        levelBar = spec.levelBar
        photoRing = spec.photoRing
        palette = spec.palette(theme.accent ?? spec.accent)
        fonts = (theme.headingFont ?? spec.fonts.heading, theme.bodyFont ?? spec.fonts.body)
        let size = (theme.paper == .letter ? StudioPageSize.letter : StudioPageSize.a4).size
        width = size.width
        height = size.height
        switch theme.density {
        case .compact: scale = 0.92; gap = 0.72
        case .normal: scale = 1; gap = 1
        case .roomy: scale = 1.06; gap = 1.3
        }
    }

    func size(_ value: Double) -> Double { (value * scale * 10).rounded() / 10 }
    func space(_ value: Double) -> Double { value * gap }

    func text(_ x: Double, _ y: Double, _ width: Double, _ value: String, _ style: StudioCVTextStyle) -> StudioElement {
        var options = StudioCVKit.TextOptions()
        options.font = style.font ?? fonts.body
        options.size = style.size
        options.color = style.color
        options.bold = style.bold
        options.italic = style.italic
        options.upper = style.upper
        options.spacing = style.spacing
        options.lineHeight = style.lineHeight
        options.align = style.align
        var element = StudioCVKit.text(x, y, max(width, 4), 2000, value, options)
        element.height = ceil(measure(element)) + 1
        return element
    }

    func textHeight(_ width: Double, _ value: String, _ style: StudioCVTextStyle) -> Double {
        value.cvTrimmed.isEmpty ? 0 : text(0, 0, width, value, style).height
    }

    var hasPhoto: Bool { allowPhoto && theme.photoShape != .none && (profile.photo != nil || emptyPhoto) }

    func photo(_ x: Double, _ y: Double, _ side: Double, backing: String, ring: String? = nil) -> [StudioElement] {
        guard hasPhoto else { return [] }
        let mask: StudioImageMask = theme.photoShape == .circle ? .circle : theme.photoShape == .rounded ? .rounded : .none
        let frame = photoRing ? [self.ring(x, y, side, mask, ring ?? palette.accent)] : []
        if let path = profile.photo {
            var image = StudioFactory.image(src: path, x: x, y: y, width: side, height: side)
            if var value = image.image {
                value.crop = profile.photoCrop ?? value.crop
                value.mask = mask
                value.cornerRadius = mask == .rounded ? side * 0.12 : 0
                image.content = .image(value)
            }
            return frame + [image]
        }
        return emptyPhoto ? frame + StudioCVKit.photoSlot(x, y, side, side, backing, mask: mask) : frame
    }

    private func ring(_ x: Double, _ y: Double, _ side: Double, _ mask: StudioImageMask, _ color: String) -> StudioElement {
        let gap = 3.0
        let outer = side + gap * 2
        let stroke = StudioStroke(color: color, width: 1.6)
        return mask == .circle
            ? StudioCVKit.box(.ellipse, x - gap, y - gap, outer, outer, .none, stroke: stroke)
            : StudioCVKit.box(.rect, x - gap, y - gap, outer, outer, .none, stroke: stroke, radius: mask == .rounded ? side * 0.12 + gap : 0)
    }

    var contacts: [(kind: StudioCVContactKind, value: String)] {
        profile.contacts.filter { !$0.value.cvTrimmed.isEmpty }.map { ($0.kind, $0.value.cvTrimmed) }
    }

    func colors(_ tone: StudioCVTone) -> (text: String, muted: String, accent: String, soft: String) {
        tone == .side ? (palette.sideText, palette.sideMuted, palette.sideAccent, palette.sideSoft) : (palette.text, palette.muted, palette.accent, palette.soft)
    }
}

/// A measured piece of content that draws itself at a position and may split across pages.
struct StudioCVBlock {
    var height: Double
    var draw: (Double, Double, Double) -> [StudioElement]
    var split: ((Double) -> (StudioCVBlock, StudioCVBlock)?)? = nil
}

enum StudioCVLayout {
    static let maxPages = 20
    private static let minSplitSpace = 48.0
    private static let dateWidth = 92.0
    private static let dateColumn = 84.0
    private static let timelineGutter = 18.0
    private static let barHeight = 4.5
    private static let dotSize = 6.0
    private static let dotGap = 3.5
    private static let thinBar = 2.5
    private static let segmentGap = 2.5

    private static let bullet = try! NSRegularExpression(pattern: "^\\s*[-*•–]\\s+")

    private static func isBullet(_ line: String) -> Bool { bullet.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) != nil }

    /// Detail text with "- " lines turned into "• " bullets and outer blank lines dropped.
    static func details(_ value: String) -> String {
        let lines = value.components(separatedBy: "\n").map { $0.hasSuffix("\r") ? String($0.dropLast()) : $0 }.map { line -> String in
            var s = line
            while let last = s.last, last.isWhitespace { s.removeLast() }
            return s
        }
        return lines.enumerated().filter { !$0.element.cvTrimmed.isEmpty || ($0.offset > 0 && $0.offset < lines.count - 1) }.map { entry -> String in
            let line = entry.element
            guard isBullet(line) else { return line }
            return "• " + bullet.stringByReplacingMatches(in: line, range: NSRange(line.startIndex..., in: line), withTemplate: "")
        }.joined(separator: "\n")
    }

    static func period(_ start: String, _ end: String, _ current: Bool, _ present: String) -> String {
        let finish = current ? present : end.cvTrimmed
        let begin = start.cvTrimmed
        if !begin.isEmpty && !finish.isEmpty { return "\(begin) – \(finish)" }
        return begin.isEmpty ? finish : begin
    }

    static func join(_ parts: [String], _ separator: String = " · ") -> String {
        parts.map(\.cvTrimmed).filter { !$0.isEmpty }.joined(separator: separator)
    }

    static func stack(_ rows: [StudioCVBlock?], _ spacing: Double) -> StudioCVBlock {
        let present = rows.compactMap { $0 }.filter { $0.height > 0 }
        let height = present.reduce(0) { $0 + $1.height } + spacing * Double(max(0, present.count - 1))
        return StudioCVBlock(height: height) { x, y, width in
            var top = y
            var elements: [StudioElement] = []
            for row in present {
                elements += row.draw(x, top, width)
                top += row.height + spacing
            }
            return elements
        }
    }

    static func textBlock(_ c: StudioCVContext, _ width: Double, _ value: String, _ style: StudioCVTextStyle) -> StudioCVBlock? {
        guard !value.cvTrimmed.isEmpty else { return nil }
        let height = c.textHeight(width, value, style)
        return StudioCVBlock(height: height) { x, y, columnWidth in [c.text(x, y, columnWidth, value, style)] }
    }

    static func titleBlock(_ c: StudioCVContext, _ tone: StudioCVTone, _ style: StudioCVTitleStyle, _ label: String, _ width: Double) -> StudioCVBlock {
        let colors = c.colors(tone)
        let font = c.fonts.heading
        let size = c.size(style == .underline || style == .leftBar ? 13 : 10.5)
        if style == .band {
            let height = c.size(10.5) + 12
            return StudioCVBlock(height: height) { x, y, columnWidth in
                var options = StudioCVKit.TextOptions()
                options.font = font
                options.size = c.size(10)
                options.bold = true
                options.upper = true
                options.spacing = 1.6
                options.color = tone == .side ? c.palette.sideFill ?? "#ffffff" : "#ffffff"
                options.valign = .middle
                options.shrink = true
                return [StudioCVKit.box(.rect, x, y, columnWidth, height, .solid(colors.accent), radius: 3), StudioCVKit.text(x + 9, y, columnWidth - 18, height, label, options)]
            }
        }
        let style2 = StudioCVTextStyle(
            font: font, size: size,
            color: style == .plain ? colors.muted : style == .underline || style == .leftBar ? colors.text : colors.accent,
            bold: true,
            upper: style != .underline && style != .leftBar,
            spacing: style == .underline || style == .leftBar ? 0 : 1.8,
            align: style == .centered ? .center : .left
        )
        let labelHeight = c.textHeight(width, label, style2)
        switch style {
        case .leftBar:
            return StudioCVBlock(height: labelHeight) { x, y, w in [StudioCVKit.box(.rect, x, y + 1, 4, labelHeight - 2, .solid(colors.accent), radius: 2), c.text(x + 12, y, w - 12, label, style2)] }
        case .underline:
            return StudioCVBlock(height: labelHeight + 7) { x, y, w in [c.text(x, y, w, label, style2), StudioCVKit.box(.rect, x, y + labelHeight + 2, 28, 3, .solid(colors.accent), radius: 1.5)] }
        case .rule:
            return StudioCVBlock(height: labelHeight + 7) { x, y, w in [c.text(x, y, w, label, style2), StudioCVKit.rule(x, y + labelHeight + 3, w, colors.soft, 1)] }
        case .centered:
            return StudioCVBlock(height: labelHeight + 8) { x, y, w in [c.text(x, y, w, label, style2), StudioCVKit.rule(x + w / 2 - 22, y + labelHeight + 4, 44, colors.accent, 1.2)] }
        default:
            return StudioCVBlock(height: labelHeight) { x, y, w in [c.text(x, y, w, label, style2)] }
        }
    }

    private static func headlineRow(_ c: StudioCVContext, _ tone: StudioCVTone, _ width: Double, _ title: String, _ date: String, _ size: Double) -> StudioCVBlock? {
        if title.cvTrimmed.isEmpty && date.cvTrimmed.isEmpty { return nil }
        let colors = c.colors(tone)
        let dateStyle = StudioCVTextStyle(size: c.size(8.5), color: colors.muted, align: .right)
        let titleStyle = StudioCVTextStyle(font: c.fonts.heading, size: size, color: colors.text, bold: true)
        let narrow = width < 200 || date.cvTrimmed.isEmpty
        if narrow {
            var left = dateStyle
            left.align = .left
            return stack([textBlock(c, width, title, titleStyle), !date.cvTrimmed.isEmpty && width < 200 ? textBlock(c, width, date, left) : nil], 1)
        }
        let titleHeight = c.textHeight(width - dateWidth - 6, title, titleStyle)
        let dateHeight = c.textHeight(dateWidth, date, dateStyle)
        return StudioCVBlock(height: max(titleHeight, dateHeight)) { x, y, w in
            (title.cvTrimmed.isEmpty ? [] : [c.text(x, y, w - dateWidth - 6, title, titleStyle)]) + [c.text(x + w - dateWidth, y + 1, dateWidth, date, dateStyle)]
        }
    }

    struct EntryParts { var title: String; var subtitle: String; var date: String; var body: String }

    private static func trimmedLines(_ lines: [String]) -> [String] {
        var start = 0
        while start < lines.count && lines[start].cvTrimmed.isEmpty { start += 1 }
        return Array(lines[start...])
    }

    private static func splittable(_ build: @escaping (String, Bool) -> StudioCVBlock?, _ lines: [String], _ first: Bool) -> StudioCVBlock? {
        guard var whole = build(lines.joined(separator: "\n"), first), lines.count >= 2 else { return build(lines.joined(separator: "\n"), first) }
        whole.split = { available in
            var count = lines.count - 1
            while count >= 1 {
                defer { count -= 1 }
                if lines[count - 1].cvTrimmed.isEmpty { continue }
                guard let head = build(lines[0..<count].joined(separator: "\n"), first), head.height <= available else { continue }
                guard let rest = splittable(build, trimmedLines(Array(lines[count...])), false) else { return nil }
                return (head, rest)
            }
            return nil
        }
        return whole
    }

    private static func entryBlock(_ c: StudioCVContext, _ tone: StudioCVTone, _ style: StudioCVEntryStyle, _ width: Double, _ parts: EntryParts) -> StudioCVBlock? {
        let lines = parts.body.components(separatedBy: "\n")
        return splittable({ body, first in
            entryPart(c, tone, style, width, first ? EntryParts(title: parts.title, subtitle: parts.subtitle, date: parts.date, body: body) : EntryParts(title: "", subtitle: "", date: "", body: body), first)
        }, lines, true)
    }

    private static func entryPart(_ c: StudioCVContext, _ tone: StudioCVTone, _ style: StudioCVEntryStyle, _ width: Double, _ parts: EntryParts, _ first: Bool) -> StudioCVBlock? {
        let colors = c.colors(tone)
        let bodyStyle = StudioCVTextStyle(size: c.size(9), color: colors.muted, lineHeight: 1.45)
        let subtitleStyle = StudioCVTextStyle(size: c.size(9), color: colors.accent, bold: style == .dateLeft, italic: style != .dateLeft)
        let titleSize = c.size(10.5)
        if style == .dateLeft && width >= 260 && !first {
            let inner = width - dateColumn
            guard let right = textBlock(c, inner, parts.body, bodyStyle) else { return nil }
            return StudioCVBlock(height: right.height) { x, y, w in right.draw(x + dateColumn, y, w - dateColumn) }
        }
        if style == .dateLeft && width >= 260 && !parts.date.cvTrimmed.isEmpty {
            let inner = width - dateColumn
            let right = stack([textBlock(c, inner, parts.title, StudioCVTextStyle(font: c.fonts.heading, size: titleSize, color: colors.text, bold: true)), textBlock(c, inner, parts.subtitle, subtitleStyle), textBlock(c, inner, parts.body, bodyStyle)], 2)
            let dateStyle = StudioCVTextStyle(size: c.size(8.5), color: colors.muted)
            let dateHeight = c.textHeight(dateColumn - 10, parts.date, dateStyle)
            return StudioCVBlock(height: max(right.height, dateHeight)) { x, y, w in
                [c.text(x, y + 1, dateColumn - 10, parts.date, dateStyle)] + right.draw(x + dateColumn, y, w - dateColumn)
            }
        }
        let contentWidth = style == .timeline ? width - timelineGutter : width
        let content = stack([headlineRow(c, tone, contentWidth, parts.title, parts.date, titleSize), textBlock(c, contentWidth, parts.subtitle, subtitleStyle), textBlock(c, contentWidth, parts.body, bodyStyle)], 2)
        if content.height == 0 { return nil }
        if style != .timeline { return content }
        return StudioCVBlock(height: content.height) { x, y, w in
            [StudioCVKit.box(.rect, x + 3.4, first ? y + 9 : y, 1.2, max(0, first ? content.height - 4 : content.height + 5), .solid(colors.soft))]
                + (first ? [StudioCVKit.box(.ellipse, x, y + 2.5, 8, 8, .solid(colors.accent))] : [])
                + content.draw(x + timelineGutter, y, w - timelineGutter)
        }
    }

    private static func levelBlock(_ c: StudioCVContext, _ tone: StudioCVTone, _ style: StudioCVSkillStyle, _ width: Double, _ name: String, _ level: Int, _ levelLabel: String) -> StudioCVBlock? {
        guard !name.cvTrimmed.isEmpty else { return nil }
        let colors = c.colors(tone)
        let nameStyle = StudioCVTextStyle(size: c.size(9), color: colors.text)
        if style == .text || level <= 0 {
            let label = style == .text && level > 0 && !levelLabel.isEmpty ? "\(name) — \(levelLabel)" : name
            return textBlock(c, width, label, nameStyle)
        }
        if style == .dots {
            let dots = 5 * dotSize + 4 * dotGap
            let nameWidth = max(40, width - dots - 8)
            let height = max(c.textHeight(nameWidth, name, nameStyle), dotSize + 2)
            return StudioCVBlock(height: height) { x, y, w in
                [c.text(x, y, w - dots - 8, name, nameStyle)] + (0..<5).map { index in
                    StudioCVKit.box(.ellipse, x + w - dots + Double(index) * (dotSize + dotGap), y + (height - dotSize) / 2, dotSize, dotSize, .solid(index < level ? colors.accent : colors.soft))
                }
            }
        }
        let nameHeight = c.textHeight(width, name, nameStyle)
        let bar = c.levelBar == .thin ? thinBar : barHeight
        return StudioCVBlock(height: nameHeight + 3 + bar) { x, y, w in
            [c.text(x, y, w, name, nameStyle)] + levelTrack(c.levelBar, x, y + nameHeight + 3, w, bar, level, colors.accent, colors.soft)
        }
    }

    private static func levelTrack(_ style: StudioCVLevelBar, _ x: Double, _ y: Double, _ width: Double, _ height: Double, _ level: Int, _ accent: String, _ soft: String) -> [StudioElement] {
        if style == .segmented {
            let segment = (width - segmentGap * 4) / 5
            return (0..<5).map { index in StudioCVKit.box(.rect, x + Double(index) * (segment + segmentGap), y, segment, height, .solid(index < level ? accent : soft), radius: 1) }
        }
        return [StudioCVKit.box(.rect, x, y, width, height, .solid(soft), radius: height / 2), StudioCVKit.box(.rect, x, y, width * Double(level) / 5, height, .solid(accent), radius: height / 2)]
    }

    private static func chipsBlock(_ c: StudioCVContext, _ tone: StudioCVTone, _ width: Double, _ items: [String]) -> StudioCVBlock? {
        let names = items.map(\.cvTrimmed).filter { !$0.isEmpty }
        guard !names.isEmpty else { return nil }
        let colors = c.colors(tone)
        let size = c.size(8.5)
        let height = size + 9
        var placed: [(x: Double, y: Double, width: Double, label: String)] = []
        var left = 0.0, top = 0.0
        for label in names {
            let chipWidth = min(width, Double(label.utf16.count) * size * 0.56 + 16)
            if left > 0 && left + chipWidth > width {
                left = 0
                top += height + 5
            }
            placed.append((left, top, chipWidth, label))
            left += chipWidth + 5
        }
        return StudioCVBlock(height: top + height) { x, y, _ in
            placed.flatMap { chip -> [StudioElement] in
                var options = StudioCVKit.TextOptions()
                options.font = c.fonts.body
                options.size = size
                options.color = colors.text
                options.align = .center
                options.valign = .middle
                options.shrink = true
                return [StudioCVKit.box(.rect, x + chip.x, y + chip.y, chip.width, height, .solid(colors.soft), radius: height / 2), StudioCVKit.text(x + chip.x + 4, y + chip.y, chip.width - 8, height, chip.label, options)]
            }
        }
    }

    private static func iconRow(_ c: StudioCVContext, _ width: Double, _ kind: StudioCVContactKind, _ value: String, _ color: String, _ iconColor: String) -> StudioCVBlock? {
        let size = c.size(8.8)
        let icon = (size * 1.15 * 10).rounded() / 10
        let indent = icon + 7
        let style = StudioCVTextStyle(size: size, color: color)
        let textHeight = c.textHeight(width - indent, value, style)
        guard textHeight > 0 else { return nil }
        let offset = max(0, (min(textHeight, size * 1.35) - icon) / 2)
        return StudioCVBlock(height: max(textHeight, icon)) { x, y, w in
            [StudioCVKit.contactIcon(kind, color: iconColor, x, y + offset, icon), c.text(x + indent, y, w - indent, value, style)]
        }
    }

    static func contactGrid(_ c: StudioCVContext, _ x: Double, _ y: Double, _ width: Double, _ columns: Int, _ color: String, _ iconColor: String) -> (elements: [StudioElement], bottom: Double) {
        let items = c.contacts
        guard !items.isEmpty else { return ([], y) }
        let count = max(1, min(columns, items.count))
        let gutter = 14.0
        let cell = (width - gutter * Double(count - 1)) / Double(count)
        var elements: [StudioElement] = []
        var top = y
        var start = 0
        while start < items.count {
            let rows = items[start..<min(items.count, start + count)].map { iconRow(c, cell, $0.kind, $0.value, color, iconColor) }
            let height = max(0, rows.map { $0?.height ?? 0 }.max() ?? 0)
            for (index, row) in rows.enumerated() { if let row { elements += row.draw(x + Double(index) * (cell + gutter), top, cell) } }
            top += height + 6
            start += count
        }
        return (elements, top - 6)
    }

    private static func contactBlocks(_ c: StudioCVContext, _ tone: StudioCVTone, _ width: Double) -> [StudioCVBlock?] {
        let colors = c.colors(tone)
        if c.contactIcons { return c.contacts.map { iconRow(c, width, $0.kind, $0.value, colors.text, colors.accent) } }
        return c.contacts.map {
            stack([textBlock(c, width, c.labels.contacts[$0.kind] ?? "", StudioCVTextStyle(size: c.size(7), color: colors.accent, bold: true, upper: true, spacing: 1.2)), textBlock(c, width, $0.value, StudioCVTextStyle(size: c.size(8.8), color: colors.text))], 1)
        }
    }

    struct Section { var key: String; var title: String; var items: [StudioCVBlock]; var gap: Double }

    private static func sections(_ c: StudioCVContext, _ spec: StudioCVSpec, _ tone: StudioCVTone, _ width: Double) -> [Section] {
        let profile = c.profile
        let labels = c.labels
        let style = c.theme.skillStyle
        let entry: StudioCVEntryStyle = tone == .side ? .stacked : spec.entry
        let itemGap = c.space(tone == .side ? 7 : 10)
        let colors = c.colors(tone)
        let paragraph = StudioCVTextStyle(size: c.size(9.2), color: colors.muted, lineHeight: 1.5)
        var keys: [String] = []
        if tone == .side && spec.side.contains("contact") { keys.append("contact") }
        for key in profile.order {
            let onSide = spec.side.contains(key.rawValue)
            if (tone == .side) == onSide && profile.isVisible(key) { keys.append(key.rawValue) }
        }
        var result: [Section] = []
        func add(_ key: String, _ items: [StudioCVBlock?], _ title: String? = nil) {
            let present = items.compactMap { $0 }.filter { $0.height > 0 }
            if !present.isEmpty { result.append(Section(key: key, title: title ?? labels.sections[key] ?? key, items: present, gap: itemGap)) }
        }
        for key in keys {
            switch key {
            case "contact": add(key, contactBlocks(c, tone, width))
            case "summary": add(key, [textBlock(c, width, profile.summary, paragraph)])
            case "experience":
                add(key, profile.experience.map { entryBlock(c, tone, entry, width, EntryParts(title: $0.role, subtitle: join([$0.organisation, $0.location]), date: period($0.start, $0.end, $0.current, labels.present), body: details($0.details))) })
            case "education":
                add(key, profile.education.map { entryBlock(c, tone, entry, width, EntryParts(title: $0.degree, subtitle: join([$0.school, $0.location]), date: period($0.start, $0.end, $0.current, labels.present), body: details($0.details))) })
            case "skills":
                let skills = profile.skills.filter { !$0.name.cvTrimmed.isEmpty }
                if style == .chips { add(key, [chipsBlock(c, tone, width, skills.map(\.name))]) }
                else if style == .text && skills.allSatisfy({ $0.level <= 0 }) { add(key, [textBlock(c, width, skills.map(\.name).joined(separator: ", "), paragraph)]) }
                else { add(key, skills.map { levelBlock(c, tone, style, width, $0.name, $0.level, $0.level >= 1 && $0.level <= labels.levels.count ? labels.levels[$0.level - 1] : "") }) }
            case "languages":
                add(key, profile.languages.filter { !$0.name.cvTrimmed.isEmpty }.map { levelBlock(c, tone, style == .chips ? .text : style, width, $0.name, $0.level, $0.level >= 1 && $0.level <= labels.languageLevels.count ? labels.languageLevels[$0.level - 1] : "") })
            case "certificates":
                add(key, profile.certificates.map { item in
                    item.name.cvTrimmed.isEmpty ? nil : stack([textBlock(c, width, item.name, StudioCVTextStyle(size: c.size(9.4), color: colors.text, bold: true)), textBlock(c, width, join([item.issuer, item.date]), StudioCVTextStyle(size: c.size(8.6), color: colors.muted))], 1)
                })
            case "projects":
                add(key, profile.projects.map { item in
                    item.name.cvTrimmed.isEmpty && item.details.cvTrimmed.isEmpty ? nil : stack([textBlock(c, width, item.name, StudioCVTextStyle(font: c.fonts.heading, size: c.size(10), color: colors.text, bold: true)), textBlock(c, width, item.link, StudioCVTextStyle(size: c.size(8.5), color: colors.accent)), textBlock(c, width, details(item.details), paragraph)], 2)
                })
            case "references":
                add(key, profile.references.map { item in
                    item.name.cvTrimmed.isEmpty ? nil : stack([textBlock(c, width, item.name, StudioCVTextStyle(size: c.size(9.4), color: colors.text, bold: true)), textBlock(c, width, item.role, StudioCVTextStyle(size: c.size(8.6), color: colors.accent)), textBlock(c, width, item.contact, StudioCVTextStyle(size: c.size(8.6), color: colors.muted))], 1)
                })
            case "interests":
                let interests = profile.interests.components(separatedBy: CharacterSet(charactersIn: ",;\n")).map(\.cvTrimmed).filter { !$0.isEmpty }
                add(key, [style == .chips ? chipsBlock(c, tone, width, interests) : textBlock(c, width, interests.joined(separator: ", "), paragraph)])
            case "custom":
                for item in profile.custom where !item.heading.cvTrimmed.isEmpty || !item.body.cvTrimmed.isEmpty {
                    add(key, [textBlock(c, width, details(item.body), paragraph)], item.heading.cvTrimmed.isEmpty ? labels.sections["custom"] : item.heading.cvTrimmed)
                }
            default: break
            }
        }
        return result
    }

    /// Places blocks in the main and side columns page by page.
    private final class Flow {
        var pages: [[StudioElement]] = []
        private var frames: [StudioCVFrame] = []
        private var cursor: [StudioCVTone: (page: Int, y: Double)] = [:]
        private let context: StudioCVContext
        private let spec: StudioCVSpec

        init(_ context: StudioCVContext, _ spec: StudioCVSpec) {
            self.context = context
            self.spec = spec
            let first = frame(0)
            let header = spec.header(context, first)
            pages[0] += header.elements
            cursor = [.main: (0, header.mainTop), .side: (0, header.sideTop)]
        }

        @discardableResult
        func frame(_ index: Int) -> StudioCVFrame {
            while frames.count <= index {
                let made = spec.frame(context, frames.count)
                frames.append(made)
                pages.append(made.decor)
            }
            return frames[index]
        }

        func column(_ tone: StudioCVTone, _ page: Int) -> StudioCVColumn? {
            let made = frame(page)
            return tone == .side ? made.side : made.main
        }

        func place(_ tone: StudioCVTone, _ block: StudioCVBlock, keep: Double = 0) -> Bool {
            guard let at = cursor[tone], let column = column(tone, at.page) else { return false }
            if at.y + block.height + keep > column.bottom {
                let available = column.bottom - at.y
                let parts = available >= StudioCVLayout.minSplitSpace || at.y <= column.top + 1 ? block.split?(available) : nil
                if let parts {
                    pages[at.page] += parts.0.draw(column.x, at.y, column.width)
                    cursor[tone] = (at.page, at.y + parts.0.height)
                    guard nextPage(tone) else { return false }
                    return place(tone, parts.1, keep: keep)
                }
                if at.y > column.top + 1 {
                    guard nextPage(tone) else { return false }
                    return place(tone, block, keep: keep)
                }
            }
            pages[at.page] += block.draw(column.x, at.y, column.width)
            cursor[tone] = (at.page, at.y + block.height)
            return true
        }

        private func nextPage(_ tone: StudioCVTone) -> Bool {
            guard let at = cursor[tone], at.page + 1 < StudioCVLayout.maxPages, let next = column(tone, at.page + 1) else { return false }
            cursor[tone] = (at.page + 1, next.top)
            return true
        }

        func advance(_ tone: StudioCVTone, _ amount: Double) {
            if let at = cursor[tone] { cursor[tone] = (at.page, at.y + amount) }
        }

        func width(_ tone: StudioCVTone) -> Double { column(tone, 0)?.width ?? 0 }
    }

    /// `composeCvReport`: the design plus what did not fit within `maxPages`.
    static func compose(spec: StudioCVSpec, profile: StudioCVProfile, theme: StudioCVTheme, labels: StudioCVLabels, measure: @escaping StudioCVMeasure.Measure, emptyPhoto: Bool, name: String) -> (design: StudioDesign, overflow: StudioCVOverflow) {
        let context = StudioCVContext(spec: spec, profile: profile, theme: theme, labels: labels, measure: measure, emptyPhoto: emptyPhoto)
        let flow = Flow(context, spec)
        var overflow = StudioCVOverflow()
        func drop(_ section: Section, _ count: Int) {
            guard count > 0 else { return }
            overflow.items += count
            if let key = StudioCVSection(rawValue: section.key), !overflow.sections.contains(key) { overflow.sections.append(key) }
        }
        for tone in [StudioCVTone.main, .side] {
            let width = flow.width(tone)
            guard width > 0 else { continue }
            let titleStyle = tone == .side ? (spec.sideTitle ?? spec.title) : spec.title
            let sectionGap = context.space(tone == .side ? 16 : 18)
            let column = flow.column(tone, 0)
            let columnHeight = column.map { $0.bottom - $0.top } ?? 0
            let list = sections(context, spec, tone, width)
            for (sectionIndex, section) in list.enumerated() {
                let title = titleBlock(context, tone, titleStyle, section.title, width)
                let keep = section.items.first.map { min($0.height, columnHeight / 3) } ?? 0
                if !flow.place(tone, title, keep: keep + context.space(8)) {
                    for rest in list[sectionIndex...] { drop(rest, rest.items.count) }
                    break
                }
                flow.advance(tone, context.space(8))
                var placed = section.items.count
                for (index, item) in section.items.enumerated() {
                    if !flow.place(tone, item) {
                        placed = index
                        break
                    }
                    if index < section.items.count - 1 { flow.advance(tone, section.gap) }
                }
                if placed < section.items.count {
                    drop(section, section.items.count - placed)
                    for rest in list[(sectionIndex + 1)...] { drop(rest, rest.items.count) }
                    break
                }
                flow.advance(tone, sectionGap)
            }
        }
        let pages = flow.pages.map { elements -> StudioPage in
            var page = StudioFactory.page(width: context.width, height: context.height)
            page.background = StudioBackground(fill: .solid(context.palette.page))
            page.elements = elements
            return page
        }
        return (StudioDesign(name: name, palette: [context.palette.accent, context.palette.text], pages: pages), overflow)
    }

    static func textLine(_ c: StudioCVContext, _ x: Double, _ y: Double, _ width: Double, _ value: String, _ style: StudioCVTextStyle) -> (element: StudioElement?, bottom: Double) {
        guard !value.cvTrimmed.isEmpty else { return (nil, y) }
        let element = c.text(x, y, width, value, style)
        return (element, y + element.height)
    }

    static func contactLine(_ c: StudioCVContext, separator: String = "   •   ") -> String {
        c.contacts.map(\.value).joined(separator: separator)
    }
}

/// Renders a CV (`renderCv` / `sampleCv`) with stable element ids so unchanged pages keep identity.
enum StudioCVRender {
    static func fonts(_ theme: StudioCVTheme) -> [String] {
        let spec = StudioCVDesigns.spec(theme.layout)
        return [theme.headingFont ?? spec.fonts.heading, theme.bodyFont ?? spec.fonts.body]
    }

    static func render(profile: StudioCVProfile, theme: StudioCVTheme, name: String) -> (design: StudioDesign, overflow: StudioCVOverflow) {
        let translate = StudioCVTranslator(language: theme.language)
        let result = StudioCVLayout.compose(spec: StudioCVDesigns.spec(theme.layout), profile: profile, theme: theme, labels: StudioCVLabels.make { translate($0) }, measure: StudioCVMeasure.real(language: theme.language), emptyPhoto: false, name: name)
        return (stableIds(result.design), result.overflow)
    }

    /// Design thumbnails: sample content, estimated text heights and empty photo frames.
    static func sample(profile: StudioCVProfile, theme: StudioCVTheme) -> StudioDesign {
        let translate = StudioCVTranslator(language: theme.language)
        return stableIds(StudioCVLayout.compose(spec: StudioCVDesigns.spec(theme.layout), profile: profile, theme: theme, labels: StudioCVLabels.make { translate($0) }, measure: StudioCVMeasure.estimate, emptyPhoto: true, name: "").design)
    }

    /// `keepUnchanged`: deterministic ids (`cv-<page>-<index>`, `cv-page-<page>`).
    static func stableIds(_ design: StudioDesign) -> StudioDesign {
        var next = design
        for p in next.pages.indices {
            next.pages[p].id = "cv-page-\(p)"
            for e in next.pages[p].elements.indices { next.pages[p].elements[e].id = "cv-\(p)-\(e)" }
        }
        return next
    }
}
