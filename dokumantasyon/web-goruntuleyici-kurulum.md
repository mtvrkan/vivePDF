# Web görüntüleyiciyi kurma

> vivePDF web görüntüleyiciyi sitene bir CDN'den, kendi sunucundan ya da npm'den ekle; düz HTML, React, Vue, Svelte ve diğer çatılarla kullan.

URL: https://vivepdf.com/dokumantasyon/web-goruntuleyici-kurulum/
Son güncelleme: 2026-10-31

Görüntüleyici tek bir özel öğedir: `<vive-pdf>`. JavaScript çalıştıran her sayfada, bir çatı olsun ya da olmasın çalışır. Dosyalarının nereden geleceğini seç: bir CDN, kendi sunucun ya da npm.

## CDN'den

En hızlı yol. Betiği sayfada bir kez yükle, sonra görüntüleyicileri istediğin yere koy:

```html
<script src="https://cdn.jsdelivr.net/npm/@vivepdf/viewer@0/dist/vivepdf.js"></script>
<vive-pdf src="/dosyalar/fiyat-listesi.pdf" style="height: 80vh"></vive-pdf>
```

`@0` en yeni 0.x sürümünü alır; düzeltmeler sen bir şey değiştirmeden gelir. Tek bir sürümde sabitlemek için sürümü tam yaz, örneğin `@vivepdf/viewer@0.2.0`. Betik `<script type="module">` için modül olarak da gelir: `dist/vivepdf.mjs`.

## Kendi sunucundan

1. [GitHub'daki sürümlerden](https://github.com/mtvrkan/vivePDF/releases) `vivepdf-viewer-<sürüm>.zip` dosyasını indir.

2. İçindeki `dist` klasörünü sitene kopyala, örneğin `/vivepdf/` altına.

3. Betiği oradan yükle:

   ```html
   <script src="/vivepdf/vivepdf.js"></script>
   ```

Klasördeki dosyaları bir arada tut: betik görüntüleyiciyi, motoru ve işçileri kendi yanında bulur. `THIRD-PARTY-NOTICES.txt` dosyasını da yanlarında tut; motorun içindeki kütüphanelerin lisansları ondadır.

## npm'den

```sh
npm install @vivepdf/viewer
```

```js
import "@vivepdf/viewer";
```

Bu içe aktarma `<vive-pdf>` öğesini kaydeder ve TypeScript türlerini getirir. Paketleyici yalnızca 2 KB'lık yükleyiciyi paketler; görüntüleyici, motor ve işçiler dışarıda kalır. `node_modules/@vivepdf/viewer/dist` klasörünü bir kez (ya da derleme betiğinde) herkese açık bir klasöre kopyala ve görüntüleyiciye yerini `assets` ile söyle:

```html
<vive-pdf src="/dosyalar/fiyat-listesi.pdf" assets="/vivepdf/"></vive-pdf>
```

## Düz HTML

Başka bir şey gerekmez. Ayarlar özniteliktir; JavaScript yalnızca [metotlar ve olaylar](https://vivepdf.com/dokumantasyon/web-goruntuleyici-api/) için gerekir.

```html
<vive-pdf src="/dosyalar/rapor.pdf" page="3" zoom="fit-page" theme="auto" style="height: 600px"></vive-pdf>
```

## React

React 19 öznitelikleri ve özellikleri özel öğelere olduğu gibi geçirir. Görüntüleyiciyi bir kez yükle, örneğin giriş dosyanda, sonra etiketi kullan:

```jsx
import "@vivepdf/viewer";

export function Report({ url }) {
  return <vive-pdf src={url} theme="auto" style={{ height: "80vh", display: "block" }} />;
}
```

Metotları çağırmak için bir ref tut: `ref.current.goTo(5)`. Olayları bir effect içinde `addEventListener` ile dinle ve temizlikte dinleyiciyi kaldır. TypeScript'te etiketi JSX için bir kez tanıt:

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

Vue'ya `vive-pdf`'in özel bir öğe olduğunu `vite.config.js` içinde söyle:

```js
vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === "vive-pdf" } } });
```

Sonra şablonlarda kullan:

```vue
<script setup>
import "@vivepdf/viewer";
</script>

<template>
  <vive-pdf :src="url" theme="auto" style="height: 80vh" @vive-pagechange="onPage" />
</template>
```

## Svelte

Svelte bir ayar istemez:

```svelte
<script>
  import "@vivepdf/viewer";
  let { url } = $props();
</script>

<vive-pdf src={url} theme="auto" style="height: 80vh"></vive-pdf>
```

Metotlar ve olaylar için öğeyi `bind:this` ile al ve onun üzerinde `addEventListener` çağır.

## Sunucuda oluşturulan sayfalar

Öğe yalnızca tarayıcıda başlar. Next.js, Nuxt, SvelteKit ya da Astro ile paketi tarayıcıda çalışan kodda içe aktar (istemci bileşeni, `onMount`, bir `<script>` etiketi) ve `<vive-pdf>`'i sunucuda düz HTML olarak yaz. Görüntüleyici ekrana yaklaşınca yüklenmeye başlar.

## Güncelleme

CDN'den `@0` ile kullanıyorsan yapacak bir şey yok. npm ile `npm update @vivepdf/viewer` çalıştır ve `dist`'i yeniden kopyala. Zip ile kullanıyorsan klasörün tamamını değiştir: farklı sürümlerin dosyaları karışmamalı. Neyin değiştiği [sürüm notlarında](https://github.com/mtvrkan/vivePDF/releases).
