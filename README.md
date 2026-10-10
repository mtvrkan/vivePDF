# vivePDF

Open-source, offline PDF studio for Windows, macOS and Linux. View, edit, organise, convert, secure and sign PDFs — every file stays on your machine; nothing is uploaded.

Website: https://vivepdf.com · Downloads: [Releases](https://github.com/mtvrkan/vivePDF/releases/latest)

## Features
- **Viewer** — tabs, search, outline, thumbnails, layers, presentation mode, comments and highlights; large files (a 244 MB scan) open in pieces instead of loading whole.
- **Edit** — text, images, shapes, tables, charts, formulas (LaTeX), function graphs, molecules, flowcharts, questions and answer keys, all saved as real PDF content.
- **Pages** — reorder, rotate, delete, duplicate, insert blank or lined paper, insert pages from other PDFs, split, merge, labels, duplex printing order.
- **Convert** — PDF to Word, Excel, PowerPoint, Markdown and images; Office files, images and web pages to PDF; PDF/A archiving and print preflight.
- **OCR and scans** — searchable PDFs from scans, straightening and clean-up.
- **Security** — passwords, permissions, redaction, metadata clean-up, digital signatures and certificate checks.
- **Forms and codes** — fill and build forms, QR and barcodes, optical answer sheets that grade themselves.
- **Compare, compress, batch** — side-by-side and text/visual compare, compression, batch runs, watched folders and bulk rename.
- **Accessibility** — tagged-PDF checks and alt text; the interface comes in 8 languages (tr, en, de, fr, es, it, pt-BR, ar), Arabic right-to-left.

## Install
Windows 10 or 11 (64-bit): download `vivePDF_<version>_x64-setup.exe` from [Releases](https://github.com/mtvrkan/vivePDF/releases/latest) and run it. The app checks for updates itself (Settings › Updates) and installs nothing without asking.

The installer is not code-signed yet, so Windows SmartScreen shows "Windows protected your PC" the first time: click **More info** → **Run anyway**. Office conversions use LibreOffice, which the app can download for you on request (Settings › Tools).

macOS 14 Sonoma or later (Apple silicon): download `vivePDF_<version>_aarch64.dmg` from [Releases](https://github.com/mtvrkan/vivePDF/releases/latest), open it and drag vivePDF to Applications. The app is not notarised yet, so Gatekeeper refuses the first start: open **System Settings › Privacy & Security** and click **Open Anyway** next to the vivePDF message, or run `xattr -dr com.apple.quarantine /Applications/vivePDF.app`. Office conversions use a LibreOffice installed in Applications (or downloaded by the app on request); scanning uses SANE (`brew install sane-backends`).

Linux builds are not published yet; build them from source (below).

## Development
Stack: Tauri 2 (Rust) shell · React 19 + TypeScript + Tailwind v4 UI with the EmbedPDF viewer · Python engine on PyMuPDF (+ pdf2docx, OCRmyPDF, pyHanko, Tesseract) running as a sidecar.

Prerequisites: Node 22 + pnpm, Rust (stable) + platform build tools, Python 3.12+ + uv.

```
cd apps/desktop && pnpm install
cd ../../sidecar && uv sync
cd ../apps/desktop && pnpm tauri dev
```

Tests: `pnpm test` / `pnpm typecheck` / `pnpm lint` (UI) · `uv run pytest` (engine) · `cargo test` (Rust) · `pnpm e2e` (the real app on Windows, see [docs/TESTING.md](docs/TESTING.md)). Building and publishing a release: [docs/RELEASING.md](docs/RELEASING.md).

## License
AGPL-3.0 — see `LICENSE`. Distributing builds of vivePDF requires offering the corresponding source under the same license. Third-party notices in `THIRD_PARTY_NOTICES.md`.
