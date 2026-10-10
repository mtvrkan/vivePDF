import Foundation

/// Port of `cv/cvDesigns.ts`: the fourteen CV designs.
enum StudioCVDesigns {
    private static let white = "#ffffff"
    private static let black = "#000000"
    private static let gold = "#b8893b"
    private typealias K = StudioCVKit
    private typealias L = StudioCVLayout

    private static func mix(_ a: String, _ b: String, _ amount: Double) -> String { K.mix(a, b, amount) }

    private static func light(_ accent: String, _ change: (inout StudioCVPalette) -> Void = { _ in }) -> StudioCVPalette {
        var p = StudioCVPalette(page: white, text: "#111827", muted: "#4b5563", accent: accent, soft: mix(accent, white, 0.82), line: "#e5e7eb", sideFill: nil, sideText: "#111827", sideMuted: "#4b5563", sideAccent: accent, sideSoft: mix(accent, white, 0.82))
        change(&p)
        return p
    }

    private static func single(_ c: StudioCVContext, _ margin: Double, _ decor: [StudioElement] = []) -> StudioCVFrame {
        StudioCVFrame(decor: decor, main: StudioCVColumn(x: margin, width: c.width - margin * 2, top: margin, bottom: c.height - margin), side: nil)
    }

    private struct HeaderOptions {
        var nameSize: Double
        var nameColor: String
        var headlineColor: String
        var contactColor: String
        var upper = false
        var spacing: Double = 0
        var headlineItalic = false
        var contacts = true
        var iconColumns: Int? = nil
        var iconColor: String? = nil
    }

    private static func headerBlock(_ c: StudioCVContext, _ x: Double, _ y: Double, _ width: Double, _ align: StudioTextAlign, _ o: HeaderOptions) -> (elements: [StudioElement], bottom: Double) {
        var elements: [StudioElement] = []
        let name = L.textLine(c, x, y, width, c.profile.name, StudioCVTextStyle(font: c.fonts.heading, size: c.size(o.nameSize), color: o.nameColor, bold: true, upper: o.upper, spacing: o.spacing, lineHeight: 1.1, align: align))
        if let e = name.element { elements.append(e) }
        let headline = L.textLine(c, x, name.bottom + 4, width, c.profile.headline, StudioCVTextStyle(font: c.fonts.heading, size: c.size(11), color: o.headlineColor, italic: o.headlineItalic, upper: !o.headlineItalic, spacing: o.headlineItalic ? 0 : 1.8, align: align))
        if let e = headline.element { elements.append(e) }
        var bottom = headline.bottom
        if o.contacts, let columns = o.iconColumns {
            let grid = L.contactGrid(c, x, bottom + 12, width, columns, o.contactColor, o.iconColor ?? o.headlineColor)
            elements += grid.elements
            bottom = grid.bottom
        } else if o.contacts {
            let contacts = L.textLine(c, x, bottom + 8, width, L.contactLine(c, separator: align == .center ? "   ·   " : "   •   "), StudioCVTextStyle(size: c.size(8.6), color: o.contactColor, lineHeight: 1.5, align: align))
            if let e = contacts.element { elements.append(e) }
            bottom = contacts.bottom
        }
        return (elements, bottom)
    }

    private static func sidebarFrame(_ c: StudioCVContext, left: Bool, _ sideWidth: Double, _ fill: [StudioElement], _ margin: Double) -> StudioCVFrame {
        let inner = 22.0
        let sideX = left ? inner : c.width - sideWidth + inner
        let mainX = left ? sideWidth + 30 : margin
        let mainWidth = c.width - sideWidth - 30 - margin
        return StudioCVFrame(decor: fill, main: StudioCVColumn(x: mainX, width: mainWidth, top: margin, bottom: c.height - margin), side: StudioCVColumn(x: sideX, width: sideWidth - inner * 2, top: margin, bottom: c.height - margin))
    }

    private static func hasHeading(_ c: StudioCVContext) -> Bool { !c.profile.name.cvTrimmed.isEmpty || !c.profile.headline.cvTrimmed.isEmpty }

