# Changelog

Format based on Keep a Changelog (https://keepachangelog.com/).

## [Unreleased]

### Added
- An eraser (E) that cuts pen lines where you drag it, Delete all with a question first (undo brings everything back), a Delete button above a selected drawing, and `setTool("eraser")`.
- `hasChanges`: true once the reader or `setAnnotations()` changed the drawings since the document opened, so a site can warn before leaving; `save()` does not reset it.

### Changed
- Rectangles, ellipses and arrows put the tool down after one shape and stay selected; a click beside a selected drawing lets go of it; picking highlight, underline or strike out marks text that is already selected; while a drawing tool is on, dragging on a touch screen draws instead of scrolling.

### Fixed
- The note box takes clicks; until now it could only be typed into right after placing the note.
- `annotations()`, `setAnnotations()`, `save()` and `setTool()` answer while the viewer is hidden, and `annotations()` right after `open()` lists the new document's drawings.
- `annotations()` called from a `vive-annotationchange` handler already includes that change.
- Text typed into a note is kept when `save()` runs while the note box still has focus, or when the reader taps the page beside it.
- A `viewer.js` that cannot load sends `vive-error` with `engine` and rejects `open()` instead of leaving the element opening forever.
- Drawing tools that cannot load make the drawing calls fail with `failed` ("could not load") instead of `annotate-off`, and are tried again with the next document.
- Drawings made by other PDF programs (zero or very wide lines, notes longer than 2000 characters, highlights without boxes, empty pen drawings) come out of `annotations()` in a form `setAnnotations()` accepts.
- The More menu opens above the drawing bar instead of under it.
- On phones the drawing bar has two rows: tools on top, colours and the always visible undo, redo, delete, delete all and close below.
- Closing the drawing bar puts focus back on the Draw button; the arrow keys move through the tools, colours and widths (one Tab stop each); the hint is read out by screen readers.
- With `toolbar="false"`, tools chosen through `setTool()` get the note box styles, the keys, click-to-deselect and touch drawing.
- The pen and the marker keep everything drawn on a page as one drawing until the tool, colour or width changes, instead of making every stroke a separate, selected drawing. Undo takes back the last stroke, and picking a colour after a stroke no longer recolours it.

## [0.2.0]

### Added
- A small vivePDF mark at the start of the toolbar links to vivepdf.com in a new tab; `branding="false"` hides it.
- Drawing and notes with the new `annotate` setting (off by default): pen, marker, highlight, underline and strike out text, sticky notes, rectangle, ellipse and arrow, in six colours and three line widths, with undo, redo and delete (also Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Delete and Escape). Download saves the PDF with the drawings in it. The drawing code is a separate file that is fetched only when `annotate` is on.
- Sites can read and restore the annotations as JSON (`annotations()`, `setAnnotations()`), get the PDF with them (`save()`), choose a tool (`setTool()`) and follow changes with the `vive-annotationchange` event. Restored lists are checked first and keep only known fields, so they cannot carry links, pictures or scripts.

### Fixed
- Highlights, pen drawings, boxes and notes already in a PDF are drawn; 0.1.0 showed pages without them.
- Rectangles, ellipses and arrows drawn with the drawing tools are outlines in the chosen colour instead of filled shapes.
- Deleting a note also removes its pop-up window from the PDF, and a download or print started while a drawing was still being written waits for it.
- The toolbar fits in narrow viewers again now that it can hold the vivePDF mark and the Draw button: below about 430 pixels the zoom buttons move into the More menu, and the page arrows, fit and rotate move there a little earlier.

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
