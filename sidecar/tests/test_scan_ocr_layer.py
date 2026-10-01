import io
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw

from vivepdf.ops.scan import EnhanceParams, enhance, turned_words
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)
PHRASE = "Öğrenci işleri şubesi arşiv kaydı"


def _paper(tilt: float = 0.0) -> bytes:
    image = Image.new("RGB", (1190, 1684), (232, 228, 220))
    draw = ImageDraw.Draw(image)
    for row in range(200, 1500, 44):
        draw.rectangle((140, row, 1050, row + 12), fill=(20, 20, 20))
    if tilt:
        image = image.rotate(tilt, fillcolor=(232, 228, 220))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


def _ocr_scan(path: Path, tilt: float = 0.0, visible: bool = False) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=_paper(tilt))
    page.insert_text(
        (100, 150),
        PHRASE,
        fontsize=14,
        fontname="dv",
        fontfile=FONT,
        render_mode=0 if visible else 3,
    )
    document.save(path)
    document.close()
    return path


def test_an_ocr_scan_is_enhanced_and_stays_searchable(tmp_path: Path) -> None:
    source = _ocr_scan(tmp_path / "scan.pdf")
    with pymupdf.open(source) as document:
        expected = document[0].search_for("şubesi")[0]
    result = enhance(
        EnhanceParams(path=str(source), output=str(tmp_path / "out.pdf"), dpi=100, deskew=False),
        silent_progress(),
    )
    assert result.enhanced_pages == 1
    assert result.skipped_pages == 0
    assert result.ocr_kept_pages == 1
    with pymupdf.open(result.output) as document:
        found = document[0].search_for("şubesi")
        assert found
        assert abs(found[0].x0 - expected.x0) < 2
        assert abs(found[0].y0 - expected.y0) < 2
        assert all(span["type"] == 3 for span in document[0].get_texttrace())


def test_a_straightened_scan_keeps_its_words(tmp_path: Path) -> None:
    source = _ocr_scan(tmp_path / "tilted.pdf", tilt=2.5)
    result = enhance(
        EnhanceParams(path=str(source), output=str(tmp_path / "out.pdf"), dpi=100),
        silent_progress(),
    )
    assert result.deskewed_pages == 1
    assert result.ocr_kept_pages == 1
    with pymupdf.open(result.output) as document:
        assert "arşiv" in document[0].get_text()


def test_a_page_with_visible_text_is_still_left_alone(tmp_path: Path) -> None:
    source = _ocr_scan(tmp_path / "typed.pdf", visible=True)
    result = enhance(
        EnhanceParams(path=str(source), output=str(tmp_path / "out.pdf"), dpi=100),
        silent_progress(),
    )
    assert result.skipped_pages == 1
    assert result.ocr_kept_pages == 0


def test_words_turn_with_the_page() -> None:
    area = pymupdf.Rect(0, 0, 200, 100)
    word = (pymupdf.Rect(145, 45, 155, 55), "x")
    [(box, text)] = turned_words([word], area, 10)
    assert text == "x"
    assert abs((box.x0 + box.x1) / 2 - 149.24) < 0.05
    assert abs((box.y0 + box.y1) / 2 - 41.32) < 0.05
