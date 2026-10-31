# Web viewer settings

> Every attribute of the vive-pdf element with its values and defaults, from the PDF address and opening page to the theme, language, controls and drawing tools.

URL: https://vivepdf.com/en/docs/web-viewer-settings/
Last updated: 2026-10-31

Settings are attributes on the `<vive-pdf>` element. Each has a default, so a viewer needs nothing but `src`. Most settings can be changed while the viewer is open: set the attribute again and the viewer follows.

```html
<vive-pdf src="/files/annual-report.pdf" page="4" zoom="fit-page" theme="auto" lang="en" accent="#0F766E" download="false"></vive-pdf>
```

## The document

| Attribute | Values | Default |
| --- | --- | --- |
| `src` | Address of the PDF, relative to the page; `http:`, `https:` and `blob:` only | — |
| `page` | Page to open on, from 1; changing it turns to that page | `1` |
| `zoom` | `fit-width`, `fit-page` or a percentage from 10 to 800, such as `150` or `150%` | `fit-width` |
| `load` | `range` downloads only the parts on screen; `full` downloads the whole file first | `range` |
| `filename` | Name of the file when the visitor downloads it | the name in the address |

Changing `src` opens the new document. To show a file the visitor picked, use `open()` instead: it takes a `File`, a `Blob` or bytes. See [methods and events](https://vivepdf.com/en/docs/web-viewer-api/).

## How it looks

| Attribute | Values | Default |
| --- | --- | --- |
| `mode` | `sized` (a box), `full` (window height), `inline` (as tall as the document) or `lightbox` (opens over the page) | `sized` |
| `theme` | `light`, `dark` or `auto` (follows the visitor's system) | `light` |
| `lang` | `tr` or `en` | the page's `lang`, then English |
| `accent` | Any CSS colour, for buttons and highlights | blue |

When to use each mode, and how the theme and colour work, is in [modes and appearance](https://vivepdf.com/en/docs/web-viewer-modes/).

## Controls

| Attribute | What it controls | Default |
| --- | --- | --- |
| `toolbar` | The floating toolbar at the bottom | shown |
| `search` | The search button and Ctrl/Cmd+F | shown |
| `print` | Print in the menu and Ctrl/Cmd+P | shown |
| `download` | Download in the menu and Ctrl/Cmd+S | shown |
| `branding` | The small vivePDF mark at the start of the toolbar, a link to vivepdf.com | shown |
| `annotate` | The Draw button and the [drawing tools](https://vivepdf.com/en/docs/web-viewer-drawing/) | off |

`false`, `off`, `no`, `0`, `none` and `hidden` turn a control off, in any letter case. `annotate` is the other way round: it is off until the attribute is there, so `<vive-pdf annotate>` is enough to turn it on and `annotate="false"` keeps it off.

Hiding Download hides the button; the PDF's address is still in your page, so this does not protect a file. A file that must not be copied should not be shown on the web at all.

## Files and fonts

| Attribute | Values | Default |
| --- | --- | --- |
| `assets` | Folder with the viewer's files, when a bundler moved the script away from them; read once when the viewer starts | the script's folder |
| `fonts` | Folder with fallback fonts, for PDFs that do not carry their own Japanese, Korean, Chinese, Cyrillic, Greek, Vietnamese, Hebrew or Arabic fonts | — |

Without `fonts` the viewer downloads no fonts at all. How to prepare the fonts folder is in [performance and large files](https://vivepdf.com/en/docs/web-viewer-performance/#fonts-for-pdfs-without-their-own).

## Size on the page

In `sized` mode the viewer is 600 pixels high until you give it a height in CSS. Width follows the space it is in.

```css
vive-pdf {
  height: 80vh;
  border-radius: 12px;
  overflow: hidden;
}
```

The toolbar, panels and menus live inside the element, so your site's CSS does not reach them. Only `accent`, `theme` and the element's own size and border change how the viewer looks.
