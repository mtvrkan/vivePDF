import Observation
import SwiftUI
import WebKit

/// Formatting state at the caret, reported by the editor script (`useEditorState` on desktop).
struct StudioDocEditorState: Equatable {
    var block = "paragraph"
    var bold = false
    var italic = false
    var underline = false
    var strike = false
    var superscript = false
    var `subscript` = false
    var link: String?
    var list: String?
    var quote = false
    var code = false
    var table = false
    var align = "left"
    var fontId: String?
    var fontSize: String?
    var color: String?
    var highlight: String?
    var canUndo = false
    var canRedo = false
    var canSink = false
    var canLift = false
    var image: Int?

    init() {}

    init(_ message: [String: Any]) {
        block = message["block"] as? String ?? "paragraph"
        bold = message["bold"] as? Bool ?? false
        italic = message["italic"] as? Bool ?? false
        underline = message["underline"] as? Bool ?? false
        strike = message["strike"] as? Bool ?? false
        superscript = message["superscript"] as? Bool ?? false
        `subscript` = message["subscript"] as? Bool ?? false
        link = message["link"] as? String
        list = message["list"] as? String
        quote = message["quote"] as? Bool ?? false
        code = message["code"] as? Bool ?? false
        table = message["table"] as? Bool ?? false
        align = message["align"] as? String ?? "left"
        fontId = message["fontId"] as? String
        fontSize = message["fontSize"] as? String
        color = message["color"] as? String
        highlight = message["highlight"] as? String
        canUndo = message["canUndo"] as? Bool ?? false
        canRedo = message["canRedo"] as? Bool ?? false
        canSink = message["canSink"] as? Bool ?? false
        canLift = message["canLift"] as? Bool ?? false
        image = (message["image"] as? NSNumber)?.intValue
    }
}

/// Owns the editing web view and talks to `studio-doc-editor.js`.
@MainActor
@Observable
final class StudioDocEditorBridge: NSObject, WKScriptMessageHandler {
    private(set) var state = StudioDocEditorState()
    private(set) var ready = false
    @ObservationIgnored let webView: WKWebView
    @ObservationIgnored weak var store: StudioDocStore?
    @ObservationIgnored var onShortcut: ((String) -> Void)?
    @ObservationIgnored private var loadedFonts = Set<String>()
    @ObservationIgnored private var pageLoaded = false

    init(store: StudioDocStore) {
        self.store = store
        let configuration = WKWebViewConfiguration()
        let controller = WKUserContentController()
        configuration.userContentController = controller
        configuration.dataDetectorTypes = []
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        controller.add(WeakScriptHandler(self), name: "vp")
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.allowsLinkPreview = false
        webView.accessibilityLabel = t("studio.doc.editorLabel")
        load()
    }

    private func load() {
        guard let url = StudioResources.url("studio-doc-editor", "js"), let script = try? String(contentsOf: url, encoding: .utf8) else { return }
        let page = """
        <!doctype html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
        <style>\(Self.chromeCSS)</style><style id="vp-style"></style></head>
        <body><div id="paper"><div id="editor" contenteditable="true" spellcheck="true" autocorrect="on" role="textbox" aria-multiline="true" aria-label="\(StudioDocHTML.escape(t("studio.doc.editorLabel")))"></div></div>
        <script>\(script)</script></body></html>
        """
        webView.loadHTMLString(page, baseURL: nil)
    }