    static let modern = StudioCVSpec(
        id: .modern, accent: "#38bdf8", fonts: (K.Font.montserrat, K.Font.inter),
        palette: { accent in light(mix(accent, black, 0.4)) { p in
            p.text = "#0f172a"; p.muted = "#475569"; p.soft = mix(accent, white, 0.75); p.sideFill = "#1e293b"
            p.sideText = "#f1f5f9"; p.sideMuted = "#cbd5e1"; p.sideAccent = accent; p.sideSoft = "#334155"
        } },
        frame: { c, _ in sidebarFrame(c, left: true, 196, [K.box(.rect, 0, 0, 196, c.height, K.gradient(180, ["#1e293b", "#0f172a"])), K.box(.rect, 0, 0, 196, 5, .solid(c.palette.sideAccent))], 40) },
        header: { c, frame in
            var elements: [StudioElement] = []
            var sideTop = frame.side?.top ?? 0
            if let side = frame.side, c.hasPhoto {
                let size = 118.0
                elements += c.photo(side.x + (side.width - size) / 2, side.top, size, backing: "#334155", ring: c.palette.sideAccent)
                sideTop = side.top + size + 26
            }
            let header = headerBlock(c, frame.main.x, frame.main.top, frame.main.width, .left, HeaderOptions(nameSize: 30, nameColor: "#0f172a", headlineColor: c.palette.accent, contactColor: "#64748b", contacts: false))
            elements += header.elements
            if hasHeading(c) { elements.append(K.box(.rect, frame.main.x, header.bottom + 13, 48, 3.5, .solid(c.palette.sideAccent), radius: 1.75)) }
            return StudioCVHeader(elements: elements, mainTop: header.bottom + 32, sideTop: sideTop)
        },
        side: ["contact", "skills", "languages", "interests"], title: .rule, entry: .timeline, photo: true, contactIcons: true, levelBar: .thin, photoRing: true
    )

    static let classic = StudioCVSpec(
        id: .classic, accent: "#1f3a5f", fonts: (K.Font.lora, K.Font.sourceSerif),
        palette: { accent in light(accent) { $0.text = "#1c1917"; $0.muted = "#44403c"; $0.soft = "#d6d3d1" } },
        frame: { c, _ in single(c, 54) },
        header: { c, frame in
            let main = frame.main
            let header = headerBlock(c, main.x, main.top, main.width, .center, HeaderOptions(nameSize: 27, nameColor: c.palette.text, headlineColor: c.palette.accent, contactColor: c.palette.muted, upper: true, spacing: 2.5, headlineItalic: true))
            let elements = header.elements + [K.rule(main.x, header.bottom + 12, main.width, c.palette.text, 1.4), K.rule(main.x, header.bottom + 15.5, main.width, c.palette.text, 0.5)]
            return StudioCVHeader(elements: elements, mainTop: header.bottom + 32, sideTop: main.top)
        },
        side: [], title: .rule, entry: .stacked, photo: false
    )

    static let corporate = StudioCVSpec(
        id: .corporate, accent: "#0f766e", fonts: (K.Font.poppins, K.Font.nunito),
        palette: { accent in light(accent) { $0.text = "#0f172a"; $0.muted = "#475569"; $0.sideFill = mix(accent, white, 0.92); $0.sideSoft = mix(accent, white, 0.7) } },
        frame: { c, pageIndex in
            let band = pageIndex == 0 ? 136.0 : 0
            let sideWidth = 186.0
            var decor = [K.box(.rect, c.width - sideWidth, band, sideWidth, c.height - band, .solid(c.palette.sideFill ?? white))]
            if band > 0 {
                decor.insert(contentsOf: [
                    K.box(.rect, 0, 0, c.width, band, K.linear(90, c.palette.accent, mix(c.palette.accent, black, 0.4))),
                    K.art("diagonalHatch", primary: white, secondary: white, 0, 0, c.width, band, opacity: 0.1),
                    K.box(.rect, 0, band - 3, c.width, 3, .solid(mix(c.palette.accent, white, 0.55))),
                ], at: 0)
            } else {
                decor.insert(K.box(.rect, 0, 0, c.width, 6, .solid(c.palette.accent)), at: 0)
            }
            return StudioCVFrame(decor: decor, main: StudioCVColumn(x: 40, width: c.width - sideWidth - 70, top: band + 30, bottom: c.height - 40), side: StudioCVColumn(x: c.width - sideWidth + 20, width: sideWidth - 40, top: band + 30, bottom: c.height - 40))
        },
        header: { c, frame in
            var elements: [StudioElement] = []
            var x = 40.0
            if c.hasPhoto {
                let size = 92.0
                elements += c.photo(x, 22, size, backing: mix(c.palette.accent, white, 0.45), ring: white)
                x += size + 26
            }
            let header = headerBlock(c, x, 36, c.width - x - 40, .left, HeaderOptions(nameSize: 28, nameColor: white, headlineColor: mix(c.palette.accent, white, 0.78), contactColor: white, contacts: false))
            elements += header.elements
            return StudioCVHeader(elements: elements, mainTop: frame.main.top, sideTop: frame.side?.top ?? 0)
        },
        side: ["contact", "skills", "languages", "certificates", "interests"], title: .underline, sideTitle: .plain, entry: .stacked, photo: true, contactIcons: true, levelBar: .segmented, photoRing: true
    )

