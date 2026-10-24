# Compress a PDF

> How to make a PDF smaller with vivePDF, see what takes up the space, choose a compression profile and get a file small enough to e-mail.

URL: https://vivepdf.com/en/docs/compress-a-pdf/
Last updated: 2026-10-24

To make a PDF smaller, open **Tools › Compress**, choose your file, pick a profile and click **Compress**. Pictures are resampled and unused font parts and leftover structure are cleaned out; the original file stays as it was.

1. Open **Tools › Compress** and choose the PDF, or drag it onto the window.
2. Look at **What the file is made of**: pictures, fonts and page content are shown separately, with the largest pictures listed.
3. Pick a **Profile**. For e-mail, **Strong** is usually enough.
4. Click **Compress**.

![The Compress tool: a bar showing that pictures fill most of a 25 MB brochure, and a list of the largest pictures](https://vivepdf.com/shots/en/compress-1-1600.webp)

The profiles differ like this:

- **Light**: leaves pictures alone and only cleans the structure and fonts.
- **Balanced**: 150 dpi and 75% JPEG; invisible on screen.
- **Strong**: 100 dpi and 60% JPEG; ideal for e-mail.
- **Extreme**: 72 dpi and 40% JPEG; the smallest file, at low quality.
- **Custom**: you set the resolution and quality yourself.

The result panel shows the percentage saved, the old and new size and a before-and-after preview. In the example below, a 25 MB brochure came down to 266 KB.

![Compression result: −99%, from 25.0 MB to 265.8 KB, with a before and after preview](https://vivepdf.com/shots/en/compress-2-1600.webp)

> **Need to get under a set size?**
>
> Turn on **Compress to a target size** and enter the limit (for example 10 MB). vivePDF tries the profiles from light to strong and saves the first result that fits.

A text-heavy PDF that is already small gains little; the big savings come from large photos and scans. For scanned documents, also see [Make scanned pages searchable (OCR)](https://vivepdf.com/en/docs/ocr/).
