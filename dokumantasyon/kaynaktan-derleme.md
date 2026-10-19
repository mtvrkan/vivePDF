# Kaynaktan derleme

> vivePDF'i kaynak koddan çalıştırmak için gerekenler, geliştirme modunda açma, testleri çalıştırma ve kendi kurulum paketini derleme.

URL: https://vivepdf.com/dokumantasyon/kaynaktan-derleme/
Son güncelleme: 2026-10-18

vivePDF'i kaynak koddan derleyip çalıştırabilirsin. Hazır paketi olmayan Linux'ta ya da macOS sürümü yayımlanana kadar Mac'te uygulamayı kullanmanın yolu budur; koda katkı vermek istediğinde de buradan başlarsın.

## Depo düzeni

Kaynak kodun tamamı [GitHub'daki vivePDF deposunda](https://github.com/mtvrkan/vivePDF). Üç ana klasör var:

- `apps/desktop` — masaüstü uygulaması: Tauri 2 (Rust) kabuğu ve React 19, TypeScript ve Tailwind v4 ile yazılmış arayüz. PDF görüntüleyici EmbedPDF'tir.
- `sidecar` — PyMuPDF üzerine kurulu Python motoru. Uygulama onu ayrı bir süreç olarak başlatır; pdf2docx, OCRmyPDF, pyHanko ve Tesseract da burada kullanılır.
- `scripts` — motoru paketleyen ve sürüm derlemesini hazırlayan betikler.

## Gerekenler

- Node 22 ve pnpm 10
- Rust (stable) ve işletim sisteminin derleme araçları; macOS'ta Xcode komut satırı araçları
- Python 3.12 ya da sonrası ve uv

## Geliştirme modunda çalıştırma

1. Depoyu klonla:

   ```sh
   git clone https://github.com/mtvrkan/vivePDF.git
   cd vivePDF
   ```

2. Arayüzün bağımlılıklarını kur:

   ```sh
   cd apps/desktop
   pnpm install
   ```

3. Python motorunun ortamını hazırla. Geliştirme modundaki uygulama motoru doğrudan kaynaktan çalıştırır:

   ```sh
   cd ../../sidecar
   uv sync
   ```

4. Uygulamayı aç:

   ```sh
   cd ../apps/desktop
   pnpm tauri dev
   ```

## Testler

Her katmanın kendi testleri var. Komutları belirtilen klasörde çalıştır:

| Katman | Klasör | Komut |
|---|---|---|
| Arayüz birim testleri | `apps/desktop` | `pnpm test` |
| Tür denetimi ve lint | `apps/desktop` | `pnpm typecheck` · `pnpm lint` |
| Arayüz ve motor arasındaki RPC türleri | `apps/desktop` | `pnpm check:rpc` |
| Python motoru | `sidecar` | `uv run pytest -x -q` |
| Rust kabuğu | `apps/desktop/src-tauri` | `cargo test` |
| Uçtan uca, gerçek uygulamayla | `apps/desktop` | `pnpm e2e` |

Uçtan uca testler gerçek uygulamayı arayüzü üzerinden kullanır ve yalnızca Windows'ta çalışır; ek kurulum için `cargo install tauri-driver --locked` gerekir. Kurulum ayrıntıları, gerçek belgelerle ve büyük dosyalarla yapılan testler [docs/TESTING.md](https://github.com/mtvrkan/vivePDF/blob/main/docs/TESTING.md) dosyasında anlatılıyor.

## Kurulum paketi derleme

Kurulabilir bir paket için önce Python motorunu tek bir klasör hâlinde paketlemen gerekir. Betik motoru derler, `apps/desktop/src-tauri/binaries/engine/` altına kopyalar ve kendi denetimlerinden geçmezse durur:

```sh
scripts/build-sidecar.sh
```

Windows'ta aynı işi `scripts/build-sidecar.ps1` yapar. Sonra uygulamayı sürüm yapılandırmasıyla derle. Güncelleme imzalama anahtarın yoksa güncelleme dosyalarını kapat:

```sh
cd apps/desktop
pnpm tauri build --config src-tauri/tauri.release.conf.json --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Paketler `apps/desktop/src-tauri/target/release/bundle/` altına yazılır. Linux'ta aralarında `.deb` ve AppImage'ın da olduğu paketler çıkar; AppImage'ı başlatmadan önce `chmod +x` ile çalıştırılabilir yap.

> **Ofis dönüştürmeleri**
>
> Kendi derlediğin macOS ve Linux sürümleri Word, Excel ve PowerPoint dönüştürmeleri için sistemde kurulu LibreOffice'i kullanır. LibreOffice'i içinde taşıyan Windows kurulumu ise `scripts/build-windows-release.ps1` ile derlenir.

Resmî sürümlerin nasıl derlenip yayımlandığı, imzalama ve güncelleme kanalı [docs/RELEASING.md](https://github.com/mtvrkan/vivePDF/blob/main/docs/RELEASING.md) dosyasında. Kod lisansı için [Lisans](https://vivepdf.com/dokumantasyon/lisans/) sayfasına bak.
