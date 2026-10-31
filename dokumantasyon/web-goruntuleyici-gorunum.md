# Web görüntüleyici modları ve görünümü

> Bir PDF'i kutu içinde, pencere yüksekliğinde, sayfanın akışında ya da açılır pencerede göster; tema, vurgu rengi ve dille görüntüleyiciyi sitene uydur.

URL: https://vivepdf.com/dokumantasyon/web-goruntuleyici-gorunum/
Son güncelleme: 2026-10-31

`mode` özniteliği görüntüleyicinin ne kadar yer kaplayacağını ve nasıl kayacağını belirler. `theme`, `accent` ve `lang` onu sitene uydurur.

## Modlar

| Mod | Nasıl görünür | Ne için iyi |
| --- | --- | --- |
| `sized` | 600 piksel ya da CSS ile verdiğin yükseklikte, kendi içinde kayan bir kutu | Başka içeriğin yanında duran bir belge |
| `full` | Pencere yüksekliğinde | Asıl konusu belge olan bir sayfa |
| `inline` | Belgenin tamamı kadar uzun; sayfalar senin sayfanın içinde durur ve sayfa kaydıkça ilerler | Sayfanın bir parçası gibi okunması gereken yazılar, raporlar, menüler |
| `lightbox` | Yer kaplamaz; istendiğinde sayfanın üstünde, bir kapatma düğmesiyle açılır | "Broşürü görüntüle" gibi bir bağlantı ya da düğme |

### sized

```html
<vive-pdf src="/dosyalar/fiyat-listesi.pdf" style="height: 70vh"></vive-pdf>
```

Varsayılan. Kutunun içinde kaydırmak sayfaları çevirir; etraftaki sayfa yerinde kalır.

### full

```html
<vive-pdf src="/dosyalar/kilavuz.pdf" mode="full"></vive-pdf>
```

Görüntüleyici `100dvh` yüksekliğindedir; telefonlarda tarayıcının adres çubuğu gelip gitse de görünen ekrana sığar.

### inline

```html
<vive-pdf src="/dosyalar/faaliyet-raporu.pdf" mode="inline"></vive-pdf>
```

Görüntüleyici belgenin yüksekliğine uzar, ziyaretçi senin sayfanı her zamanki gibi kaydırır. Belge görünürken araç çubuğu ekranda kalır. Bu, pencerenin kaydırmasıyla da görüntüleyiciyi saran kayan bir öğeyle de çalışır.

### lightbox

```html
<button type="button" id="open-brochure">Broşürü görüntüle</button>
<vive-pdf id="brochure" src="/dosyalar/brosur.pdf" mode="lightbox"></vive-pdf>
<script>
  document.getElementById("open-brochure").addEventListener("click", () => document.getElementById("brochure").show());
</script>
```

`show()` ya da `open()` çağrılana kadar hiçbir şey indirilmez. Belge sonra sayfanın üstünde açılır; Escape, kapatma düğmesi ya da `close()` onu kapatır, `vive-close` da sayfana haber verir.

Bir belge açıkken `mode`'u değiştirmek belgeyi açık tutar.

## Tema

| `theme` | |
| --- | --- |
| `light` | Açık arka plan ve araç çubuğu (varsayılan) |
| `dark` | Koyu arka plan ve araç çubuğu; sayfaların kendisi kendi renklerini korur |
| `auto` | Ziyaretçinin sistem ayarına uyar ve o değişince değişir |

## Vurgu rengi

`accent` herhangi bir CSS rengini alır ve görüntüleyicinin düğmelerini ve vurgularını o renge boyar:

```html
<vive-pdf src="/dosyalar/menu.pdf" accent="#C2410C"></vive-pdf>
```

Geçerli bir CSS rengi olmayan değer yok sayılır ve görüntüleyici mavi kalır. Üstünde beyaz yazının okunabileceği kadar koyu bir renk seç.

## Dil

Görüntüleyici Türkçe ve İngilizce konuşur. `lang` verilmezse sayfanın `lang` değerine (`<html lang="tr">`) uyar, yoksa İngilizce olur. `lang="tr"` ya da `lang="en"` ile o dil kullanılır.

## vivePDF işareti

Araç çubuğu, vivepdf.com'u yeni sekmede açan küçük bir vivePDF işaretiyle başlar. Başkalarının ücretsiz bir görüntüleyici bulmasına yardım eder; `branding="false"` onu gizler. MIT lisansı bunu sormadan yapmana izin verir.

## Telefon ve tablette

Dar ekranlarda araç çubuğu sayfa numarasını, yakınlaştırmayı ve menüyü tutar, ziyaretçi aşağı kaydırırken kenara çekilir. Küçük resimlerin ve içindekilerin bulunduğu yan panel alttan bir sayfa olarak açılır. İki parmakla sayfalar yakınlaştırılır. Bunların hepsi masaüstü tarayıcıların yanında iPhone ve iPad'de de deneniyor.
