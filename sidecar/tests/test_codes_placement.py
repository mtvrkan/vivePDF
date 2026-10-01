import csv
import io
from pathlib import Path

import numpy as np
import pymupdf
import pytest
from PIL import Image

from vivepdf.ops.codes import (
    CodeHit,
    CodesExportParams,
    CodesReadParams,
    QrAddParams,
    add_qr,
    export_csv,
    read_codes,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def pages(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for rotation in (0, 90, 180, 270):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 72), f"page turned {rotation}")
        page.set_rotation(rotation)
    path = tmp_path / "döndürülmüş.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def speckled_scan(tmp_path: Path) -> Path:
    generator = np.random.default_rng(11)
    array = np.full((1754, 1240, 3), 232, dtype=np.int16)
    mask = generator.random(array.shape[:2]) < 0.03
    array[mask] = generator.integers(0, 90, size=(int(mask.sum()), 1))
    image = Image.fromarray(np.clip(array, 0, 255).astype(np.uint8))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=buffer.getvalue())
    path = tmp_path / "scan.pdf"
    document.save(path)
    document.close()
    return path


def _texts(path: Path, thorough: bool = False) -> list[tuple[int, str]]:
    found = read_codes(CodesReadParams(path=str(path), thorough=thorough), silent_progress())
    return [(code.page, code.text) for code in found.codes]


def test_a_code_on_a_speckled_scan_gets_a_clean_quiet_zone(speckled_scan: Path, tmp_path: Path):
    target = tmp_path / "coded.pdf"
    result = add_qr(
        QrAddParams(
            path=str(speckled_scan),
            output=str(target),
            text="INV-2026-0042",
            format="code128",
            size=200,
            height=60,
            position="center",
        ),
        silent_progress(),
    )
    assert result.verified
    assert (1, "INV-2026-0042") in _texts(target, thorough=True)


