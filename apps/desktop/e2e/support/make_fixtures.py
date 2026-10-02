import json
import sys
import tempfile
from pathlib import Path

import pymupdf

from vivepdf.ops.a11y_fix import FixParams, fix
from vivepdf.ops.omr import OmrSheetParams, sheet
from vivepdf.ops.omr_layout import SheetSpec, sheet_layout
from vivepdf.rpc.progress import silent_progress

FONT_FILE = Path("C:/Windows/Fonts/arial.ttf")


def text_page(document: pymupdf.Document, lines: list[str], size: float = 18) -> pymupdf.Page:
    page = document.new_page(width=595, height=842)
    y = 90.0
    for line in lines:
        if FONT_FILE.is_file():
            page.insert_text(
                (72, y), line, fontsize=size, fontname="arial", fontfile=str(FONT_FILE)
            )
        else:
            page.insert_text((72, y), line, fontsize=size)
        y += size * 2
    return page


def save(document: pymupdf.Document, target: Path) -> None:
    document.subset_fonts()
    document.save(target, garbage=3, deflate=True)


def sample(target: Path) -> None:
    document = pymupdf.open()
    for number in range(1, 4):
        text_page(
            document, [f"Sample page {number}", f"alpha marker {number}", "The quick brown fox"]
        )
    document.set_metadata({"title": "E2E sample"})
    save(document, target)


def tagged(target: Path) -> None:
    with tempfile.TemporaryDirectory() as scratch:
        plain = Path(scratch) / "plain.pdf"
        document = pymupdf.open()
        for number in range(1, 3):
            text_page(document, [f"Tagged page {number}", "Body text of the tagged sample"])
        document.set_metadata({"title": "E2E tagged"})
        save(document, plain)
        fix(FixParams(path=str(plain), output=str(target), auto_tag=True), silent_progress())


def second(target: Path) -> None:
    document = pymupdf.open()
    for number in range(1, 3):
        text_page(document, [f"Second file page {number}"])
    save(document, target)


def contacts(target: Path) -> None:
    document = pymupdf.open()
    text_page(document, ["Visit https://vivepdf.example/docs today", "Write to help@vivepdf.example"])
    save(document, target)


def locked(target: Path) -> None:
    document = pymupdf.open()
    text_page(document, ["Locked page 1"])
    document.subset_fonts()
    document.save(
        target,
        garbage=3,
        deflate=True,
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw="secret",
        owner_pw="owner-secret",
    )


def six_pages(target: Path) -> None:
    document = pymupdf.open()
    for number in range(1, 7):
        text_page(document, [f"Split page {number}"])
    save(document, target)


def long_document(target: Path) -> None:
    document = pymupdf.open()
    for number in range(1, 401):
        document.new_page(width=595, height=842).insert_text((72, 90), f"Long page {number}", fontsize=18)
    document.save(target, garbage=3, deflate=True)


def chapters(target: Path) -> None:
    document = pymupdf.open()
    for number in range(1, 7):
        text_page(document, [f"Chapter page {number}"])
    document.set_toc([[1, "Intro", 1], [1, "Part one", 3], [2, "Section", 4], [1, "Part two", 5]])
    save(document, target)


def scanned(target: Path) -> None:
    source = pymupdf.open()
    text_page(source, ["INVOICE NUMBER 4821", "Merhaba vivePDF", "OPTICAL TEXT CHECK"], size=30)
    pixmap = source[0].get_pixmap(dpi=200, colorspace=pymupdf.csGRAY)
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=pixmap.tobytes("png"))
    document.save(target, deflate=True)


def form(target: Path) -> None:
    document = pymupdf.open()
    page = text_page(document, ["Application form", "Full name:"])
    widget = pymupdf.Widget()
    widget.field_name = "fullName"
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.rect = pymupdf.Rect(72, 150, 400, 180)
    widget.field_value = ""
    page.add_widget(widget)
    save(document, target)


def annotated(target: Path) -> None:
    document = pymupdf.open()
    page = text_page(document, ["Annotated page"])
    page.add_freetext_annot(
        pymupdf.Rect(72, 300, 460, 360),
        "LENS NOTE",
        fontsize=32,
        text_color=(0.85, 0.1, 0.1),
    )
    save(document, target)


def academic(target: Path) -> None:
    document = pymupdf.open()
    text_page(document, ["Preface", "See Chapter 2 for the results", "Back matter follows"])
    text_page(document, ["Contents"])
    text_page(document, ["Chapter 1", "The experi-", "ment was repeated twice."])
    for number in range(4, 9):
        text_page(document, [f"Body page {number}"])
    document[0].insert_link(
        {"kind": pymupdf.LINK_GOTO, "from": pymupdf.Rect(72, 112, 360, 134), "page": 5, "to": pymupdf.Point(72, 72)}
    )
    document.set_toc([[1, "Preface", 1], [1, "Chapter 1", 3], [2, "Method", 4], [1, "Chapter 2", 6]])
    document.set_page_labels(
        [
            {"startpage": 0, "prefix": "", "style": "r", "firstpagenum": 1},
            {"startpage": 2, "prefix": "", "style": "D", "firstpagenum": 1},
        ]
    )
    save(document, target)


