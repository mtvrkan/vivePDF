# Sürüm notları

> vivePDF'in her sürümünde öne çıkan değişiklikler, güncellemelerin nasıl geldiği ve tam değişiklik listesinin nerede olduğu.

URL: https://vivepdf.com/dokumantasyon/surum-notlari/
Son güncelleme: 2026-10-18

Bu sayfada vivePDF'in her sürümüyle gelen başlıca yenilikleri bulursun. Aşağıdaki notlar uygulamanın içindeki **Yenilikler** bölümüyle aynıdır: en yeni sürüm en üstte, her sürüm kendi başlığı altında. Notlar yalnızca öne çıkan değişiklikleri anlatır; her küçük düzeltmeyi görmek istersen tam listeye bakabilirsin.

## Güncellemeler nasıl gelir

vivePDF yeni sürümü kendisi denetler ve sana haber verir. Açılışta yalnızca sürüm bilgisi alınır; indirme ve kurulum her zaman sana sorulur.

1. **Ayarlar › Güncellemeler**'i aç ve **Güncellemeleri denetle**'ye tıkla. Aynı komut **Yardım** menüsünde de var.
2. Yeni sürüm varsa üst çubukta **v… hazır** etiketi belirir. **İndir ve yükle**'yi seç; güncelleme imzalı olarak iner.
3. İndirme bitince **Yeniden başlat**'a tıkla; uygulama yeni sürümle açılır.

