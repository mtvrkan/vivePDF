# Taranmış sayfaları aranabilir yapma (OCR)

> vivePDF'te OCR ile taranmış PDF'lere aranabilir metin katmanı ekleme, OCR dilleri, tarayıcıdan tarama ve taramaları iyileştirme.

URL: https://vivepdf.com/dokumantasyon/ocr/
Son güncelleme: 2026-10-18

Taranmış bir PDF'in sayfaları aslında birer resimdir; içinde arama yapamaz, metni seçip kopyalayamazsın. vivePDF'in OCR aracı sayfaları okuyup üzerlerine görünmez bir metin katmanı ekler: sayfalar aynı görünür, ama metinleri artık aranabilir, seçilebilir ve kopyalanabilir. OCR bilgisayarında, yerleşik Tesseract ile yapılır; belgen hiçbir yere gönderilmez.

## OCR uygulama

1. **Araçlar › OCR**'ı aç ve taranmış PDF'i seç. vivePDF kaç sayfanın taranmış, kaçında zaten metin katmanı olduğunu gösterir.
2. **Diller** bölümünde belgede geçen dilleri işaretle.
3. **Kapsam**'ı seç ve gerekirse **Otomatik döndür** ile **Okumadan önce temizle**'yi aç.
4. **OCR uygula**'ya tıkla. Sonuç yeni bir dosyaya yazılır; asıl dosyan olduğu gibi kalır.

Bittiğinde sonuç panelinde kaç sayfanın okunduğu, kaçının atlandığı ve kaçının döndürüldüğü görünür.

## Diller

Dil listesinde yalnızca kurulu diller yer alır ve başlangıçta uygulamanın dili ile İngilizce seçili gelir. Türkçe ve İngilizce vivePDF ile birlikte gelir. Yalnızca belgede gerçekten geçen dilleri seç: her fazladan dil okumayı yavaşlatır ve hata ekleyebilir.

Başka bir dil gerekiyorsa OCR sayfasındaki **Başka dil indir**'i aç ya da **Ayarlar › Araçlar**'daki **OCR dil paketleri** listesini kullan. Her dil bir kez indirilir ve sonra internetsiz çalışır. OCR sayfasında hangi dilin hazır seçili geleceğini **Varsayılan OCR dili** ayarı belirler.

> **Dil indirmek internet ister**
>
> Dil paketleri tessdata deposundan indirilir. [Çevrimdışı mod](https://vivepdf.com/dokumantasyon/cevrimdisi/) açıkken yeni dil indirilemez; kurulu dillerle OCR ise her zaman çalışır.

## Seçenekler

**Kapsam** hangi sayfaların okunacağını belirler:

- **Sadece taranmış sayfalar**: zaten metin içeren sayfalar olduğu gibi kalır. Çoğu belge için doğru seçim budur.
- **Tüm sayfalar**: her sayfa yeniden okunur, mevcut metin katmanı değiştirilir.
- **Eski OCR'yi yenile**: daha önceki bir OCR'nin gizli metni silinir ve sayfa yeniden okunur; görünür metni olan sayfalara dokunulmaz.

Diğer seçenekler:

- **Otomatik döndür**: yan ya da ters taranmış sayfaların okuma yönünü bulup düzeltir; işlemi biraz yavaşlatır.
- **Okumadan önce temizle**: kontrastı düzeltir ve lekeleri azaltır. Yalnızca okuma için kullanılır, sayfanın görünüşü değişmez.
- **Tarama çözünürlüğü**: 150, 200 ya da 300. 200 çoğu belge için yeterli; 300 daha doğru ama daha yavaş.
- **Sayfalar**: yalnızca belirli sayfaları okumak için bir aralık yaz. Belgede hem taranmış hem metinli sayfalar varsa **Yalnızca taranmış sayfaları işle** düğmesi aralığı senin için doldurur.
- **Metni ayrıca kaydet**: tanınan metni PDF'in yanına düz metin (.txt) ya da Word belgesi (.docx) olarak da yazar.

## Görüntüleyici'den hızlı OCR

Bütün aracı açmadan da metin tanıyabilirsin. Görüntüleyici'de sayfanın boş bir yerine sağ tıkla ve **Seçilebilir yap › Bu sayfayı seçilebilir yap** ya da **Tüm belgeyi seçilebilir yap**'ı seç.

> **Bu işlem dosyanın kendisini değiştirir**
>
> **Seçilebilir yap**, OCR aracının aksine yeni dosya oluşturmaz; metin katmanını açık belgeye yazar ve dosya diskte yeniden kaydedilir. Sayfanın görünümü değişmez ve metni olan sayfalara dokunulmaz, ama işlem geri alınamaz.

Yalnızca küçük bir parçanın yazısını istiyorsan Görüntüleyici'deki **Alandan yazı al** aracıyla o alanı sürükleyerek seç; vivePDF alandaki yazıyı okuyup kopyalaman için gösterir.

## Taramalar aracı

Kâğıttan PDF'e giden işler **Araçlar › Taramalar**'da toplanır:

- **Tarayıcıdan**: Tarayıcından doğrudan tarar. Windows'ta tarayıcın doğrudan listelenir; macOS ve Linux'ta SANE kurulu olmalıdır. **İki yüzü de tara** ve **Boş yaprakları atla** seçenekleri var; **Metni aranabilir yap (OCR)** açıksa taranan sayfalar kaydedilirken okunur.
- **İyileştir**: Var olan taramaları **Düzelt** (eğik sayfaları doğrultur), **Lekeleri temizle**, **Arka planı beyazlat**, **Kenar gölgelerini kaldır** ve **Boş sayfaları kaldır** ile temizler. **Önizlemeyi göster** sayfanın önceki ve sonraki hâlini gösterir.
- **Toplu tarama böl**: Tek seferde taranmış bir yığını boş sayfalardan, QR ya da barkod ayırıcı sayfalardan veya bir metin kalıbından ayrı dosyalara böler.
- **Fotoğraftan**: Telefonla çekilmiş kâğıt fotoğraflarının köşelerini bulur, perspektifi düzeltir, arka planı beyazlatır ve her fotoğrafı bir sayfa yapar.

## OCR'dan sonra

OCR'lı bir belgede [Görüntüleyici'deki arama](https://vivepdf.com/dokumantasyon/acma-okuma/) artık çalışır. Taranmış bir belgeyi Word ya da Excel'e çevirmek istiyorsan önce OCR uygula, sonra [Dosya dönüştürme](https://vivepdf.com/dokumantasyon/donusturme/) sayfasındaki adımları izle.
