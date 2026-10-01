import base64
import html as html_module
import io
import threading
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree

import pymupdf
import pytest

from vivepdf.ops import _page_images, convert_images, epub
from vivepdf.ops._markup import PageMarkup, inert_markdown, retag_headings, xml_safe
from vivepdf.ops.convert import ExtractImagesParams, TextSourceParams, extract_images
from vivepdf.ops.convert_images import ImagesParams, page_dpi, to_images
from vivepdf.ops.convert_text import MarkdownParams, TextParams, to_html, to_markdown, to_text
from vivepdf.ops.epub import EpubParams, cover_image, limit_chapters, plan_chapters, to_epub
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress

SIDECAR = Path(__file__).resolve().parent.parent
FONT = str(SIDECAR / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf")
OPF = "{http://www.idpf.org/2007/opf}"
DC = "{http://purl.org/dc/elements/1.1/}"


def _write(page: pymupdf.Page, point: tuple[float, float], text: str, size: float = 12) -> None:
    page.insert_text(point, text, fontsize=size, fontname="dejavu", fontfile=FONT)


def _save(document: pymupdf.Document, path: Path) -> Path:
    document.save(path)
    document.close()
    return path


@pytest.fixture
def columns_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    _write(page, (50, 80), "Sol sütun birinci satır")
    _write(page, (50, 95), "Sol sütun ikinci satır")
    _write(page, (320, 80), "Sağ sütun birinci")
    _write(page, (320, 95), "Sağ sütun ikinci")
    _write(page, (50, 140), "Ad          Adet    Fiyat")
    _write(page, (50, 300), "Kontrol \x01 karakteri")
    document.new_page(width=595, height=842)
    return _save(document, tmp_path / "sütunlar.pdf")


@pytest.fixture
def book_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for number in range(3):
        page = document.new_page(width=595, height=842)
        _write(page, (72, 90), f"Bölüm {number + 1}", 20)
        for line in range(5):
            _write(page, (72, 130 + line * 16), f"Gövde metni satır {line + 1} ve {number}", 12)
    document.new_page(width=595, height=842)
    document.xref_set_key(document.pdf_catalog(), "Lang", "(de-DE)")
    return _save(document, tmp_path / "kitap.pdf")


def _cancelling(predicate) -> Progress:
    cancel = threading.Event()
    events: list[tuple[float, str | None, dict | None]] = []

    def sink(value, message, detail):
        events.append((value, message, detail))
        if predicate(events):
            cancel.set()

    return Progress(sink, cancel)


def test_plain_text_keeps_columns_in_reading_order(columns_pdf: Path, tmp_path: Path) -> None:
    result = to_text(
        TextParams(path=str(columns_pdf), output=str(tmp_path / "düz.txt")), silent_progress()
    )
    raw = Path(result.output).read_bytes()
    assert b"\r\n" not in raw
    text = raw.decode("utf-8")
    lines = [line for line in text.splitlines() if line.strip()]
    assert lines.index("Sol sütun ikinci satır") < lines.index("Sağ sütun birinci")
    assert "\x01" not in text
    assert result.textless_pages == [2]


def test_layout_text_puts_columns_side_by_side(columns_pdf: Path, tmp_path: Path) -> None:
    result = to_text(
        TextParams(path=str(columns_pdf), output=str(tmp_path / "düzen.txt"), layout=True),
        silent_progress(),
    )
    text = Path(result.output).read_text(encoding="utf-8")
    first = next(line for line in text.splitlines() if "Sol sütun birinci" in line)
    assert "Sağ sütun birinci" in first
    assert first.index("Sağ") > first.index("satır") + 5
    assert "Ad          Adet    Fiyat" in text
    assert result.textless_pages == [2]


def test_xml_safe_drops_only_characters_xml_cannot_hold() -> None:
    assert xml_safe("a&#x1;b&#0;c&#xFFFF;d\x02e") == "abcde"
    assert xml_safe("&#x41;&#233;&#x1F600;&amp;") == "&#x41;&#233;&#x1F600;&amp;"


def test_markdown_markup_from_the_page_text_is_made_inert() -> None:
    source = "\n".join(
        [
            "Metin <script>alert(1)</script> ve <img src=x onerror=y>",
            "a < b ve 2<3",
            "<sup>1</sup> <u>altı</u> <mark>işaret</mark> satır<br>",
            "<!-- Start of picture text -->",
            "`<kod>` satır içi",
            "```",
            "<blok>kod</blok>",
            "```",
            "<!-- gizli -->",
        ]
    )
    lines = inert_markdown(source).split("\n")
    assert lines[0] == "Metin &lt;script>alert(1)&lt;/script> ve &lt;img src=x onerror=y>"
    assert lines[1] == "a < b ve 2<3"
    assert lines[2] == "<sup>1</sup> <u>altı</u> <mark>işaret</mark> satır<br>"
    assert lines[3] == "<!-- Start of picture text -->"
    assert lines[4] == "`<kod>` satır içi"
    assert lines[6] == "<blok>kod</blok>"
    assert lines[8] == "&lt;!-- gizli -->"


def test_markdown_never_runs_the_bundled_ocr_lookup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pymupdf4llm.helpers import document_layout

    def refuse(*_args, **_kwargs):
        raise AssertionError("OCR lookup must not run")

    monkeypatch.setattr(pymupdf, "get_tessdata", refuse)
    monkeypatch.setattr(document_layout, "select_ocr_function", refuse)
    document = pymupdf.open()
    _write(document.new_page(), (72, 100), "Başlık <script>x</script>", 14)
    scanned = document.new_page()
    picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), 0)
    picture.clear_with(120)
    scanned.insert_image(pymupdf.Rect(72, 72, 272, 272), pixmap=picture)
    source = _save(document, tmp_path / "tarama.pdf")
    result = to_markdown(
        MarkdownParams(path=str(source), output=str(tmp_path / "çıktı.md")), silent_progress()
    )
    text = Path(result.output).read_text(encoding="utf-8")
    assert "&lt;script>" in text and "<script>" not in text
    assert result.textless_pages == [2]
    assert b"\r\n" not in Path(result.output).read_bytes()


