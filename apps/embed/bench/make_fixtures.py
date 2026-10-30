import os
import sys
from pathlib import Path

import pymupdf

FONT_FILE = Path(__file__).resolve().parents[3] / "sidecar" / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"

LOCKED_PASSWORD = "vive-2026"

PARAGRAPH = (
    "vivePDF web viewer benchmark text. The quick brown fox jumps over the lazy dog. "
    "Çalışkan öğrenciler şiir okuyor, ılık rüzgâr ağaçları sallıyor. "
) * 6


def text_document(path: Path, pages: int) -> None:
    doc = pymupdf.open()
    for number in range(pages):
        page = doc.new_page(width=595, height=842)
        page.insert_font(fontname="dejavu", fontfile=str(FONT_FILE))
        page.insert_text((56, 72), f"Chapter {number + 1}", fontsize=20, fontname="dejavu")
        box = pymupdf.Rect(56, 96, 539, 786)
        page.insert_textbox(box, PARAGRAPH * 3, fontsize=10, lineheight=1.4, fontname="dejavu")
        shape = page.new_shape()
        for step in range(12):
            shape.draw_line((56 + step * 40, 800), (96 + step * 40, 820))
        shape.finish(color=(0.2, 0.3, 0.6), width=0.8)
        shape.commit()
    doc.set_toc([[1, f"Chapter {n + 1}", n + 1] for n in range(pages)])
    doc.save(path, garbage=3, deflate=True)
    doc.close()


def links_document(path: Path) -> None:
    doc = pymupdf.open()
    for number in range(3):
        page = doc.new_page(width=595, height=842)
        page.insert_font(fontname="dejavu", fontfile=str(FONT_FILE))
        page.insert_text((56, 72), f"Bağlantılar {number + 1}", fontsize=20, fontname="dejavu")
    first = doc[0]
    rows = [
        ("Üçüncü sayfaya git", {"kind": pymupdf.LINK_GOTO, "page": 2, "to": pymupdf.Point(0, 0)}),
        ("vivePDF web sitesi", {"kind": pymupdf.LINK_URI, "uri": "https://vivepdf.com/"}),
        ("E-posta gönder", {"kind": pymupdf.LINK_URI, "uri": "mailto:info@example.com"}),
        ("Zararlı bağlantı", {"kind": pymupdf.LINK_URI, "uri": "javascript:alert(1)"}),
    ]
    for index, (label, link) in enumerate(rows):
        top = 120 + index * 48
        first.insert_text((56, top + 20), label, fontsize=16, fontname="dejavu", color=(0.1, 0.3, 0.7))
        first.insert_link({**link, "from": pymupdf.Rect(52, top, 320, top + 28)})
    doc.save(path, garbage=3, deflate=True)
    doc.close()


def scan_document(path: Path, pages: int) -> None:
    doc = pymupdf.open()
    for _ in range(pages):
        width, height = 1700, 2400
        pix = pymupdf.Pixmap(pymupdf.csRGB, width, height, os.urandom(width * height * 3), False)
        image = pix.tobytes("jpeg", jpg_quality=70)
        page = doc.new_page(width=595, height=842)
        page.insert_image(page.rect, stream=image)
    doc.save(path, garbage=3)
    doc.close()


def locked_document(path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="dejavu", fontfile=str(FONT_FILE))
    page.insert_text((56, 72), "Kilitli belge", fontsize=20, fontname="dejavu")
    doc.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=LOCKED_PASSWORD, owner_pw=LOCKED_PASSWORD + "-owner")
    doc.close()


def damaged_documents(out: Path) -> None:
    book = (out / "book.pdf").read_bytes()
    (out / "truncated.pdf").write_bytes(book[: len(book) // 3])
    (out / "garbage.pdf").write_bytes(b"%PDF-1.7\n" + bytes((index * 37 + 11) % 256 for index in range(40_000)))
    (out / "notpdf.pdf").write_bytes(b"<!doctype html><title>Not found</title><p>This is a web page, not a PDF.</p>")


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    text_document(out / "small.pdf", 2)
    text_document(out / "book.pdf", 500)
    links_document(out / "links.pdf")
    scan_document(out / "scan.pdf", 20)
    locked_document(out / "locked.pdf")
    damaged_documents(out)
    for item in sorted(out.glob("*.pdf")):
        print(f"{item.name}: {item.stat().st_size / 1_048_576:.1f} MB")


if __name__ == "__main__":
    main()
