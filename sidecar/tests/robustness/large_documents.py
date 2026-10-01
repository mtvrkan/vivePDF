import argparse
import io
import random
from pathlib import Path

import pymupdf
from PIL import Image, ImageFilter

from vivepdf.ops._watermark_style import WATERMARK_FONT

DEFAULT_TARGET = Path(__file__).resolve().parents[3] / ".corpus" / "large"
THESIS_PAGES = 800
SCAN_PAGES = 240
SCAN_DPI = 300
SCAN_QUALITY = 88
VOCABULARY = (
    "öğrenci ders notları sınav çalışma yöntem araştırma sonuç tartışma kaynak bölüm "
    "şekil tablo veri analiz model deney gözlem hipotez literatür kuram uygulama "
    "değerlendirme İstanbul Ankara İzmir üniversite fakülte bilgisayar mühendisliği"
)
WORDS = VOCABULARY.split()


def _paragraph(generator: random.Random, words: int) -> str:
    chosen = [generator.choice(WORDS) for _ in range(words)]
    return (" ".join(chosen) + ".").capitalize()


def _chart(page: pymupdf.Page, generator: random.Random, top: float) -> None:
    shape = page.new_shape()
    shape.draw_line((90, top + 180), (520, top + 180))
    shape.draw_line((90, top), (90, top + 180))
    shape.finish(color=(0, 0, 0), width=0.8)
    for index in range(24):
        height = generator.uniform(20, 170)
        x = 100 + index * 17
        shape.draw_rect(pymupdf.Rect(x, top + 180 - height, x + 12, top + 180))
    shape.finish(color=(0.1, 0.3, 0.7), fill=(0.4, 0.6, 0.9), width=0.4)
    shape.commit()


def _photo(generator: random.Random) -> bytes:
    image = Image.effect_noise((640, 400), generator.uniform(40, 80)).convert("RGB")
    buffer = io.BytesIO()
    image.filter(ImageFilter.GaussianBlur(2)).save(buffer, "JPEG", quality=80)
    return buffer.getvalue()


def thesis(target: Path, pages: int = THESIS_PAGES) -> Path:
    generator = random.Random(2026)
    document = pymupdf.open()
    toc = []
    photo = _photo(generator)
    for number in range(1, pages + 1):
        page = document.new_page(width=595, height=842)
        page.insert_font(fontname="dejavu", fontfile=str(WATERMARK_FONT))
        top = 72.0
        if number % 40 == 1:
            chapter = number // 40 + 1
            title = f"Bölüm {chapter}: {_paragraph(generator, 4)[:-1]}"
            page.insert_text((72, top + 20), title, fontsize=20, fontname="dejavu")
            toc.append([1, title, number])
            top += 50
        if number % 20 == 7:
            _chart(page, generator, top)
            page.insert_text(
                (72, top + 205), f"Şekil {number}.1 Ölçüm sonuçları", fontsize=10, fontname="dejavu"
            )
            top += 220
        if number % 50 == 13:
            page.insert_image(pymupdf.Rect(72, top, 523, top + 280), stream=photo)
            top += 295
        body = "\n\n".join(_paragraph(generator, generator.randint(40, 70)) for _ in range(6))
        page.insert_textbox(
            pymupdf.Rect(72, top, 523, 790), body, fontsize=11, fontname="dejavu", lineheight=1.4
        )
        page.insert_text((290, 815), str(number), fontsize=9, fontname="dejavu")
    document.set_toc(toc)
    document.subset_fonts()
    path = target / "tez-800-sayfa.pdf"
    document.save(path, garbage=3, deflate=True)
    document.close()
    return path


def scan(target: Path, source: Path, pages: int = SCAN_PAGES) -> Path:
    generator = random.Random(1923)
    with pymupdf.open(source) as original:
        document = pymupdf.open()
        for index in range(pages):
            pixmap = original[index % original.page_count].get_pixmap(
                dpi=SCAN_DPI, colorspace=pymupdf.csGRAY
            )
            image = Image.frombytes("L", (pixmap.width, pixmap.height), pixmap.samples)
            grain = Image.effect_noise(image.size, 18).point(lambda value: value - 128)
            paper = Image.eval(image, lambda value: min(250, value))
            noisy = Image.blend(paper, grain.convert("L"), 0.08).rotate(
                generator.uniform(-0.8, 0.8), fillcolor=240
            )
            buffer = io.BytesIO()
            noisy.save(buffer, "JPEG", quality=SCAN_QUALITY)
            page = document.new_page(width=595, height=842)
            page.insert_image(page.rect, stream=buffer.getvalue())
        path = target / "taranmis-kitap.pdf"
        document.save(path)
        document.close()
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the large-document performance corpus.")
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    arguments = parser.parse_args()
    arguments.target.mkdir(parents=True, exist_ok=True)
    built = thesis(arguments.target)
    scanned = scan(arguments.target, built)
    for path in (built, scanned):
        print(f"{path.name}: {path.stat().st_size / 1_000_000:.1f} MB")


if __name__ == "__main__":
    main()