def test_html_headings_follow_the_body_size_and_carry_the_language(
    book_pdf: Path, tmp_path: Path
) -> None:
    result = to_html(
        TextSourceParams(path=str(book_pdf), output=str(tmp_path / "kitap.html")),
        silent_progress(),
    )
    html = html_module.unescape(Path(result.output).read_text(encoding="utf-8"))
    assert html.startswith('<!doctype html><html lang="de-DE">')
    assert html.count('id="page') == 0
    assert "<h1>Bölüm 1</h1>" in html
    assert "<h3>Gövde" not in html
    assert "<p>Gövde metni satır 1 ve 0" in html
    assert result.textless_pages == [4]


def test_html_drops_control_character_references(columns_pdf: Path, tmp_path: Path) -> None:
    result = to_html(
        TextSourceParams(path=str(columns_pdf), output=str(tmp_path / "s.html")), silent_progress()
    )
    html = Path(result.output).read_text(encoding="utf-8")
    assert "&#x1;" not in html and "\x01" not in html
    assert "Kontrol" in html


def test_retag_keeps_the_markup_when_blocks_do_not_line_up() -> None:
    page = PageMarkup('<div id="page0">\n<h3>a</h3>\n</div>', [(12.0, 1), (12.0, 1)], Counter())
    assert retag_headings(page, 12.0) == page.markup
    single = PageMarkup("<h3>a</h3><p>bb</p>", [(12.0, 1), (24.0, 2)], Counter())
    assert retag_headings(single, 12.0) == "<p>a</p><h1>bb</h1>"


def _read_epub(path: str) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def test_epub_takes_the_document_language_and_leaves_no_author_blank(
    book_pdf: Path, tmp_path: Path
) -> None:
    result = to_epub(
        EpubParams(path=str(book_pdf), output=str(tmp_path / "kitap.epub"), language="tr"),
        silent_progress(),
    )
    files = _read_epub(result.output)
    package = ElementTree.fromstring(files["OEBPS/content.opf"])
    metadata = package.find(f"{OPF}metadata")
    assert metadata is not None
    assert metadata.findtext(f"{DC}language") == "de-DE"
    assert metadata.find(f"{DC}creator") is None
    chapter = html_module.unescape(files["OEBPS/text/chapter0001.xhtml"].decode("utf-8"))
    assert "<h1>Bölüm 1</h1>" in chapter
    assert "<h3>" not in chapter
    assert result.textless_pages == [4]


def test_epub_chapters_are_valid_xml_despite_control_characters(
    columns_pdf: Path, tmp_path: Path
) -> None:
    result = to_epub(
        EpubParams(path=str(columns_pdf), output=str(tmp_path / "s.epub"), cover=False),
        silent_progress(),
    )
    chapter = _read_epub(result.output)["OEBPS/text/chapter0001.xhtml"].decode("utf-8")
    ElementTree.fromstring(chapter.split("<!DOCTYPE html>\n", 1)[1])
    assert "Kontrol" in chapter


def test_epub_bookmarks_are_ordered_by_page_and_merged_per_start(tmp_path: Path) -> None:
    document = pymupdf.open()
    for number in range(6):
        _write(document.new_page(), (72, 100), f"Sayfa {number + 1}")
    document.set_toc([[1, "Son", 5], [1, "Baş", 1], [1, "İkiz", 5], [1, "Orta", 3]])
    source = _save(document, tmp_path / "karışık.pdf")
    with pymupdf.open(source) as opened:
        planned = plan_chapters(opened, list(range(6)), "auto")
    assert planned == [("Baş", [0, 1]), ("Orta", [2, 3]), ("Son", [4, 5])]


