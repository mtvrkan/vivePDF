# Web görüntüleyici sorun giderme

> vivePDF web görüntüleyicide sık karşılaşılan sorunların cevapları; indirilemeyen dosyadan engellenen motora, eksik harflerden çizimlere ve çatı kurulumuna kadar.

URL: https://vivepdf.com/dokumantasyon/web-goruntuleyici-sorunlar/
Son güncelleme: 2026-10-31

Görüntüleyici bir belgeyi açamadığında kendi mesajını gösterir; `vive-error` de aynı nedeni sayfana bir kod olarak verir. Mesajdan başla: aşağıdaki bölümler onu izliyor.

## "Dosya indirilemedi"

Kod `network`. Sık görülen nedenler:

- **PDF başka bir sitede** ve o site sayfanın onu okumasına izin vermiyor. O sitenin dosyayla birlikte `Access-Control-Allow-Origin` göndermesi gerekir; bkz. [başka sitedeki PDF'ler](https://vivepdf.com/dokumantasyon/web-goruntuleyici-guvenlik/#ba%C5%9Fka-sitedeki-pdfler). Tarayıcının konsolu eksik başlığın adını verir.
- **İçerik Güvenliği Politikan** PDF'in sitesini `connect-src` içinde saymıyor. Konsol bir CSP ihlali gösterir; siteyi [güvenlik politikası](https://vivepdf.com/dokumantasyon/web-goruntuleyici-guvenlik/#g%C3%BCvenlik-politikas%C4%B1-csp) bölümündeki gibi ekle.
- **Adres bir oturum istiyor** ve tarayıcı o siteye oturum bilgisini göndermiyor, ya da adres bir giriş sayfasına yönlendiriyor.

## "Dosya bulunamadı"

Kod `not-found`: sunucu `src` içindeki adres için 404 döndü. Göreli bir adres betiğe göre değil sayfana göre okunur; yani `/blog/yazi/` sayfasındaki `src="rapor.pdf"` `/blog/yazi/rapor.pdf` dosyasını arar. Emin olmak için adresi `/` ile başlat.

## "Görüntüleyici başlatılamadı"

Kod `engine`: PDF motoru indirilemedi ya da çalışmasına izin verilmedi.

- İçerik Güvenliği Politikası varsa `script-src` içinde `'wasm-unsafe-eval'`, `worker-src` ve `connect-src` içinde görüntüleyicinin kaynağı olduğuna bak.
- npm ve bir paketleyiciyle kullanıyorsan görüntüleyicinin dosyaları herkese açık bir klasöre kopyalanmalı ve `assets` oraya göstermeli; bkz. [kurulum](https://vivepdf.com/dokumantasyon/web-goruntuleyici-kurulum/). Ağ sekmesi hangi dosyanın 404 döndüğünü gösterir.
- Kendi barındırdığın zip ile kullanıyorsan `dist`'teki bütün dosyaları `vivepdf.js` ile aynı klasörde tut.

## "Dosya bozuk"

Kod `damaged`: dosya PDF değil ya da bozuk. Adresin gerçekten PDF'i döndürdüğüne, bir HTML hata ya da giriş sayfası döndürmediğine bak. Dosya başka yerde açılıyor ama burada açılmıyorsa, paylaşabiliyorsan dosyayla birlikte [bildir](https://github.com/mtvrkan/vivePDF/issues).

## Görüntüleyici boş ya da yüksekliği yok

`sized` modunda görüntüleyici, CSS başka bir yükseklik vermedikçe 600 piksel yüksekliğindedir. Yüzde olarak verilen yükseklik yalnızca üst öğenin bir yüksekliği varsa çalışır. Onu sıkıştıran bir flex ya da grid düzenindeyse bir `min-height` ver. `lightbox` tasarım gereği yer kaplamaz: `show()` çağır.

## Bazı harfler kutucuk ya da eksik

PDF o metin için kendi fontlarını taşımıyor. Japonca, Korece, Çince, Kiril, Yunanca, Vietnamca, İbranice ve Arapça için yedek fontları [kendi fontu olmayan PDF'ler için fontlar](https://vivepdf.com/dokumantasyon/web-goruntuleyici-performans/#kendi-fontu-olmayan-pdfler-i%C3%A7in-fontlar) bölümündeki gibi kur.

## Büyük dosyalar yavaş

Ağ sekmesinde PDF isteklerinin `206 Partial Content` döndürdüğüne bak. `200` dönüyorsa sunucu her seferinde dosyanın tamamını gönderiyor; aralık isteklerini aç, başka bir siteyse `Content-Range`'i açtır. Ayrıntısı [performans](https://vivepdf.com/dokumantasyon/web-goruntuleyici-performans/#b%C3%BCy%C3%BCk-dosyalar) sayfasında.

## Çiz düğmesi yok

Çizim araçları, öğede `annotate` özniteliği olana kadar kapalıdır. Öznitelik var ama düğme hâlâ yoksa ağ sekmesine bak: çizim araçları görüntüleyicinin diğer dosyalarının yanında ayrı bir dosya olarak gelir ve engellenmemelidir.

## Vurgulama bir sayfada çalışmıyor

Vurgulama, altını çizme ve üstünü çizme PDF'te metin ister. Taranmış bir sayfa bir resimdir; kalemi ya da fosforlu kalemi kullan, ya da önce vivePDF uygulamasında [OCR](https://vivepdf.com/dokumantasyon/ocr/) ile metni seçilebilir yap.

## Yeniledikten sonra çizimler gitti

Görüntüleyici hiçbir şey saklamaz. Ziyaretçiler işaretlerini PDF'i indirerek tutar; siten onları `annotations()` ile saklayıp `setAnnotations()` ile geri koyabilir, [sunucuna kaydetme](https://vivepdf.com/dokumantasyon/web-goruntuleyici-cizim/#sunucuna-kaydetme) bölümündeki gibi.

## Metotlar `not-ready` ile reddediyor

`annotations()`, `setAnnotations()` ve `save()` açık bir belge ister. Onları `vive-ready`'den sonra çağır. Diğer metotlar kendileri bekler.

## Çatılar

- **React 19** öznitelikleri özel öğelere olduğu gibi geçirir; `vive-` olaylarını bir ref ve `addEventListener` ile dinle.
- **Vue**, `vive-pdf` `isCustomElement` içinde listelenene kadar onun bilinmeyen bir bileşen olduğu uyarısını verebilir.
- **Sunucuda oluşturma**: görüntüleyiciyi yalnızca tarayıcıda içe aktar. Öğe sunucunun HTML'inde durabilir; betik çalışınca başlar.

Her biri için örnekler [kurulum](https://vivepdf.com/dokumantasyon/web-goruntuleyici-kurulum/) sayfasında.

## Hâlâ takıldın mı?

GitHub'da bir [konu (issue) aç](https://github.com/mtvrkan/vivePDF/issues): tarayıcıyı ve sürümünü, görüntüleyicinin sürümünü, hata kodunu ve mümkünse PDF'i ya da sorunu gösteren bir sayfayı yaz.
