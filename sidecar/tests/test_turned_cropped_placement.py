import base64
import io
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pymupdf
import pytest
from PIL import Image

from vivepdf.ops._placement import insertion_matrix
from vivepdf.ops._watermark_style import WatermarkParams
from vivepdf.ops.codes import QrAddParams, add_qr
from vivepdf.ops.editor import EditorApplyParams, EditorImage, EditorText, apply
from vivepdf.ops.links import AutoLinkParams, LinksAddParams, NewLink, add_links, autolink
from vivepdf.ops.ocr import HiddenFonts, write_hidden_words
from vivepdf.ops.page_numbers import PageNumberParams, number_pages
from vivepdf.ops.scan import EnhanceParams, enhance
from vivepdf.ops.security_watermark import watermark
from vivepdf.ops.signature import SignaturePlacement, SignaturePlaceParams, place
from vivepdf.ops.stamp import StampParams, stamp
from vivepdf.ops.textedit import TextEdit, TextEditParams, TextSpansParams, get_spans, replace_text
from vivepdf.rpc.progress import silent_progress

FONT = "vivepdf/assets/fonts/DejaVuSans.ttf"
SHOWN = pymupdf.Rect(120, 90, 320, 190)


def _page_pair(tmp_path: Path, draw: Callable[[pymupdf.Page], None] | None = None):
    paths = []
    for name, width, height, crop in (
        ("cropped", 600, 800, pymupdf.Rect(50, 60, 550, 760)),
        ("reference", 500, 700, None),
    ):
        document = pymupdf.open()
        page = document.new_page(width=width, height=height)
        if crop is not None:
            page.set_cropbox(crop)
        page.set_rotation(90)
        if draw is not None:
            draw(page)
        path = tmp_path / f"{name}.pdf"
        document.save(path)
        document.close()
        paths.append(path)
    return paths


def _ink(path: Path | str) -> tuple[int, int, int, int] | None:
    with pymupdf.open(path) as document:
        pixmap = document[0].get_pixmap(dpi=72, alpha=False)
    grid = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
        pixmap.height, pixmap.width, pixmap.n
    )
    rows, columns = np.nonzero(grid.min(axis=2) < 200)
    if rows.size == 0:
        return None
    return (int(columns.min()), int(rows.min()), int(columns.max()) + 1, int(rows.max()) + 1)


def _same_place(cropped: Path | str, reference: Path | str) -> None:
    found, expected = _ink(cropped), _ink(reference)
    assert found is not None and expected is not None
    assert all(abs(a - b) <= 2 for a, b in zip(found, expected, strict=True)), (found, expected)


def _png(width: int = 20, height: int = 10) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (0, 0, 0)).save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def test_a_signature_lands_where_it_was_placed(tmp_path: Path) -> None:
    cropped, reference = _page_pair(tmp_path)
    outputs = []
    for source in (cropped, reference):
        output = tmp_path / f"signed-{source.name}"
        placement = SignaturePlacement(
            page=1, x0=SHOWN.x0, y0=SHOWN.y0, x1=SHOWN.x1, y1=SHOWN.y1, png_base64=_png()
        )
        place(
            SignaturePlaceParams(path=str(source), output=str(output), placements=[placement]),
            silent_progress(),
        )
        outputs.append(output)
    _same_place(*outputs)
    assert all(abs(a - b) <= 2 for a, b in zip(_ink(outputs[0]), SHOWN, strict=True))


def test_a_drawn_link_covers_the_chosen_area(tmp_path: Path) -> None:
    cropped, _reference = _page_pair(tmp_path)
    link = NewLink(page=1, x0=SHOWN.x0, y0=SHOWN.y0, x1=SHOWN.x1, y1=SHOWN.y1, uri="https://a.b")
    add_links(LinksAddParams(path=str(cropped), links=[link]), silent_progress())
    with pymupdf.open(cropped) as document:
        found = document[0].get_links()[0]["from"]
    assert all(abs(a - b) <= 1 for a, b in zip(found, SHOWN, strict=True)), found


def _address(page: pymupdf.Page) -> None:
    page.insert_text(
        pymupdf.Point(SHOWN.x0, SHOWN.y0) * page.derotation_matrix,
        "https://example.com",
        fontsize=14,
        fontname="dv",
        fontfile=FONT,
        rotate=page.rotation,
    )


def test_an_automatic_link_covers_the_address(tmp_path: Path) -> None:
    cropped, _reference = _page_pair(tmp_path, _address)
    output = tmp_path / "linked.pdf"
    assert (
        autolink(AutoLinkParams(path=str(cropped), output=str(output)), silent_progress()).added
        == 1
    )
    with pymupdf.open(output) as document:
        page = document[0]
        found = pymupdf.Rect(page.get_links()[0]["from"])
        word = page.search_for("example")[0] * page.rotation_matrix
    assert found.contains(pymupdf.Point((word.x0 + word.x1) / 2, (word.y0 + word.y1) / 2))


