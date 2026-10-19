# Güvenlik

> vivePDF ile PDF'e parola ve izin ekleme, parolayı kaldırma, sertifikayla mühürleme, filigran ve damga basma, gizli verileri temizleme ve karartma.

URL: https://vivepdf.com/dokumantasyon/guvenlik/
Son güncelleme: 2026-10-18

vivePDF'in güvenlik araçlarıyla bir PDF'e parola ve izin koyabilir, parolayı kaldırabilir, dosyayı yalnızca belirli sertifika sahiplerinin açabileceği biçimde mühürleyebilir, filigran ve damga basabilir, paylaşmadan önce gizli verileri temizleyebilir ve metinleri kalıcı olarak karartabilirsin. Her araç sonucu yeni bir dosyaya yazar; asıl dosyan olduğu gibi kalır.

## Araçlara ulaşma

**Araçlar › Güvenlik**'i aç; sayfa **Parola ekle** ile başlar. Sayfa başlığının üstündeki **Güvenlik** yazısına tıklayınca gruptaki tüm araçlar listelenir: **Parola ekle**, **Parola kaldır**, **Sertifikayla mühürle**, **Sertifikayla aç**, **Karartma**, **Gizlilik kontrolü** ve [imza araçları](https://vivepdf.com/dokumantasyon/imza/). **Filigran ekle**, **Damga** ve **Filigran kaldır** ise **İçerik düzenleme** grubundadır. Tüm araçları **Araçlar** menüsündeki **Tümünü göster** ile de görebilirsin.

## Parola ve izinler

1. **Parola ekle**'de PDF'i seç.
2. **Açma parolası**'nı yaz. Bu parola belgeyi açmak için gerekir; yalnızca izinleri kısıtlamak istiyorsan boş bırakabilirsin.
3. **Sahip parolası**'nı yaz. İzinleri sonradan değiştirmek için bu parola gerekir.
4. **İzinler** bölümünde neye izin verileceğini seç ya da **Hızlı ayar**'dan **Tümü serbest**, **Sadece okuma**, **Kopyalama yok** veya **En kısıtlı**'yı kullan.
5. **Parola ekle**'ye tıkla.

Sahip parolasını boş bırakırsan rastgele bir parola oluşturulur ve dosya yazılınca bir kez gösterilir; kısıtlamaları sonradan kaldırmanın tek yolu bu olduğu için onu güvenli bir yerde sakla. **Şifreleme** için **AES-256 (önerilen)** seçeneğini kullan; AES-128 ve RC4 yalnızca eski okuyucular içindir ve parolada ş, ğ, İ gibi harfleri saklayamaz. **Dosya bilgilerini de şifrele** başlık, yazar ve konuyu da korur.

Yeni bir parola yaygın sızdırılmış parolaların yerleşik listesiyle karşılaştırılır. **Ayarlar › Web**'de çevrimiçi denetimi açarsan Have I Been Pwned'e parolanın kendisi değil, yalnızca SHA-1 özetinin ilk 5 karakteri gider.

**Parola kaldır** parolasız bir kopya oluşturur; bunun için açma ya da sahip parolasını girmen gerekir. Dosya yalnızca izinlerle korunuyorsa parola sormadan çalışır.

## Sertifikayla mühürleme

**Sertifikayla mühürle**, dosyayı hiç parola kullanmadan yalnızca **Alıcılar** listesindeki sertifikaların özel anahtar sahiplerinin açabileceği biçimde şifreler. **Sertifika ekle** ile alıcıların açık sertifikalarını ekle, sonra **Mühürle**'ye tıkla. Yalnızca RSA sertifikaları mühürlü belge alabilir.

Mühürlü bir dosyayı açmak için **Sertifikayla aç**'ı kullan: **Mühürlü PDF**'i, özel anahtarını taşıyan **Sertifika (.p12 / .pfx)** dosyasını ve parolasını seç, **Aç**'a tıkla. Korumasız bir kopya yazılır. Kendi açık sertifikanı başkasına vermek için [İmzalama ve doğrulama](https://vivepdf.com/dokumantasyon/imza/) sayfasındaki **Açık sertifikayı dışa aktar** aracına bak.

## Filigran ve damga

**Filigran ekle**'de **Filigran türü** olarak **Metin**, **Görsel** (PNG / JPG) ya da başka bir PDF'ten **PDF sayfası** seç. Boyutu, konumu ve sayfaları ayarlarken canlı önizleme ilk sayfayı gösterir. **Filigranın görüneceği yer** ile filigranı yalnızca ekranda ya da yalnızca baskıda gösterebilirsin. **Filigranı sayfaya göm** filigranlı sayfaları resme çevirir; filigran artık kaldırılamaz, ama o sayfalardaki metin de seçilemez ve aranamaz.

**Damga**, her sayfanın seçilen yerine çerçeveli bir ibare basar: **ONAYLANDI**, **TASLAK**, **GİZLİ**, **ÖDENDİ** gibi hazır damgalardan birini seç ya da kendi metnini yaz. `{date}`, `{name}`, `{page}` ve `{total}` gibi yer tutucular otomatik doldurulur. Sık kullandığın ayarları **Ön ayarlar**'a kaydedebilirsin.

**Filigran kaldır** belgeyi tarar ve bulduğu filigranları listeler; kaldırmak istediklerini işaretle. Sonucu Görüntüleyici'de kontrol et.

## Gizlilik kontrolü

**Gizlilik kontrolü**, dosyanın görünen sayfaların dışında neleri açığa çıkardığını gösterir. **Belgeyi tara**'ya tıkla; üst veri, XMP üst verisi, JavaScript ve otomatik eylemler, gömülü dosyalar, yorumlar, dış bağlantılar, gizli metin, gizli katmanlar ve fotoğraflardaki kamera ile konum bilgileri gibi bulguları gör. **Kaldırılacaklar** listesinde silinecekleri işaretle ve **Temizle ve kaydet**'e tıkla.

> **İmzalı dosyalar**
>
> İmzalı bir dosyayı temizlemek, geçerli imzası olmayan yeni bir dosya yazar. İmzalı kalması gerekiyorsa temiz kopyayı yeniden imzala.

## Karartma

Hassas metin dosyada kalıyorsa onu **Karartma** ile kalıcı olarak sil. **Aranacak metinler**'e kelimeleri yaz ya da **Bulunan hassas veriler** listesinden TC kimlik no, IBAN, e-posta adresi gibi türleri seç; gerekirse düzenli ifadeler ekle. **Eşleşmeleri say** ile önce sonucu gör, sonra **Karart**'a tıkla. Eşleşen metin dosyadan silinir ve üzeri kapatılır; bu işlem geri alınamaz.

**Sayfa dışındaki eşleşmeleri de sil** aynı ifadeleri yorumlarda, form alanlarında, yer imlerinde ve belge özelliklerinde de arar. Bir alanı elle karartmak için belgeyi Görüntüleyici'de aç, **Düzenle › Sayfa araçları › Alanı karart**'ı seç, alanın üstünde sürükle ve **Karart**'a tıkla. Tüm araçların listesi [Araçlar](https://vivepdf.com/dokumantasyon/araclar/) sayfasında.
