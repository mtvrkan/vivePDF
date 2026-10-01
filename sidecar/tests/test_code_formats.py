from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.codes import CodesReadParams, QrAddParams, add_qr, read_codes
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def blank(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for _ in range(2):
        document.new_page(width=595, height=842)
    path = tmp_path / "blank.pdf"
    document.save(path)
    document.close()
    return path


def _decoded(path: Path) -> list[tuple[str, str]]:
    result = read_codes(CodesReadParams(path=str(path), dpi=300), silent_progress())
    return [(code.format, code.text) for code in result.codes]


@pytest.mark.parametrize(
    ("code_format", "payload"),
    [
        ("qr", "https://vivepdf.com"),
        ("dataMatrix", "DM-2026-0041"),
        ("aztec", "AZ-TEST"),
        ("pdf417", "PDF417 payload"),
        ("code128", "ABC-12345"),
        ("code39", "CODE39TEST"),
        ("ean13", "5901234123457"),
        ("ean8", "96385074"),
        ("itf", "12345678"),
    ],
)
def test_each_symbology_is_written_and_reads_back(
    code_format: str, payload: str, blank: Path, tmp_path: Path
):
    target = tmp_path / f"{code_format}.pdf"
    add_qr(
        QrAddParams(
            path=str(blank),
            output=str(target),
            text=payload,
            format=code_format,
            size=220,
            height=90,
            position="center",
        ),
        silent_progress(),
    )
    decoded = _decoded(target)
    assert any(text == payload for _format, text in decoded), decoded


def test_a_payload_the_symbology_cannot_hold_is_refused_with_its_name(blank: Path, tmp_path: Path):
    with pytest.raises(OpError) as error:
        add_qr(
            QrAddParams(
                path=str(blank),
                output=str(tmp_path / "bad.pdf"),
                text="not a valid ean",
                format="ean13",
            ),
            silent_progress(),
        )
    assert "ean13" in error.value.message


def test_a_coloured_code_still_decodes(blank: Path, tmp_path: Path):
    target = tmp_path / "blue.pdf"
    add_qr(
        QrAddParams(
            path=str(blank),
            output=str(target),
            text="RENKLI",
            color="#102a63",
            background="#ffffff",
            size=200,
            position="center",
        ),
        silent_progress(),
    )
    assert any(text == "RENKLI" for _format, text in _decoded(target))


def test_the_caption_prints_the_payload_under_the_code(blank: Path, tmp_path: Path):
    target = tmp_path / "caption.pdf"
    add_qr(
        QrAddParams(
            path=str(blank),
            output=str(target),
            text="ABC-12345",
            format="code128",
            caption=True,
            size=240,
            height=70,
            position="center",
        ),
        silent_progress(),
    )
    document = pymupdf.open(target)
    text = document[0].get_text()
    document.close()
    assert "ABC-12345" in text


def test_a_linear_code_is_not_forced_into_a_square(blank: Path, tmp_path: Path):
    target = tmp_path / "linear.pdf"
    add_qr(
        QrAddParams(
            path=str(blank),
            output=str(target),
            text="ABC-12345",
            format="code128",
            size=240,
            height=60,
            position="center",
        ),
        silent_progress(),
    )
    document = pymupdf.open(target)
    rects = document[0].get_image_rects(document[0].get_images()[0][0])
    document.close()
    assert rects
    assert rects[0].width > rects[0].height