    static let minimal = StudioCVSpec(
        id: .minimal, accent: "#111827", fonts: (K.Font.inter, K.Font.inter),
        palette: { accent in light(accent) { $0.text = "#111827"; $0.muted = "#6b7280"; $0.soft = "#e5e7eb" } },
        frame: { c, _ in single(c, 58) },
        header: { c, frame in
            let main = frame.main
            var elements: [StudioElement] = []
            var width = main.width
            if c.hasPhoto {
                let size = 78.0
                elements += c.photo(main.x + main.width - size, main.top, size, backing: "#f3f4f6")
                width -= size + 24
            }
            let header = headerBlock(c, main.x, main.top, width, .left, HeaderOptions(nameSize: 32, nameColor: c.palette.text, headlineColor: c.palette.muted, contactColor: c.palette.muted, iconColumns: 2, iconColor: c.palette.accent))
            elements += header.elements
            let bottom = max(header.bottom, c.hasPhoto ? main.top + 78 : 0)
            return StudioCVHeader(elements: elements, mainTop: bottom + 32, sideTop: main.top)
        },
        side: [], title: .plain, entry: .dateLeft, photo: true, levelBar: .thin
    )

    static let creative = StudioCVSpec(
        id: .creative, accent: "#e11d48", fonts: (K.Font.raleway, K.Font.nunito),
        palette: { accent in light(accent) { p in
            p.text = "#1f2937"; p.muted = "#4b5563"; p.sideFill = accent; p.sideText = white
            p.sideMuted = mix(accent, white, 0.8); p.sideAccent = white; p.sideSoft = mix(accent, black, 0.25)
        } },
        frame: { c, pageIndex in
            let sideWidth = 200.0
            let fill = K.box(.rect, c.width - sideWidth, 0, sideWidth, c.height, K.linear(160, c.palette.accent, mix(c.palette.accent, black, 0.4)))
            let soft = mix(c.palette.accent, white, 0.86)
            let decor = pageIndex == 0 ? [K.art("blob", primary: soft, secondary: mix(c.palette.accent, white, 0.92), -70, -80, 200, 200, opacity: 0.9)] : []
            return sidebarFrame(c, left: false, sideWidth, decor + [fill], 40)
        },
        header: { c, frame in
            var elements: [StudioElement] = []
            var sideTop = frame.side?.top ?? 0
            if let side = frame.side, c.hasPhoto {
                let size = 120.0
                elements += c.photo(side.x + (side.width - size) / 2, side.top, size, backing: mix(c.palette.accent, white, 0.4), ring: white)
                sideTop = side.top + size + 26
            }
            let header = headerBlock(c, frame.main.x, frame.main.top + 14, frame.main.width, .left, HeaderOptions(nameSize: 34, nameColor: c.palette.text, headlineColor: c.palette.accent, contactColor: c.palette.muted, contacts: false))
            elements += header.elements
            return StudioCVHeader(elements: elements, mainTop: header.bottom + 30, sideTop: sideTop)
        },
        side: ["contact", "skills", "languages", "interests", "references"], title: .leftBar, sideTitle: .plain, entry: .stacked, photo: true, contactIcons: true, photoRing: true
    )

