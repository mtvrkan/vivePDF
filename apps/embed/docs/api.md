# Integration API

`<vive-pdf>` is configured with attributes and driven with methods and events. Attribute changes
apply while the document is open; only `src`, `load` and `open()` load a new document.

## Attributes

| Attribute | Values | Default |
| --- | --- | --- |
| `mode` | `sized` · `full` · `inline` · `lightbox` (see below) | `sized` |
| `src` | URL of the PDF, relative to the page; `http:`, `https:` and `blob:` only | — |
| `load` | `range` (fetch the parts on screen) · `full` (fetch the whole file first) | `range` |
| `page` | Page to show, from 1. Changing it turns to that page. | `1` |
| `zoom` | `fit-width` · `fit-page` · a percentage such as `150` or `150%` (10–800) | `fit-width` |
| `theme` | `light` · `dark` · `auto` (follows the system) | `light` |
| `lang` | `en` · `tr` | the page's `lang`, then `en` |
| `accent` | Any CSS colour for buttons and highlights | blue |
| `toolbar` · `search` · `print` · `download` | `false`, `off`, `no`, `0`, `none` or `hidden` hides the control | shown |
| `filename` | Name used when the file is downloaded | the name in the URL |
| `fonts` | Base URL of `@vivepdf/viewer-fonts`, for PDFs without embedded fonts | — |
| `assets` | Folder with the viewer's files, when a bundler moved the script away from them; read once when the viewer starts | the script's folder |

## Modes

| Mode | What it does |
| --- | --- |
| `sized` | A box 600 pixels high (set your own `height` in CSS) that scrolls on its own. |
| `full` | As high as the window, for a page that is mainly the document. |
| `inline` | As high as the document: pages sit in the web page and turn as the page scrolls; the toolbar stays on screen while the document is in view. Works with the window or a scrolling element around it. |
| `lightbox` | Takes no room and loads nothing until `show()` or `open()`; the document then opens over the page with a close button. Escape closes it. |

Changing `mode` keeps the open document.

## Methods

```js
const viewer = document.querySelector("vive-pdf");
await viewer.open(file);
viewer.goTo(12);
viewer.setZoom("fit-page");
viewer.search("invoice");
viewer.print();
viewer.download();
viewer.show();
viewer.close();
```

`open()` takes a URL string, a `URL`, a `Blob` or `File`, an `ArrayBuffer` or a typed array. It
resolves once the document is shown and rejects with an `Error` whose `code` says why (see below);
a later `open()` rejects the earlier one with `code: "replaced"`. A password-protected file rejects
with `password` while the viewer goes on to ask for the password; `vive-ready` follows once it is
unlocked.

`show()` and `close()` open and close the lightbox; in other modes they do nothing.

Methods called before the viewer has started wait and run once the document is on screen.
`viewer.page`, `viewer.pageCount` and `viewer.zoom` (percent) read the current state.

## Events

All events bubble out of the element, so one listener on `document` can watch several viewers.

| Event | `detail` |
| --- | --- |
| `vive-ready` | `{ pageCount }` |
| `vive-pagechange` | `{ page, pageCount }` |
| `vive-zoomchange` | `{ zoom }` in percent |
| `vive-close` | `null`, when the lightbox closes |
| `vive-error` | `{ code }`: `password` · `wrong-password` · `not-found` · `network` · `damaged` · `no-pages` · `engine` · `unsupported-url` · `unknown` |

## TypeScript

The package ships `types.d.ts`. Importing it types `document.querySelector("vive-pdf")`, the
methods and the event details.
