# Web görüntüleyici performansı ve büyük dosyalar

> vivePDF web görüntüleyicinin neyi ne zaman indirdiği, büyük PDF'leri parça parça nasıl açtığı, ölçülmüş açılış süreleri ve yedek fontlar.

URL: https://vivepdf.com/dokumantasyon/web-goruntuleyici-performans/
Son güncelleme: 2026-10-31

Görüntüleyici, üzerinde PDF olan bir sayfa olmayan bir sayfa kadar hızlı kalsın diye yapıldı. Bu sayfa neyin ne zaman indirildiğini ve bir belgenin ne kadar sürede göründüğünü anlatıyor.

## Ne, ne zaman indirilir

| Parça | Boyut (sıkıştırılmış) | Ne zaman |
| --- | --- | --- |
| Yükleyici, `vivepdf.js` | 3 KB'tan az | Sayfanla birlikte |
| Görüntüleyici | yaklaşık 70 KB | Görüntüleyici ekrana 200 piksel yaklaşınca ya da `open()`/`show()` çağrılınca |
| PDF motoru (PDFium) | yaklaşık 1,6 MB, açılmış hali 4,5 MB | Aynı anda, her sürüm için bir kez; sonra tarayıcının önbelleğinden |
| Çizim araçları | yaklaşık 46 KB | Yalnızca `annotate` ile, görüntüleyici başlarken |
| Yedek fontlar | Font başına 25 KB ile 8,5 MB arası | Yalnızca `fonts` ile, bir sayfa ihtiyaç duyunca |

Sayfanın çok aşağısındaki bir görüntüleyici, ziyaretçi yakınına kaydırana kadar hiçbir şeye mal olmaz. `lightbox` modunda açılır pencere açılana kadar yükleyiciden başka bir şey indirilmez.

## Büyük dosyalar

Varsayılan `load="range"` ile görüntüleyici sunucudan dosyanın yalnızca ekrandaki sayfalar için gereken kısımlarını, ziyaretçi kaydırdıkça da sonrakileri ister. 500 sayfalık bir kitap ya da 80 MB'lık bir tarama, kısa bir mektup kadar hızlı açılır.

