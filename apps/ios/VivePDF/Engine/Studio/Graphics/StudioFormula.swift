import Foundation
import JavaScriptCore

/// LaTeX typesetting with the desktop's own MathJax build (TeX input, SVG output, New Computer Modern
/// fonts), bundled as `studio-mathjax.js.xz` and run in JavaScriptCore — no web view, works offline.
/// The bundle is built from `apps/desktop/src/features/viewer/overlay/formula/mathjaxEngine.ts`.
actor StudioFormulaEngine {
    static let shared = StudioFormulaEngine()

    enum Result: Equatable { case svg(String, emWidth: Double, emHeight: Double), error(String) }

    private var context: JSContext?

    private func load() throws -> JSContext {
        if let context { return context }
        guard let url = StudioResources.url("studio-mathjax.js", "xz") else { throw EngineError(.UNSUPPORTED, reason: "formulaEngine") }
        let packed = try Data(contentsOf: url)
        let script = try (packed as NSData).decompressed(using: .lzma) as Data
        guard let source = String(data: script, encoding: .utf8), let made = JSContext() else { throw EngineError(.UNSUPPORTED, reason: "formulaEngine") }
        let timeout: @convention(block) (JSValue, JSValue) -> Void = { function, _ in function.call(withArguments: []) }
        made.setObject(timeout, forKeyedSubscript: "setTimeout" as NSString)
        made.evaluateScript(source)
        if made.exception != nil || made.objectForKeyedSubscript("vivepdfTypeset")?.isUndefined != false { throw EngineError(.UNSUPPORTED, reason: "formulaEngine") }
        context = made
        return made
    }

    /// `typeset`: display-mode LaTeX → standalone SVG plus its size in ems (viewBox / 1000).
    func typeset(_ latex: String) throws -> Result {
        let context = try load()
        var json = "{\"error\":\"timeout\"}"
        let done: @convention(block) (String) -> Void = { json = $0 }
        // MathJax settles through microtasks, which JavaScriptCore drains before `call` returns.
        context.objectForKeyedSubscript("vivepdfTypeset").call(withArguments: [latex, unsafeBitCast(done, to: AnyObject.self)])
        guard let data = json.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return .error("invalid") }
        if let error = object["error"] as? String { return .error(error) }
        guard let svg = object["svg"] as? String, let w = object["emWidth"] as? Double, let h = object["emHeight"] as? Double else { return .error("empty") }
        return .svg(svg, emWidth: w, emHeight: h)
    }
}

/// `formulaSvg.ts` helpers and the formula template palette.
enum StudioFormulaMarkup {
    /// `coloredFormulaSvg`: strips size/style from the root and paints `currentColor`.
    static func colored(_ svg: String, _ color: String) -> String {
        let paint = StudioJSON.isColour(color) ? color : StudioFormulaSource.defaultColor
        var out = svg
        if let range = out.range(of: "^<svg\\b[^>]*>", options: .regularExpression) {
            let tag = String(out[range]).replacingOccurrences(of: "\\s(?:style|width|height)=\"[^\"]*\"", with: "", options: .regularExpression)
            out.replaceSubrange(range, with: tag)
        }
        return out.replacingOccurrences(of: "currentColor", with: paint)
    }

    static func round2(_ v: Double) -> String { StudioGraphicScene.num((v * 100).rounded() / 100) }

    /// `formulaSvg`: coloured, sized (100 per em) and stretched markup stored in the element.
    static func svg(_ f: StudioFormulaSource) -> String {
        let sized = colored(f.svg, f.color).replacingOccurrences(of: "^<svg\\b", with: "<svg width=\"\(round2(f.emWidth * 100))\" height=\"\(round2(f.emHeight * 100))\"", options: .regularExpression)
        return StudioGraphics.stretch(sized)
    }

    struct Group: Identifiable { let id: String; let labelKey: String; let items: [String] }

    enum MatrixBracket: String, CaseIterable, Identifiable { case paren, bracket, bar, double, brace, none; var id: String { rawValue }
        var environment: String { switch self { case .paren: "pmatrix"; case .bracket: "bmatrix"; case .bar: "vmatrix"; case .double: "Vmatrix"; case .brace: "Bmatrix"; case .none: "matrix" } }
    }
    enum MatrixFill: String, CaseIterable, Identifiable { case entries, zeros, identity, empty; var id: String { rawValue } }

    /// `matrixLatex`.
    static func matrix(rows: Int, columns: Int, bracket: MatrixBracket, fill: MatrixFill, letter: String) -> String {
        let r = max(1, min(10, rows)), c = max(1, min(10, columns))
        let safe = letter.count == 1 && letter.first!.isASCII && letter.first!.isLetter ? letter : "a"
        func cell(_ row: Int, _ column: Int) -> String {
            switch fill {
            case .entries: return "\(safe)_{\(r > 9 || c > 9 ? "\(row),\(column)" : "\(row)\(column)")}"
            case .zeros: return "0"
            case .identity: return row == column ? "1" : "0"
            case .empty: return ""
            }
        }
        let body = (1...r).map { row in (1...c).map { cell(row, $0) }.joined(separator: " & ").replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression) }.joined(separator: " \\\\\n")
        return "\\begin{\(bracket.environment)}\n\(body)\n\\end{\(bracket.environment)}"
    }
}
