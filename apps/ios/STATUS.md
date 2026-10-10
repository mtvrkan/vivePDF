# iOS port — status (paused 2026-10-10)

The work was paused to save quota. The agents were stopped partway through their tasks, so the code
on disk is **partial and does not currently build as a whole**. The core alone built and launched in the
simulator before the modules were added. Conventions are in `PORTING.md`.

## Done
- XcodeGen project (`project.yml`): iOS 17+, iPhone + iPad, multi-window, PDF/Office/image document
  types, files visible in the Files app. Locales are copied straight from `apps/desktop/src/locales` by a
  build script (all 8 languages, Arabic RTL). App icon.
- Core (`VivePDF/Core`, `VivePDF/App`) — complete:
  - Adaptive shell: a sidebar split view at regular width and a tab bar at compact width (`RootView`).
  - `L10n`: i18next-compatible lookups, including plurals and `{{var}}` interpolation.
  - `Theme`, navigation and a full tool catalogue.
  - `DocumentStore`: tabs, recents, open-in-place, file presenter.
  - `Workspace`: paths and output naming.
  - `JobRunner` / `JobControls`, `OperationHistory`.
  - Shared components: `ToolPage`, `TabChips`, `SourcePicker`, `MultiFilePicker`, `ResultPanel`,
    `PageRangeField`, `PageThumbnail`, `PhotoPicker`, `PasswordPrompt`, `LayoutMetrics`.
  - `scripts/typecheck.sh` checks one module on its own.

## In progress when stopped (code on disk, unfinished, may not compile)
| Module | Folder(s) | State |
|---|---|---|
| PDFCore (raw PDF parse/write) | Engine/PDFCore (~3.8k lines) | Parse and write verified on 172 real PDFs × 5 write variants. Content-stream layer was next. No README yet. Known issue: `String(validating:as:)` at CosObject.swift:~346 needs iOS 18; replace it with `String(bytes:encoding:)`. |
| Crypto (ASN.1/X.509/PKCS#12/CMS) | Engine/Crypto (~4k lines), VivePDFTests/CryptoTests.swift | Was writing the XCTests. No README yet. |
| Viewer | Features/Viewer (~11k), Engine/Viewer (~3.7k) | Large part written. Panels, print and OCR helpers were in progress. |
| Studio | Engine/Studio (~15k), Features/Studio (~1.4k), Resources/Studio | Model, JSON and SVG written. Renderer, CV builder, document editor, templates, icons and ornaments were half done. Error: StudioDocStarters.swift — "escaping closure captures non-escaping parameter". |
| Pages + Merge + Split + PageTools | Engine/Pages, Features/Pages | Organizer screen was in progress. **`PaperPattern` name clash with Engine/Create**: rename it in Pages (e.g. `OrganizerPaperPattern`). `OrganizerTile.Kind` needs to be Hashable. Merge and Split are still placeholders. |
| Home / Catalog / Search / Settings / About / Rename / Report | Features/Home, Search, Settings, About, Report, Tools/Rename, Engine/Home, Search, Rename | Mostly written. Rename UI was being finished. Settings-key notes not written yet. |
| Convert + Create | Engine/Convert, Create, Shared (ZipArchive etc.) | Create engine verified. Convert was at text extraction. Both UIs are still placeholders. Error: PDFContentScanner.swift:138 — use `unsafeBitCast(stream, to: Int.self)`. |

## Not started (wave 2/3)
- Security tool (encrypt/decrypt/certificate seal-unseal/watermark/remove watermark/stamp/privacy) + Sign (PAdES sign, verify, certificate create/export) — needs PDFCore + Crypto.
- Edit tool (number, header/footer, letterhead, cover, find&replace, crop, resize, flatten, impose, poster, bookmarks, autolink, textedit, redact, repair) + Codes (QR add/read).
- OCR (Vision) + Scan (VisionKit camera, enhance, split, photo) + OMR + Compress.
- Forms (fill/merge/export/detect) + Compare + Access + Preflight + PDF/A.
- Batch + Watched folders (after all engines exist).
- Integration: get the whole app to build, run unit tests, screenshot iPhone SE / iPhone 17 Pro Max / iPad mini (A17 Pro) / iPad Pro 13" in portrait, landscape and split view, then install on the physical iPad mini (team JGXAH2UJWN, use `-allowProvisioningUpdates`).

## How to resume
1. Fix the known compile errors above, then run `scripts/typecheck.sh` per module.
2. Re-launch module agents with the same briefs (scope = the module folders above, rules in `PORTING.md`).
   Tell each one to continue from the existing files instead of starting over.
3. Start the wave 2 agents once PDFCore and Crypto have READMEs.
4. To build from a clean copy while agents are editing: rsync `apps/ios` into a scratch folder, symlink
   `apps/desktop` next to it, run `xcodegen generate`, then `xcodebuild`.
