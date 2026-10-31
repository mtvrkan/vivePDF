# Web viewer troubleshooting

> Answers for the usual problems with the vivePDF web viewer, from a file that will not download and a blocked engine to missing letters, drawings and framework setup.

URL: https://vivepdf.com/en/docs/web-viewer-troubleshooting/
Last updated: 2026-10-31

The viewer shows its own message when it cannot open a document, and `vive-error` gives your page the same reason as a code. Start with the message: the sections below follow it.

## "The file could not be downloaded"

The code is `network`. The usual reasons:

- **The PDF is on another site** that does not allow your page to read it. That site has to send `Access-Control-Allow-Origin` with the file; see [PDFs on another site](https://vivepdf.com/en/docs/web-viewer-security/#pdfs-on-another-site). The browser's console names the missing header.
- **Your Content Security Policy** does not list the PDF's site in `connect-src`. The console shows a CSP violation; add the site as shown in [Content Security Policy](https://vivepdf.com/en/docs/web-viewer-security/#content-security-policy).
- **The address needs a login** the browser does not send to that site, or it redirects to a login page.

## "File not found"

The code is `not-found`: the server answered 404 for the address in `src`. A relative address is read against your page, not against the script, so `src="report.pdf"` on `/blog/post/` looks for `/blog/post/report.pdf`. Start the address with `/` to be sure.

## "The viewer could not start"

The code is `engine`: the PDF engine was not downloaded or not allowed to run.

- With a Content Security Policy, check `'wasm-unsafe-eval'` in `script-src` and the viewer's origin in `worker-src` and `connect-src`.
- With npm and a bundler, the viewer's files must be copied to a public folder and `assets` must point at it; see [installation](https://vivepdf.com/en/docs/web-viewer-install/). The network tab shows which file came back as 404.
- With the self-hosted zip, keep every file of `dist` in the same folder as `vivepdf.js`.

## "The file is damaged"

The code is `damaged`: the file is not a PDF, or it is broken. Check that the address really returns the PDF and not an HTML error or login page. If the file opens elsewhere but not here, please [report it](https://github.com/mtvrkan/vivePDF/issues) with the file if you can share it.

## The viewer is empty or has no height

In `sized` mode the viewer is 600 pixels high unless your CSS sets another height. A height in percent only works when the parent has a height. If it sits in a flex or grid layout that squeezes it, give it a `min-height`. `lightbox` takes no room by design: call `show()`.

## Some letters are boxes or missing

The PDF does not carry its own fonts for that text. For Japanese, Korean, Chinese, Cyrillic, Greek, Vietnamese, Hebrew and Arabic, set up the fallback fonts as in [fonts for PDFs without their own](https://vivepdf.com/en/docs/web-viewer-performance/#fonts-for-pdfs-without-their-own).

## Large files are slow

Check in the network tab that the PDF requests answer `206 Partial Content`. If they answer `200`, the server is sending the whole file each time; turn on range requests, or for another site expose `Content-Range`. More in [performance](https://vivepdf.com/en/docs/web-viewer-performance/#large-files).

## The Draw button is missing

The drawing tools are off until the element has the `annotate` attribute. If it is there and the button is still missing, check the network tab: the drawing tools come as a separate file next to the viewer's other files, and it must not be blocked.

## Highlight does nothing on a page

Highlight, underline and strike out need text in the PDF. A scanned page is a picture; use the pen or the marker, or make the text selectable first with [OCR](https://vivepdf.com/en/docs/ocr/) in the vivePDF app.

## Drawings are gone after a reload

The viewer keeps nothing. Visitors keep their marks by downloading the PDF; your site can store them with `annotations()` and put them back with `setAnnotations()`, as shown in [saving to your server](https://vivepdf.com/en/docs/web-viewer-drawing/#saving-to-your-server).

## Methods reject with `not-ready`

`annotations()`, `setAnnotations()` and `save()` need an open document. Call them after `vive-ready`. The other methods wait on their own.

## Frameworks

- **React 19** passes attributes to custom elements as they are; listen to `vive-` events with a ref and `addEventListener`.
- **Vue** may warn that `vive-pdf` is an unknown component until it is listed in `isCustomElement`.
- **Server-side rendering**: import the viewer only in the browser. The element can be in the server's HTML; it starts once the script runs.

Examples for each are on the [installation](https://vivepdf.com/en/docs/web-viewer-install/) page.

## Still stuck?

Open an [issue on GitHub](https://github.com/mtvrkan/vivePDF/issues) with the browser and its version, the viewer's version, the error code and, if you can, the PDF or a page that shows the problem.