    nonisolated func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let doc = body["doc"]
        MainActor.assumeIsolated {
            switch type {
            case "ready":
                pageLoaded = true
                sendDocument()
            case "loaded":
                if let node = StudioDocNode(json: doc) { store?.adopt(node) }
                ready = true
            case "content":
                if let node = StudioDocNode(json: doc) { store?.setContent(node) }
            case "state":
                let next = StudioDocEditorState(body)
                if next != state { state = next }
            case "shortcut":
                if let name = body["name"] as? String { onShortcut?(name) }
            default:
                break
            }
        }
    }

    // MARK: Loading

    private func sendDocument() {
        guard pageLoaded, let store else { return }
        let document = store.document
        applySettings(document.settings)
        let html: String
        switch document.content {
        case .node(let node):
            StudioDocFonts.fontIds(in: node).forEach(ensureFont)
            html = StudioDocHTML.editor(node) { StudioDocFonts.stack($0) }
        case .html(let raw):
            html = StudioDocHTML.withoutRemotePictures(raw)
        }
        let options: [String: Any] = ["bodyFont": document.settings.fontId, "placeholder": t("studio.doc.placeholder")]
        call("VP.load", html, options)
    }

    func ensureFont(_ fontId: String) {
        guard pageLoaded, !loadedFonts.contains(fontId) else { return }
        loadedFonts.insert(fontId)
        call("VP.addFonts", StudioDocFonts.rules(fontId, cssFamily: StudioDocFonts.family(fontId)))
    }

    /// Paper size, margins and type from the document settings (desktop `.vp-doc` paper style).
    func applySettings(_ settings: StudioDocSettings) {
        guard pageLoaded else { return }
        ensureFont(settings.fontId)
        if let heading = settings.headingFontId { ensureFont(heading) }
        let size = settings.pageSize
        let margin = settings.marginPoints
        let heading = StudioDocFonts.stack(settings.headingFontId ?? settings.fontId)
        let css = """
        #paper{width:\(size.width)pt;min-height:\(size.height)pt;padding:\(margin)pt;font-size:\(settings.fontSize)pt;line-height:\(settings.lineHeight);font-family:\(StudioDocFonts.stack(settings.fontId));}
        #editor{min-height:\(max(0, size.height - margin * 2))pt;}
        h1,h2,h3,h4{color:\(settings.accent);font-family:\(heading);}
        a{color:\(settings.accent);}
        """
        call("VP.setStyle", css)
        call("VP.setPaper", size.width * 4 / 3)
        call("VP.setBodyFont", settings.fontId)
    }

    // MARK: Commands

    func command(_ name: String, _ argument: Any? = nil) {
        call("VP.cmd", name, argument ?? NSNull())
    }

    func setFont(_ fontId: String) {
        ensureFont(fontId)
        command("font", ["fontId": fontId, "family": StudioDocFonts.stack(fontId)])
    }

    func focus() { call("VP.focus") }

    private func call(_ function: String, _ arguments: Any...) {
        guard let data = try? JSONSerialization.data(withJSONObject: arguments, options: [.fragmentsAllowed]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("\(function).apply(null, \(json))", completionHandler: nil)
    }

    static let chromeCSS = """
    html,body{margin:0;padding:0;background:transparent;-webkit-text-size-adjust:100%;}
    body{padding:20px 0 120px;}
    #paper{box-sizing:border-box;margin:0 auto;background:#fff;color:#1a1a1a;box-shadow:0 2px 12px rgba(0,0,0,.12);border-radius:2px;}
    #editor{outline:none;white-space:pre-wrap;word-wrap:break-word;-webkit-user-modify:read-write;}
    #editor.is-empty>p:first-child::before{content:attr(data-placeholder);color:#9ca3af;float:left;height:0;pointer-events:none;}
    #editor p{margin:0 0 .6em;}
    #editor h1,#editor h2,#editor h3,#editor h4{font-weight:700;line-height:1.2;}
    #editor h1{font-size:2em;margin:.5em 0 .3em;}
    #editor h2{font-size:1.55em;margin:.65em 0 .32em;}
    #editor h3{font-size:1.25em;margin:.64em 0 .32em;}
    #editor h4{font-size:1.08em;margin:.65em 0 .25em;}
    #editor ul,#editor ol{margin:0 0 .5em;padding-left:18pt;}
    #editor ul{list-style:disc;}#editor ol{list-style:decimal;}
    #editor li p{margin:0;}
    #editor ul[data-type="taskList"]{list-style:none;padding-left:2pt;}
    #editor ul[data-type="taskList"] li{display:flex;gap:.4em;align-items:flex-start;}
    #editor ul[data-type="taskList"] li>label{flex:none;user-select:none;-webkit-user-select:none;}
    #editor ul[data-type="taskList"] li>label input{width:1em;height:1em;margin:.2em 0 0;}
    #editor ul[data-type="taskList"] li>div{flex:1;}
    #editor blockquote{border-left:2pt solid #d1d5db;color:#6b7280;margin:0 0 .6em;padding-left:10pt;}
    #editor pre{border-left:2pt solid #d1d5db;font-family:ui-monospace,monospace;font-size:.88em;margin:0 0 .6em;padding:2pt 0 2pt 8pt;white-space:pre-wrap;}
    #editor code{font-family:ui-monospace,monospace;}
    #editor a{text-decoration:underline;}
    #editor hr{border:none;border-top:.75pt solid #d1d5db;margin:8pt 0;}
    #editor img{display:block;height:auto;margin:0 auto;max-width:100%;}
    #editor img.vp-selected{outline:2px solid #0a84ff;outline-offset:2px;}
    #editor table{border-collapse:collapse;margin:0 0 .6em;table-layout:fixed;width:100%;}
    #editor td,#editor th{border:.5pt solid #6b7280;padding:3pt 5pt;vertical-align:top;}
    #editor th{border-bottom-width:1pt;font-weight:700;text-align:left;}
    #editor .page-break{border-top:1px dashed #6b7280;height:0;margin:12pt 0;}
    #editor mark{color:inherit;}
    """
}

/// Breaks the retain cycle between the content controller and the bridge.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/// Hosts the bridge's web view in SwiftUI.
struct StudioDocEditorWebView: UIViewRepresentable {
    let bridge: StudioDocEditorBridge
    func makeUIView(context: Context) -> WKWebView { bridge.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
