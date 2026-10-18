import { APP_VERSION, type Locale } from "..";
import type { DocKey } from "../../docs/structure";

export type Guide = { key: DocKey; t: string; d: string; s: [string, string, string] };

export const GUIDES: Record<Locale, Guide[]> = {
  tr: [
    { key: "install", t: "Kurulum", d: "Windows kurulumu, SmartScreen ve güncellemeler", s: [`vivePDF_${APP_VERSION}_x64-setup.exe dosyasını indir ve çalıştır.`, "SmartScreen uyarısında Ek bilgi › Yine de çalıştır'ı seç.", "Sonraki sürümler uygulamanın içinden, küçük paketlerle gelir."] },
    { key: "openRead", t: "PDF açma ve okuma", d: "Sekmeler, arama, sayfa numaraları ve yakınlaştırma", s: ["Başlangıç'ta PDF aç'a tıkla ya da Ctrl+O'ya bas; dosyayı pencereye bırakmak da olur.", "Her belge Görüntüleyici'de kendi sekmesinde açılır.", "Ctrl+F ile ara; F3 sonraki eşleşmeye geçer."] },
    { key: "pages", t: "Sayfaları düzenleme", d: "Sırala, döndür, sil, ekle ve böl", s: ["Belgeyi aç ve üst çubukta Sayfalar'ı seç.", "Sayfaları sürükleyerek sırala; seçime döndür, çoğalt ya da sil uygula.", "Uygula ve kaydet'e tıkla: sonuç yeni bir dosyaya yazılır, asıl dosya olduğu gibi kalır."] },
    { key: "convert", t: "Dosya dönüştürme", d: "PDF'ten Word, Excel, PowerPoint ve daha fazlasına", s: ["Araçlar › Dönüştür'ü aç.", "PDF'ten ya da PDF'e yönünü ve hedef biçimi seç.", "Dönüştür'e tıkla; yeni dosya Ayarlar › Dosyalar'daki çıktı klasörüne gider."] },
    { key: "ocr", t: "OCR", d: "Taranmış sayfaları aranabilir yapma", s: ["Araçlar › OCR'ı aç ve taranmış PDF'i seç.", "Metnin dillerini seç; eğri taramalar için Otomatik döndür ve Okumadan önce temizle'yi aç.", "OCR uygula'ya tıkla: metin aranabilir, seçilebilir ve kopyalanabilir olur."] },
    { key: "sign", t: "İmzalama ve doğrulama", d: "Elle imza, sertifikalı dijital imza ve doğrulama", s: ["Elle imza için Görüntüleyici'de İmza yerleştir'i seç ve imzanı çiz.", "Sertifikalı imza için Araçlar › İmzala'yı aç, .p12 ya da .pfx dosyanı seç.", "İmzalı bir dosyayı Doğrula sekmesinde kontrol et."] },
    { key: "present", t: "Sunum modu", d: "Sunucu görünümü, tahta ve konuşmacı notları", s: ["PDF'i Görüntüleyici'de aç; F5 baştan, Shift+F5 geçerli sayfadan başlatır.", "Projeksiyon bağlıyken Alt+F5 ile Sunucu görünümünü aç.", "L lazer, P kalem, H vurgulayıcı; Esc aracı bırakır."] },
    { key: "shortcuts", t: "Kısayollar", d: "Her ekranın kendi kısayol listesi", s: ["Herhangi bir ekranda F1 ya da Ctrl+/ tuşuna bas.", "O ekranın kısayolları listelenir; Tüm kısayollar hepsini gösterir.", "Listeyi PDF olarak kaydet düğmesiyle dosyaya al."] },
    { key: "offline", t: "Çevrimdışı mod", d: "Tek anahtarla bütün bağlantıları kes", s: ["Ayarlar › Web'i aç.", "Çevrimdışı mod anahtarını aç.", "Güncellemeler, indirmeler, web araması ve çevrimiçi denetimler durur."] },
    { key: "buildFromSource", t: "Kaynaktan derleme", d: "macOS ve Linux için derleme adımları", s: ["Node 22 + pnpm, Rust ve Python 3.12 + uv kur.", "apps/desktop'ta pnpm install, sidecar'da uv sync çalıştır.", "apps/desktop'ta pnpm tauri dev ile başlat."] },
  ],
  en: [
    { key: "install", t: "Installation", d: "Installing on Windows, SmartScreen and updates", s: [`Download vivePDF_${APP_VERSION}_x64-setup.exe and run it.`, "On the SmartScreen warning, choose More info › Run anyway.", "Later releases arrive from inside the app, in small packages."] },
    { key: "openRead", t: "Open and read a PDF", d: "Tabs, search, page numbers and zoom", s: ["On Home, click Open PDF or press Ctrl+O; dropping a file onto the window works too.", "Each document opens in its own tab in the Viewer.", "Search with Ctrl+F; F3 jumps to the next match."] },
    { key: "pages", t: "Organise pages", d: "Reorder, rotate, delete, insert and split", s: ["Open the document and choose Pages in the top bar.", "Drag pages into order; rotate, duplicate or delete the selection.", "Click Apply and save: the result goes to a new file and the original stays as it was."] },
    { key: "convert", t: "Convert files", d: "From PDF to Word, Excel, PowerPoint and more", s: ["Open Tools › Convert.", "Choose From PDF or To PDF, and the target format.", "Click Convert; the new file goes to the output folder in Settings › Files."] },
    { key: "ocr", t: "OCR", d: "Make scanned pages searchable", s: ["Open Tools › OCR and pick the scanned PDF.", "Choose the languages of the text; for crooked scans turn on Auto-rotate and Clean up before reading.", "Click Run OCR: the text becomes searchable, selectable and copyable."] },
    { key: "sign", t: "Sign and verify", d: "Handwritten signatures, certificate signatures and checks", s: ["For a handwritten signature, choose Place signature in the Viewer and draw it.", "For a certificate signature, open Tools › Sign and choose your .p12 or .pfx file.", "Check a signed file in the Verify tab."] },
    { key: "present", t: "Presenter view", d: "Presenter view, boards and speaker notes", s: ["Open the PDF in the Viewer; F5 starts from the beginning, Shift+F5 from the current page.", "With a projector connected, press Alt+F5 for Presenter view.", "L laser, P pen, H highlighter; Esc puts the tool away."] },
    { key: "shortcuts", t: "Shortcuts", d: "Every screen has its own shortcut list", s: ["Press F1 or Ctrl+/ on any screen.", "That screen's shortcuts are listed; All shortcuts shows every one.", "Save the list to a file with Save as PDF."] },
    { key: "offline", t: "Offline mode", d: "Cut every connection with one switch", s: ["Open Settings › Web.", "Turn on Offline mode.", "Updates, downloads, web search and online checks stop."] },
    { key: "buildFromSource", t: "Build from source", d: "Build steps for macOS and Linux", s: ["Install Node 22 + pnpm, Rust and Python 3.12 + uv.", "Run pnpm install in apps/desktop and uv sync in sidecar.", "Start it with pnpm tauri dev in apps/desktop."] },
  ],
};
