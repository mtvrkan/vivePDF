# Web viewer for your site

> Show PDFs on your own website with one tag. The vivePDF web viewer runs in the visitor's browser, needs no server and is free under the MIT licence.

URL: https://vivepdf.com/en/docs/web-viewer/
Last updated: 2026-10-31

The vivePDF web viewer shows a PDF inside your own web page: page thumbnails, the document's contents, search, links, text selection, print and download. Pages are drawn by PDFium in the visitor's browser, so nothing is uploaded anywhere and you need no server of your own. The viewer is a separate package under the MIT licence; the desktop app's code is not in it.

## Add it with a script tag

1. Load the viewer once per page:

   ```html
   <script src="https://cdn.jsdelivr.net/npm/@vivepdf/viewer@0/dist/vivepdf.js"></script>
   ```

2. Put a viewer where the PDF should appear and give it a height:

   ```html
   <vive-pdf src="/files/price-list.pdf" style="height: 80vh"></vive-pdf>
   ```

The script on your page is about 2 KB. The viewer itself and its PDF engine load only when the viewer scrolls into view, and the engine stays in the browser's cache after the first visit.

## Try it

Pick the settings below: the code for your page changes with them, and the preview shows the result with a sample PDF.

## Compared with Adobe PDF Embed API

| | vivePDF web viewer | Adobe PDF Embed API |
| --- | --- | --- |
| Account and key | None | An Adobe account and a client ID registered for your domain; on any other domain the preview is blocked |
| Price | Free | Free; Adobe's terms allow it to set usage limits |
| Licence | MIT, open source | Adobe's proprietary terms; the code may not be modified |
| Where the code is loaded from | Your own server, a CDN or npm | Adobe's server, as documented |
| Data sent to the maker | None; the visitor's browser talks only to your site and the CDN you chose | Usage information, including the address of the web page, the file size and the page count |
| Branding | None | A "Powered by Adobe Document Cloud" link is required; the viewer shows the Adobe Acrobat logo |
| Ways to show a document | Box, full window, inline, lightbox | Full window, sized container, in line, lightbox |
| Search | Yes | Yes |
| Comments and markup | No, reading only | Yes, in full window mode |
| Filling in forms | No, reading only | Yes, in full window mode |

The Adobe column comes from Adobe's [PDF Embed API documentation](https://developer.adobe.com/document-services/docs/overview/pdf-embed-api/gettingstarted/) and its [Developer Terms of Use](https://wwwimages2.adobe.com/content/dam/cc/en/legal/servicetou/Developer-Terms-en_US-20240618.pdf) (June 2024 edition), checked on 31 October 2026.

## Host the files yourself

Download `vivepdf-viewer-<version>.zip` from the [releases on GitHub](https://github.com/mtvrkan/vivePDF/releases), copy its `dist` folder to your site and load `dist/vivepdf.js` from there. Keep the files of the folder together: the viewer looks for the rest next to the script.

## Use it from npm

```sh
npm install @vivepdf/viewer
```

```js
import "@vivepdf/viewer";
```

A bundler does not copy the viewer's own files. Copy `node_modules/@vivepdf/viewer/dist` to a public folder and tell the viewer where it is:

```html
<vive-pdf src="/files/price-list.pdf" assets="/vivepdf/"></vive-pdf>
```

## Settings

| Setting | What it does |
| --- | --- |
| `src` | Address of the PDF |
| `page` | Page to open on, from 1 |
| `zoom` | `fit-width`, `fit-page` or a percentage such as `150` |
| `mode` | `sized` (a box, the default), `full` (window height), `inline` (as tall as the document, scrolls with the page) or `lightbox` (opens over the page) |
| `theme` | `light`, `dark` or `auto` |
| `lang` | `tr` or `en`; without it the page's language is used |
| `accent` | Colour of buttons and highlights |
| `toolbar`, `search`, `print`, `download` | `false` hides that control |
| `filename` | Name used when the file is downloaded |

The viewer can also be driven from JavaScript: `open()` takes a file the visitor picked, `goTo()`, `setZoom()` and `search()` move around the document, and events report when it is ready, when the page changes and when a file cannot be opened. All of it is described in the [API reference](https://github.com/mtvrkan/vivePDF/blob/main/apps/embed/docs/api.md).

## PDFs on another site

The PDF is fetched by the visitor's browser, so a file on another domain must allow your page to read it. That site has to send these headers with the PDF:

```text
Access-Control-Allow-Origin: https://your-site.example
Access-Control-Expose-Headers: Content-Range
```

The second header lets the viewer download only the parts of a large file that are on screen. Without the first one, the viewer says the file could not be downloaded.

## Content Security Policy

If your site sends a Content Security Policy, the viewer needs a few entries in it: `'wasm-unsafe-eval'` in `script-src` for its engine, `blob:` in `img-src` for the rendered pages and the PDF's site in `connect-src`; from a CDN also the CDN in `script-src`, `worker-src` and `connect-src`. It needs no `'unsafe-inline'` and no `'unsafe-eval'`. Tested policies for both setups, files on your own site and files from a CDN, are in the [CSP guide](https://github.com/mtvrkan/vivePDF/blob/main/apps/embed/docs/csp.md).