    static let timeline = StudioCVSpec(
        id: .timeline, accent: "#0d9488", fonts: (K.Font.josefin, K.Font.nunito),
        palette: { accent in light(mix(accent, black, 0.2)) { $0.text = "#134e4a"; $0.muted = "#475569"; $0.soft = mix(accent, white, 0.8) } },
        frame: { c, pageIndex in single(c, 50, [K.box(.rect, 0, 0, c.width, pageIndex == 0 ? 10 : 5, K.linear(90, c.palette.accent, mix(c.palette.accent, white, 0.45)))]) },
        header: { c, frame in
            let main = frame.main
            var elements: [StudioElement] = []
            var top = main.top
            if c.hasPhoto {
                let size = 96.0
                elements += c.photo(main.x + (main.width - size) / 2, top, size, backing: c.palette.soft)
                top += size + 18
            }
            let header = headerBlock(c, main.x, top, main.width, .center, HeaderOptions(nameSize: 30, nameColor: c.palette.text, headlineColor: c.palette.accent, contactColor: c.palette.muted))
            elements += header.elements
            return StudioCVHeader(elements: elements, mainTop: header.bottom + 28, sideTop: main.top)
        },
        side: [], title: .leftBar, entry: .timeline, photo: true, levelBar: .segmented, photoRing: true
    )

    static let compact = StudioCVSpec(
        id: .compact, accent: "#2563eb", fonts: (K.Font.inter, K.Font.inter),
        palette: { accent in light(accent) },
        frame: { c, _ in
            let margin = 36.0
            let sideWidth = ((c.width - margin * 2) * 0.34).rounded()
            let mainWidth = c.width - margin * 2 - sideWidth - 24
            return StudioCVFrame(decor: [K.box(.rect, 0, 0, c.width, 4, .solid(c.palette.accent))], main: StudioCVColumn(x: margin, width: mainWidth, top: margin, bottom: c.height - margin), side: StudioCVColumn(x: margin + mainWidth + 24, width: sideWidth, top: margin, bottom: c.height - margin))
        },
        header: { c, frame in
            let margin = frame.main.x
            let width = c.width - margin * 2
            var elements: [StudioElement] = []
            var textWidth = width
            if c.hasPhoto {
                let size = 64.0
                elements += c.photo(margin + width - size, margin, size, backing: c.palette.soft)
                textWidth -= size + 18
            }
            let header = headerBlock(c, margin, margin, textWidth, .left, HeaderOptions(nameSize: 25, nameColor: c.palette.text, headlineColor: c.palette.accent, contactColor: c.palette.muted, iconColumns: 3, iconColor: c.palette.accent))
            elements += header.elements
            let bottom = max(header.bottom, c.hasPhoto ? margin + 64 : 0) + 12
            elements.append(K.rule(margin, bottom, width, c.palette.line, 1))
            return StudioCVHeader(elements: elements, mainTop: bottom + 16, sideTop: bottom + 16)
        },
        side: ["skills", "languages", "certificates", "interests", "references"], title: .underline, entry: .stacked, photo: true, levelBar: .thin
    )

    static let elegant = StudioCVSpec(
        id: .elegant, accent: "#a16207", fonts: (K.Font.cormorant, K.Font.garamond),
        palette: { accent in light(accent) { $0.page = "#fffdf8"; $0.text = "#292524"; $0.muted = "#57534e"; $0.soft = mix(accent, white, 0.7) } },
        frame: { c, _ in
            let line = mix(c.palette.accent, white, 0.45)
            return single(c, 60, [
                K.box(.rect, 18, 18, c.width - 36, c.height - 36, .none, stroke: StudioStroke(color: line, width: 0.9)),
                K.box(.rect, 23, 23, c.width - 46, c.height - 46, .none, stroke: StudioStroke(color: line, width: 0.4)),
            ])
        },
        header: { c, frame in
            let main = frame.main
            var elements: [StudioElement] = []
            var top = main.top
            if c.hasPhoto {
                let size = 88.0
                elements += c.photo(main.x + (main.width - size) / 2, top, size, backing: c.palette.soft)
                top += size + 18
            }
            let header = headerBlock(c, main.x, top, main.width, .center, HeaderOptions(nameSize: 31, nameColor: c.palette.text, headlineColor: c.palette.accent, contactColor: c.palette.muted, upper: true, spacing: 3, headlineItalic: true))
            elements += header.elements
            elements.append(K.art("flourishDivider", primary: c.palette.accent, secondary: c.palette.accent, main.x + main.width / 2 - 80, header.bottom + 10, 160, 20))
            return StudioCVHeader(elements: elements, mainTop: header.bottom + 44, sideTop: main.top)
        },
        side: [], title: .centered, entry: .dateLeft, photo: true, photoRing: true
    )

