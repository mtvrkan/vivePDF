# Web viewer for your site

> Show PDFs on your own website with one tag. The vivePDF web viewer runs in the visitor's browser, needs no server and is free under the MIT licence.

URL: https://vivepdf.com/en/docs/web-viewer/
Last updated: 2026-10-31

The vivePDF web viewer shows a PDF inside your own web page: page thumbnails, the document's contents, search, links, text selection, print and download. With one more attribute visitors can also draw, highlight text and leave notes. Pages are drawn by PDFium in the visitor's browser, so nothing is uploaded anywhere and you need no server of your own. The viewer is a separate package under the MIT licence; the desktop app's code is not in it.

## Add it with a script tag

1. Load the viewer once per page:

   ```html
   <script src="https://cdn.jsdelivr.net/npm/@vivepdf/viewer@0/dist/vivepdf.js"></script>
   ```

2. Put a viewer where the PDF should appear and give it a height:

   ```html
   <vive-pdf src="/files/price-list.pdf" style="height: 80vh"></vive-pdf>
   ```

The script on your page is under 3 KB. The viewer itself and its PDF engine load only when the viewer scrolls into view, and the engine stays in the browser's cache after the first visit.

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
| Branding | A small vivePDF mark in the toolbar, which `branding="false"` hides | A "Powered by Adobe Document Cloud" link is required; the viewer shows the Adobe Acrobat logo |
| Ways to show a document | Box, full window, inline, lightbox | Full window, sized container, in line, lightbox |
| Search | Yes | Yes |
| Comments and markup | Yes, with the `annotate` attribute | Yes, in full window mode |
| Filling in forms | No, reading only | Yes, in full window mode |

The Adobe column comes from Adobe's [PDF Embed API documentation](https://developer.adobe.com/document-services/docs/overview/pdf-embed-api/gettingstarted/) and its [Developer Terms of Use](https://wwwimages2.adobe.com/content/dam/cc/en/legal/servicetou/Developer-Terms-en_US-20240618.pdf) (June 2024 edition), checked on 31 October 2026.

## Next steps

| Page | What is in it |
| --- | --- |
| [Installation](https://vivepdf.com/en/docs/web-viewer-install/) | CDN, your own server, npm, and React, Vue, Svelte and plain HTML |
| [Settings](https://vivepdf.com/en/docs/web-viewer-settings/) | Every attribute with its values and defaults |
| [Methods and events](https://vivepdf.com/en/docs/web-viewer-api/) | Driving the viewer from JavaScript, error codes, TypeScript |
| [Drawing and notes](https://vivepdf.com/en/docs/web-viewer-drawing/) | The drawing tools, and saving marks to your server |
| [Modes and appearance](https://vivepdf.com/en/docs/web-viewer-modes/) | Box, full window, inline and lightbox; theme, colour, language |
| [Security and privacy](https://vivepdf.com/en/docs/web-viewer-security/) | PDFs from other sites and Content Security Policy |
| [Performance and large files](https://vivepdf.com/en/docs/web-viewer-performance/) | What is downloaded when, measured times, fallback fonts |
| [Troubleshooting](https://vivepdf.com/en/docs/web-viewer-troubleshooting/) | What each message means and how to fix it |
