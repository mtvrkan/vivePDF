from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.page_geometry import CropParams, Insets, crop_pages
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


def _labelled(tmp_path: Path, media: str, rotation: int = 0, crop: str | None = None) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    document.xref_set_key(page.xref, "MediaBox", media)
    if crop:
        document.xref_set_key(page.xref, "CropBox", crop)
    page = document.reload_page(page)
    page.set_rotation(rotation)
    rect = page.rect
    for label, y in (
        ("INTOP", 15),
        ("KEEPTOP", 60),
        ("KEEPBOTTOM", rect.height - 50),
        ("INBOTTOM", rect.height - 8),
    ):
        point = pymupdf.Point(rect.width / 2, y) * page.derotation_matrix
        page.insert_text(point, label, fontsize=7, rotate=rotation)
    path = tmp_path / "labelled.pdf"
    document.save(path)
    document.close()
    return path


def _all_words(path: Path) -> list[str]:
    with pymupdf.open(path) as document:
        page = document[0]
        document.xref_set_key(page.xref, "CropBox", "null")
        page = document.reload_page(page)
        return sorted(word[4] for word in page.get_text("words"))


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize(
    ("media", "crop"),
    [("[20 50 620 850]", None), ("[20 50 620 850]", "[40 60 610 845]")],
)
def test_removing_content_on_shifted_boxes_erases_exactly_the_cut_bands(
    tmp_path: Path, rotation: int, media: str, crop: str | None
):
    source = _labelled(tmp_path, media, rotation, crop)
    target = tmp_path / "out.pdf"

    crop_pages(
        CropParams(
            path=str(source),
            output=str(target),
            insets=Insets(top=40, bottom=30),
            remove_content=True,
        ),
        silent_progress(),
    )

    assert _all_words(target) == ["KEEPBOTTOM", "KEEPTOP"]


def test_a_crop_box_larger_than_the_page_is_clipped_before_cropping(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.insert_text((300, 400), "MIDDLE", fontsize=12)
    document.xref_set_key(page.xref, "CropBox", "[-20 -20 700 900]")
    source = tmp_path / "oversized.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "out.pdf"

    result = crop_pages(
        CropParams(
            path=str(source),
            output=str(target),
            insets=Insets(left=10, top=10, right=10, bottom=10),
            remove_content=True,
        ),
        silent_progress(),
    )

    assert result.cropped == 1
    with pymupdf.open(target) as document:
        assert document.xref_get_key(document[0].xref, "CropBox") == ("array", "[10 10 590 790]")
        assert "MIDDLE" in document[0].get_text()


def test_auto_crop_keeps_annotations_outside_the_page_content(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.draw_rect(pymupdf.Rect(200, 300, 400, 500), fill=(0, 0, 0))
    note = page.add_freetext_annot(pymupdf.Rect(60, 60, 180, 90), "not", fontsize=14)
    note.update()
    source = tmp_path / "noted.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "out.pdf"

    crop_pages(
        CropParams(path=str(source), output=str(target), mode="auto", auto_margin=0),
        silent_progress(),
    )

    with pymupdf.open(target) as document:
        visible = document[0].cropbox
    assert visible.x0 <= 62 and visible.y0 <= 62
    assert visible.x1 >= 398 and visible.y1 >= 498


def test_auto_crop_finds_content_on_tinted_paper(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.draw_rect(page.rect, fill=(0.93, 0.9, 0.8), width=0)
    page.draw_rect(pymupdf.Rect(150, 250, 445, 560), fill=(0.2, 0.2, 0.2))
    source = tmp_path / "tinted.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "out.pdf"

    result = crop_pages(
        CropParams(path=str(source), output=str(target), mode="auto", auto_margin=0),
        silent_progress(),
    )

    assert result.cropped == 1
    with pymupdf.open(target) as document:
        visible = document[0].cropbox
    assert abs(visible.x0 - 150) < 3 and abs(visible.y0 - 250) < 3
    assert abs(visible.x1 - 445) < 3 and abs(visible.y1 - 560) < 3


def test_insets_that_leave_nothing_name_the_page(tmp_path: Path):
    document = pymupdf.open()
    document.new_page(width=600, height=800)
    document.new_page(width=200, height=200)
    source = tmp_path / "mixed.pdf"
    document.save(source)
    document.close()

    with pytest.raises(OpError) as refused:
        crop_pages(
            CropParams(
                path=str(source),
                output=str(tmp_path / "out.pdf"),
                insets=Insets(left=100, right=100),
            ),
            silent_progress(),
        )

    assert refused.value.data == {"reason": "cropEmpty", "page": 2}
