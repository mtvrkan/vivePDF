from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.ops.editor_blocks import BlocksParams, blocks
from vivepdf.rpc.progress import silent_progress

PARAGRAPH = "Scanned paragraph that was recognised by OCR and should change."
OTHER = "Another scanned line stays."
PARAGRAPH_BOX = pymupdf.Rect(72, 100, 500, 200)


def _scan(path: Path, paper: tuple[float, float, float]) -> Path:
    source = pymupdf.open()
    page = source.new_page(width=595, height=842)
    page.draw_rect(page.rect, color=None, fill=paper)
    page.insert_textbox(PARAGRAPH_BOX, PARAGRAPH, fontsize=16, fontname="helv")
    page.insert_text((72, 300), OTHER, fontsize=16, fontname="helv")
    picture = page.get_pixmap(dpi=100)
    document = pymupdf.open()
    scanned = document.new_page(width=595, height=842)
    scanned.insert_image(scanned.rect, pixmap=picture)
    scanned.insert_textbox(PARAGRAPH_BOX, PARAGRAPH, fontsize=16, fontname="helv", render_mode=3)
    scanned.insert_text((72, 300), OTHER, fontsize=16, fontname="helv", render_mode=3)
    document.save(path)
    return path


def _photo_with_caption(path: Path) -> Path:
    stripes = pymupdf.open()
    page = stripes.new_page(width=595, height=842)
    for step in range(0, 595, 20):
        page.draw_rect(pymupdf.Rect(step, 0, step + 10, 842), color=None, fill=(0.8, 0.1, 0.1))
    picture = page.get_pixmap(dpi=50)
    document = pymupdf.open()
    target = document.new_page(width=595, height=842)
    target.insert_image(target.rect, pixmap=picture)
    target.insert_textbox(PARAGRAPH_BOX, PARAGRAPH, fontsize=16, fontname="helv")
    document.save(path)
    return path


def _rewrite(source: Path, output: Path, text: str) -> pymupdf.Page:
    listing = blocks(BlocksParams(path=str(source), page=0), silent_progress())
    paragraph = next(
        item for item in listing.blocks if item.kind == "text" and "Scanned" in item.text
    )
    apply(
        EditorApplyParams(
            path=str(source),
            output=str(output),
            objects=[
                {
                    "kind": "block",
                    "page": 1,
                    "x0": paragraph.bbox[0],
                    "y0": paragraph.bbox[1],
                    "x1": paragraph.bbox[2],
                    "y1": paragraph.bbox[3],
                    "text": text,
                    "fontSize": paragraph.size,
                    "color": paragraph.color,
                    "bold": paragraph.bold,
                    "italic": paragraph.italic,
                    "font": paragraph.font,
                    "align": paragraph.align,
                    "lineHeight": paragraph.line_height,
                }
            ],
        ),
        silent_progress(),
    )
    return pymupdf.open(output)[0]


def _ink(page: pymupdf.Page, clip: pymupdf.Rect, paper: tuple[int, int, int]) -> int:
    pixmap = page.get_pixmap(dpi=72, clip=clip, annots=False)
    return sum(
        1
        for y in range(pixmap.height)
        for x in range(pixmap.width)
        if max(abs(a - b) for a, b in zip(pixmap.pixel(x, y)[:3], paper, strict=True)) > 60
    )


def test_editing_ocr_text_on_a_scan_erases_the_scanned_words(tmp_path: Path):
    source = _scan(tmp_path / "scan.pdf", (1, 1, 1))
    page = _rewrite(source, tmp_path / "out.pdf", "")

    assert PARAGRAPH not in page.get_text()
    assert OTHER in page.get_text()
    assert _ink(page, pymupdf.Rect(72, 100, 500, 150), (255, 255, 255)) == 0
    assert _ink(page, pymupdf.Rect(72, 284, 300, 305), (255, 255, 255)) > 50


def test_the_erased_area_takes_the_colour_of_the_paper(tmp_path: Path):
    cream = (0.95, 0.9, 0.75)
    source = _scan(tmp_path / "cream.pdf", cream)
    page = _rewrite(source, tmp_path / "out.pdf", "")

    pixel = page.get_pixmap(dpi=72, clip=pymupdf.Rect(150, 110, 151, 111), annots=False).pixel(0, 0)
    assert pixel[:3] == pytest.approx([round(channel * 255) for channel in cream], abs=6)


def test_visible_text_over_a_picture_keeps_the_picture(tmp_path: Path):
    source = _photo_with_caption(tmp_path / "photo.pdf")
    page = _rewrite(source, tmp_path / "out.pdf", "")

    after = page.get_pixmap(dpi=36, clip=pymupdf.Rect(80, 105, 400, 115), annots=False)
    assert PARAGRAPH not in page.get_text()
    reds = sum(1 for x in range(after.width) if after.pixel(x, 2)[:3][1] < 80)
    assert reds > after.width // 4
