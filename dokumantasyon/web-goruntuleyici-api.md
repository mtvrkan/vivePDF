# Web görüntüleyici metotları ve olayları

> vivePDF web görüntüleyiciyi JavaScript ile yönet, ziyaretçinin seçtiği dosyaları aç, sayfa ve yakınlaştırma değişikliklerini izle, hataları yakala; TypeScript türleriyle.

URL: https://vivepdf.com/dokumantasyon/web-goruntuleyici-api/
Son güncelleme: 2026-10-31

Her `<vive-pdf>` öğesi aynı zamanda bir JavaScript nesnesidir. Metotları belgede gezinir ve dosya açar; olayları içeride ne olduğunu sayfana haber verir.

```js
const viewer = document.querySelector("vive-pdf");
viewer.addEventListener("vive-ready", (event) => console.log(`${event.detail.pageCount} sayfa`));
viewer.goTo(12);
```

## Metotlar

| Metot | Ne yapar |
| --- | --- |
| `open(input)` | Bir belge açar, belge ekrana gelince tamamlanır. `input` bir adres, `URL`, `File` ya da `Blob`, `ArrayBuffer` ya da typed array olabilir |
| `goTo(page)` | Bir sayfaya gider, 1'den başlar |
| `setZoom(zoom)` | `fit-width`, `fit-page` ya da 10 ile 800 arasında bir yüzde |
| `search(text)` | Aramayı metinle açar ve ilk sonucu gösterir |
| `print()` | Belgeyi menüdeki gibi yazdırır |
| `download()` | Belgeyi menüdeki gibi indirir |
| `show()` · `close()` | `lightbox` modunda görüntüleyiciyi açar ve kapatır; diğer modlarda bir şey yapmaz |

`annotate` özniteliği varken dört metot daha var: `annotations()`, `setAnnotations()`, `save()` ve `setTool()`. Bunlar [çizim araçlarıyla](https://vivepdf.com/dokumantasyon/web-goruntuleyici-cizim/#geli%C5%9Ftiriciler-i%C3%A7in) birlikte anlatılıyor.

Görüntüleyici başlamadan çağrılan metotlar bekler ve belge ekrana gelince çalışır; yani öğeyi oluşturur oluşturmaz çağrılabilirler.

## Özellikler

| Özellik | Değer |
| --- | --- |
| `page` | Görünen sayfa, 1'den başlar |
| `pageCount` | Sayfa sayısı; belge açılana kadar `0` |
| `zoom` | Yüzde olarak yakınlaştırma |

## Olaylar

Bütün olaylar öğeden dışarı kabarcıklanır; `document` üzerindeki tek bir dinleyici birden çok görüntüleyiciyi izleyebilir. Ayrıntılar `event.detail` içindedir.

| Olay | `detail` | Ne zaman |
| --- | --- | --- |
| `vive-ready` | `{ pageCount }` | Belge açıldı |
| `vive-pagechange` | `{ page, pageCount }` | Başka bir sayfa görünür oldu |
| `vive-zoomchange` | `{ zoom }` | Yakınlaştırma değişti |
| `vive-error` | `{ code }` | Belge açılamadı |
| `vive-close` | `null` | Açılır pencere kapandı |
| `vive-annotationchange` | `{ type, page }` | Bir çizim ya da not eklendi, değişti ya da silindi |

## Ziyaretçinin seçtiği dosyayı açma

Dosya ziyaretçinin tarayıcısında kalır; hiçbir şey yüklenmez.

```html
<input type="file" accept="application/pdf" id="pick">
<vive-pdf id="viewer" style="height: 80vh"></vive-pdf>
<script>
  const viewer = document.getElementById("viewer");
  document.getElementById("pick").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await viewer.open(file);
    } catch (error) {
      console.warn(error.code);
    }
  });
</script>
```

Bu yolla açılan dosya, ziyaretçi indirdiğinde kendi adını korur.

## Hatalar

`open()` reddeder ve `vive-error` şu kodlardan biriyle haber verir. Görüntüleyici ayrıca kendi mesajını ve bir çıkış yolunu gösterir; çoğu site için kodları kaydetmek yeter.

| Kod | Anlamı |
| --- | --- |
| `password` | Dosya parolalı; görüntüleyici parolayı sorar ve kilit açılınca `vive-ready` gönderir |
| `wrong-password` | Girilen parola yanlış |
| `not-found` | Sunucu dosyanın olmadığını söyledi |
| `network` | Dosya indirilemedi; çoğu zaman başka bir site izin vermediği için (bkz. [güvenlik](https://vivepdf.com/dokumantasyon/web-goruntuleyici-guvenlik/#ba%C5%9Fka-sitedeki-pdfler)) |
| `damaged` | Dosya PDF değil ya da bozuk |
| `no-pages` | PDF'te sayfa yok |
| `engine` | PDF motoru başlayamadı, örneğin indirilmesi engellendiği için |
| `unsupported-url` | Adres `http:`, `https:` ya da `blob:` değil |
| `unknown` | Geri kalan her şey |

İlki bitmeden ikinci bir `open()` çağrılırsa ilki `replaced` ile reddedilir.

## Okuyucuyu izleme

```js
document.addEventListener("vive-pagechange", (event) => {
  history.replaceState(null, "", `#page=${event.detail.page}`);
});

const start = Number(new URLSearchParams(location.hash.slice(1)).get("page"));
if (start) document.querySelector("vive-pdf").setAttribute("page", String(start));
```

## TypeScript

npm paketi kendi türleriyle gelir. `import "@vivepdf/viewer"` sonrasında `document.querySelector("vive-pdf")` `VivePdfViewer` türündedir ve `addEventListener("vive-pagechange", …)` `detail`'in ne olduğunu bilir. Türler kendi kodun için de dışa aktarılır:

```ts
import type { VivePdfViewer, VivePdfAnnotation, VivePdfErrorCode } from "@vivepdf/viewer";
```
