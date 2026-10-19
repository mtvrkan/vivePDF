# Sorun giderme

> vivePDF'te bir araç çalışmadığında yapılacaklar; günlük klasörü, destek paketi, hata bildirme, SmartScreen, LibreOffice ve OCR dil paketleri.

URL: https://vivepdf.com/dokumantasyon/sorun-giderme/
Son güncelleme: 2026-10-18

vivePDF'te bir şey beklendiği gibi çalışmadığında önce ekrandaki iletiyi oku: neyin ters gittiğini ve çoğu zaman nasıl düzeltileceğini söyler. Sorun sürerse **Yardım** menüsündeki günlük klasörü, destek paketi ve hata bildirme seçenekleriyle neler olduğunu görebilir ve bize iletebilirsin.

## İlk adımlar

- Bir araç başarısız olursa dosyanın bir kopyasıyla yeniden dene. Araçlar asıl dosyaya dokunmaz, sonucu yeni bir dosyaya yazar.
- "Dosya geçerli bir PDF değil ya da bozuk." iletisini görüyorsan dosyayı önce **Onar** aracıyla onarmayı dene. [Araçlar](https://vivepdf.com/dokumantasyon/araclar/) sayfası tüm araçları listeler.
- Bir özellik soluk görünüyor ve üzerine gelince "Çevrimdışı mod açıkken kapalı" yazıyorsa [çevrimdışı mod](https://vivepdf.com/dokumantasyon/cevrimdisi/) açıktır. **Ayarlar › Web**'den kapat.
- Bulunduğun ekranla ilgili yardım konusunu açmak için `Shift+F1`'e, o ekranın kısayollarını görmek için `F1`'e bas.

## Kurulumda SmartScreen uyarısı

Kurulum dosyası kod imzası taşımadığı için Windows ilk çalıştırmada **Windows bilgisayarınızı korudu** uyarısını gösterebilir. **Ek bilgi**'ye, ardından **Yine de çalıştır**'a tıkla. Ayrıntılar [Kurulum](https://vivepdf.com/dokumantasyon/kurulum/) sayfasında.

## Mac'te "açılamıyor" uyarısı

macOS ilk açılışta vivePDF'i engellerse **Sistem Ayarları › Gizlilik ve Güvenlik**'i aç ve vivePDF iletisinin yanındaki **Yine de Aç**'a tıkla. Bu yalnızca ilk açılışta gerekir; ayrıntılar [Kurulum](https://vivepdf.com/dokumantasyon/kurulum/) sayfasında.

## "Bu dönüştürme için LibreOffice gerekli."

Word, Excel ve PowerPoint dönüştürmeleri LibreOffice ile yapılır. Bu iletiyi görüyorsan **Ayarlar › Araçlar**'daki **Ofis dönüştürücü** bölümünü aç:

- Windows kurulumunda LibreOffice uygulamayla birlikte gelir. **Uygulama paketinden kur** onu internete çıkmadan kurar (diskte yaklaşık 900 MB).
- Paket yoksa **İndir ve kur** LibreOffice'i indirir (yaklaşık 350 MB).
- Bilgisayarında zaten LibreOffice varsa durum satırında **Bu bilgisayarda bulundu** yazar ve o kullanılır.

LibreOffice "hâlâ kullanımda" diyorsa açık LibreOffice pencerelerini kapatıp yeniden dene. Parola korumalı bir Office dosyasının parolasını önce onu oluşturan uygulamada kaldırman gerekir.

## "OCR dil paketi bulunamadı."

OCR, metnin dili için bir dil paketine ihtiyaç duyar. **Ayarlar › Araçlar**'daki **OCR dil paketleri** listesinde dili ara ve **İndir**'e tıkla; her dil bir kez indirilir. Varsayılan dili aynı bölümdeki **Varsayılan OCR dili** ile seçebilirsin. İndirme için çevrimdışı modun kapalı olması gerekir. OCR'ın ayrıntıları [OCR](https://vivepdf.com/dokumantasyon/ocr/) sayfasında.

## Uygulama kapanırsa

vivePDF beklenmedik şekilde kapanırsa bir sonraki açılışta "vivePDF son oturumda beklenmedik şekilde kapandı — Çökme bildir" bildirimi çıkar; **Bildir** ile doğrudan rapor açabilirsin. Açık belgelerini Başlangıç'taki **Oturumu geri yükle** ile geri getirebilirsin. "PDF motoru başlatılamadı" iletisi alırsan uygulamayı kapatıp yeniden aç; sorun sürerse bir destek paketi kaydet.

## Günlük klasörü

**Yardım › Günlük klasörünü aç** günlük dosyalarının bulunduğu klasörü açar. Günlük, uygulamada neler olduğunu teknik olarak kaydeder; belge içeriği asla yazılmaz. Hata satırlarında dosya yolları geçebilir ve kullanıcı klasörün `~` olarak görünür. Aynı klasöre **Ayarlar › Geri bildirim › Günlük klasörü** üzerinden de ulaşabilirsin.

## Destek paketi

**Yardım › Destek paketi kaydet…** sistem bilgilerini ve son günlükleri paylaşabileceğin tek bir zip dosyasına toplar.

1. **Yardım › Destek paketi kaydet…**'i seç.
2. Dosyanın kaydedileceği yeri seç; dosya adı `vivepdf-support-` ile başlar ve tarihi içerir.
3. "Destek paketi kaydedildi" bildirimindeki **Klasörde göster** ile dosyayı bul ve hata kaydına ya da e-postana ekle.

Paket kendiliğinden hiçbir yere gönderilmez; kimle paylaşacağına sen karar verirsin.

## Hata bildirme

**Yardım › Hata bildir** **Rapor gönder** penceresini açar. Türü seç (**Çökme**, **Hata** ya da **Öneri**), ne olduğunu anlat. İstersen **Tanılama bilgilerini ekle** seçeneğini aç; **Neler dahil edilecek** rapora eklenecek bilgiyi tam olarak gösterir.

- `Ctrl+V` ile ekran görüntüsü yapıştırabilir, **Dosya ekle…** ile örnek bir dosya ekleyebilirsin. Ekler yalnızca **Paket olarak kaydet (.zip)** ile kaydettiğin pakete girer; kopyalama ve GitHub bunları hiç içermez.
- **GitHub’da aç** tarayıcında önceden doldurulmuş bir kayıt açar. **Panoya kopyala** ve **Raporu dosyaya kaydet** raporu başka bir yolla iletmen için.

> **Raporlar otomatik gönderilmez**
>
> vivePDF hiçbir raporu kendiliğinden göndermez. Açık hata kayıtlarını görmek ya da yeni bir kayıt açmak için [GitHub sorunlar sayfasını](https://github.com/mtvrkan/vivePDF/issues) kullanabilirsin.
