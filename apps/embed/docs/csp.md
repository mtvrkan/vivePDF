# Content Security Policy

The viewer runs on pages with a strict Content Security Policy. It needs no `'unsafe-inline'`, no
`'unsafe-eval'` and no `blob:` in `connect-src`, and under the policies below it causes no
violation reports.

## Viewer files hosted on your own site

```text
default-src 'none';
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self';
connect-src 'self';
img-src 'self' blob:
```

This is a complete policy for a page that only shows the viewer. Add the directives your own
page needs.

## Viewer files from a CDN

Replace `https://cdn.example.com` with the address the viewer files come from.

```text
default-src 'none';
script-src 'self' https://cdn.example.com 'wasm-unsafe-eval';
worker-src blob: https://cdn.example.com;
connect-src 'self' https://cdn.example.com;
img-src 'self' blob:
```

## What each directive is for

| Directive | Why the viewer needs it |
|---|---|
| `script-src` + viewer origin | the loader script and the viewer code it loads |
| `'wasm-unsafe-eval'` | the PDF engine is WebAssembly and cannot start without it |
| `worker-src` | the engine runs in a worker; from a CDN the worker starts from a small `blob:` script that loads the real one from the CDN, so both `blob:` and the CDN are needed |
| `connect-src` | the PDF itself, the engine file (`pdfium.wasm`) and, if you use the `fonts` attribute, the fonts folder |
| `img-src blob:` | rendered pages are shown as images made in the browser |

`style-src` is not needed: the viewer's styles are applied through constructed style sheets.

## The PDF and fonts on another site

`connect-src` must also list the site the PDF comes from, and the site of the `fonts` folder if
it is not one of the origins above. For example, with PDFs on `https://files.example.com`:

```text
connect-src 'self' https://files.example.com
```

## A policy sent on every file

Some servers send the same `Content-Security-Policy` header on every response, the viewer's own
script files included. The browser then applies that policy inside the engine worker as well. The
policies above already cover this case; removing `'wasm-unsafe-eval'` or `connect-src` from them
stops the viewer from starting.

## Engine cache

The engine (about 4.5 MB) is kept in the browser's Cache Storage of your site under a name that
starts with `vivepdf-engine-`, so it is downloaded once per version. This needs nothing extra in the
policy. Older versions are removed when a new one is stored.