    static let tech = StudioCVSpec(
        id: .tech, accent: "#22c55e", fonts: (K.Font.oswald, K.Font.inter),
        palette: { accent in light(mix(accent, black, 0.36)) { $0.text = "#0f172a"; $0.muted = "#475569"; $0.soft = mix(accent, white, 0.78); $0.sideFill = "#f1f5f9"; $0.sideSoft = mix(accent, white, 0.72); $0.sideAccent = mix(accent, black, 0.3) } },
        frame: { c, pageIndex in
            let band = pageIndex == 0 ? 124.0 : 0
            let sideWidth = 180.0
            var decor = [K.box(.rect, 0, band, sideWidth, c.height - band, .solid("#f1f5f9"))]
            if band > 0 {
                let glow = mix(c.palette.accent, white, 0.2)
                decor.insert(contentsOf: [
                    K.box(.rect, 0, 0, c.width, band, K.linear(90, "#0f172a", "#1e293b")),
                    K.art("halftone", primary: glow, secondary: glow, c.width * 0.55, 0, c.width * 0.45, band, opacity: 0.16),
                    K.box(.rect, 0, band - 4, c.width, 4, .solid(glow)),
                ], at: 0)
            }
            return StudioCVFrame(decor: decor, main: StudioCVColumn(x: sideWidth + 28, width: c.width - sideWidth - 64, top: band + 28, bottom: c.height - 36), side: StudioCVColumn(x: 20, width: sideWidth - 40, top: band + 28, bottom: c.height - 36))
        },
        header: { c, frame in
            var elements: [StudioElement] = []
            var x = 36.0
            if c.hasPhoto {
                let size = 82.0
                elements += c.photo(x, 21, size, backing: "#1e293b", ring: mix(c.palette.accent, white, 0.2))
                x += size + 24
            }
            let header = headerBlock(c, x, 28, c.width - x - 36, .left, HeaderOptions(nameSize: 30, nameColor: white, headlineColor: mix(c.palette.accent, white, 0.35), contactColor: "#cbd5e1", upper: true, spacing: 1))
            elements += header.elements
            return StudioCVHeader(elements: elements, mainTop: frame.main.top, sideTop: frame.side?.top ?? 0)
        },
        side: ["skills", "languages", "certificates", "interests"], title: .rule, sideTitle: .plain, entry: .timeline, photo: true, levelBar: .segmented, photoRing: true
    )

    static let ats = StudioCVSpec(
        id: .ats, accent: "#1f2937", fonts: (K.Font.inter, K.Font.inter),
        palette: { accent in light(accent) { $0.text = "#111827"; $0.muted = "#374151"; $0.soft = "#d1d5db" } },
        frame: { c, _ in single(c, 50) },
        header: { c, frame in
            let main = frame.main
            let header = headerBlock(c, main.x, main.top, main.width, .left, HeaderOptions(nameSize: 24, nameColor: c.palette.text, headlineColor: c.palette.text, contactColor: c.palette.muted, headlineItalic: true))
            return StudioCVHeader(elements: header.elements, mainTop: header.bottom + 20, sideTop: main.top)
        },
        side: [], title: .rule, entry: .stacked, photo: false
    )

