import CoreGraphics
import Foundation
import PDFKit

/// One row of the layer list (desktop `LayerRow`): an optional content group, or a text label from `/Order`.
struct PDFLayerInfo: Identifiable, Hashable, Sendable {
    /// Position of the OCG in `/OCProperties /OCGs` (nil for label rows).
    let ocgIndex: Int?
    /// Unique per row (labels get negative ids).
    let id: Int
    let name: String
    let depth: Int
    /// Visible in the document's default configuration (`/D /BaseState`, `/ON`, `/OFF`).
    let isOn: Bool
    /// Listed in `/D /Locked`: the reader may not switch it.
    let isLocked: Bool
    var isLabel: Bool { ocgIndex == nil }
}

/// Reads optional content groups (`/OCProperties`) with Core Graphics, since PDFKit has no layer API.
/// The row order follows `/D /Order` like the sidecar `_layers.layer_rows`; groups missing from the order
/// are appended at depth 0.
enum LayerReader {
    /// Switching layers needs a view copy with a rewritten `/OCProperties /D` (raw PDF writer pending).
    static let canSwitch = false

    static func layers(in pdf: PDFDocument) -> [PDFLayerInfo] {
        guard let document = pdf.documentRef else { return [] }
        return layers(in: document)
    }

    static func hasLayers(_ pdf: PDFDocument) -> Bool {
        layers(in: pdf).contains { !$0.isLabel }
    }

    static func layers(in document: CGPDFDocument) -> [PDFLayerInfo] {
        guard let catalog = document.catalog,
              let properties = ViewerCGPDF.dictionary(catalog, "OCProperties"),
              let ocgs = ViewerCGPDF.array(properties, "OCGs") else { return [] }
        var groups: [(dict: CGPDFDictionaryRef, name: String)] = []
        for index in 0..<CGPDFArrayGetCount(ocgs) {
            guard let dict = ViewerCGPDF.dictionary(ocgs, index) else { continue }
            groups.append((dict, ViewerCGPDF.text(dict, "Name") ?? ""))
        }
        guard !groups.isEmpty else { return [] }
        // Core Graphics resolves each indirect object once, so the same OCG yields the same pointer.
        func indexOf(_ dict: CGPDFDictionaryRef) -> Int? { groups.firstIndex { $0.dict == dict } }

        let config = ViewerCGPDF.dictionary(properties, "D")
        let baseOn = config.flatMap { ViewerCGPDF.name($0, "BaseState") } != "OFF"
        func members(_ key: String) -> Set<Int> {
            guard let config, let list = ViewerCGPDF.array(config, key) else { return [] }
            return Set((0..<CGPDFArrayGetCount(list)).compactMap { ViewerCGPDF.dictionary(list, $0).flatMap(indexOf) })
        }
        let on = members("ON"), off = members("OFF"), locked = members("Locked")
        func state(_ index: Int) -> Bool { baseOn ? !off.contains(index) : on.contains(index) }

        var rows: [PDFLayerInfo] = []
        var placed = Set<Int>()
        var labelID = -1

        func walk(_ array: CGPDFArrayRef, depth: Int) {
            guard depth < 16 else { return }
            let count = CGPDFArrayGetCount(array)
            var start = 0
            // A nested array that starts with a string is a labelled group.
            if count > 0, let label = ViewerCGPDF.text(array, 0) {
                rows.append(PDFLayerInfo(ocgIndex: nil, id: labelID, name: label, depth: depth, isOn: true, isLocked: false))
                labelID -= 1
                start = 1
            }
            let childDepth = start == 1 ? depth + 1 : depth
            for index in start..<max(start, count) {
                if let dict = ViewerCGPDF.dictionary(array, index), let group = indexOf(dict) {
                    guard !placed.contains(group) else { continue }
                    placed.insert(group)
                    rows.append(PDFLayerInfo(ocgIndex: group, id: group, name: groups[group].name, depth: childDepth,
                                             isOn: state(group), isLocked: locked.contains(group)))
                } else if let nested = ViewerCGPDF.array(array, index) {
                    // A plain nested array lists the children of the item before it.
                    let nestedHasLabel = CGPDFArrayGetCount(nested) > 0 && ViewerCGPDF.text(nested, 0) != nil
                    walk(nested, depth: nestedHasLabel ? childDepth : childDepth + 1)
                }
            }
        }
        if let config, let order = ViewerCGPDF.array(config, "Order") { walk(order, depth: 0) }
        for index in groups.indices where !placed.contains(index) {
            rows.append(PDFLayerInfo(ocgIndex: index, id: index, name: groups[index].name, depth: 0,
                                     isOn: state(index), isLocked: locked.contains(index)))
        }
        return rows
    }
}
