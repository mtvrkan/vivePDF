# Third-party notices

| Component | License | Role |
|---|---|---|
| MuPDF / PyMuPDF (Artifex) | AGPL-3.0 | PDF engine |
| Tesseract OCR | Apache-2.0 | OCR engine |
| Tesseract trained data (tessdata_fast, tessdata_best) | Apache-2.0 | OCR language models |
| OCRmyPDF | MPL-2.0 | OCR pipeline |
| pdf2docx | GPL-3.0 | PDF → DOCX |
| pyHanko | MIT | Digital signatures |
| pikepdf / QPDF | MPL-2.0 / Apache-2.0 | Fast web view (linearization) when compressing |
| PDFium / EmbedPDF | BSD-3 / Apache-2.0 | In-app viewer |
| Tauri | MIT / Apache-2.0 | Desktop shell |
| Lucide icons (lucide-react; Lucide Contributors, portions © Cole Bemis as part of Feather) | ISC (Feather portions MIT) | Interface icons and the Studio icon library (icon drawings are inserted into designs and exported PDFs) |
| IBM Plex Sans / Mono | OFL-1.1 | UI typography |
| DejaVu Sans (bundled in sidecar) | Bitstream Vera / DejaVu license | Watermark text font |
| fontTools | MIT | Font subsetting during compression |
| SecLists `xato-net-10-million-passwords-100000.txt` (bundled as truncated SHA-1 digests in `sidecar/vivepdf/assets/passwords`; data by Mark Burnett, public domain) | MIT | Offline breached-password warning |
| Have I Been Pwned — Pwned Passwords range API by Troy Hunt (queried only when the user turns the online check on; only a 5-character hash prefix is sent) | CC BY 4.0 | Online breached-password count |
| LibreOffice (detected, not bundled) | MPL-2.0 | Office ⇄ PDF |
| CTranslate2 (OpenNMT) | MIT | Offline translation inference |
| SentencePiece (Google) | Apache-2.0 | Tokenizer for translation models |
| Argos Translate language models (downloaded on demand, not bundled) | per package; OPUS-MT based models CC-BY-4.0, credits in each model's `README.md` kept beside it | Offline translation |
| Piper TTS (piper-tts, Open Home Foundation) with espeak-ng | GPL-3.0-or-later | Read aloud speech synthesis |
| ONNX Runtime (Microsoft) | MIT | Runs the Piper voice models |
| Piper voice models (downloaded on demand, not bundled) | per voice, see each voice's model card | Read aloud voices |
| NumPy | BSD-3-Clause | Numeric arrays for speech and translation |
| pi-heif with libheif and libde265 | BSD-3-Clause / LGPL-3.0 | HEIF and AVIF pictures to PDF |
| zxing-cpp | Apache-2.0 | Barcode and QR code reading |
| olefile (Philippe Lagadec) | BSD-2-Clause | Reading Outlook .msg e-mails |
