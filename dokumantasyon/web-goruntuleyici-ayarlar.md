# Web görüntüleyici ayarları

> vive-pdf öğesinin bütün öznitelikleri, değerleri ve varsayılanlarıyla; PDF adresi ve açılış sayfasından tema, dil, denetimler ve çizim araçlarına kadar.

URL: https://vivepdf.com/dokumantasyon/web-goruntuleyici-ayarlar/
Son güncelleme: 2026-10-31

Ayarlar `<vive-pdf>` öğesinin öznitelikleridir. Her birinin bir varsayılanı var; bir görüntüleyiciye `src` dışında bir şey gerekmez. Ayarların çoğu görüntüleyici açıkken değiştirilebilir: özniteliği yeniden ver, görüntüleyici ona uyar.

```html
<vive-pdf src="/dosyalar/faaliyet-raporu.pdf" page="4" zoom="fit-page" theme="auto" lang="tr" accent="#0F766E" download="false"></vive-pdf>
```

## Belge

| Öznitelik | Değerler | Varsayılan |
| --- | --- | --- |
| `src` | PDF'in adresi, sayfaya göre; yalnızca `http:`, `https:` ve `blob:` | — |
| `page` | Açılacak sayfa, 1'den başlar; değiştirilince o sayfaya gider | `1` |
| `zoom` | `fit-width`, `fit-page` ya da 10 ile 800 arasında bir yüzde, örneğin `150` ya da `150%` | `fit-width` |
| `load` | `range` yalnızca ekrandaki kısımları indirir; `full` önce dosyanın tamamını indirir | `range` |
| `filename` | Ziyaretçi indirirken dosyanın adı | adresteki ad |

`src`'yi değiştirmek yeni belgeyi açar. Ziyaretçinin seçtiği bir dosyayı göstermek için bunun yerine `open()` kullan: `File`, `Blob` ya da bayt alır. Bkz. [metotlar ve olaylar](https://vivepdf.com/dokumantasyon/web-goruntuleyici-api/).

## Görünüm

| Öznitelik | Değerler | Varsayılan |
| --- | --- | --- |
| `mode` | `sized` (kutu), `full` (pencere yüksekliği), `inline` (belge kadar uzun) ya da `lightbox` (sayfanın üstünde açılır) | `sized` |
| `theme` | `light`, `dark` ya da `auto` (ziyaretçinin sistemine uyar) | `light` |
| `lang` | `tr` ya da `en` | sayfanın `lang` değeri, yoksa İngilizce |
| `accent` | Düğmeler ve vurgular için herhangi bir CSS rengi | mavi |

Hangi modun ne zaman kullanılacağı, tema ve rengin nasıl çalıştığı [modlar ve görünüm](https://vivepdf.com/dokumantasyon/web-goruntuleyici-gorunum/) sayfasında.

## Denetimler

| Öznitelik | Neyi denetler | Varsayılan |
| --- | --- | --- |
| `toolbar` | Alttaki yüzen araç çubuğu | görünür |
| `search` | Arama düğmesi ve Ctrl/Cmd+F | görünür |
| `print` | Menüdeki Yazdır ve Ctrl/Cmd+P | görünür |
| `download` | Menüdeki İndir ve Ctrl/Cmd+S | görünür |
| `branding` | Araç çubuğunun başındaki küçük vivePDF işareti, vivepdf.com'a bağlantı | görünür |
| `annotate` | Çiz düğmesi ve [çizim araçları](https://vivepdf.com/dokumantasyon/web-goruntuleyici-cizim/) | kapalı |

`false`, `off`, `no`, `0`, `none` ve `hidden` bir denetimi kapatır; büyük küçük harf fark etmez. `annotate` tersine çalışır: öznitelik yazılana kadar kapalıdır, yani açmak için `<vive-pdf annotate>` yeter, `annotate="false"` kapalı tutar.

İndir'i gizlemek yalnızca düğmeyi gizler; PDF'in adresi yine sayfanda durur, yani bu bir dosyayı korumaz. Kopyalanmaması gereken bir dosya web'de hiç gösterilmemeli.

## Dosyalar ve fontlar

| Öznitelik | Değerler | Varsayılan |
| --- | --- | --- |
| `assets` | Görüntüleyicinin dosyalarının klasörü; bir paketleyici betiği onlardan ayırdıysa gerekir. Görüntüleyici başlarken bir kez okunur | betiğin klasörü |
| `fonts` | Yedek fontların klasörü; kendi Japonca, Korece, Çince, Kiril, Yunanca, Vietnamca, İbranice ya da Arapça fontlarını taşımayan PDF'ler için | — |

`fonts` olmadan görüntüleyici hiç font indirmez. Font klasörünün nasıl hazırlanacağı [performans ve büyük dosyalar](https://vivepdf.com/dokumantasyon/web-goruntuleyici-performans/#kendi-fontu-olmayan-pdfler-i%C3%A7in-fontlar) sayfasında.

## Sayfadaki boyut

`sized` modunda görüntüleyici, CSS ile bir yükseklik verene kadar 600 piksel yüksekliğindedir. Genişlik içinde bulunduğu alana uyar.

```css
vive-pdf {
  height: 80vh;
  border-radius: 12px;
  overflow: hidden;
}
```

Araç çubuğu, paneller ve menüler öğenin içinde yaşar; sitenin CSS'i onlara ulaşmaz. Görüntüleyicinin görünüşünü yalnızca `accent`, `theme` ve öğenin kendi boyutu ile kenarlığı değiştirir.
