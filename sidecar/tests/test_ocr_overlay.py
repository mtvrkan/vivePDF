from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.ocr import OcrParams, run_ocr
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


def _scan_of(text: str, dpi: int = 200) -> pymupdf.Pixmap:
    source = pymupdf.open()
    page = source.new_page()
    page.insert_text((60, 140), text, fontsize=30, fontfile=FONT, fontname="dv")
    pixmap = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
    source.close()
    return pixmap


@pytest.fixture
def scan(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_image(page.rect, pixmap=_scan_of("Öğrenci işleri şubesi"))
    page.insert_link(
        {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(0, 0, 50, 50), "uri": "https://example.org"}
    )
    document.set_metadata({"title": "Tarama", "author": "Arşiv"})
    path = tmp_path / "tarama ş.pdf"
    document.save(path)
    document.close()
    return path


def _image_streams(path: str) -> list[bytes]:
    with pymupdf.open(path) as document:
        return [document.xref_stream(item[0]) for item in document[0].get_images()]


def test_the_scanned_picture_is_kept_as_it_was(scan: Path, tmp_path: Path) -> None:
    result = run_ocr(
        OcrParams(path=str(scan), output=str(tmp_path / "ocr.pdf"), dpi=200),
        silent_progress(),
    )
    assert result.ocr_pages == 1
    assert result.words >= 3
    assert _image_streams(result.output) == _image_streams(str(scan))
    assert result.bytes < scan.stat().st_size * 1.5


def test_turkish_letters_come_back_searchable(scan: Path, tmp_path: Path) -> None:
    result = run_ocr(
        OcrParams(path=str(scan), output=str(tmp_path / "ocr.pdf"), languages=["tur"], dpi=300),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        text = document[0].get_text()
        assert "işleri" in text
        assert "şubesi" in text
        assert document[0].search_for("şubesi")


def test_links_metadata_and_rotation_survive(scan: Path, tmp_path: Path) -> None:
    with pymupdf.open(scan) as document:
        document[0].set_rotation(90)
        turned = tmp_path / "turned.pdf"
        document.save(turned)
    result = run_ocr(
        OcrParams(path=str(turned), output=str(tmp_path / "ocr.pdf"), dpi=150),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        assert document[0].rotation == 90
        assert document.metadata["title"] == "Tarama"
        assert document[0].get_links()


def test_a_protected_scan_stays_protected(scan: Path, tmp_path: Path) -> None:
    protected = tmp_path / "korumali.pdf"
    with pymupdf.open(scan) as document:
        document.save(
            protected, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="gizli", owner_pw="sahip"
        )
    result = run_ocr(
        OcrParams(path=str(protected), password="gizli", output=str(tmp_path / "ocr.pdf"), dpi=150),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        assert document.needs_pass
        assert document.authenticate("gizli")
        assert "subesi" in document[0].get_text().replace("ş", "s")


def _recognised(width: float, height: float, text: str) -> pymupdf.Document:
    sheet = pymupdf.open()
    page = sheet.new_page(width=width, height=height)
    page.insert_text((100, 150), text, fontsize=20, fontname="ref", fontfile=FONT)
    return sheet


def _target(rotation: int, cropped: bool) -> pymupdf.Document:
    document = pymupdf.open()
    page = document.new_page()
    if cropped:
        page.set_cropbox(pymupdf.Rect(40, 100, 500, 700))
    page.set_rotation(rotation)
    return document


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize("cropped", [False, True])
def test_hidden_words_land_where_they_are_seen(rotation: int, cropped: bool) -> None:
    from vivepdf.ops.ocr import HiddenFonts, _write_hidden_words

    reference = _target(rotation, cropped)
    reference_page = reference[0]
    reference_page.insert_text(
        pymupdf.Point(100, 150) * reference_page.derotation_matrix,
        "şubesi",
        fontsize=20,
        rotate=rotation,
        fontname="ref",
        fontfile=FONT,
    )
    expected = pymupdf.open("pdf", reference.tobytes())[0].search_for("şubesi")[0]

    document = _target(rotation, cropped)
    page = document[0]
    sheet = _recognised(page.rect.width, page.rect.height, "şubesi")
    assert _write_hidden_words(page, sheet[0], HiddenFonts()) == 1
    found = pymupdf.open("pdf", document.tobytes())[0].search_for("şubesi")
    assert found
    assert abs(found[0].x0 - expected.x0) < 2
    assert abs(found[0].y0 - expected.y0) < 2
    assert abs(found[0].x1 - expected.x1) < 3


def test_chinese_and_korean_hidden_words_are_extractable() -> None:
    from vivepdf.ops.ocr import HiddenFonts, _write_hidden_words

    words = "中文文本 한국어"
    document = pymupdf.open()
    page = document.new_page()
    cjk = pymupdf.Font("cjk")
    sheet = pymupdf.open()
    sheet_page = sheet.new_page()
    sheet_page.insert_font(fontname="ref", fontbuffer=cjk.buffer)
    sheet_page.insert_text((100, 150), words, fontsize=20, fontname="ref")
    assert _write_hidden_words(page, sheet_page, HiddenFonts()) == 2
    document.subset_fonts()
    text = pymupdf.open("pdf", document.tobytes())[0].get_text()
    assert "中文文本" in text
    assert "한국어" in text


@pytest.mark.parametrize("word", ["नमस्ते", "বাংলা", "ภาษาไทย"])
def test_devanagari_bengali_and_thai_hidden_words_are_extractable(word: str) -> None:
    from vivepdf.ops.ocr import HiddenFonts, write_hidden_words

    document = pymupdf.open()
    page = document.new_page()
    box = pymupdf.Rect(100, 130, 220, 155)
    assert write_hidden_words(page, [(box, word)], HiddenFonts()) == 1
    document.subset_fonts()
    assert word in pymupdf.open("pdf", document.tobytes())[0].get_text()


def test_huge_pages_render_at_a_capped_resolution() -> None:
    from vivepdf.ops._orientation import MAX_RENDER_PIXELS, capped_dpi

    huge = pymupdf.Rect(0, 0, 14400, 14400)
    dpi = capped_dpi(huge, 300)
    assert dpi < 300
    assert (huge.width / 72 * dpi) * (huge.height / 72 * dpi) <= MAX_RENDER_PIXELS
    assert capped_dpi(pymupdf.Rect(0, 0, 595, 842), 300) == 300
