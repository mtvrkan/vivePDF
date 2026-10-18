import base64
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._placement import text_to_pdf_matrix, write_text_on
from vivepdf.ops._watermark_style import WATERMARK_FONT_BOLD, WatermarkParams
from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.ops.security_watermark import watermark
from vivepdf.ops.watermark_removal import RemoveWatermarkParams, remove_watermark
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

MEDIA_BOXES = ("[0 0 595 842]", "[0 100 595 942]", "[50 -20 645 822]")
CROP_BOXES = (None, "[30 42 560 802]", "[60 150 500 900]", "[0 0 595 542]")
BOX = {"page": 1, "x0": 100, "y0": 100, "x1": 300, "y1": 160}


def _page(media: str, crop: str | None, rotation: int) -> tuple[pymupdf.Document, pymupdf.Page]:
    document = pymupdf.open()
    page = document.new_page()
    document.xref_set_key(page.xref, "MediaBox", media)
    if crop:
        document.xref_set_key(page.xref, "CropBox", crop)
    document[0].set_rotation(rotation)
    return document, document[0]


def _origins(page: pymupdf.Page, glyph: str) -> list[tuple[float, float]]:
    return [
        char["origin"]
        for block in page.get_text("rawdict")["blocks"]
        for line in block.get("lines", [])
        for span in line["spans"]
        for char in span["chars"]
        if char["c"] == glyph
    ]


@pytest.mark.parametrize("media", MEDIA_BOXES)
@pytest.mark.parametrize("crop", CROP_BOXES)
@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize("angle", [0, 30])
def test_written_text_lands_at_its_page_point(media, crop, rotation, angle):
    document, page = _page(media, crop, rotation)
    writer = pymupdf.TextWriter(page.rect)
    writer.append((100, 150), "X", fontsize=12)

    write_text_on(
        page, writer, morph=(pymupdf.Point(100, 150), pymupdf.Matrix(angle)) if angle else None
    )

    assert _origins(page, "X") == [pytest.approx((100, 150), abs=0.5)]
    document.close()


@pytest.mark.parametrize("media", MEDIA_BOXES)
@pytest.mark.parametrize("crop", CROP_BOXES)
def test_page_points_map_to_pdf_space_like_an_unturned_page(media, crop):
    document, page = _page(media, crop, 0)

    assert tuple(text_to_pdf_matrix(page)) == pytest.approx(tuple(~page.transformation_matrix))
    document.close()


def _saved(tmp_path: Path, crop: pymupdf.Rect | None, rotation: int, draw=None) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    if draw is not None:
        draw(page)
    if crop is not None:
        page.set_cropbox(crop)
    page.set_rotation(rotation)
    path = tmp_path / "in.pdf"
    document.save(path)
    document.close()
    return path


def _words(path: str | Path) -> list[tuple[str, pymupdf.Rect]]:
    with pymupdf.open(path) as document:
        page = document[0]
        return [
            (word[4], pymupdf.Rect(word[:4]) * page.rotation_matrix)
            for word in page.get_text("words")
        ]


@pytest.mark.parametrize("kind", ["runs", "block"])
def test_styled_text_on_an_offset_crop_lands_in_its_box(tmp_path: Path, kind: str):
    source = _saved(tmp_path, pymupdf.Rect(20, 0, 595, 500), 0)
    item = {"kind": "text", "text": "STYLED", "runs": [{"text": "STYLED"}], **BOX}
    if kind == "block":
        item = {"kind": "block", "text": "STYLED", **BOX}

    result = apply(
        EditorApplyParams(path=str(source), output=str(tmp_path / "out.pdf"), objects=[item]),
        silent_progress(),
    )

    [(text, shown)] = _words(result.output)
    assert text == "STYLED"
    assert 95 <= shown.y0 <= 110


@pytest.mark.parametrize("rotation", [90, 270])
def test_replaced_text_on_a_turned_page_keeps_its_direction(tmp_path: Path, rotation: int):
    def greet(page: pymupdf.Page) -> None:
        page.set_rotation(rotation)
        page.insert_text(
            pymupdf.Point(100, 120) * page.derotation_matrix,
            "Hello there",
            fontsize=14,
            rotate=rotation,
        )
        page.set_rotation(0)

    source = _saved(tmp_path, None, rotation, greet)
    shown = _words(source)[0][1] | _words(source)[1][1]
    edit = {
        "kind": "edit",
        "page": 1,
        "x0": shown.x0,
        "y0": shown.y0,
        "x1": shown.x1,
        "y1": shown.y1,
        "text": "World wide",
        "font_size": 14,
    }

    result = apply(
        EditorApplyParams(path=str(source), output=str(tmp_path / "out.pdf"), objects=[edit]),
        silent_progress(),
    )

    with pymupdf.open(result.output) as document:
        lines = [
            line
            for block in document[0].get_text("dict")["blocks"]
            for line in block.get("lines", [])
        ]
    assert ["".join(span["text"] for span in line["spans"]) for line in lines] == ["World wide"]
    assert lines[0]["dir"] == pytest.approx((0, -1) if rotation == 90 else (0, 1), abs=1e-3)


def test_restored_words_stay_put_on_a_turned_cropped_page(tmp_path: Path):
    def draw(page: pymupdf.Page) -> None:
        for row in range(12):
            page.insert_text(
                (40, 80 + row * 16),
                "e-posta ve-ya iki-uc kelime - tire",
                fontsize=13,
                fontname="tiro",
            )
        page.insert_text(
            (30, 200),
            "TASLAK",
            fontsize=110,
            fontname="wm",
            fontfile=str(WATERMARK_FONT_BOLD),
            color=(0.8, 0.8, 0.85),
        )

    source = _saved(tmp_path, pymupdf.Rect(0, 0, 595, 600), 90, draw)
    before = sorted(
        (text, round(rect.x0), round(rect.y0)) for text, rect in _words(source) if text != "TASLAK"
    )

    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(source),
            output=str(tmp_path / "out.pdf"),
            texts=["TASLAK"],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )

    after = sorted((text, round(rect.x0), round(rect.y0)) for text, rect in _words(result.output))
    assert after == before


def test_an_unreadable_picture_is_reported_as_such(tmp_path: Path):
    source = _saved(tmp_path, None, 0)
    broken = tmp_path / "broken.png"
    broken.write_bytes(b"\x89PNG\r\n\x1a\nnot really")

    for item in (
        {"kind": "image", "path": str(broken), **BOX},
        {"kind": "image", "png_base64": base64.b64encode(b"junk").decode(), **BOX},
    ):
        with pytest.raises(OpError) as raised:
            apply(
                EditorApplyParams(
                    path=str(source),
                    output=str(tmp_path / "out.pdf"),
                    overwrite=True,
                    objects=[item],
                ),
                silent_progress(),
            )
        assert raised.value.code == ErrorCode.INVALID_PARAMS
        assert raised.value.data["reason"] == "imageUnreadable"


def test_a_watermark_never_writes_over_its_own_template(tmp_path: Path):
    source = _saved(tmp_path, None, 0)
    template = tmp_path / "template.pdf"
    template.write_bytes(source.read_bytes())

    with pytest.raises(OpError) as raised:
        watermark(
            WatermarkParams(
                path=str(source),
                output=str(template),
                overwrite=True,
                kind="pdf",
                template_path=str(template),
            ),
            silent_progress(),
        )

    assert raised.value.data == {"reason": "sameAsInput"}
