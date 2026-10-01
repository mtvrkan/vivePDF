from pathlib import Path

import numpy as np
import pymupdf
import pytest

from vivepdf.ops.letterhead import LetterheadParams, letterhead, target_rect
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _document(path: Path, pages: int = 3, rotation: int = 0, crop: tuple | None = None) -> Path:
    document = pymupdf.open()
    for _ in range(pages):
        page = document.new_page(width=595, height=842)
        if crop is not None:
            page.set_cropbox(pymupdf.Rect(*crop))
        page.set_rotation(rotation)
    document.save(path)
    document.close()
    return path


def _template(
    path: Path,
    *,
    words: tuple[str, ...] = ("ANTET",),
    rotation: int = 0,
    size: tuple[float, float] = (595, 842),
    blank: bool = False,
    **encryption,
) -> Path:
    document = pymupdf.open()
    for word in words:
        page = document.new_page(width=size[0], height=size[1])
        if not blank:
            page.draw_rect(pymupdf.Rect(0, 0, size[0], 80), color=(0, 0, 0), fill=(0, 0, 0))
            page.insert_text((40, 140), word, fontsize=20)
        page.set_rotation(rotation)
    document.save(path, **encryption)
    document.close()
    return path


def _dark_box(page: pymupdf.Page) -> tuple[int, int, int, int] | None:
    pixmap = page.get_pixmap(dpi=72, colorspace=pymupdf.csGRAY, alpha=False)
    grid = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width)
    rows, columns = np.nonzero(grid < 50)
    if rows.size == 0:
        return None
    return (int(columns.min()), int(rows.min()), int(columns.max()) + 1, int(rows.max()) + 1)


def _words(path: Path, index: int) -> list[str]:
    with pymupdf.open(path) as document:
        return [word[4] for word in document[index].get_text("words")]


def _run(tmp_path: Path, source: Path, template: Path, **options) -> Path:
    result = letterhead(
        LetterheadParams(
            path=str(source),
            output=str(tmp_path / "out.pdf"),
            template_path=str(template),
            **options,
        ),
        silent_progress(),
    )
    return Path(result.output)


def test_the_first_page_template_goes_on_the_first_selected_page(tmp_path: Path):
    source = _document(tmp_path / "doc.pdf")
    main = _template(tmp_path / "main.pdf", words=("GENEL",))
    first = _template(tmp_path / "first.pdf", words=("KAPAK",))
    output = _run(tmp_path, source, main, pages="2-3", first_page_template_path=str(first))
    assert _words(output, 0) == []
    assert _words(output, 1) == ["KAPAK"]
    assert _words(output, 2) == ["GENEL"]


def test_the_chosen_template_page_is_used(tmp_path: Path):
    source = _document(tmp_path / "doc.pdf", pages=1)
    template = _template(tmp_path / "two.pdf", words=("BIR", "IKI"))
    output = _run(tmp_path, source, template, template_page=2)
    assert _words(output, 0) == ["IKI"]


def test_fit_keeps_the_template_at_the_top(tmp_path: Path):
    source = _document(tmp_path / "doc.pdf", pages=1)
    template = _template(tmp_path / "wide.pdf", size=(842, 595))
    output = _run(tmp_path, source, template, fit="fit")
    with pymupdf.open(output) as document:
        box = _dark_box(document[0])
    assert box is not None
    assert box[1] == 0
    assert box[3] < 120


def test_fit_rect_is_centred_across_and_pinned_to_the_top():
    rect = target_rect(pymupdf.Rect(0, 0, 600, 800), pymupdf.Rect(0, 0, 300, 100), "fit")
    assert tuple(rect) == (0, 0, 600, 200)
    rect = target_rect(pymupdf.Rect(0, 0, 600, 800), pymupdf.Rect(0, 0, 100, 400), "fit")
    assert tuple(rect) == (200, 0, 400, 800)


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_a_turned_template_is_drawn_the_way_it_looks(tmp_path: Path, rotation: int):
    source = _document(tmp_path / "doc.pdf", pages=1)
    template = _template(tmp_path / "turned.pdf", rotation=rotation)
    with pymupdf.open(template) as document:
        expected = _dark_box(document[0])
        shown = document[0].rect
    output = _run(tmp_path, source, template)
    with pymupdf.open(output) as document:
        box = _dark_box(document[0])
        page = document[0].rect
    scale_x, scale_y = page.width / shown.width, page.height / shown.height
    wanted = (
        expected[0] * scale_x,
        expected[1] * scale_y,
        expected[2] * scale_x,
        expected[3] * scale_y,
    )
    assert box is not None
    assert all(abs(a - b) <= 3 for a, b in zip(box, wanted, strict=True))


@pytest.mark.parametrize("rotation", [90, 270])
def test_a_turned_cropped_page_gets_the_band_on_its_visible_top(tmp_path: Path, rotation: int):
    source = _document(tmp_path / "doc.pdf", pages=1, rotation=rotation, crop=(40, 50, 555, 800))
    template = _template(tmp_path / "band.pdf", words=("",))
    output = _run(tmp_path, source, template)
    with pymupdf.open(output) as document:
        page = document[0]
        box = _dark_box(page)
        visible = page.rect
    assert box is not None
    assert (box[0], box[1]) == (0, 0)
    assert abs(box[2] - visible.width) <= 1
    assert box[3] < visible.height / 4


def test_a_locked_template_asks_for_its_own_password(tmp_path: Path):
    source = _document(tmp_path / "doc.pdf", pages=1)
    locked = _template(
        tmp_path / "locked.pdf",
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw="antet123",
        owner_pw="sahip123",
    )
    with pytest.raises(OpError) as missing:
        _run(tmp_path, source, locked)
    assert missing.value.code == ErrorCode.NEEDS_PASSWORD
    assert missing.value.data == {
        "which": "template",
        "wrongPassword": False,
        "reason": "templatePassword",
    }
    with pytest.raises(OpError) as wrong:
        _run(tmp_path, source, locked, template_password="yanlis")
    assert wrong.value.data["reason"] == "templateWrongPassword"
    output = _run(tmp_path, source, locked, template_password="antet123")
    assert _words(output, 0) == ["ANTET"]


def test_a_blank_template_is_refused(tmp_path: Path):
    source = _document(tmp_path / "doc.pdf", pages=1)
    blank = _template(tmp_path / "blank.pdf", blank=True)
    with pytest.raises(OpError) as refused:
        _run(tmp_path, source, blank)
    assert refused.value.data == {"reason": "blankTemplate", "which": "template"}


def test_a_missing_first_template_page_names_that_template(tmp_path: Path):
    source = _document(tmp_path / "doc.pdf", pages=1)
    template = _template(tmp_path / "main.pdf")
    with pytest.raises(OpError) as refused:
        _run(
            tmp_path,
            source,
            template,
            first_page_template_path=str(template),
            first_page_template_page=4,
        )
    assert refused.value.data == {"reason": "templatePage", "which": "firstPageTemplate"}