    static let executive = StudioCVSpec(
        id: .executive, accent: "#1d3461", fonts: (K.Font.playfair, K.Font.sourceSerif),
        palette: { accent in light(accent) { p in
            p.text = "#111827"; p.muted = "#4b5563"; p.soft = mix(accent, white, 0.8); p.sideFill = mix(accent, white, 0.94)
            p.sideText = "#111827"; p.sideMuted = "#4b5563"; p.sideAccent = accent; p.sideSoft = mix(accent, white, 0.76)
        } },
        frame: { c, pageIndex in
            let band = pageIndex == 0 ? 150.0 : 0
            let sideWidth = 190.0
            var decor = [K.box(.rect, c.width - sideWidth, band, sideWidth, c.height - band, .solid(c.palette.sideFill ?? white))]
            if band > 0 {
                decor.insert(contentsOf: [K.box(.rect, 0, 0, c.width, band, K.gradient(120, [c.palette.accent, mix(c.palette.accent, black, 0.38)])), K.box(.rect, 0, band, c.width, 3, K.foilGold(0))], at: 0)
            } else {
                decor.insert(K.box(.rect, 0, 0, c.width, 3, K.foilGold(0)), at: 0)
            }
            let top = band + (band > 0 ? 32 : 40)
            return StudioCVFrame(decor: decor, main: StudioCVColumn(x: 44, width: c.width - sideWidth - 76, top: top, bottom: c.height - 44), side: StudioCVColumn(x: c.width - sideWidth + 22, width: sideWidth - 44, top: top, bottom: c.height - 44))
        },
        header: { c, frame in
            var elements: [StudioElement] = []
            var width = c.width - 88
            if c.hasPhoto {
                let size = 100.0
                elements += c.photo(c.width - 44 - size, 25, size, backing: mix(c.palette.accent, white, 0.3), ring: gold)
                width -= size + 28
            }
            let header = headerBlock(c, 44, 40, width, .left, HeaderOptions(nameSize: 32, nameColor: white, headlineColor: mix(gold, white, 0.45), contactColor: white, contacts: false))
            elements += header.elements
            if hasHeading(c) { elements.append(K.box(.rect, 44, header.bottom + 12, 56, 2, K.foilGold(0))) }
            return StudioCVHeader(elements: elements, mainTop: frame.main.top, sideTop: frame.side?.top ?? 0)
        },
        side: ["contact", "skills", "languages", "certificates"], title: .underline, sideTitle: .plain, entry: .stacked, photo: true, contactIcons: true, levelBar: .thin, photoRing: true
    )

    static let academic = StudioCVSpec(
        id: .academic, accent: "#7f1d1d", fonts: (K.Font.baskerville, K.Font.sourceSerif),
        palette: { accent in light(accent) { $0.text = "#1c1917"; $0.muted = "#44403c"; $0.soft = mix(accent, white, 0.72); $0.line = "#d6d3d1" } },
        frame: { c, _ in single(c, 60) },
        header: { c, frame in
            let main = frame.main
            let header = headerBlock(c, main.x, main.top, main.width, .center, HeaderOptions(nameSize: 26, nameColor: c.palette.text, headlineColor: c.palette.accent, contactColor: c.palette.muted, headlineItalic: true))
            return StudioCVHeader(elements: header.elements + [K.rule(main.x, header.bottom + 14, main.width, c.palette.accent, 0.8)], mainTop: header.bottom + 32, sideTop: main.top)
        },
        side: [], title: .rule, entry: .dateLeft, photo: false
    )

