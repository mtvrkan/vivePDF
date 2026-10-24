# PDF küçültme (sıkıştırma)

> vivePDF ile PDF dosya boyutunu küçültme; neyin yer kapladığını görme, sıkıştırma profili seçme ve e-postaya sığacak bir dosya elde etme.

URL: https://vivepdf.com/dokumantasyon/pdf-kucultme/
Son güncelleme: 2026-10-24

Bir PDF'in boyutunu küçültmek için **Araçlar › Sıkıştır**'ı aç, dosyanı seç, bir profil belirle ve **Sıkıştır**'a tıkla. Görseller yeniden örneklenir, kullanılmayan yazı tipi parçaları ve gereksiz yapı temizlenir; asıl dosya olduğu gibi kalır.

1. **Araçlar › Sıkıştır**'ı aç ve PDF'i seç ya da pencereye sürükle.
2. **Dosyada yeri ne kaplıyor** bölümüne bak: görseller, yazı tipleri ve sayfa içerikleri ayrı ayrı gösterilir, en büyük görseller listelenir.
3. **Profil**'den birini seç. E-posta için **Güçlü** genellikle yeterlidir.
4. **Sıkıştır**'a tıkla.

![Sıkıştır aracı: 25 MB'lık broşürde yerin çoğunu görsellerin kapladığını gösteren çubuk ve en büyük görseller listesi](https://vivepdf.com/shots/tr/compress-1-1600.webp)

Profiller şöyle ayrılır:

- **Hafif**: görsellere dokunmaz, yalnızca yapıyı ve yazı tiplerini temizler.
- **Dengeli**: 150 dpi ve %75 JPEG; ekranda fark edilmez.
- **Güçlü**: 100 dpi ve %60 JPEG; e-posta için ideal.
- **Aşırı**: 72 dpi ve %40 JPEG; en küçük dosya, düşük kalite.
- **Özel**: çözünürlüğü ve kaliteyi kendin belirlersin.

Sonuç panelinde kazanç yüzdesi, eski ve yeni boyut ve bir önce/sonra önizlemesi görünür. Aşağıdaki örnekte 25 MB'lık broşür 267 KB'a indi.

![Sıkıştırma sonucu: −%99, 25,0 MB'tan 266,6 KB'a; önce ve sonra önizlemesi](https://vivepdf.com/shots/tr/compress-2-1600.webp)

> **Belirli bir boyutun altına inmen gerekiyorsa**
>
> **Hedef boyuta sıkıştır**'ı aç ve sınırı yaz (örneğin 10 MB). vivePDF profilleri hafiften güçlüye doğru dener ve sınıra sığan ilk sonucu kaydeder.

Metin ağırlıklı bir PDF zaten küçükse sıkıştırma çok az kazandırır; asıl kazanç büyük fotoğraf ve taramalardan gelir. Taranmış belgeler için [Taranmış sayfaları aranabilir yapma (OCR)](https://vivepdf.com/dokumantasyon/ocr/) sayfasına da bak.