def test_a_linear_code_fills_the_requested_bar_height(pages: Path, tmp_path: Path):
    target = tmp_path / "tall.pdf"
    add_qr(
        QrAddParams(
            path=str(pages),
            output=str(target),
            pages="1",
            text="ABC-12345",
            format="code128",
            size=150,
            height=80,
            position="top-left",
        ),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        box = pymupdf.Rect(document[0].get_image_info()[0]["bbox"])
    assert round(box.width) == 150
    assert round(box.height) == 80


def test_codes_on_turned_pages_sit_where_asked_and_read_back(pages: Path, tmp_path: Path):
    target = tmp_path / "turned.pdf"
    add_qr(
        QrAddParams(path=str(pages), output=str(target), text="P{page}", position="top-left"),
        silent_progress(),
    )
    found = read_codes(CodesReadParams(path=str(target)), silent_progress()).codes
    assert [(code.page, code.text) for code in found] == [
        (1, "P1"),
        (2, "P2"),
        (3, "P3"),
        (4, "P4"),
    ]
    with pymupdf.open(target) as document:
        for code in found:
            page = document[code.page - 1]
            corner = pymupdf.Point(code.x0, code.y0)
            assert corner.x < page.rect.width / 2 and corner.y < page.rect.height / 2


def test_a_code_bigger_than_its_margin_allows_stays_on_the_page(pages: Path, tmp_path: Path):
    target = tmp_path / "clamped.pdf"
    add_qr(
        QrAddParams(
            path=str(pages),
            output=str(target),
            pages="1",
            text="edge",
            size=400,
            margin=200,
            position="bottom-right",
        ),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        page = document[0]
        box = pymupdf.Rect(page.get_image_info()[0]["bbox"])
        assert page.rect.contains(box)


def test_the_caption_keeps_turkish_letters(pages: Path, tmp_path: Path):
    target = tmp_path / "caption.pdf"
    add_qr(
        QrAddParams(
            path=str(pages), output=str(target), pages="1", text="Şişli ğüı İÖÇ", caption=True
        ),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        assert "Şişli ğüı İÖÇ" in document[0].get_text()
    assert (1, "Şişli ğüı İÖÇ") in _texts(target)


def test_a_list_of_values_gives_each_page_its_own_code(pages: Path, tmp_path: Path):
    target = tmp_path / "values.pdf"
    result = add_qr(
        QrAddParams(
            path=str(pages),
            output=str(target),
            values=["INV-001", "", "INV-{page}-{n}"],
        ),
        silent_progress(),
    )
    assert result.stamped == 2
    assert _texts(target) == [(1, "INV-001"), (3, "INV-3-3")]


@pytest.mark.parametrize(
    ("fields", "reason"),
    [({"text": "   "}, "emptyText"), ({"values": ["", " "]}, "emptyValues")],
)
def test_empty_payloads_are_refused(pages: Path, tmp_path: Path, fields: dict, reason: str):
    with pytest.raises(OpError) as raised:
        add_qr(
            QrAddParams(path=str(pages), output=str(tmp_path / "x.pdf"), **fields),
            silent_progress(),
        )
    assert raised.value.data == {"reason": reason}


def test_a_code_too_dense_to_scan_is_reported(pages: Path, tmp_path: Path):
    result = add_qr(
        QrAddParams(
            path=str(pages), output=str(tmp_path / "dense.pdf"), pages="1", text="x" * 900, size=24
        ),
        silent_progress(),
    )
    assert result.stamped == 1
    assert result.verified is False


def test_codes_export_to_a_spreadsheet_safe_csv(tmp_path: Path):
    codes = [
        CodeHit(page=1, format="QRCode", text='=HYPERLINK("x")', x0=1, y0=2, x1=3, y1=4),
        CodeHit(page=2, format="Code128", text="Fatura ğüş", x0=5, y0=6, x1=7, y1=8),
    ]
    result = export_csv(
        CodesExportParams(codes=codes, output=str(tmp_path / "kodlar")), silent_progress()
    )
    assert result.count == 2
    with Path(result.output).open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle, delimiter=";"))
    assert rows[0] == ["page", "format", "text", "x0", "y0", "x1", "y1"]
    assert rows[1][:3] == ["1", "QRCode", '\'=HYPERLINK("x")']
    assert rows[2][:3] == ["2", "Code128", "Fatura ğüş"]
    with pytest.raises(OpError):
        export_csv(
            CodesExportParams(codes=codes, output=str(tmp_path / "kodlar.csv")), silent_progress()
        )


def test_a_turned_page_with_an_offset_crop_box_gets_the_code_where_asked(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.set_cropbox(pymupdf.Rect(50, 60, 550, 760))
    page.set_rotation(90)
    source = tmp_path / "cropped.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "cropped-coded.pdf"
    result = add_qr(
        QrAddParams(path=str(source), output=str(target), text="crop", position="bottom-right"),
        silent_progress(),
    )
    assert result.verified
    found = read_codes(CodesReadParams(path=str(target)), silent_progress()).codes
    assert [code.text for code in found] == ["crop"]
    with pymupdf.open(target) as coded:
        visible = coded[0].rect
    assert found[0].x0 > visible.width / 2
    assert found[0].y0 > visible.height / 2
    assert visible.contains(pymupdf.Rect(found[0].x0, found[0].y0, found[0].x1, found[0].y1))


def test_repeated_pages_in_the_range_are_stamped_once(pages: Path, tmp_path: Path):
    target = tmp_path / "once.pdf"
    result = add_qr(
        QrAddParams(path=str(pages), output=str(target), pages="1,1-2,2", text="P{page}"),
        silent_progress(),
    )
    assert result.stamped == 2
    with pymupdf.open(target) as document:
        assert len(document[0].get_images()) == 1


def test_values_beyond_the_last_page_are_reported(pages: Path, tmp_path: Path):
    result = add_qr(
        QrAddParams(
            path=str(pages),
            output=str(tmp_path / "extra.pdf"),
            pages="1-2",
            values=["A", "B", "C", "", "D"],
        ),
        silent_progress(),
    )
    assert result.stamped == 2
    assert result.unused == 2


def test_a_long_caption_shrinks_and_stays_on_the_page(pages: Path, tmp_path: Path):
    target = tmp_path / "long-caption.pdf"
    text = "https://example.com/" + "segment/" * 30
    add_qr(
        QrAddParams(
            path=str(pages),
            output=str(target),
            pages="1",
            text=text,
            caption=True,
            position="bottom-right",
            size=120,
        ),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        page = document[0]
        spans = [
            span
            for block in page.get_text("dict")["blocks"]
            for line in block.get("lines", [])
            for span in line["spans"]
            if span["text"].startswith("https://")
        ]
        assert spans
        box = pymupdf.Rect(spans[0]["bbox"])
        assert page.rect.contains(box)
        assert spans[0]["size"] >= 4
        assert spans[0]["text"].endswith("…")


def test_caption_characters_the_font_cannot_draw_are_reported(pages: Path, tmp_path: Path):
    result = add_qr(
        QrAddParams(
            path=str(pages),
            output=str(tmp_path / "glyphs.pdf"),
            pages="1",
            text="東京 ok",
            caption=True,
        ),
        silent_progress(),
    )
    assert sorted(result.missing_glyphs) == ["京", "東"]


@pytest.mark.parametrize(
    ("fields", "reason"),
    [
        ({"format": "microQr", "error_level": "H"}, "errorLevelUnsupported"),
        ({"format": "ean13", "text": "not digits"}, "cannotEncode"),
        ({"color": "red"}, "badColour"),
    ],
)
def test_bad_code_settings_name_their_reason(
    pages: Path, tmp_path: Path, fields: dict, reason: str
):
    params = {"text": "x", **fields}
    with pytest.raises(OpError) as raised:
        add_qr(
            QrAddParams(path=str(pages), output=str(tmp_path / "bad.pdf"), **params),
            silent_progress(),
        )
    assert raised.value.data["reason"] == reason
