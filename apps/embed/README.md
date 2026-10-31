# @vivepdf/viewer

A small, fast PDF viewer for any website. One `<vive-pdf>` tag shows a PDF with page thumbnails,
the document's contents, search, links, text selection, print and download, and on request drawing
and notes. Pages are drawn by
PDFium compiled to WebAssembly, in the visitor's browser: no server, no account, nothing uploaded.

- About 3 KB of script on your page; the viewer (69 KB) and the engine (1.6 MB compressed, kept
  in the browser's cache) load only when the viewer scrolls into view.
- Large files open quickly: only the parts on screen are downloaded.
- Light and dark themes, Turkish and English; runs under a strict Content Security Policy with
  no `'unsafe-inline'` or `'unsafe-eval'`.
- Drawing and notes with the `annotate` setting: pen, marker, text highlight, sticky notes and
  shapes, saved into the downloaded PDF or read and restored as JSON by your site.
- Tested in Chromium and WebKit (Safari on the Mac, iPhone and iPad).
- MIT licence.

## Add it to a page

From a CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@vivepdf/viewer@0/dist/vivepdf.js"></script>
<vive-pdf src="/files/price-list.pdf" style="height: 80vh"></vive-pdf>
```

From your own server: download `vivepdf-viewer-<version>.zip` from the
[releases](https://github.com/mtvrkan/vivePDF/releases), copy its `dist` folder to your site and
load `dist/vivepdf.js` the same way. Keep the files of the folder together; the viewer finds the
rest next to the script.

With a bundler:

```sh
npm install @vivepdf/viewer
```

```js
import "@vivepdf/viewer";
```

Bundlers do not copy the viewer's own files, so copy `node_modules/@vivepdf/viewer/dist` to a
public folder and point the element at it:

```html
<vive-pdf src="/files/price-list.pdf" assets="/vivepdf/"></vive-pdf>
```

The PDF is fetched by the visitor's browser, so a file on another site must allow your page with
CORS (`Access-Control-Allow-Origin`) and expose `Content-Range`
(`Access-Control-Expose-Headers: Content-Range`) so the viewer can fetch only the parts it needs.

## Settings, methods and events

```html
<vive-pdf src="report.pdf" page="3" zoom="fit-page" theme="auto" mode="inline"></vive-pdf>
```

```js
const viewer = document.querySelector("vive-pdf");
viewer.addEventListener("vive-pagechange", (event) => console.log(event.detail.page));
await viewer.open(fileInput.files[0]);
```

Every setting, the four modes (`sized`, `full`, `inline`, `lightbox`), the methods and the events
are described in [docs/api.md](docs/api.md) and, with examples, in the
[web viewer documentation](https://vivepdf.com/en/docs/web-viewer/). Sites with a Content Security
Policy: see [docs/csp.md](docs/csp.md). TypeScript types come with the package.

## Fonts for PDFs without their own

Some PDFs leave out their fonts. For Japanese, Korean, Chinese, Cyrillic, Greek, Vietnamese, Hebrew
and Arabic text in such files, build the font folder from `apps/embed-fonts` in this repository
(`pnpm install && pnpm collect`), host it and set `fonts="/path/to/fonts/"`; the steps are in the
[performance guide](https://vivepdf.com/en/docs/web-viewer-performance/#fonts-for-pdfs-without-their-own).
Without it the viewer downloads no fonts.

## Licence

MIT. Part of [vivePDF](https://vivepdf.com); the desktop app lives in the same repository under
AGPL-3.0, this package does not include its code.

The viewer contains EmbedPDF and Preact (MIT), and its engine `pdfium.wasm` contains PDFium and the
libraries it is built with (FreeType, Little CMS, OpenJPEG, libjpeg-turbo, libpng, zlib, ICU and
others). Their licences are in `THIRD-PARTY-NOTICES.txt`, which is also copied next to the viewer
files in `dist`; keep it with them when you host the files yourself.