def illustrated(target: Path) -> None:
    source = pymupdf.open()
    text_page(source, ["PICTURE WORDS 42"], size=44)
    photo = source[0].get_pixmap(dpi=150, clip=pymupdf.Rect(60, 40, 520, 110))
    document = pymupdf.open()
    page = text_page(
        document,
        ["Menu check first line", "second line of the paragraph", "", "Chapter one marker"],
    )
    page.insert_text((72, 162), "- bullet entry", fontsize=18)
    page.insert_image(pymupdf.Rect(72, 330, 492, 394), stream=photo.tobytes("jpeg"))
    text_page(document, ["Menu check second page", "Chapter two marker"])
    save(document, target)


def covers(target: Path) -> None:
    photo = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 40), False)
    for x in range(60):
        for y in range(40):
            photo.set_pixel(x, y, (60 + 2 * x, 90 + 3 * y, 210 - 2 * x))
    stream = photo.tobytes("png")
    document = pymupdf.open()
    page = text_page(document, ["Light page with a photo"])
    page.insert_image(pymupdf.Rect(150, 220, 450, 420), stream=stream)
    cover = document.new_page(width=595, height=842)
    cover.draw_rect(cover.rect, color=None, fill=(0.3, 0.05, 0.15))
    cover.insert_text((72, 200), "Dark cover", fontsize=28, color=(1, 1, 1))
    cover.insert_image(pymupdf.Rect(150, 300, 450, 500), stream=stream)
    save(document, target)


def turned(target: Path) -> None:
    document = pymupdf.open()
    page = text_page(document, ["Turned page marker", "second line on the turned page"])
    page.set_cropbox(pymupdf.Rect(30, 40, 565, 800))
    page.set_rotation(90)
    text_page(document, ["Upright page after the turned one"])
    save(document, target)


def signed(target: Path) -> None:
    from vivepdf.ops._sign_params import SignParams
    from vivepdf.ops.sign import sign
    from vivepdf.ops.sign_certificate import CreateCertificateParams, create_certificate
    from vivepdf.rpc.progress import silent_progress

    with tempfile.TemporaryDirectory() as scratch:
        unsigned = Path(scratch) / "unsigned.pdf"
        document = pymupdf.open()
        text_page(document, ["Signed agreement", "Signature check"])
        save(document, unsigned)
        certificate = create_certificate(
            CreateCertificateParams(
                output=str(Path(scratch) / "signer.p12"),
                password="fixture-signer",
                common_name="Fixture Signer",
                key_type="ec",
            ),
            silent_progress(),
        )
        sign(
            SignParams(
                path=str(unsigned),
                output=str(target),
                certificate_path=certificate.output,
                certificate_password="fixture-signer",
            ),
            silent_progress(),
        )


def commented(target: Path) -> None:
    document = pymupdf.open()
    page = text_page(document, ["Review copy", "Figure 3 shows the yearly totals"])
    note = page.add_text_annot((480, 80), "Is the figure right?")
    note.set_info(title="Ayşe")
    note.update()
    marked = page.add_highlight_annot(pymupdf.Rect(72, 112, 360, 134))
    marked.set_info(title="Can", content="Check the totals")
    marked.update()
    save(document, target)


def layered(target: Path) -> None:
    document = pymupdf.open()
    page = text_page(document, ["Site plan"])
    base = document.add_ocg("Walls", on=True)
    notes = document.add_ocg("Wiring", on=True)
    hidden = document.add_ocg("Plumbing", on=False)
    page.draw_rect(pymupdf.Rect(72, 200, 222, 350), color=(0.8, 0.1, 0.1), fill=(0.8, 0.1, 0.1), oc=base)
    page.draw_rect(pymupdf.Rect(250, 200, 400, 350), color=(0.1, 0.2, 0.8), fill=(0.1, 0.2, 0.8), oc=notes)
    page.draw_rect(pymupdf.Rect(72, 400, 222, 550), color=(0.1, 0.6, 0.2), fill=(0.1, 0.6, 0.2), oc=hidden)
    document.xref_set_key(
        document.pdf_catalog(),
        "OCProperties/D/Order",
        f"[{base} 0 R [(Services) {notes} 0 R {hidden} 0 R]]",
    )
    save(document, target)


