# Dosya dönüştürme

> vivePDF ile PDF'i Word, Excel, PowerPoint, resim, metin, Markdown, HTML ve EPUB'a çevirme; resim, Office, SVG ve web sayfalarından PDF yapma.

URL: https://vivepdf.com/dokumantasyon/donusturme/
Son güncelleme: 2026-10-18

vivePDF, PDF'leri Word, Excel, PowerPoint, resim, metin, Markdown, HTML ve EPUB biçimine çevirir; resimlerden, Office belgelerinden, SVG çizimlerinden ve web sayfalarından da PDF yapar. Hepsi tek bir araçta, **Araçlar › Dönüştür**'de toplanır ve dosyaların bilgisayarından çıkmadan dönüştürülür.

## Dönüştürme adımları

1. **Araçlar › Dönüştür**'ü aç. Araç, Araçlar menüsünde **PDF’ten dönüştürme** grubunda durur.
2. Soldaki listeden bir dönüşüm seç: **PDF’ten** altında PDF'i başka biçime çeviren, **PDF’e** altında PDF oluşturan seçenekler var.
3. Dosyanı seç ve seçenekleri kontrol et. PDF'ten dönüştürürken yalnızca bazı sayfaları istiyorsan sayfa aralığını yaz.
4. **Dönüştür**'e tıkla. Bittiğinde sağdaki sonuç panelinden **Çıktı klasörünü aç** ile yeni dosyaya ulaşabilirsin.

## PDF'ten başka biçimlere

- **PDF → Word**: Düzeni koruyan bir .docx yapar; tablolar ve resimler aktarılır. **Tekrar eden üst ve alt bilgileri Word'e taşı** açıksa her sayfada tekrar eden metin Word'ün üst ve alt bilgisine, sayfa numaraları Word sayfa numarası alanına dönüşür.
- **PDF → Excel**: Sayfalardaki tablolar ayrı çalışma sayfalarına yazılır; tablo olmayan sayfaların metni satır satır ayrı bir sayfaya gider. Dosya türü olarak .xlsx ya da .csv seçebilir, tabloları **Her tablo için bir sayfa**, **Her PDF sayfası için bir sayfa** ya da **Tüm tablolar tek sayfada** olarak dizebilirsin. **Çizgisiz tabloları da bul** yalnızca boşlukla hizalanmış sütunları da okur.
- **PDF → PowerPoint**: Her sayfa bir slayt olur. **Düzenlenebilir metin** seçeneğinde metin, sayfanın geri kalanını gösteren resmin üstünde düzenlenebilir kutulara yazılır; **Yalnızca görsel** her sayfanın birebir resmini koyar ve sayfa metnini konuşmacı notlarına ekler.
- **PDF → JPG / PNG**: Her sayfa bir resim olur. PNG, JPG, WebP ya da TIFF biçimini ve 72 ile 600 arasında bir çözünürlük (DPI) seçebilirsin. Sayfaları tek uzun bir resimde birleştirme, çok sayfalı tek bir TIFF yapma, resimleri tek bir ZIP dosyasında toplama, gri tonlama ve saydam arka plan seçenekleri de var.
- **Görselleri çıkar**: Sayfalara gömülü her resmi özgün çözünürlüğünde kaydeder.
- **PDF → Metin**, **PDF → Markdown**, **PDF → HTML**: Metni düz metin, başlık ve tabloları koruyan Markdown ya da sayfa başına bir bölümden oluşan tek HTML dosyası olarak verir. Markdown'da resimleri dışarıda bırakabilir, yanındaki bir klasöre kaydedebilir ya da dosyanın içine koyabilirsin.
- **PDF → EPUB**: Telefon ve e-kitap okuyucular için akışkan bir e-kitap yapar. Bölümlerin nasıl ayrılacağını, kitap adını, yazarı ve ilk sayfanın kapak olup olmayacağını seçebilirsin.

> **Taranmış PDF'ler**
>
> Taranmış bir sayfada metin değil yalnızca resim vardır. Metin, Markdown, HTML ve EPUB dönüşümlerinde **Metni olmayan sayfaları OCR ile oku** seçeneğini aç; PDF'in kendisi değişmez. Word, Excel ve PowerPoint için önce belgeye [OCR](https://vivepdf.com/dokumantasyon/ocr/) uygula, sonra dönüştür.

## Başka dosyalardan PDF'e

- **Görseller → PDF**: Resimleri ya da bütün bir klasörü tek PDF'te birleştirir. **Alt klasörler dahil** seçeneği, ada ya da tarihe göre sıralama, kenar boşluğu ve resmin sayfaya sığdırılması ya da sayfayı doldurması arasında seçim yapabilirsin.
- **Office → PDF**: Word, Excel ve PowerPoint belgeleri LibreOffice ile çevrilir. TXT, Markdown, HTML, EPUB, XPS, CBZ ve resim dosyaları ise doğrudan dönüştürülür.
- **SVG → PDF**: Inkscape, Illustrator ya da Figma çizimlerini kendi boyutunda vektör PDF sayfalarına dönüştürür. **Tüm çizimleri tek PDF'te topla** açıksa her çizim aynı dosyada bir sayfa olur.
- **Web sayfası → PDF**: Bir web adresini indirip PDF olarak kaydeder. **Okuma kipi** yalnızca asıl yazıyı tutar, menüleri ve yan sütunları dışarıda bırakır; **Görselleri dahil et** ile resimleri ekleyip çıkarabilirsin.

> **İnternet gerektiren tek dönüşüm**
>
> **Web sayfası → PDF** sayfayı indirmek için internete bağlanır, bu yüzden [Çevrimdışı mod](https://vivepdf.com/dokumantasyon/cevrimdisi/) açıkken kullanılamaz. Diğer bütün dönüşümler bilgisayarında, internet olmadan çalışır.

### LibreOffice

Office dönüşümleri LibreOffice ile yapılır. Windows kurulumuyla birlikte gelir; **Ayarlar › Araçlar**'dan kaldırabilir ya da yeniden kurabilirsin. LibreOffice yoksa listeye eklediğin Office dosyalarının yanında **LibreOffice gerekli** uyarısı görünür. Kurulum ayrıntıları [Kurulum](https://vivepdf.com/dokumantasyon/kurulum/) sayfasında.

## Sonuç nereye kaydedilir?

Varsayılan olarak yeni dosya kaynağın yanına, aracın eklediği bir ekle birlikte yazılır. **Ayarlar › Dosyalar**'da **Kayıt yeri**'ni **Sabit klasöre** çevirip bir çıktı klasörü seçebilir, dosya adlarının nasıl oluşturulacağını da ad kalıbıyla belirleyebilirsin. Dönüştürme asıl dosyana hiçbir zaman dokunmaz.

> **Hızlı açma**
>
> Bir Word belgesini, e-kitabı ya da resmi yalnızca okumak istiyorsan dönüştürmene gerek yok: pencereye bırak, PDF kopyası olarak açılsın. Ayrıntılar [PDF açma ve okuma](https://vivepdf.com/dokumantasyon/acma-okuma/) sayfasında.
