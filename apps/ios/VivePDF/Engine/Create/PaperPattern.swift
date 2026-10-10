import CoreGraphics
import Foundation

/// Printable paper patterns (`_paper.py` / `paperPattern.ts`): the marks are computed in points with a
/// top-left origin, so the same geometry drives both the PDF and the SwiftUI previews.
struct PaperPattern: Equatable, Sendable {
    enum Style: String, CaseIterable, Sendable {
        case lined, grid, dots, isometric, handwriting, staff

        var defaultSpacing: Double {
            switch self {
            case .lined: 8
            case .grid, .dots: 5
            case .isometric: 6
            case .handwriting: 4
            case .staff: 2
            }
        }
    }

    enum LineKind { case rule, guide, margin }

    struct Line {
        var from: CGPoint
        var to: CGPoint
        var kind: LineKind
    }

    struct Marks {
        var lines: [Line] = []
        var dots: [CGPoint] = []
        var dotRadius: CGFloat = 0
    }

    static let defaultColor = "#9bb4d0"
    static let marginColor = "#de6666"
    static let spacingRange: ClosedRange<Double> = 2...30
    static let insetMM: CGFloat = 10
    static let marginOffsetMM: CGFloat = 20
    static let maxMarks = 40_000

    var style: Style
    var spacing: Double
    var color: String = PaperPattern.defaultColor
    var margin = false

    func marks(width: CGFloat, height: CGFloat) -> Marks {
        let mm = CreateEngine.pointsPerMM
        let step = CGFloat(spacing) * mm
        let inset = Self.insetMM * mm
        let left = inset, top = inset, right = width - inset, bottom = height - inset
        var marks = Marks(dotRadius: min(1.2, max(0.5, step * 0.05)))
        guard step > 0, right - left >= step, bottom - top >= step else { return marks }
        let epsilon: CGFloat = 1e-6
        func count(_ length: CGFloat, _ step: CGFloat) -> Int { max(0, Int(floor(length / step + epsilon))) }
        func banded(lines: Int, gap: CGFloat) -> [CGFloat] {
            let band = CGFloat(lines - 1) * step
            var rows: [CGFloat] = []
            var y = top + step
            while y + band <= bottom + epsilon {
                for index in 0..<lines { rows.append(y + CGFloat(index) * step) }
                y += band + gap
            }
            return rows
        }
        func horizontal(_ y: CGFloat, _ kind: LineKind) -> Line { Line(from: CGPoint(x: left, y: y), to: CGPoint(x: right, y: y), kind: kind) }

        switch style {
        case .lined:
            let rows = count(bottom - top, step)
            if rows > 0 { for index in 1...rows { marks.lines.append(horizontal(top + CGFloat(index) * step, .rule)) } }
            let x = left + Self.marginOffsetMM * mm
            if margin && x < right { marks.lines.append(Line(from: CGPoint(x: x, y: top), to: CGPoint(x: x, y: bottom), kind: .margin)) }
        case .grid:
            let columns = count(right - left, step), rows = count(bottom - top, step)
            guard columns > 0, rows > 0 else { break }
            let x0 = (width - CGFloat(columns) * step) / 2, y0 = (height - CGFloat(rows) * step) / 2
            for column in 0...columns {
                let x = x0 + CGFloat(column) * step
                marks.lines.append(Line(from: CGPoint(x: x, y: y0), to: CGPoint(x: x, y: y0 + CGFloat(rows) * step), kind: .rule))
            }
            for row in 0...rows {
                let y = y0 + CGFloat(row) * step
                marks.lines.append(Line(from: CGPoint(x: x0, y: y), to: CGPoint(x: x0 + CGFloat(columns) * step, y: y), kind: .rule))
            }
        case .dots:
            let columns = count(right - left, step), rows = count(bottom - top, step)
            let x0 = (width - CGFloat(columns) * step) / 2, y0 = (height - CGFloat(rows) * step) / 2
            for row in 0...rows {
                for column in 0...columns { marks.dots.append(CGPoint(x: x0 + CGFloat(column) * step, y: y0 + CGFloat(row) * step)) }
            }
        case .isometric:
            let rowHeight = step * sqrt(3) / 2
            let columns = count(right - left, step), rows = count(bottom - top, rowHeight)
            let x0 = (width - CGFloat(columns) * step) / 2, y0 = (height - CGFloat(rows) * rowHeight) / 2
            for row in 0...rows {
                let odd = row % 2 == 1
                let shift = odd ? step / 2 : 0
                for column in 0..<(odd ? columns : columns + 1) {
                    marks.dots.append(CGPoint(x: x0 + CGFloat(column) * step + shift, y: y0 + CGFloat(row) * rowHeight))
                }
            }
        case .handwriting:
            for (index, y) in banded(lines: 4, gap: 2 * step).enumerated() {
                marks.lines.append(horizontal(y, index % 4 == 1 || index % 4 == 2 ? .guide : .rule))
            }
        case .staff:
            for y in banded(lines: 5, gap: 6 * step) { marks.lines.append(horizontal(y, .rule)) }
        }
        return marks
    }