Hangi sürümün yüklü olduğunu aynı ekrandaki **Yüklü sürüm** satırında görebilirsin. Otomatik denetimi istemiyorsan **Açılışta otomatik denetle** anahtarını kapatabilirsin. [Çevrimdışı mod](https://vivepdf.com/dokumantasyon/cevrimdisi/) açıkken hiç denetim yapılmaz. Kurulum ve kaldırma ayrıntıları [Kurulum](https://vivepdf.com/dokumantasyon/kurulum/) sayfasında.

### Güncellemeden sonra

Yeni sürüme geçtikten sonraki ilk açılışta vivePDF, **vivePDF … yüklendi** başlıklı bir pencerede o sürümün yeniliklerini bir kez gösterir. Kapattıktan sonra aynı notlara istediğin zaman **Yardım › Yenilikler**'den ulaşabilirsin.

## Tam değişiklik listesi

Her sürümdeki bütün eklemeler, değişiklikler ve düzeltmeler GitHub'daki [CHANGELOG.md](https://github.com/mtvrkan/vivePDF/blob/main/CHANGELOG.md) dosyasında tarihleriyle birlikte tutulur. Kurulum dosyalarını ve her sürümün kısa notunu [sürümler sayfasında](https://github.com/mtvrkan/vivePDF/releases) bulabilirsin.

## vivePDF 0.5.0

- Kaynak yöneticisi yenilendi: DOI'den gelen künye APA 7, MLA, Chicago, IEEE, İSNAD, Vancouver ve Harvard'ın resmî stilleriyle yazılıyor; .bib dosyaları doğru okunuyor, düzenlenip kendi dosyasına kaydediliyor.
- Word, PowerPoint, Excel ve HTML'e dönüşümler PDF'e çok daha sadık: yazı tipleri, bağlantılar, resimler, tablolar ve sütunlar yerinde kalıyor; taranmış tablolar da Excel'e satır satır geliyor.
- Yazdır penceresi, seçtiğiniz sayfalar, sayfa başına sayfa sayısı, gri tonlama ve ölçekle her kâğıdın önizlemesini ayarların yanında gösteriyor.
- Ayarlar › Sistem'den vivePDF'i PDF dosyalarını açan varsayılan uygulama yapabilirsiniz; Windows, macOS ve Linux'ta.
- Yeni araçlar: PDF'ten SVG'ye dönüştürme ve sayfa arka plan rengi; Yorumlar, Ekler, Sesli oku, Çevir ve Yazdır artık araç kategorilerinde de var.
- Geniş Excel tabloları kâğıda sığıyor, eksik yazı tipleri dönüştürmeden önce bildiriliyor, Görseller → PDF fotoğrafları küçültebiliyor ve görseller sayfada göründüğü gibi çıkarılabiliyor.
- Stüdyo'daki belge düzenleyici artık Word gibi: sekmeli şerit, cetveller, sayfa çizgileri ve sayfa yapısı, gezinti bölmesi; tez için de numaralı başlıklar, şekil ve tablo yazıları ile listeleri, ana metinden önce romen rakamlı sayfa numaraları.
- Stüdyo'da tez yazımı: üniversitelerin ortak kurallarıyla hazır Yüksek Lisans ve Doktora tezi başlangıçları, LaTeX ile yazılıp (1), (2)… diye numaralanan ve metinde anılabilen denklemler, sayfanın yanında yanıtlı yorumlar ve içindekiler, dipnotlar, denklemler ve yorumlarla birlikte Word'e aktarma.
- Tez denetimi ve gözden geçirme: Araçlar › Tez denetimi bitmiş bir tez PDF'ini kâğıt, kenar boşlukları, yazı tipi, satır aralığı, başlıklar ve sayfa numaraları için üniversite kurallarına göre denetler; Stüdyo'daki belgede değişiklikleri izle eklenen ve silinen metni yazarıyla işaretler, tek tek ya da hepsini kabul veya reddettirir ve Word'e gerçek değişiklik olarak aktarılır; sürüm geçmişi her kayıtta ve 10 dakikada bir sürüm saklar, önizletir ve geri yükler.

## vivePDF 0.4.0

Yayımlandı: 2026-10-21 · [GitHub](https://github.com/mtvrkan/vivePDF/releases/tag/v0.4.0)

- Word, Excel ve PowerPoint dosyaları doğrudan vivePDF'te PDF olarak açılır, Finder ve Explorer'daki Birlikte Aç menüsünden de; LibreOffice yoksa vivePDF kurmayı önerir ve hazır olunca dosyayı açar.
- Sekmeler tarayıcıdaki gibi çalışır: bir sekmeyi ya da bütün bir sekme grubunu dışarı sürükleyip bıraktığınız yerde kendi penceresinde açın veya başka bir vivePDF penceresine bırakıp oraya taşıyın.
- vivePDF Mac'te çalışıyor: tam ekranda pencere düğmeleri logonun yanında kalır, Command kısayolları ve menü çubuğu macOS'a uygun çalışır, izleme dörtgeninde iki parmakla yakınlaştırma yumuşaktır ve güncellemeler uygulamanın içinden gelir.
- Sunumdaki siyah ve beyaz tahtalarda kalem, vurgulayıcı, şekil ve silgili bir araç çubuğu var; birden çok çizim birlikte seçilir ve 100 adıma kadar geri alınır.
- Daha akıcı ve hafif: PDF kaydırırken takılma olmuyor, uzun Stüdyo belgelerinde yazmak hızlı kalıyor ve sayfa önizlemeleri birbirini beklemiyor.

## vivePDF 0.3.0

Yayımlandı: 2026-10-15 · [GitHub](https://github.com/mtvrkan/vivePDF/releases/tag/v0.3.0)

- İnternetsiz çalışan yardım: F1 bulunduğunuz ekranın kısayollarını gösterir (PDF olarak da kaydeder), Yardım › Yardım konuları başlıca işleri adım adım anlatır ve hata bildirimleri, kendi kaydettiğiniz bir destek paketiyle resim ve örnek dosya taşıyabilir.
- Çevrimdışı mod: Ayarlar › Web'deki tek bir anahtar, internet kullanacak her özelliği kapatır; güncellemeler, indirmeler, web araması, kaynak sorguları ve sızdırılmış parola denetimi de buna dahildir.
- Sunucu görünümü: projeksiyon yalnızca slaytları gösterirken dizüstü bilgisayarınız sonraki sayfayı, süreölçeri ve konuşmacı notlarını gösterir.
- Stüdyo belgeleri Word tarzı yazım araçları kazandı: dipnotlar, sütunlar ve bölüm sonları, bul ve değiştir, satır aralığı, simgeler, sözcük sayısı ve Markdown olarak dışa aktarma.
- Sunum sırasında formül, şekil, grafik, tablo ve diyagram eklenebilir; siyah ve beyaz tahtada da.

## vivePDF 0.2.0

Yayımlandı: 2026-10-09 · [GitHub](https://github.com/mtvrkan/vivePDF/releases/tag/v0.2.0)

- Stüdyo'da yeni CV düzenleri, süsler ve yenilenen iş belgeleri, planlayıcılar ve etiketlerle 174 şablon var.
- CV oluşturucu mevcut bir CV'yi ya da LinkedIn PDF'ini içe aktarır; geri alma, sıralama ve ay seçici de eklendi.
- Sayfa düzenleyici sayfaları yönüne, boyutuna ya da içerdiği metne göre seçer, sayfaları masaüstüne ya da başka bir sekmeye sürükler ve sayfaları resim olarak kaydeder.
- Görüntüleyici formları sayfanın üzerinde doldurur, metin bloklarını ve resimleri belgeler arasında kopyalar, seçili metni vurgular ve yer imlerini düzenler.
- Ana sayfa koleksiyonları yeniden sıralanabilir, aranabilir ve yeniden renklendirilebilir; son dosyalar sabitlenebilir.

## vivePDF 0.1.1

Yayımlandı: 2026-10-04 · [GitHub](https://github.com/mtvrkan/vivePDF/releases/tag/v0.1.1)

- Stüdyo: sertifika, davetiye, kart, afiş ve daha fazlası için hazır şablonlarla sıfırdan PDF hazırlayan bir tasarım düzenleyici.
- CV oluşturucu: soldaki formu doldurursunuz, sağda bitmiş CV görünür.
- Stüdyo'da resimler kırpılıp ayarlanabilir; tasarımlara tablo, grafik, akış şeması, formül, gölge ve cetvel eklendi.
- Tümü Türkçe harfleri içeren 24 açık lisanslı yazı tipinden oluşan bir kitaplık, istendiğinde indirilir.
- 1.600'den fazla simge kendi dilinizde adıyla aranabilir ve keskin, yeniden renklendirilebilir çizimler olarak eklenebilir.
