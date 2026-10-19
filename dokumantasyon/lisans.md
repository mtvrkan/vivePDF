# Lisans

> vivePDF'in AGPL-3.0 lisansının kullanıcılar ve değiştirilmiş sürüm dağıtanlar için ne anlama geldiği, üçüncü taraf bileşenler.

URL: https://vivepdf.com/dokumantasyon/lisans/
Son güncelleme: 2026-10-19

vivePDF, GNU Affero Genel Kamu Lisansı'nın 3. sürümüyle (AGPL-3.0-only) yayımlanan özgür bir yazılımdır. Uygulamayı ücretsiz kullanabilir, kaynak kodunu inceleyebilir, değiştirebilir ve paylaşabilirsin; değiştirilmiş bir sürümü başkalarına verdiğinde ise kaynak kodunu da aynı lisansla sunman gerekir.

> **Hukuki danışmanlık değildir**
>
> Bu sayfa lisansı sade bir dille özetler. Bağlayıcı olan, depodaki [LICENSE](https://github.com/mtvrkan/vivePDF/blob/main/LICENSE) dosyasındaki tam metindir. Emin olmadığın bir durumda bir hukukçuya danış.

## Kullanıcılar için

vivePDF'i kişisel işlerinde, okulda ya da işyerinde kullanmak için hiçbir koşul yoktur. Ücret, hesap ya da lisans anahtarı istenmez ve kaç bilgisayara kurduğun sınırlanmaz.

- Kaynak kodunun tamamı [GitHub'da](https://github.com/mtvrkan/vivePDF) açıktır; uygulamanın ne yaptığını kendin görebilirsin.
- Kodu kendi bilgisayarında istediğin gibi değiştirip [kaynaktan derleyebilirsin](https://vivepdf.com/dokumantasyon/kaynaktan-derleme/).
- Lisans, yazılımın herhangi bir garanti olmadan sunulduğunu da söyler.

## Değiştirilmiş sürüm dağıtanlar için

vivePDF'in bir kopyasını ya da değiştirdiğin bir sürümünü başkalarına verdiğinde lisansın koşulları devreye girer:

- Dağıttığın sürümün kaynak kodunu, değişikliklerinle birlikte, alan herkese sunmalısın.
- Değiştirilmiş sürüm de AGPL-3.0 ile lisanslanmalı; alan kişilere ek kısıtlama koyamazsın.
- Telif ve lisans bildirimlerini olduğu gibi korumalısın.
- Değiştirdiğin sürümü kullanıcıların bir ağ üzerinden kullanmasına izin veriyorsan, AGPL onlara da kaynak kodunu sunmanı ister. Lisansı GPL'den ayıran asıl fark budur.

## Üçüncü taraf bileşenler

vivePDF, kendi lisansları olan açık kaynak bileşenler üzerine kurulur. Bunlardan bazıları:

- **MuPDF / PyMuPDF** (AGPL-3.0) — PDF motoru
- **Tesseract OCR** (Apache-2.0) — OCR motoru ve dil modelleri
- **LibreOffice** (MPL-2.0) — ofis dosyası dönüştürmeleri. Windows kurulumu, The Document Foundation'ın imzalı LibreOffice kurulum dosyasını değiştirmeden taşır.
- **pyHanko** (MIT) — dijital imzalar
- **pdf2docx** (GPL-3.0) — PDF'ten Word'e dönüştürme
- **Tauri** (MIT / Apache-2.0) — masaüstü kabuğu

Tam liste, her bileşenin lisansı ve uygulamadaki göreviyle birlikte [THIRD_PARTY_NOTICES.md](https://github.com/mtvrkan/vivePDF/blob/main/THIRD_PARTY_NOTICES.md) dosyasında. Uygulamanın içinde de bileşenleri ve lisanslarını **Yardım › Hakkında** sayfasındaki **Lisanslar** bağlantısı listeler.

## Kod imzalama politikası

Windows sürümlerinin imzalanması, SignPath Foundation'ın açık kaynak projelere yönelik programıyla kuruluyor: ücretsiz kod imzalama [SignPath.io](https://about.signpath.io/) tarafından, sertifika [SignPath Foundation](https://signpath.org/) tarafından sağlanır. İlk imzalı sürüme kadar kurulum dosyalarında kod imzası yoktur (bkz. [Kurulum](https://vivepdf.com/dokumantasyon/kurulum/)).

- İmzalanan her kurulum dosyası, herkese açık kaynak koddan GitHub'ın kendi derleme sunucularında (GitHub Actions) derlenir; imzadan önce hiçbir şey elle derlenmez ya da değiştirilmez.
- Her sürüm imzalanmadan önce elle onaylanır.
- Uygulamanın kendi kurduğu güncellemeler her durumda ayrı bir güncelleme imzasıyla denetlenir; değiştirilmiş bir dosya asla kurulmaz.

Ekip rolleri:

- Kod yazanlar ve gözden geçirenler: [Mehmet Türkan (mtvrkan)](https://github.com/mtvrkan)
- Onaylayanlar: [Mehmet Türkan (mtvrkan)](https://github.com/mtvrkan)

Gizlilik: vivePDF senin ya da belgelerin hakkında başka ağ sistemlerine hiçbir şey göndermez. Yalnızca senin başlattığın ya da izin verdiğin işler için internete çıkar: güncelleme denetimi, seçtiğin indirmeler (LibreOffice, yazı tipleri, dil paketleri, ses modelleri), web araması, web sayfasını PDF'e çevirme, DOI sorguları, isteğe bağlı sızdırılmış parola denetimi ve imzalarken zaman damgası. [Çevrimdışı mod](https://vivepdf.com/dokumantasyon/cevrimdisi/) bunların hepsini kapatır; ayrıntılar [Ayarlar ve gizlilik](https://vivepdf.com/dokumantasyon/ayarlar-gizlilik/) sayfasında.
