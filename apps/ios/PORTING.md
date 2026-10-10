# vivePDF for iPhone & iPad — porting guide

Native SwiftUI port of the desktop app (`apps/desktop`, React + Python/PyMuPDF sidecar). No Python, no
web view shell: every engine operation is reimplemented in Swift on PDFKit, Core Graphics, Core Text,
Core Image, Vision, VisionKit, Security/CryptoKit, Compression, WebKit and AVFoundation.

Project: `apps/ios/project.yml` (XcodeGen). `xcodegen generate` after adding files is **not** needed for
editing, but is needed before `xcodebuild` sees new files. Deployment target iOS 17, iPhone + iPad.

## Layout
```
VivePDF/App/            VivePDFApp, RootView (adaptive shell + route switch), AppModel
VivePDF/Core/           shared: L10n, Theme (Palette, Tone), Navigation (Route, ToolID, ToolCatalog),
                        Workspace (paths/output naming), Engine (EngineError, ProgressHandler, PageRanges),
                        DocumentStore (open tabs, recents), Components/ (ToolPage, TabChips, SourcePicker,
                        MultiFilePicker, PageRangeField, JobRunner + JobControls, ResultPanel, PageThumbnail,
                        OptionSection, AdaptiveRow, PhotoPicker, PasswordPrompt, EmptyStateView, LayoutMetrics)
VivePDF/Engine/<Module>/   engine code (no SwiftUI). `enum <Module>Engine { static func … async throws }`
VivePDF/Features/<Area>/   screens
VivePDF/Resources/L10n/<module>.l10n.json   iOS-only strings, all 8 locales
```

## Rules
1. **Strings**: never hard-code UI text. Reuse desktop keys from `apps/desktop/src/locales/en/common.json`
   through `t("tools.compress.title")`, `t("key", ["count": n])` (i18next plurals `_one/_other`, `{{var}}`).
   Only when no desktop key fits, add an iOS key under `ios.<module>.…` in your own
   `Resources/L10n/<module>.l10n.json` with **all eight** locales (tr, en, de, fr, es, it, pt-BR, ar).
   Never edit the desktop JSON files and never edit another module's l10n file.
2. **Responsive**: must look right from iPhone SE (320pt wide in Zoom) to iPad Pro 13" landscape, in
   split view / Slide Over / Stage Manager, portrait and landscape, light/dark, Arabic RTL and Dynamic Type.
   - Use `ToolPage` for tool screens; it centres content, sets gutters and stacks the `side` column on narrow widths.
   - Read `@Environment(\.layout)` (`LayoutMetrics`: width, isCompact, isWide, columns(minimum:)) for
     decisions — never `UIScreen.main.bounds` or `UIDevice.current.userInterfaceIdiom` for layout.
   - Grids: `LazyVGrid(columns: [GridItem(.adaptive(minimum: …))])`. Rows with label + control: `AdaptiveRow`
     or `ViewThatFits`. Long text: allow wrapping (`fixedSize(horizontal: false, vertical: true)`), no fixed widths.
   - Toolbars on compact width: collapse secondary actions into a `Menu` ("ellipsis.circle").
   - Use leading/trailing, never left/right; SF Symbols that mirror automatically.
   - Sheets: `.presentationDetents` where useful; popovers become sheets automatically on iPhone.
   - Touch targets ≥ 44pt. Support hardware keyboard shortcuts on iPad where the desktop has them.
3. **Files**: inputs come from `SourcePicker` / `MultiFilePicker` (Files app, open tabs, recents, photos).
   Picked URLs are security-scoped — wrap reads in `withSecurityScope(url) { … }`. Outputs go to
   `Workspace.output(for: source, suffix: "compressed", ext: "pdf")` (Documents/vivePDF, visible in Files);
   multi-file outputs to `Workspace.outputDirectory(for:suffix:)`. Scratch: `Workspace.scratch()`.
4. **Running work**: hold `@State private var runner = JobRunner()`; call
   `runner.run(label: t("nav.compress")) { progress in … return JobResult(outputs: [url], summary: …) }`
   and show `JobControls(runner:title:symbol:tone:disabled:action:)` — it renders progress, cancel, errors
   and the result panel (open in viewer / Quick Look / share / save to Files). Engines report with
   `ProgressReporter` and check `Task.checkCancellation()`. Throw `EngineError` (localised by `errors.<CODE>`).
5. **Tabs inside a tool**: `tab: String?` is the desktop `?tab=`/`?mode=` value. Use the same ids as desktop.
   Render tabs with `ToolPage(tabs:selectedTab:)` (scrolling chips).
6. **Open documents**: `AppModel` (`@Environment(AppModel.self)`) has `documents` (`DocumentStore`:
   `documents`, `active`, `open(url)`, `recents`), `navigate(_ route:)`, `open(url)`, `authorName`, `theme`.
   `OpenDocument.pdf` is the live `PDFDocument`; `snapshotURL()` gives a file including unsaved edits;
   `replaceFile(with:)` swaps in an engine result; `save()` writes back in place.
7. **Feature parity**: read the desktop sources for your module (React UI in
   `apps/desktop/src/features/...`, engine in `sidecar/vivepdf/ops/...`) and port every option and
   behaviour. Where iOS truly cannot do something the desktop does (e.g. LibreOffice, SANE, system tray),
   implement the closest native equivalent (WebKit/Quick Look rendering, VisionKit camera, Files app) and
   note it in `apps/ios/parity/<module>.md` (one file per module).
8. **Checking**: `scripts/typecheck.sh <your folders>` type-checks Core + your code in isolation (other
   modules may be mid-edit). Fix all errors and warnings in your files. Do not edit files outside your
   module folders except where your brief says so; if Core needs a change, make it minimal and additive
   (new helpers, never renamed/removed APIs) and mention it in your final report.
9. **Tests**: put unit tests for engine logic in `VivePDFTests/<Module>Tests.swift` (XCTest, `@testable import vivePDF`).
10. Comments: brief, explain *why*. Match the style of Core.
