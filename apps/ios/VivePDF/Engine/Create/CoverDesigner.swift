import CoreGraphics
import CoreText
import Foundation

/// Title pages in the five desktop styles (`cover.py`): classic, colour band, framed, minimal, photo.
struct CoverDesign: Sendable {
    enum Style: String, CaseIterable, Sendable { case classic, band, frame, minimal, photo }

    var style: Style = .classic
    var title = ""
    var subtitle = ""
    var author = ""
    var organisation = ""
    var date = ""
    var details = ""
    var accent = CreateEngine.defaultAccent
    var font: StoryFontFamily = .sans
    var logo: CGImage?
    var photo: CGImage?
}

/// A vertical stack of text paragraphs placed inside an area, like `insert_centered` / `put_bottom`.
struct TextStack {
    enum Piece {
        case text(String, size: CGFloat, bold: Bool, color: CGColor, letterSpacing: CGFloat)
        case gap(CGFloat)
        case image(CGImage, maxWidth: CGFloat, maxHeight: CGFloat)
    }

    var pieces: [Piece] = []
    var family: StoryFontFamily
    var alignment: CTTextAlignment

    mutating func text(_ value: String, size: CGFloat, bold: Bool = false, color: CGColor = StoryColor.text, letterSpacing: CGFloat = 0) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        pieces.append(.text(trimmed, size: size, bold: bold, color: color, letterSpacing: letterSpacing))
    }

    mutating func gap(_ size: CGFloat) { pieces.append(.gap(size)) }

    var isEmpty: Bool { !pieces.contains { if case .gap = $0 { return false } else { return true } } }

    private func strings(scale: CGFloat) -> [NSAttributedString] {
        pieces.compactMap { piece in
            guard case .text(let value, let size, let bold, let color, let spacing) = piece else { return nil }
            var style = StoryTextStyle(family: family, size: size * scale, color: color, bold: bold, lineHeight: 1.25, alignment: alignment)
            style.letterSpacing = spacing * scale
            return style.string(value)
        }
    }

    private func height(width: CGFloat, scale: CGFloat) -> CGFloat {
        var total: CGFloat = 0
        var strings = self.strings(scale: scale).makeIterator()
        for piece in pieces {
            switch piece {
            case .text: total += StoryPaginator.measure(strings.next()!, width: width)
            case .gap(let size): total += size * scale * 1.25
            case .image(let image, let maxWidth, let maxHeight):
                let fit = min(maxWidth * scale / CGFloat(image.width), maxHeight * scale / CGFloat(image.height), 1)
                total += CGFloat(image.height) * fit
            }
        }
        return total
    }

    enum Placement { case top, center, bottom }

    /// Draws the stack in `rect`, shrinking the text when it would not fit (like `insert_htmlbox`).
    func draw(in rect: CGRect, placement: Placement, context: CGContext, canvas: StoryCanvas) {
        guard !isEmpty else { return }
        var scale: CGFloat = 1
        var total = height(width: rect.width, scale: scale)
        while total > rect.height && scale > 0.3 {
            scale *= 0.92
            total = height(width: rect.width, scale: scale)
        }
        var y: CGFloat = switch placement {
        case .top: rect.minY
        case .center: rect.minY + max(0, (rect.height - total) / 2)
        case .bottom: rect.maxY - min(total, rect.height)
        }
        var strings = self.strings(scale: scale).makeIterator()
        for piece in pieces {
            switch piece {
            case .text:
                let string = strings.next()!
                let height = StoryPaginator.measure(string, width: rect.width)
                StoryRenderer.drawText(string, in: CGRect(x: rect.minX, y: y, width: rect.width, height: height), verticalCenter: false, context: context, canvas: canvas)
                y += height
            case .gap(let size):
                y += size * scale * 1.25
            case .image(let image, let maxWidth, let maxHeight):
                let fit = min(maxWidth * scale / CGFloat(image.width), maxHeight * scale / CGFloat(image.height), 1)
                let size = CGSize(width: CGFloat(image.width) * fit, height: CGFloat(image.height) * fit)
                let x: CGFloat = switch alignment {
                case .left: rect.minX
                case .right: rect.maxX - size.width
                case .natural: rect.minX
                default: rect.midX - size.width / 2
                }
                context.interpolationQuality = .high
                context.draw(image, in: canvas.cg(CGRect(x: x, y: y, width: size.width, height: size.height)))
                y += size.height
            }
        }
    }
}