def test_a_watermark_is_centred_on_the_visible_page(tmp_path: Path) -> None:
    cropped, reference = _page_pair(tmp_path)
    outputs = []
    for source in (cropped, reference):
        output = tmp_path / f"marked-{source.name}"
        watermark(
            WatermarkParams(path=str(source), output=str(output), text="GİZLİ", opacity=1),
            silent_progress(),
        )
        outputs.append(output)
    _same_place(*outputs)


def test_a_stamp_keeps_its_corner(tmp_path: Path) -> None:
    cropped, reference = _page_pair(tmp_path)
    outputs = []
    for source in (cropped, reference):
        output = tmp_path / f"stamped-{source.name}"
        stamp(
            StampParams(path=str(source), output=str(output), text="ONAY", opacity=1),
            silent_progress(),
        )
        outputs.append(output)
    _same_place(*outputs)


@pytest.mark.parametrize("kind", ["text", "image"])
def test_editor_objects_land_where_they_were_drawn(tmp_path: Path, kind: str) -> None:
    cropped, reference = _page_pair(tmp_path)
    box = {"page": 1, "x0": SHOWN.x0, "y0": SHOWN.y0, "x1": SHOWN.x1, "y1": SHOWN.y1}
    item = (
        EditorText(**box, text="Yeni metin", font_size=18)
        if kind == "text"
        else EditorImage(**box, png_base64=_png())
    )
    outputs = []
    for source in (cropped, reference):
        output = tmp_path / f"edited-{source.name}"
        apply(
            EditorApplyParams(path=str(source), output=str(output), objects=[item]),
            silent_progress(),
        )
        outputs.append(output)
    _same_place(*outputs)


def _greeting(page: pymupdf.Page) -> None:
    page.insert_text(
        pymupdf.Point(SHOWN.x0, SHOWN.y0) * page.derotation_matrix,
        "Merhaba dunya",
        fontsize=16,
        fontname="dv",
        fontfile=FONT,
        rotate=page.rotation,
    )


def test_replaced_text_stays_on_its_line(tmp_path: Path) -> None:
    cropped, reference = _page_pair(tmp_path, _greeting)
    outputs = []
    for source in (cropped, reference):
        span = get_spans(TextSpansParams(path=str(source), page=0), silent_progress()).spans[0]
        output = tmp_path / f"replaced-{source.name}"
        replace_text(
            TextEditParams(
                path=str(source),
                output=str(output),
                page=0,
                edits=[TextEdit(bbox=span.bbox, text="Selam", size=span.size, color="#000000")],
            ),
            silent_progress(),
        )
        outputs.append(output)
    _same_place(*outputs)


def test_hidden_words_are_found_where_they_are_seen(tmp_path: Path) -> None:
    found = []
    for source in _page_pair(tmp_path):
        with pymupdf.open(source) as document:
            page = document[0]
            assert write_hidden_words(page, [(SHOWN, "kelime")], HiddenFonts()) == 1
            reopened = pymupdf.open("pdf", document.tobytes())
            found.append(reopened[0].search_for("kelime")[0] * reopened[0].rotation_matrix)
    assert all(abs(a - b) <= 1 for a, b in zip(found[0], found[1], strict=True)), found
    assert abs(found[0].x0 - SHOWN.x0) <= 2


def _square(page: pymupdf.Page) -> None:
    page.draw_rect(SHOWN * insertion_matrix(page), color=(0, 0, 0), fill=(0, 0, 0))


def test_an_enhanced_scan_keeps_its_picture_in_view(tmp_path: Path) -> None:
    cropped, reference = _page_pair(tmp_path, _square)
    outputs = []
    for source in (cropped, reference):
        output = tmp_path / f"enhanced-{source.name}"
        enhance(
            EnhanceParams(
                path=str(source),
                output=str(output),
                deskew=False,
                despeckle=False,
                only_scanned=False,
            ),
            silent_progress(),
        )
        outputs.append(output)
    _same_place(*outputs)
    assert all(abs(a - b) <= 3 for a, b in zip(_ink(outputs[0]), SHOWN, strict=True))


def test_page_numbers_sit_where_they_do_on_an_uncropped_page(tmp_path: Path) -> None:
    outputs = []
    for source in _page_pair(tmp_path):
        output = tmp_path / f"numbered-{source.name}"
        number_pages(
            PageNumberParams(path=str(source), output=str(output), font_size=20),
            silent_progress(),
        )
        outputs.append(output)
    _same_place(*outputs)


def test_a_code_caption_stays_under_its_code(tmp_path: Path) -> None:
    outputs = []
    for source in _page_pair(tmp_path):
        output = tmp_path / f"coded-{source.name}"
        add_qr(
            QrAddParams(
                path=str(source),
                output=str(output),
                text="https://example.com/caption",
                caption=True,
                caption_size=12,
                color="#000000",
            ),
            silent_progress(),
        )
        outputs.append(output)
    _same_place(*outputs)
    for output in outputs:
        with pymupdf.open(output) as document:
            page = document[0]
            caption = page.search_for("caption")[0] * page.rotation_matrix
            code = pymupdf.Rect(page.get_image_info()[0]["bbox"]) * page.rotation_matrix
        assert code.y1 - 2 <= caption.y0 <= code.y1 + 20