    /// Strokes the pattern into a page (top-left geometry converted through `canvas`).
    func draw(in context: CGContext, canvas: StoryCanvas) throws {
        let marks = marks(width: canvas.pageSize.width, height: canvas.pageSize.height)
        if marks.lines.count + marks.dots.count > Self.maxMarks { throw EngineError(.INVALID_PARAMS, reason: "paperTooDense") }
        let colour = StoryColor.hex(StoryColor.isValid(color) ? color : Self.defaultColor)
        func stroke(_ kind: LineKind, width: CGFloat, colour: CGColor, dashes: [CGFloat] = []) {
            let lines = marks.lines.filter { $0.kind == kind }
            guard !lines.isEmpty else { return }
            context.saveGState()
            context.setStrokeColor(colour)
            context.setLineWidth(width)
            context.setLineDash(phase: 0, lengths: dashes)
            for line in lines {
                context.move(to: canvas.cg(line.from))
                context.addLine(to: canvas.cg(line.to))
            }
            context.strokePath()
            context.restoreGState()
        }
        stroke(.rule, width: 0.5, colour: colour)
        stroke(.guide, width: 0.4, colour: colour, dashes: [2, 2])
        stroke(.margin, width: 0.7, colour: StoryColor.hex(Self.marginColor))
        if !marks.dots.isEmpty {
            // Zero-length round-capped strokes: one short path per dot keeps the content stream small.
            context.saveGState()
            context.setStrokeColor(colour)
            context.setLineWidth(marks.dotRadius * 2)
            context.setLineCap(.round)
            for dot in marks.dots {
                let center = canvas.cg(dot)
                context.move(to: center)
                context.addLine(to: center)
            }
            context.strokePath()
            context.restoreGState()
        }
    }
}

struct CreatePaperOptions: Sendable {
    static let sizes = ["a4", "a5", "a3", "letter"]
    static let maxPages = 500

    var size = "a4"
    var landscape = false
    var pages = 20
    /// nil = plain (empty) pages.
    var pattern: PaperPattern?
    var output: URL
}

extension CreateEngine {
    static func createPaper(_ options: CreatePaperOptions, progress: ProgressHandler?) async throws -> JobResult {
        guard (1...CreatePaperOptions.maxPages).contains(options.pages) else { throw EngineError.invalid("pages") }
        let pageSize = paperSize(options.size, landscape: options.landscape)
        var box = CGRect(origin: .zero, size: pageSize)
        guard let context = CGContext(options.output as CFURL, mediaBox: &box, StoryRenderer.auxiliaryInfo(StoryMetadata())) else {
            throw EngineError.internalError("pdf context")
        }
        let canvas = StoryCanvas(pageSize: pageSize)
        let reporter = ProgressReporter(total: options.pages, progress)
        do {
            // The pattern is drawn once into a stencil page that every page reuses (one shared form
            // XObject in the output, like the desktop's `show_pdf_page`).
            let stencil = try options.pattern.map { try paperStencil($0, size: pageSize) }
            for index in 0..<options.pages {
                try reporter.step(index, t("progress.creatingPages", ["current": index + 1, "total": options.pages]))
                context.beginPDFPage(nil)
                if let stencil { context.drawPDFPage(stencil) }
                context.endPDFPage()
            }
            context.closePDF()
        } catch {
            context.closePDF()
            try? FileManager.default.removeItem(at: options.output)
            throw error
        }
        return JobResult(outputs: [options.output], summary: t("tools.create.resultCaption", ["count": options.pages]))
    }

    static func paperStencil(_ pattern: PaperPattern, size: CGSize) throws -> CGPDFPage {
        let data = NSMutableData()
        var box = CGRect(origin: .zero, size: size)
        guard let consumer = CGDataConsumer(data: data as CFMutableData),
              let context = CGContext(consumer: consumer, mediaBox: &box, nil) else { throw EngineError.internalError("pdf context") }
        context.beginPDFPage(nil)
        try pattern.draw(in: context, canvas: StoryCanvas(pageSize: size))
        context.endPDFPage()
        context.closePDF()
        guard let provider = CGDataProvider(data: data as CFData), let document = CGPDFDocument(provider), let page = document.page(at: 1) else {
            throw EngineError.internalError("stencil")
        }
        return page
    }
}
