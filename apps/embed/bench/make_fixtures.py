import os
import random
import re
import sys
import zlib
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


def annotated_document(path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 100), "Highlighted words here", fontsize=24)
    page.add_highlight_annot(pymupdf.Rect(70, 78, 340, 106))
    ink = page.add_ink_annot([[(100, 200), (200, 260), (300, 200), (400, 280)]])
    ink.set_colors(stroke=(1, 0, 0))
    ink.set_border(width=4)
    ink.update()
    square = page.add_rect_annot(pymupdf.Rect(100, 320, 300, 420))
    square.set_colors(stroke=(0, 0, 1))
    square.set_border(width=3)
    square.update()
    page.add_text_annot((450, 100), "A sticky note")
    page.insert_text((72, 520), "Plain words to mark", fontsize=24)
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


def unembedded_fonts_document(path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((56, 72), "Helvetica without an embedded font", fontsize=20, fontname="helv")
    page.insert_text((56, 120), "日本語のテキスト 中文文本", fontsize=20, fontname="japan")
    page.insert_text((56, 168), "한국어 텍스트", fontsize=20, fontname="korea")
    doc.save(path)
    doc.close()


def damaged_documents(out: Path) -> None:
    book = (out / "book.pdf").read_bytes()
    (out / "truncated.pdf").write_bytes(book[: len(book) // 3])
    (out / "garbage.pdf").write_bytes(b"%PDF-1.7\n" + bytes((index * 37 + 11) % 256 for index in range(40_000)))
    (out / "notpdf.pdf").write_bytes(b"<!doctype html><title>Not found</title><p>This is a web page, not a PDF.</p>")


PAGE_CONTENT = b"BT /F1 24 Tf 72 720 Td (Corrupt corpus) Tj ET"
FONT = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"


def stream(dictionary: bytes, data: bytes, length: int | None = None) -> bytes:
    size = len(data) if length is None else length
    return b"<< " + dictionary + b" /Length " + str(size).encode() + b" >>\nstream\n" + data + b"\nendstream"


def raw_pdf(objects: list[bytes], trailer: bytes = b"/Root 1 0 R") -> bytes:
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets)
    out += b"trailer\n<< /Size " + str(len(objects) + 1).encode() + b" " + trailer + b" >>\nstartxref\n" + str(xref).encode() + b"\n%%EOF\n"
    return bytes(out)


def one_page(page_extra: bytes = b"", content: bytes = PAGE_CONTENT, pages: bytes = b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", extra: list[bytes] | None = None, catalog: bytes = b"<< /Type /Catalog /Pages 2 0 R >>", media: bytes = b"[0 0 595 842]", resources: bytes = b"<< /Font << /F1 5 0 R >> >>", contents: bytes = b"4 0 R") -> bytes:
    page = b"<< /Type /Page /Parent 2 0 R /MediaBox " + media + b" /Resources " + resources + b" /Contents " + contents + b" " + page_extra + b" >>"
    return raw_pdf([catalog, pages, page, stream(b"", content), FONT, *(extra or [])])


def handmade_corpus() -> dict[str, bytes]:
    image_page = b"<< /XObject << /Im1 6 0 R >> /Font << /F1 5 0 R >> >>"
    return {
        "hand-baseline.pdf": one_page(),
        "hand-empty.pdf": b"",
        "hand-header-only.pdf": b"%PDF-1.7\n",
        "hand-pages-cycle.pdf": raw_pdf([b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 2 >>", b"<< /Type /Pages /Parent 2 0 R /Kids [2 0 R] /Count 1 >>"]),
        "hand-pages-self.pdf": one_page(pages=b"<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >>"),
        "hand-count-huge.pdf": one_page(pages=b"<< /Type /Pages /Kids [3 0 R] /Count 2147483647 >>"),
        "hand-count-negative.pdf": one_page(pages=b"<< /Type /Pages /Kids [3 0 R] /Count -5 >>"),
        "hand-kids-many-missing.pdf": one_page(pages=b"<< /Type /Pages /Kids [3 0 R " + b" ".join(f"{n} 0 R".encode() for n in range(100, 5100)) + b"] /Count 5001 >>"),
        "hand-no-root.pdf": raw_pdf([b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [] /Count 0 >>"], trailer=b"/Info 1 0 R"),
        "hand-root-number.pdf": raw_pdf([b"42"]),
        "hand-no-pages.pdf": raw_pdf([b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [] /Count 0 >>"]),
        "hand-mediabox-zero.pdf": one_page(media=b"[0 0 0 0]"),
        "hand-mediabox-huge.pdf": one_page(media=b"[0 0 1e9 1e9]"),
        "hand-mediabox-inverted.pdf": one_page(media=b"[595 842 0 0]"),
        "hand-mediabox-strings.pdf": one_page(media=b"[(a) (b) (c) (d)]"),
        "hand-userunit-huge.pdf": one_page(page_extra=b"/UserUnit 75000"),
        "hand-rotate-odd.pdf": one_page(page_extra=b"/Rotate 47"),
        "hand-deep-arrays.pdf": one_page(content=b"[" * 200_000 + b"]" * 200_000),
        "hand-deep-resources.pdf": one_page(resources=b"<< /A " * 20_000 + b"1" + b" >>" * 20_000),
        "hand-content-garbage.pdf": one_page(content=bytes(random.Random(7).randrange(256) for _ in range(200_000))),
        "hand-content-unbalanced.pdf": one_page(content=b"q " * 100_000 + b"Q " * 3 + b"BT BT BT ET ET Tj Tj 1 2 3 re f f f"),
        "hand-content-bomb.pdf": one_page(contents=b"6 0 R", extra=[stream(b"/Filter /FlateDecode", zlib.compress(b" " * 64_000_000, 9))]),
        "hand-image-bomb.pdf": one_page(resources=image_page, content=b"q 500 0 0 700 40 60 cm /Im1 Do Q", extra=[stream(b"/Type /XObject /Subtype /Image /Width 60000 /Height 60000 /ColorSpace /DeviceRGB /BitsPerComponent 8", b"\x80" * 1024)]),
        "hand-image-short.pdf": one_page(resources=image_page, content=b"q 500 0 0 700 40 60 cm /Im1 Do Q", extra=[stream(b"/Type /XObject /Subtype /Image /Width 2000 /Height 2000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode", zlib.compress(b"\x40" * 5000))]),
        "hand-image-bad-jpeg.pdf": one_page(resources=image_page, content=b"q 500 0 0 700 40 60 cm /Im1 Do Q", extra=[stream(b"/Type /XObject /Subtype /Image /Width 800 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", b"\xff\xd8\xff\xe0" + bytes(random.Random(8).randrange(256) for _ in range(8000)))]),
        "hand-image-bad-jpx.pdf": one_page(resources=image_page, content=b"q 500 0 0 700 40 60 cm /Im1 Do Q", extra=[stream(b"/Type /XObject /Subtype /Image /Width 800 /Height 800 /Filter /JPXDecode", b"\x00\x00\x00\x0cjP  \r\n\x87\n" + bytes(random.Random(9).randrange(256) for _ in range(8000)))]),
        "hand-xobject-self.pdf": one_page(resources=b"<< /XObject << /X1 6 0 R >> >>", content=b"/X1 Do", extra=[stream(b"/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /XObject << /X1 6 0 R >> >>", b"/X1 Do")]),
        "hand-font-broken.pdf": raw_pdf([b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", stream(b"", PAGE_CONTENT), b"<< /Type /Font /Subtype /TrueType /BaseFont /Broken /FirstChar 0 /LastChar 255 /FontDescriptor 6 0 R >>", b"<< /Type /FontDescriptor /FontName /Broken /Flags 32 /FontBBox [0 0 1000 1000] /FontFile2 7 0 R >>", stream(b"", b"\x00\x01\x00\x00" + bytes(random.Random(10).randrange(256) for _ in range(6000)))]),
        "hand-length-wrong.pdf": raw_pdf([b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", stream(b"", PAGE_CONTENT, length=999_999), FONT]),
        "hand-length-negative.pdf": raw_pdf([b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", stream(b"", PAGE_CONTENT, length=-40), FONT]),
        "hand-flate-broken.pdf": one_page(contents=b"6 0 R", extra=[stream(b"/Filter /FlateDecode", zlib.compress(PAGE_CONTENT)[:12] + b"\x00garbage\xff" * 4)]),
        "hand-filter-chain.pdf": one_page(contents=b"6 0 R", extra=[stream(b"/Filter [/FlateDecode /LZWDecode /RunLengthDecode /ASCII85Decode /ASCIIHexDecode /CCITTFaxDecode /JBIG2Decode]", b"\x00" * 300)]),
        "hand-outline-cycle.pdf": one_page(catalog=b"<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R >>", extra=[b"<< /Type /Outlines /First 7 0 R /Last 7 0 R /Count 2 >>", b"<< /Title (Loop) /Parent 6 0 R /Next 7 0 R /First 7 0 R /Dest [3 0 R /XYZ 0 800 0] >>"]),
        "hand-outline-bad-dest.pdf": one_page(catalog=b"<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R >>", extra=[b"<< /Type /Outlines /First 7 0 R /Last 8 0 R /Count 2 >>", b"<< /Title (Missing page) /Parent 6 0 R /Next 8 0 R /Dest [99 0 R /XYZ 0 800 0] >>", b"<< /Title 12 /Parent 6 0 R /Prev 7 0 R /A << /S /URI /URI 5 >> >>"]),
        "hand-links-broken.pdf": one_page(page_extra=b"/Annots [6 0 R 7 0 R 8 0 R]", extra=[b"<< /Type /Annot /Subtype /Link /Rect [(x) 1 2] /Dest [3 0 R /Fit] >>", b"<< /Type /Annot /Subtype /Link /Rect [0 0 1e30 1e30] /A << /S /URI /URI (javascript:alert(1)) >> >>", b"<< /Type /Annot /Subtype /Link /Rect [10 10 200 60] /A << /S /GoTo /D [42 0 R /XYZ] >> >>"]),
        "hand-names-loop.pdf": one_page(catalog=b"<< /Type /Catalog /Pages 2 0 R /Names << /Dests 6 0 R >> >>", page_extra=b"/Annots [7 0 R]", extra=[b"<< /Kids [6 0 R] >>", b"<< /Type /Annot /Subtype /Link /Rect [10 10 200 60] /Dest (nowhere) >>"]),
        "hand-form-loop.pdf": one_page(catalog=b"<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] >> >>", page_extra=b"/Annots [6 0 R]", extra=[b"<< /Type /Annot /Subtype /Widget /FT /Tx /T (a) /Rect [50 50 300 80] /Parent 6 0 R /Kids [6 0 R] /V (x) /P 3 0 R >>"]),
        "hand-encrypt-broken.pdf": raw_pdf([b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>", b"<< /Filter /Standard /V 9 /R 77 /O (x) /U (y) /P -1 >>"], trailer=b"/Root 1 0 R /Encrypt 4 0 R /ID [(a) (a)]"),
    }


def structural_variants(name: str, data: bytes) -> dict[str, bytes]:
    stem = name.removesuffix(".pdf")
    xref = data.rfind(b"xref\n")
    start = data.rfind(b"startxref")
    table = data[xref:start]
    garbled = re.sub(rb"(\d{10}) 00000 n", lambda m: f"{(int(m.group(1)) * 7919) % len(data):010d} 00000 n".encode(), table)
    return {
        f"{stem}-no-xref.pdf": data[:xref] + b"%%EOF\n",
        f"{stem}-xref-garbled.pdf": data[:xref] + garbled + data[start:],
        f"{stem}-startxref-wrong.pdf": data[:start] + b"startxref\n123456789\n%%EOF\n",
        f"{stem}-no-trailer.pdf": data[: data.rfind(b"trailer")],
        f"{stem}-no-header.pdf": data[data.find(b"\n") + 1 :],
        f"{stem}-header-late.pdf": b"\x00" * 3000 + data,
        f"{stem}-twice.pdf": data + data,
    }


def mutated_variants(name: str, data: bytes, seed: int) -> dict[str, bytes]:
    stem = name.removesuffix(".pdf")
    rng = random.Random(seed)
    variants: dict[str, bytes] = {}
    for percent in (5, 20, 50, 80, 95, 99):
        variants[f"{stem}-cut{percent:02d}.pdf"] = data[: len(data) * percent // 100]
    for round_index in range(8):
        flipped = bytearray(data)
        for _ in range(max(1, len(data) // 500)):
            flipped[rng.randrange(len(flipped))] = rng.randrange(256)
        variants[f"{stem}-flip{round_index}.pdf"] = bytes(flipped)
    for round_index in range(4):
        holed = bytearray(data)
        start = rng.randrange(len(holed) // 10, len(holed))
        holed[start : start + rng.randrange(64, 4096)] = b""
        variants[f"{stem}-hole{round_index}.pdf"] = bytes(holed)
    return variants


def corrupt_corpus(out: Path, sources: list[Path]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    corpus = handmade_corpus()
    for seed, source in enumerate(sources):
        data = source.read_bytes()
        corpus |= structural_variants(source.name, data)
        corpus |= mutated_variants(source.name, data, seed)
    for name, data in corpus.items():
        (out / name).write_bytes(data)
    print(f"corrupt/: {len(corpus)} files")


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    text_document(out / "small.pdf", 2)
    text_document(out / "book.pdf", 500)
    links_document(out / "links.pdf")
    annotated_document(out / "annotated.pdf")
    scan_document(out / "scan.pdf", 20)
    locked_document(out / "locked.pdf")
    unembedded_fonts_document(out / "fonts.pdf")
    damaged_documents(out)
    corrupt_corpus(out / "corrupt", [out / "small.pdf", out / "links.pdf"])
    for item in sorted(out.glob("*.pdf")):
        print(f"{item.name}: {item.stat().st_size / 1_048_576:.1f} MB")


if __name__ == "__main__":
    main()
