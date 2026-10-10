import PDFKit
import UIKit

/// Print options (desktop `PrintDialog`). Printer, copies and duplex are chosen in the system print panel.
struct PrintOptions: Equatable {
    enum Pages: String, CaseIterable { case all, current, range }
    enum Subset: String, CaseIterable { case all, odd, even }
    enum Scale: String, CaseIterable { case fit, actual }

    var pages: Pages = .all
    var range = ""
    /// Zero-based page shown when "current page" is chosen.
    var currentPage = 0
    var subset: Subset = .all
    var reverse = false
    var includeAnnotations = true
    var grayscale = false
    var scale: Scale = .fit
    var pagesPerSheet = 1
    var autoRotate = true
    var duplex: UIPrintInfo.Duplex = .none

    static let pagesPerSheetChoices = [1, 2, 4, 6, 9]
}

enum PrintJobEngine {
    /// Zero-based pages to print in order, or nil when the range does not parse.
    static func pageIndices(_ options: PrintOptions, pageCount: Int) -> [Int]? {
        guard pageCount > 0 else { return [] }
        var pages: [Int]
        switch options.pages {
        case .all: pages = Array(0..<pageCount)
        case .current: pages = [min(max(0, options.currentPage), pageCount - 1)]
        case .range:
            guard !options.range.trimmingCharacters(in: .whitespaces).isEmpty,
                  let parsed = PageRanges.parse(options.range, pageCount: pageCount) else { return nil }
            pages = parsed
        }
        switch options.subset {
        case .all: break
        case .odd: pages = pages.filter { $0 % 2 == 0 }
        case .even: pages = pages.filter { $0 % 2 == 1 }
        }
        if options.reverse { pages.reverse() }
        return pages
    }

    /// Columns × rows of an n-up sheet; the long side of the sheet gets more cells.
    static func grid(pagesPerSheet: Int, sheetIsPortrait: Bool) -> (columns: Int, rows: Int) {
        let (short, long): (Int, Int) = switch pagesPerSheet {
        case 2: (1, 2)
        case 4: (2, 2)
        case 6: (2, 3)
        case 9: (3, 3)
        default: (1, 1)
        }
        return sheetIsPortrait ? (short, long) : (long, short)
    }

    static func printInfo(_ options: PrintOptions, jobName: String) -> UIPrintInfo {
        let info = UIPrintInfo.printInfo()
        info.jobName = jobName
        info.outputType = options.grayscale ? .grayscale : .general
        info.duplex = options.duplex
        return info
    }
}

/// Draws the chosen PDF pages (vector, with or without markup) onto print sheets, n-up and auto-rotated.
final class PDFPrintRenderer: UIPrintPageRenderer {
    let document: PDFDocument
    let pages: [Int]
    let options: PrintOptions

    init(document: PDFDocument, pages: [Int], options: PrintOptions) {
        self.document = document
        self.pages = pages
        self.options = options
        super.init()
    }

    private var perSheet: Int { max(1, options.pagesPerSheet) }

    override var numberOfPages: Int { (pages.count + perSheet - 1) / perSheet }

    override func drawPage(at sheetIndex: Int, in printableRect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        let grid = PrintJobEngine.grid(pagesPerSheet: perSheet, sheetIsPortrait: paperRect.height >= paperRect.width)
        let cellWidth = printableRect.width / CGFloat(grid.columns)
        let cellHeight = printableRect.height / CGFloat(grid.rows)
        for slot in 0..<perSheet {
            let position = sheetIndex * perSheet + slot
            guard position < pages.count, let page = document.page(at: pages[position]) else { break }
            let column = slot % grid.columns, row = slot / grid.columns
            let cell = CGRect(x: printableRect.minX + CGFloat(column) * cellWidth, y: printableRect.minY + CGFloat(row) * cellHeight,
                              width: cellWidth, height: cellHeight).insetBy(dx: perSheet > 1 ? 4 : 0, dy: perSheet > 1 ? 4 : 0)
            draw(page, in: cell, context: context)
        }
    }

    private func draw(_ page: PDFPage, in cell: CGRect, context: CGContext) {
        let bounds = page.bounds(for: .cropBox)
        let quarter = (page.rotation / 90) % 2 != 0
        var size = quarter ? CGSize(width: bounds.height, height: bounds.width) : bounds.size
        // Turn landscape pages on portrait cells (and the reverse) so they fill the paper.
        let turn = options.autoRotate && (size.width > size.height) != (cell.width > cell.height) && abs(size.width - size.height) > 1
        let pageSize = size
        if turn { size = CGSize(width: size.height, height: size.width) }
        let fit = min(cell.width / size.width, cell.height / size.height)
        // Actual size prints 1:1 (points), centred and clipped to the paper like the desktop dialog.
        let scale = options.scale == .fit || perSheet > 1 ? fit : 1
        let drawn = CGRect(x: cell.midX - size.width * scale / 2, y: cell.midY - size.height * scale / 2,
                           width: size.width * scale, height: size.height * scale)
        context.saveGState()
        context.clip(to: cell)
        context.translateBy(x: drawn.minX, y: drawn.maxY)
        context.scaleBy(x: scale, y: -scale)
        if turn {
            // Quarter turn clockwise: (x, y) → (y, w − x) where w is the unturned width.
            context.concatenate(CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: pageSize.width))
        }
        let hidden = options.includeAnnotations ? [] : page.annotations.filter { $0.shouldDisplay && $0.type != "Widget" }
        hidden.forEach { $0.shouldDisplay = false }
        page.draw(with: .cropBox, to: context)
        hidden.forEach { $0.shouldDisplay = true }
        context.restoreGState()
    }
}