def test_epub_merges_chapters_beyond_the_limit_without_losing_pages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(epub, "MAX_CHAPTERS", 4)
    planned = [(f"b{index}", [index]) for index in range(10)]
    limited = limit_chapters(planned)
    assert len(limited) <= 4
    assert [index for _title, block in limited for index in block] == list(range(10))
    assert limited[0][0] == "b0"


def test_epub_cover_of_a_wide_page_stays_within_bounds(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=3000, height=200)
    cover = pymupdf.Pixmap(cover_image(page))
    assert cover.width <= epub.COVER_SIDE + 1
    assert cover.height <= epub.COVER_SIDE + 1


def test_epub_turns_pictures_outside_the_core_types_into_png() -> None:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), (200, 10, 10)).save(buffer, format="BMP")
    body = (
        f'<p><img src="data:image/bmp;base64,{base64.b64encode(buffer.getvalue()).decode()}"/></p>'
    )
    images: dict[str, epub._Image] = {}
    replaced = epub.extract_images(body, images, keep=True)
    (image,) = images.values()
    assert image.media_type == "image/png"
    assert image.name.endswith(".png")
    assert image.payload.startswith(b"\x89PNG")
    assert f"../images/{image.name}" in replaced


def test_epub_without_any_text_or_picture_says_so(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page()
    source = _save(document, tmp_path / "boş.pdf")
    with pytest.raises(OpError) as caught:
        to_epub(EpubParams(path=str(source), output=str(tmp_path / "b.epub")), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "noText"}


def test_epub_failed_write_leaves_nothing_behind(
    book_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(*_args, **_kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(epub, "content_opf", broken)
    target = tmp_path / "yarım.epub"
    with pytest.raises(RuntimeError):
        to_epub(EpubParams(path=str(book_pdf), output=str(target)), silent_progress())
    assert list(tmp_path.glob("*.epub")) == []
    assert list(tmp_path.glob(".vivepdf-*")) == []


def test_page_dpi_stays_under_the_side_and_pixel_limits() -> None:
    assert page_dpi(pymupdf.Rect(0, 0, 595, 842), 300, "png") == 300
    wide = page_dpi(pymupdf.Rect(0, 0, 2400, 400), 600, "webp")
    assert 2400 * wide / 72 <= convert_images.MAX_IMAGE_SIDE["webp"]
    huge = page_dpi(pymupdf.Rect(0, 0, 3370, 4768), 600, "png")
    assert (3370 * huge / 72) * (4768 * huge / 72) <= _page_images.MAX_PAGE_PIXELS


def test_images_lower_the_resolution_of_oversized_pages(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(_page_images, "MAX_PAGE_PIXELS", 40_000)
    document = pymupdf.open()
    _write(document.new_page(width=100, height=100), (10, 50), "küçük")
    _write(document.new_page(width=400, height=400), (10, 50), "büyük")
    source = _save(document, tmp_path / "boyut.pdf")
    result = to_images(
        ImagesParams(path=str(source), output_dir=str(tmp_path / "resimler"), dpi=144),
        silent_progress(),
    )
    assert result.reduced_pages == [2]
    small, large = (pymupdf.Pixmap(path) for path in result.outputs)
    assert small.width == 200
    assert large.width * large.height <= 40_000 * 1.05


def test_extract_images_never_overwrites_and_cleans_up_on_cancel(tmp_path: Path) -> None:
    document = pymupdf.open()
    for shade in (40, 90, 160):
        page = document.new_page()
        picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 100, 100), 0)
        picture.clear_with(shade)
        page.insert_image(pymupdf.Rect(72, 72, 272, 272), pixmap=picture)
    source = _save(document, tmp_path / "görseller.pdf")
    folder = tmp_path / "çıkan"
    first = extract_images(
        ExtractImagesParams(path=str(source), output_dir=str(folder)), silent_progress()
    )
    assert first.count == 3 and first.bytes == sum(Path(p).stat().st_size for p in first.outputs)
    before = {path: Path(path).read_bytes() for path in first.outputs}
    second = extract_images(
        ExtractImagesParams(path=str(source), output_dir=str(folder)), silent_progress()
    )
    assert all(" (2)." in Path(path).name for path in second.outputs)
    assert {path: Path(path).read_bytes() for path in first.outputs} == before

    fresh = tmp_path / "iptal"
    with pytest.raises(OpError) as caught:
        extract_images(
            ExtractImagesParams(path=str(source), output_dir=str(fresh)),
            _cancelling(lambda events: True),
        )
    assert caught.value.code == ErrorCode.CANCELLED
    assert list(fresh.iterdir()) == []