LOGO_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
  <style>.box{fill:#e63946;stroke:#1d3557;stroke-width:4}</style>
  <rect class="box" x="20" y="20" width="160" height="100" rx="12"/>
  <text x="20" y="180" font-family="Arial" font-size="28">Merhaba şğü</text>
</svg>
"""

BADGE_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <circle cx="100" cy="100" r="80" fill="#2a9d8f"/>
  <text x="60" y="110" font-family="Arial" font-size="24">Badge</text>
</svg>
"""


def drawing(target: Path, markup: str) -> None:
    target.write_text(markup, encoding="utf-8")


def picture(target: Path, color: tuple[float, float, float], label: str) -> None:
    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    page.draw_rect(page.rect, color=color, fill=color)
    page.insert_text((40, 160), label, fontsize=40, color=(1, 1, 1))
    page.get_pixmap(dpi=72).save(target)


ANSWER_SHEET_MARKS = "ABCDABCDA"
PENCIL = (0.15, 0.15, 0.15)
FAINT = (0.7, 0.7, 0.7)


def answer_sheet(target: Path) -> None:
    with tempfile.TemporaryDirectory() as scratch:
        blank = Path(scratch) / "blank.pdf"
        params = {"output": str(blank), "questions": 10, "options": 4, "idDigits": 4, "booklets": 2}
        sheet(OmrSheetParams.model_validate(params), silent_progress())
        layout = sheet_layout(SheetSpec(questions=10, options=4, digits=4, booklets=2))
        with pymupdf.open(blank) as document:
            page = document[0]
            marks = [(layout.digit_bubbles[column][digit], PENCIL) for column, digit in enumerate([2, 0, 2, 6])]
            marks.append((layout.booklet_bubbles[1], PENCIL))
            for question, letter in enumerate(ANSWER_SHEET_MARKS):
                marks.append((layout.question_bubbles[question][ord(letter) - ord("A")], PENCIL))
            marks.append((layout.question_bubbles[2][1], PENCIL))
            marks.append((layout.question_bubbles[9][1], FAINT))
            for point, color in marks:
                page.draw_circle(point, 4.5, color=None, fill=color)
            pixmap = page.get_pixmap(dpi=150, colorspace=pymupdf.csGRAY)
    pixmap.save(target)


def japanese(target: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for row, line in enumerate(["日本語の文書です", "東京都千代田区", "縦横の文字列"]):
        page.insert_text((72, 140 + row * 90), line, fontsize=56, fontname="japan")
    document.save(target, garbage=3, deflate=True)


def memo(target: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    lines = [f"Memo line {number} keeps a small body size" for number in range(1, 9)]
    for row, line in enumerate(lines):
        if FONT_FILE.is_file():
            page.insert_text(
                (72, 100 + row * 12), line, fontsize=9, fontname="arial", fontfile=str(FONT_FILE)
            )
        else:
            page.insert_text((72, 100 + row * 12), line, fontsize=9)
    page.insert_text((72, 230), "Below the memo", fontsize=9)
    save(document, target)


def main() -> None:
    directory = Path(sys.argv[1])
    directory.mkdir(parents=True, exist_ok=True)
    files = {
        "sample": directory / "sample.pdf",
        "japanese": directory / "japanese.pdf",
        "memo": directory / "memo.pdf",
        "second": directory / "ikinci belge şğü.pdf",
        "six": directory / "six-pages.pdf",
        "chapters": directory / "chapters.pdf",
        "scanned": directory / "scanned.pdf",
        "form": directory / "form.pdf",
        "contacts": directory / "contacts.pdf",
        "locked": directory / "locked.pdf",
        "long": directory / "long.pdf",
        "annotated": directory / "annotated.pdf",
        "academic": directory / "academic.pdf",
        "illustrated": directory / "illustrated.pdf",
        "covers": directory / "covers.pdf",
        "turned": directory / "turned.pdf",
        "signed": directory / "signed.pdf",
        "commented": directory / "commented.pdf",
        "layered": directory / "layered.pdf",
        "tagged": directory / "tagged.pdf",
        "logo": directory / "logo.svg",
        "badge": directory / "badge.svg",
        "red": directory / "red.png",
        "blue": directory / "blue.png",
        "answers": directory / "answer-sheet.png",
    }
    sample(files["sample"])
    second(files["second"])
    japanese(files["japanese"])
    memo(files["memo"])
    six_pages(files["six"])
    chapters(files["chapters"])
    scanned(files["scanned"])
    form(files["form"])
    contacts(files["contacts"])
    locked(files["locked"])
    long_document(files["long"])
    annotated(files["annotated"])
    academic(files["academic"])
    illustrated(files["illustrated"])
    covers(files["covers"])
    turned(files["turned"])
    signed(files["signed"])
    commented(files["commented"])
    layered(files["layered"])
    tagged(files["tagged"])
    drawing(files["logo"], LOGO_SVG)
    drawing(files["badge"], BADGE_SVG)
    picture(files["red"], (0.8, 0.1, 0.1), "RED")
    picture(files["blue"], (0.1, 0.2, 0.8), "BLUE")
    answer_sheet(files["answers"])
    sys.stdout.write(json.dumps({key: str(value) for key, value in files.items()}))


if __name__ == "__main__":
    main()