    static let designer = StudioCVSpec(
        id: .designer, accent: "#7c3aed", fonts: (K.Font.poppins, K.Font.lora),
        palette: { accent in light(mix(accent, black, 0.12)) { p in
            p.text = "#1f2937"; p.muted = "#4b5563"; p.soft = mix(accent, white, 0.78); p.sideFill = mix(accent, white, 0.9)
            p.sideText = "#1f2937"; p.sideMuted = "#4b5563"; p.sideAccent = mix(accent, black, 0.2); p.sideSoft = mix(accent, white, 0.7)
        } },
        frame: { c, pageIndex in
            let sideWidth = 214.0
            let block = pageIndex == 0 && c.hasPhoto ? 240.0 : 0
            var decor = [K.box(.rect, 0, 0, sideWidth, c.height, .solid(c.palette.sideFill ?? white))]
            if block > 0 {
                decor += [K.box(.rect, 0, 0, sideWidth, block, K.gradient(150, [mix(c.palette.accent, white, 0.12), mix(c.palette.accent, black, 0.25)])), K.art("triangleTiles", primary: white, secondary: white, 0, 0, sideWidth, block, opacity: 0.08)]
            } else {
                decor.append(K.box(.rect, 0, 0, sideWidth, 8, .solid(c.palette.accent)))
            }
            var frame = sidebarFrame(c, left: true, sideWidth, decor, 44)
            if block > 0, var side = frame.side { side.top = block + 30; frame.side = side }
            return frame
        },
        header: { c, frame in
            var elements: [StudioElement] = []
            if c.hasPhoto {
                let size = 140.0
                elements += c.photo((214 - size) / 2, 50, size, backing: mix(c.palette.accent, white, 0.4), ring: white)
            }
            let header = headerBlock(c, frame.main.x, frame.main.top + 6, frame.main.width, .left, HeaderOptions(nameSize: 34, nameColor: c.palette.text, headlineColor: c.palette.accent, contactColor: c.palette.muted, contacts: false))
            elements += header.elements
            if hasHeading(c) {
                elements += [K.box(.rect, frame.main.x, header.bottom + 14, 34, 6, .solid(c.palette.accent), radius: 3), K.box(.rect, frame.main.x + 40, header.bottom + 14, 12, 6, .solid(mix(c.palette.accent, white, 0.6)), radius: 3)]
            }
            return StudioCVHeader(elements: elements, mainTop: header.bottom + 40, sideTop: frame.side?.top ?? 0)
        },
        side: ["contact", "skills", "languages", "interests"], title: .leftBar, sideTitle: .plain, entry: .stacked, photo: true, contactIcons: true, levelBar: .segmented, photoRing: true
    )

    static let infographic = StudioCVSpec(
        id: .infographic, accent: "#14b8a6", fonts: (K.Font.raleway, K.Font.inter),
        palette: { accent in light(mix(accent, black, 0.38)) { p in
            p.text = "#0f172a"; p.muted = "#475569"; p.soft = mix(accent, white, 0.72); p.sideFill = "#0f172a"
            p.sideText = "#f1f5f9"; p.sideMuted = "#cbd5e1"; p.sideAccent = mix(accent, white, 0.15); p.sideSoft = "#334155"
        } },
        frame: { c, _ in
            sidebarFrame(c, left: true, 210, [K.box(.rect, 0, 0, 210, c.height, K.gradient(180, ["#1e293b", "#0f172a"])), K.art("topographic", primary: "#334155", secondary: c.palette.sideAccent, 0, 0, 210, c.height, opacity: 0.35)], 40)
        },
        header: { c, frame in
            var elements: [StudioElement] = []
            var sideTop = frame.side?.top ?? 0
            if let side = frame.side, c.hasPhoto {
                let size = 128.0
                elements += c.photo(side.x + (side.width - size) / 2, side.top, size, backing: "#334155", ring: c.palette.sideAccent)
                sideTop = side.top + size + 28
            }
            let header = headerBlock(c, frame.main.x, frame.main.top, frame.main.width, .left, HeaderOptions(nameSize: 32, nameColor: "#0f172a", headlineColor: c.palette.accent, contactColor: "#64748b", upper: true, spacing: 1, contacts: false))
            elements += header.elements
            if hasHeading(c) {
                let y = header.bottom + 14
                elements += [K.box(.rect, frame.main.x, y, frame.main.width, 4, .solid(c.palette.soft), radius: 2), K.box(.rect, frame.main.x, y, frame.main.width * 0.36, 4, .solid(c.palette.accent), radius: 2)]
            }
            return StudioCVHeader(elements: elements, mainTop: header.bottom + 36, sideTop: sideTop)
        },
        side: ["contact", "skills", "languages", "interests"], title: .band, sideTitle: .band, entry: .timeline, photo: true, contactIcons: true, levelBar: .segmented, photoRing: true
    )

    static func spec(_ id: StudioCVLayoutId) -> StudioCVSpec {
        switch id {
        case .modern: modern
        case .classic: classic
        case .corporate: corporate
        case .minimal: minimal
        case .creative: creative
        case .timeline: timeline
        case .compact: compact
        case .elegant: elegant
        case .tech: tech
        case .ats: ats
        case .executive: executive
        case .academic: academic
        case .designer: designer
        case .infographic: infographic
        }
    }
}