enum CoverDesigner {
    static func draw(_ design: CoverDesign, context: CGContext, canvas: StoryCanvas) throws {
        let size = canvas.pageSize
        let scale = min(size.width, size.height) / 595
        func s(_ points: CGFloat) -> CGFloat { (points * scale * 10).rounded() / 10 }
        let accent = StoryColor.hex(StoryColor.isValid(design.accent) ? design.accent : CreateEngine.defaultAccent)
        let muted = StoryColor.hex("#555555")
        func area(_ left: CGFloat, _ top: CGFloat, _ right: CGFloat, _ bottom: CGFloat) -> CGRect {
            CGRect(x: size.width * left, y: size.height * top, width: size.width * (right - left), height: size.height * (bottom - top))
        }
        func stack(_ alignment: CTTextAlignment) -> TextStack { TextStack(family: design.font, alignment: alignment) }
        func logoStack(_ alignment: CTTextAlignment) -> TextStack {
            var logo = stack(alignment)
            if let image = design.logo { logo.pieces.append(.image(image, maxWidth: 170, maxHeight: 54)) }
            return logo
        }
        func people(_ alignment: CTTextAlignment, size points: CGFloat = 13) -> TextStack {
            var people = stack(alignment)
            people.text(design.author, size: s(points), bold: true)
            people.text(design.details, size: s(points - 2), color: muted)
            people.text(design.date, size: s(points - 2), color: muted)
            return people
        }
        func fill(_ rect: CGRect, _ colour: CGColor) {
            context.setFillColor(colour)
            context.fill(canvas.cg(rect))
        }
        func strokeRect(_ rect: CGRect, width: CGFloat) {
            context.setStrokeColor(accent)
            context.setLineWidth(width)
            context.stroke(canvas.cg(rect))
        }

        switch design.style {
        case .classic:
            logoStack(.center).draw(in: area(0.12, 0.06, 0.88, 0.2), placement: .center, context: context, canvas: canvas)
            var heading = stack(.center)
            heading.text(design.organisation, size: s(12), color: muted, letterSpacing: 1.5)
            if !design.organisation.isEmpty { heading.gap(s(18)) }
            heading.text(design.title, size: s(32), bold: true, color: accent)
            heading.gap(s(8))
            heading.text(design.subtitle, size: s(16), color: muted)
            heading.draw(in: area(0.12, 0.24, 0.88, 0.62), placement: .center, context: context, canvas: canvas)
            let middle = size.width / 2, ruleY = size.height * 0.66
            context.setStrokeColor(accent)
            context.setLineWidth(s(2))
            context.move(to: canvas.cg(CGPoint(x: middle - s(60), y: ruleY)))
            context.addLine(to: canvas.cg(CGPoint(x: middle + s(60), y: ruleY)))
            context.strokePath()
            people(.center).draw(in: area(0.12, 0.7, 0.88, 0.92), placement: .center, context: context, canvas: canvas)

        case .band:
            fill(area(0, 0, 1, 0.42), accent)
            var heading = stack(.left)
            heading.text(design.organisation, size: s(11), color: StoryColor.white, letterSpacing: 1.5)
            if !design.organisation.isEmpty { heading.gap(s(10)) }
            heading.text(design.title, size: s(34), bold: true, color: StoryColor.white)
            heading.gap(s(6))
            heading.text(design.subtitle, size: s(15), color: StoryColor.white)
            heading.draw(in: area(0.1, 0.06, 0.9, 0.38), placement: .bottom, context: context, canvas: canvas)
            logoStack(.left).draw(in: area(0.1, 0.47, 0.9, 0.6), placement: .top, context: context, canvas: canvas)
            people(.left).draw(in: area(0.1, 0.62, 0.9, 0.92), placement: .bottom, context: context, canvas: canvas)

        case .frame:
            let inset = s(28)
            let outer = CGRect(origin: .zero, size: size).insetBy(dx: inset, dy: inset)
            strokeRect(outer, width: s(2.5))
            strokeRect(outer.insetBy(dx: s(6), dy: s(6)), width: s(0.7))
            var top = logoStack(.center)
            if design.logo != nil { top.gap(s(6)) }
            top.text(design.organisation, size: s(13), bold: true, letterSpacing: 1.5)
            top.draw(in: area(0.14, 0.08, 0.86, 0.3), placement: .center, context: context, canvas: canvas)
            var heading = stack(.center)
            heading.text(design.title, size: s(28), bold: true, color: accent)
            heading.gap(s(8))
            heading.text(design.subtitle, size: s(15))
            heading.draw(in: area(0.14, 0.34, 0.86, 0.62), placement: .center, context: context, canvas: canvas)
            people(.center).draw(in: area(0.14, 0.66, 0.86, 0.9), placement: .center, context: context, canvas: canvas)

        case .minimal:
            let left = size.width * 0.1
            context.setStrokeColor(accent)
            context.setLineWidth(s(3))
            context.move(to: canvas.cg(CGPoint(x: left - s(14), y: size.height * 0.08)))
            context.addLine(to: canvas.cg(CGPoint(x: left - s(14), y: size.height * 0.92)))
            context.strokePath()
            logoStack(.left).draw(in: area(0.1, 0.07, 0.5, 0.2), placement: .top, context: context, canvas: canvas)
            var date = stack(.right)
            date.text(design.date, size: s(11), color: muted)
            date.draw(in: area(0.55, 0.08, 0.9, 0.2), placement: .top, context: context, canvas: canvas)
            var heading = stack(.left)
            heading.text(design.organisation, size: s(11), color: muted, letterSpacing: 1.5)
            if !design.organisation.isEmpty { heading.gap(s(8)) }
            heading.text(design.title, size: s(40), bold: true)
            heading.gap(s(8))
            heading.text(design.subtitle, size: s(16), color: muted)
            heading.draw(in: area(0.1, 0.3, 0.9, 0.7), placement: .bottom, context: context, canvas: canvas)
            var who = stack(.left)
            who.text(design.author, size: s(13), bold: true)
            who.text(design.details, size: s(11), color: muted)
            who.draw(in: area(0.1, 0.74, 0.9, 0.92), placement: .bottom, context: context, canvas: canvas)

        case .photo:
            guard let photo = design.photo else { throw EngineError(.INVALID_PARAMS, reason: "noCoverImage") }
            let share: CGFloat = 0.56
            let picture = area(0, 0, 1, share)
            StoryImages.drawCover(photo, in: canvas.cg(picture), context: context)
            fill(CGRect(x: picture.minX, y: picture.maxY, width: picture.width, height: s(6)), accent)
            var heading = stack(.left)
            heading.text(design.organisation, size: s(11), color: muted, letterSpacing: 1.5)
            if !design.organisation.isEmpty { heading.gap(s(6)) }
            heading.text(design.title, size: s(30), bold: true, color: accent)
            heading.gap(s(6))
            heading.text(design.subtitle, size: s(15), color: muted)
            heading.draw(in: area(0.1, share + 0.05, 0.9, 0.84), placement: .top, context: context, canvas: canvas)
            logoStack(.left).draw(in: area(0.1, 0.82, 0.6, 0.94), placement: .top, context: context, canvas: canvas)
            var who = stack(.right)
            who.text(design.author, size: s(12), bold: true)
            who.text(design.date, size: s(11), color: muted)
            who.draw(in: area(0.5, 0.84, 0.9, 0.94), placement: .bottom, context: context, canvas: canvas)
        }
    }
}
