# Changelog

Format based on Keep a Changelog (https://keepachangelog.com/).

## [Unreleased]

### Added
- A small vivePDF mark at the start of the toolbar links to vivepdf.com in a new tab; `branding="false"` hides it.
- Drawing and notes with the new `annotate` setting (off by default): pen, marker, highlight, underline and strike out text, sticky notes, rectangle, ellipse and arrow, in six colours and three line widths, with undo, redo and delete. Download saves the PDF with the drawings in it. The drawing code is a separate file that is fetched only when `annotate` is on.
- Sites can read and restore the annotations as JSON (`annotations()`, `setAnnotations()`), get the PDF with them (`save()`), choose a tool (`setTool()`) and follow changes with the `vive-annotationchange` event. Restored lists are checked first and keep only known fields, so they cannot carry links, pictures or scripts.

### Fixed
- Highlights, pen drawings, boxes and notes already in a PDF are drawn; 0.1.0 showed pages without them.
- Rectangles, ellipses and arrows drawn with the drawing tools are outlines in the chosen colour instead of filled shapes.
- Deleting a note also removes its pop-up window from the PDF, and a download or print started while a drawing was still being written waits for it.

## [0.1.0]

First release of the vivePDF web viewer.

### Added
- One `<vive-pdf>` tag shows a PDF on any web page: page thumbnails, the document's contents, search, links, text selection, zoom, rotation, one or two pages side by side, print and download.
- Pages are drawn by PDFium compiled to WebAssembly in the visitor's browser; nothing is uploaded and no server is needed.
- Large files open quickly: only the parts on screen are downloaded (`load="range"`, the default).
- Four modes: `sized` (a box, the default), `full` (window height), `inline` (as tall as the document) and `lightbox` (opens over the page).
- Settings as attributes (`src`, `page`, `zoom`, `mode`, `theme`, `lang`, `accent`, `toolbar`, `search`, `print`, `download`, `filename`, `fonts`, `assets`), methods (`open`, `goTo`, `setZoom`, `search`, `print`, `download`, `show`, `close`), events (`vive-ready`, `vive-pagechange`, `vive-zoomchange`, `vive-error`, `vive-close`) and TypeScript types.
- Password-protected files ask for their password; missing, unreachable and damaged files say so with an error code.
- Light, dark and system themes; Turkish and English.
- Runs under a strict Content Security Policy without `'unsafe-inline'` or `'unsafe-eval'` (see `docs/csp.md`).
- Delivered as a script tag (CDN or your own server), an npm package and a self-host zip.

### Measured
On a MacBook, headless browsers, files served locally with brotli; median of three loads.

| | Chromium | WebKit |
| --- | --- | --- |
| First page, 3-page PDF | 143 ms | 154 ms |
| First page, 500-page book | 159 ms | 156 ms |
| First page, 80 MB scanned PDF | 315 ms | 340 ms |
| Last page after a jump, 500-page book | 40 ms | 36 ms |

Over a slow connection (Chromium, 9 Mbit/s, 60 ms latency), first visit / later visit with the engine cached: 3-page PDF 2.4 s / 0.7 s, 500-page book 3.0 s / 1.2 s, 80 MB scan 7.6 s / 5.8 s (28 MB of the file downloaded). With `load="full"` the scan first downloads all 79 MB, which takes longer than a minute on that connection.

Download sizes (brotli): loader 2.3 KB, viewer 65.7 KB, workers 64.8 KB, engine 1.6 MB.
