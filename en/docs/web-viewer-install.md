# Install the web viewer

> Add the vivePDF web viewer to a site from a CDN, from your own server or from npm, and use it in plain HTML, React, Vue, Svelte and other frameworks.

URL: https://vivepdf.com/en/docs/web-viewer-install/
Last updated: 2026-10-31

The viewer is one custom element, `<vive-pdf>`. It works in any page that runs JavaScript, with or without a framework. Choose where its files come from: a CDN, your own server or npm.

## From a CDN

The quickest way. Load the script once per page, then place viewers wherever you need them:

```html
<script src="https://cdn.jsdelivr.net/npm/@vivepdf/viewer@0/dist/vivepdf.js"></script>
<vive-pdf src="/files/price-list.pdf" style="height: 80vh"></vive-pdf>
```

`@0` takes the newest 0.x version, so fixes arrive without a change on your side. To freeze one version, write it in full, for example `@vivepdf/viewer@0.2.0`. The script also comes as a module, `dist/vivepdf.mjs`, for `<script type="module">`.

## From your own server

1. Download `vivepdf-viewer-<version>.zip` from the [releases on GitHub](https://github.com/mtvrkan/vivePDF/releases).

2. Copy its `dist` folder to your site, for example to `/vivepdf/`.

3. Load the script from there:

   ```html
   <script src="/vivepdf/vivepdf.js"></script>
   ```

Keep the files of the folder together: the script finds the viewer, the engine and the workers next to itself. Keep `THIRD-PARTY-NOTICES.txt` with them, it holds the licences of the libraries inside the engine.

## From npm

```sh
npm install @vivepdf/viewer
```

```js
import "@vivepdf/viewer";
```

The import registers `<vive-pdf>` and brings the TypeScript types. A bundler packs only the 2 KB loader; the viewer, the engine and the workers stay outside. Copy `node_modules/@vivepdf/viewer/dist` to a public folder once (or in your build script) and tell the viewer where it is with `assets`:

```html
<vive-pdf src="/files/price-list.pdf" assets="/vivepdf/"></vive-pdf>
```

## Plain HTML

Nothing else is needed. Settings are attributes; JavaScript is only for the [methods and events](https://vivepdf.com/en/docs/web-viewer-api/).

```html
<vive-pdf src="/files/report.pdf" page="3" zoom="fit-page" theme="auto" style="height: 600px"></vive-pdf>
```

## React

React 19 passes attributes and properties to custom elements as they are. Load the viewer once, for example in your entry file, and use the tag:

```jsx
import "@vivepdf/viewer";

export function Report({ url }) {
  return <vive-pdf src={url} theme="auto" style={{ height: "80vh", display: "block" }} />;
}
```

To call methods, keep a ref: `ref.current.goTo(5)`. Listen to events with `addEventListener` in an effect and remove the listener in its cleanup. In TypeScript, declare the tag once for JSX:

```ts
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "vive-pdf": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; page?: string | number; zoom?: string; theme?: string; mode?: string; annotate?: boolean | string };
    }
  }
}
```

## Vue

Tell Vue that `vive-pdf` is a custom element, in `vite.config.js`:

```js
vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === "vive-pdf" } } });
```

Then use it in templates:

```vue
<script setup>
import "@vivepdf/viewer";
</script>

<template>
  <vive-pdf :src="url" theme="auto" style="height: 80vh" @vive-pagechange="onPage" />
</template>
```

## Svelte

Svelte needs no setting:

```svelte
<script>
  import "@vivepdf/viewer";
  let { url } = $props();
</script>

<vive-pdf src={url} theme="auto" style="height: 80vh"></vive-pdf>
```

For methods and events, take the element with `bind:this` and call `addEventListener` on it.

## Pages rendered on the server

The element only starts in the browser. With Next.js, Nuxt, SvelteKit or Astro, import the package in code that runs on the client (a client component, `onMount`, a `<script>` tag) and render `<vive-pdf>` as plain HTML on the server. The viewer begins to load when it scrolls into view.

## Updating

From the CDN with `@0` there is nothing to do. With npm, run `npm update @vivepdf/viewer` and copy `dist` again. With the zip, replace the whole folder: files of different versions do not mix. The [release notes](https://github.com/mtvrkan/vivePDF/releases) list what changed.