Bunun için sunucunun aralık isteklerine (range request) cevap vermesi gerekir. Çoğu verir: statik barındırma, CDN'ler, nesne depoları ve yaygın web sunucuları hiçbir ayar olmadan `Accept-Ranges: bytes` gönderir. Sunucu bunun yerine dosyanın tamamını gönderirse görüntüleyici onu kullanır ve yine çalışır. Başka sitedeki bir dosya için o sitenin `Content-Range`'i de açması gerekir; bkz. [başka sitedeki PDF'ler](https://vivepdf.com/dokumantasyon/web-goruntuleyici-guvenlik/#ba%C5%9Fka-sitedeki-pdfler).

`load="full"` dosyanın tamamını göstermeden önce indirir. Ziyaretçinin zaten sonuna kadar okuyacağı küçük dosyalar ya da aralık isteklerine yanlış cevap veren bir sunucu için kullan.

## Ölçülen süreler

Sayfanın başlangıcından belgenin ilk sayfası ekrana gelene kadar geçen süre; bir MacBook'ta yerel bir sunucuyla ölçüldü (31 Ekim 2026):

| Belge | Chromium | WebKit (Safari) |
| --- | --- | --- |
| 2 sayfa, 0,4 MB | 0,14 sn | 0,15 sn |
| 500 sayfa, 1 MB | 0,16 sn | 0,16 sn |
| 20 taranmış sayfa, 80 MB | 0,32 sn | 0,34 sn |

`load="range"` ile 80 MB'lık tarama, Chromium'da ilk sayfasını göstermek ve son sayfasına atlamak için 28 MB indirdi.

Daha yavaş bir bağlantıda (9 Mbit/sn, 60 ms gecikme) ilk ziyaret kısa dosya için 2,4 sn, kitap için 3,0 sn sürüyor; çoğu motorun indirilmesi. Sonraki ziyarette motor önbellekten gelir ve aynı dosyalar 0,7 sn ve 1,2 sn'de açılır. O bağlantıda 80 MB'lık tarama `load="range"` ile 7,6 sn'de açılıyor; `load="full"` ile testin süre sınırı içinde açılmıyor. `range`'in varsayılan olmasının nedeni bu.

## Önbellek

Motor sitenin Cache Storage'ında, adı `vivepdf-engine-` ile başlayan bir alanda tutulur ve sitenin her sayfasında yeniden kullanılır. Görüntüleyicinin yeni bir sürümü kendi motorunu kaydeder ve eskisini siler. Tarayıcısı depolamayı engelleyen ziyaretçiler onu yeniden indirir, o kadar.

Görüntüleyicinin kendi dosyaları senin sunucundan ya da CDN'den normal HTTP önbelleğiyle gelir. jsDelivr'da en uzun önbellek süresi için bir sürüm sabitle (`@0.2.0`); `@0` güncellemeler sana ulaşsın diye daha kısa süre önbellekte kalır.

## Kendi fontu olmayan PDF'ler için fontlar

PDF'lerin çoğu kullandığı fontları içinde taşır. Bazıları onları dışarıda bırakır ve okuyucuda bulunmasını bekler. Latin harfli metin için motorun kendi fontları var. Böyle dosyalardaki Japonca, Korece, Çince, Kiril, Yunanca, Vietnamca, İbranice ve Arapça metin için görüntüleyicinin senin sunucundan Noto fontlarını alması gerekir; yoksa o metin kutucuklar olarak görünür ya da hiç görünmez.

Fontlar npm'de yok. Klasörü vivePDF deposundan oluştur:

1. Depoyu al ve font paketine geç:

   ```sh
   git clone https://github.com/mtvrkan/vivePDF.git
   cd vivePDF/apps/embed-fonts
   ```

2. Kur ve fontları topla:

   ```sh
   pnpm install
   pnpm collect
   ```

   Bu, 14 font dosyasını (toplam 46 MB) `fonts/` klasörüne, lisanslarını da `OFL.txt` dosyasına yazar.

3. `fonts/` içindeki dosyaları ve `OFL.txt`'yi sitende tek bir klasöre kopyala ve görüntüleyiciyi o klasöre yönlendir:

   ```html
   <vive-pdf src="/dosyalar/katalog.pdf" fonts="/vivepdf-fonts/"></vive-pdf>
   ```

Ziyaretçi yalnızca açık belgenin ihtiyaç duyduğu fontları indirir. En büyükleri, her biri yaklaşık 8,5 MB olan basitleştirilmiş Çince fontları; İbranice ve Arapça 150 KB'ın altında.

| Metin | Dosyalar |
| --- | --- |
| Kiril, Yunanca, Vietnamca | `NotoSans-*.ttf` (her biri 0,6 MB) |
| Japonca | `NotoSansJP-*.otf` (4,5 MB) |
| Korece | `NotoSansKR-*.otf` (4,6 MB) |
| Çince, basitleştirilmiş | `NotoSansHans-*.otf` (8,4 MB) |
| Çince, geleneksel | `NotoSansHant-*.otf` (5,7 MB) |
| İbranice | `NotoSansHebrew-*.ttf` (26 KB) |
| Arapça | `NotoNaskhArabic-*.ttf` (134 KB) |

Belgelerinin hiç kullanmadığı dillerin dosyalarını koymayabilirsin.

## İpuçları

- Görüntüleyiciye baştan CSS ile bir yükseklik ver; yüklenirken sayfa zıplamasın.
- Taranmış bir PDF çoğunlukla resimden oluşur. Onu vivePDF uygulamasında [Sıkıştır](https://vivepdf.com/dokumantasyon/pdf-kucultme/) ile küçültmek, buradaki her ayardan daha çok işe yarar.
