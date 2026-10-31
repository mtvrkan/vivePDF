# Web viewer performance and large files

> What the vivePDF web viewer downloads and when, how it opens large PDFs by fetching only the parts on screen, measured opening times, and how to add fallback fonts.

URL: https://vivepdf.com/en/docs/web-viewer-performance/
Last updated: 2026-10-31

The viewer is built so that a page with a PDF on it stays as fast as a page without one. This page shows what is downloaded, when, and how long a document takes to appear.

## What is downloaded and when

| Part | Size (compressed) | When |
| --- | --- | --- |
| Loader, `vivepdf.js` | under 3 KB | With your page |
| Viewer | about 70 KB | When the viewer comes within 200 pixels of the screen, or `open()`/`show()` is called |
| PDF engine (PDFium) | about 1.6 MB, 4.5 MB unpacked | At the same time, once per version; then from the browser's cache |
| Drawing tools | about 46 KB | Only with `annotate`, when the viewer starts |
| Fallback fonts | 25 KB to 8 MB per font | Only with `fonts`, when a page needs one |

A viewer far down the page costs nothing until the visitor scrolls near it. In `lightbox` mode nothing beyond the loader is downloaded until the lightbox opens.

## Large files

With the default `load="range"` the viewer asks the server only for the parts of the file it needs for the pages on screen, and for the next ones as the visitor scrolls. A 500-page book or an 80 MB scan opens about as fast as a short letter.

This needs a server that answers range requests. Most do: static hosting, CDNs, object storage and common web servers send `Accept-Ranges: bytes` without any setting. If the server sends the whole file instead, the viewer uses it and still works. For a file on another site, that site must also expose `Content-Range`; see [PDFs on another site](https://vivepdf.com/en/docs/web-viewer-security/#pdfs-on-another-site).

`load="full"` downloads the whole file before showing it. Use it for small files that the visitor will read to the end anyway, or for a server that sends wrong range answers.

## Measured times

Time from the start of the page until the first page of the document is on screen, measured with a local server on a MacBook (31 October 2026):

| Document | Chromium | WebKit (Safari) |
| --- | --- | --- |
| 2 pages, 0.4 MB | 0.14 s | 0.15 s |
| 500 pages, 1 MB | 0.16 s | 0.16 s |
| 20 scanned pages, 80 MB | 0.32 s | 0.34 s |

With `load="range"` the 80 MB scan needed 28 MB in Chromium to show its first page and jump to its last one.

On a slower connection (9 Mbit/s, 60 ms latency) the first visit takes 2.4 s for the short file and 3.0 s for the book, most of it the engine. On the next visit the engine comes from the cache and the same files open in 0.7 s and 1.2 s. On that connection the 80 MB scan opens in 7.6 s with `load="range"`; with `load="full"` it does not open within the test's time limit, which is why `range` is the default.

## Cache

The engine is kept in your site's Cache Storage, under a name that starts with `vivepdf-engine-`, and reused on every page of your site. A new version of the viewer stores its own engine and removes the old one. Visitors whose browser blocks storage simply download it again.

The viewer's own files come from your server or the CDN with normal HTTP caching. On jsDelivr, pin a version (`@0.2.0`) for the longest cache life; `@0` is cached for a shorter time so updates reach you.

## Fonts for PDFs without their own

Most PDFs carry the fonts they use. Some leave them out and expect the reader to have them. For Latin text the engine has its own fonts. For Japanese, Korean, Chinese, Cyrillic, Greek, Vietnamese, Hebrew and Arabic text in such files, the viewer needs the Noto fonts from your server, or that text shows as boxes or is missing.

The fonts are not on npm. Build the folder from the vivePDF repository:

1. Get the repository and go to the fonts package:

   ```sh
   git clone https://github.com/mtvrkan/vivePDF.git
   cd vivePDF/apps/embed-fonts
   ```

2. Install it and collect the fonts:

   ```sh
   pnpm install
   pnpm collect
   ```

   This writes 14 font files (46 MB in all) to `fonts/` and their licences to `OFL.txt`.

3. Copy the files in `fonts/` and `OFL.txt` to one folder on your site and point the viewer at it:

   ```html
   <vive-pdf src="/files/catalogue.pdf" fonts="/vivepdf-fonts/"></vive-pdf>
   ```

The visitor downloads only the fonts the open document needs. The largest are the simplified Chinese fonts at about 8.5 MB each; Hebrew and Arabic are under 150 KB.

| Text | Files |
| --- | --- |
| Cyrillic, Greek, Vietnamese | `NotoSans-*.ttf` (0.6 MB each) |
| Japanese | `NotoSansJP-*.otf` (4.5 MB) |
| Korean | `NotoSansKR-*.otf` (4.6 MB) |
| Chinese, simplified | `NotoSansHans-*.otf` (8.4 MB) |
| Chinese, traditional | `NotoSansHant-*.otf` (5.7 MB) |
| Hebrew | `NotoSansHebrew-*.ttf` (26 KB) |
| Arabic | `NotoNaskhArabic-*.ttf` (134 KB) |

You can leave out the files for languages your documents never use.

## Tips

- Give the viewer a height in CSS from the start, so the page does not jump when it loads.
- A scanned PDF is mostly pictures. Making it smaller with [Compress](https://vivepdf.com/en/docs/compress-a-pdf/) in the vivePDF app helps every visitor more than any setting here.
