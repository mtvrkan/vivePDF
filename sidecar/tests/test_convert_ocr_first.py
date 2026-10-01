import zipfile
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.convert import TextSourceParams
from vivepdf.ops.convert_text import MarkdownParams, TextParams, to_html, to_markdown, to_text
from vivepdf.ops.epub import EpubParams, to_epub
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

SIDECAR = Path(__file__).resolve().parent.parent
FONT = str(SIDECAR / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf")


def _scan_of(lines: list[str]) -> pymupdf.Pixmap:
    source = pymupdf.open()
    page = source.new_page()
    for number, line in enumerate(lines):
        page.insert_text((72, 120 + number * 40), line, fontsize=22, fontfile=FONT, fontname="dv")
    return page.get_pixmap(dpi=150)


@pytest.fixture
def scanned_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    scan = document.new_page()
    scan.insert_image(scan.rect, pixmap=_scan_of(["Taranmis sayfa metni", "Ikinci satir burada"]))
    typed = document.new_page()
    typed.insert_text((72, 100), "Yazili sayfa", fontsize=12, fontfile=FONT, fontname="dv")
    path = tmp_path / "taranmış.pdf"
    document.save(path)
    return path


def test_text_reads_scanned_pages_with_ocr_and_leaves_the_input_alone(
    scanned_pdf: Path, tmp_path: Path
) -> None:
    before = scanned_pdf.read_bytes()
    result = to_text(
        TextParams(path=str(scanned_pdf), output=str(tmp_path / "metin.txt"), ocr=True),
        silent_progress(),
    )
    text = Path(result.output).read_text(encoding="utf-8")
    assert "Taranmis" in text and "Yazili sayfa" in text
    assert result.ocr_pages == [1]
    assert result.textless_pages == []
    assert scanned_pdf.read_bytes() == before


def test_without_ocr_the_scanned_page_is_reported(scanned_pdf: Path, tmp_path: Path) -> None:
    result = to_text(
        TextParams(path=str(scanned_pdf), output=str(tmp_path / "metin.txt")), silent_progress()
    )
    assert result.ocr_pages == []
    assert result.textless_pages == [1]


def test_markdown_with_ocr_has_the_scanned_text(scanned_pdf: Path, tmp_path: Path) -> None:
    result = to_markdown(
        MarkdownParams(path=str(scanned_pdf), output=str(tmp_path / "not.md"), ocr=True),
        silent_progress(),
    )
    markdown = Path(result.output).read_text(encoding="utf-8")
    assert "Taranmis" in markdown
    assert result.ocr_pages == [1] and result.textless_pages == []


def test_html_with_ocr_keeps_the_text_and_drops_the_scan_picture(
    scanned_pdf: Path, tmp_path: Path
) -> None:
    plain = to_html(
        TextSourceParams(path=str(scanned_pdf), output=str(tmp_path / "düz.html")),
        silent_progress(),
    )
    assert "<img" in Path(plain.output).read_text(encoding="utf-8")
    read = to_html(
        TextSourceParams(path=str(scanned_pdf), output=str(tmp_path / "ocr.html"), ocr=True),
        silent_progress(),
    )
    html = Path(read.output).read_text(encoding="utf-8")
    assert "Taranmis" in html and "<img" not in html
    assert read.ocr_pages == [1]


def test_epub_with_ocr_has_text_instead_of_the_scan(scanned_pdf: Path, tmp_path: Path) -> None:
    result = to_epub(
        EpubParams(
            path=str(scanned_pdf), output=str(tmp_path / "kitap.epub"), ocr=True, cover=False
        ),
        silent_progress(),
    )
    assert result.ocr_pages == [1] and result.images == 0 and result.textless_pages == []
    with zipfile.ZipFile(result.output) as book:
        chapters = "".join(
            book.read(name).decode("utf-8") for name in book.namelist() if name.endswith(".xhtml")
        )
    assert "Taranmis" in chapters


def test_missing_language_only_matters_when_a_page_needs_ocr(
    scanned_pdf: Path, tmp_path: Path
) -> None:
    typed = tmp_path / "yazılı.pdf"
    with pymupdf.open(scanned_pdf) as document:
        document.delete_page(0)
        document.save(typed)
    result = to_text(
        TextParams(path=str(typed), output=str(tmp_path / "a.txt"), ocr=True, ocr_languages=["zz"]),
        silent_progress(),
    )
    assert result.ocr_pages == []
    with pytest.raises(OpError) as caught:
        to_text(
            TextParams(
                path=str(scanned_pdf),
                output=str(tmp_path / "b.txt"),
                ocr=True,
                ocr_languages=["zz"],
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.TESSDATA_MISSING
    assert not (tmp_path / "b.txt").exists()
