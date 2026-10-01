import base64
import io
from pathlib import Path

import numpy as np
import pymupdf
import pytest
from PIL import Image, ImageDraw

from vivepdf.ops.photo import PhotoParams, find_paper_quad, from_photo
from vivepdf.ops.signature import (
    SignatureCleanParams,
    SignaturePlacement,
    SignaturePlaceParams,
    clean,
    place,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _photo(tmp_path: Path) -> Path:
    image = Image.new("RGB", (1000, 800), (60, 45, 35))
    draw = ImageDraw.Draw(image)
    quad = [(180, 120), (860, 170), (820, 700), (140, 640)]
    draw.polygon(quad, fill=(236, 232, 222))
    for row in range(6):
        y = 220 + row * 60
        draw.line([(260, y), (760, y + 20)], fill=(30, 30, 30), width=6)
    path = tmp_path / "foto.jpg"
    image.save(path, quality=90)
    return path


def test_photo_is_detected_and_straightened(tmp_path: Path) -> None:
    photo = _photo(tmp_path)
    with Image.open(photo) as opened:
        quad = find_paper_quad(opened.convert("RGB"))
    assert quad is not None
    assert abs(quad[0][0] - 180) < 25 and abs(quad[0][1] - 120) < 25
    result = from_photo(
        PhotoParams(images=[str(photo)], output=str(tmp_path / "belge.pdf"), mode="gray"),
        silent_progress(),
    )
    assert result.page_count == 1 and result.pages[0].cropped is True
    with pymupdf.open(result.output) as document:
        pixmap = document[0].get_pixmap(dpi=40, colorspace=pymupdf.csGRAY)
        values = np.frombuffer(pixmap.samples, dtype=np.uint8)
        assert values.mean() > 180
        assert (values < 90).mean() < 0.2


def test_photo_without_paper_keeps_whole_image(tmp_path: Path) -> None:
    image = Image.new("RGB", (400, 300), (250, 250, 250))
    path = tmp_path / "flat.png"
    image.save(path)
    result = from_photo(
        PhotoParams(images=[str(path)], output=str(tmp_path / "flat.pdf"), paper="a4"),
        silent_progress(),
    )
    assert result.pages[0].cropped is False
    with pymupdf.open(result.output) as document:
        assert round(document[0].rect.width) == 842 and round(document[0].rect.height) == 595


def test_signature_clean_and_place(sample_pdf: Path, tmp_path: Path) -> None:
    image = Image.new("RGB", (400, 200), (245, 240, 230))
    draw = ImageDraw.Draw(image)
    draw.line([(40, 150), (120, 60), (200, 150), (280, 60), (360, 150)], fill=(25, 25, 90), width=8)
    path = tmp_path / "imza.jpg"
    image.save(path, quality=92)
    cleaned = clean(SignatureCleanParams(path=str(path)), silent_progress())
    png = Image.open(io.BytesIO(base64.b64decode(cleaned.png_base64)))
    assert png.mode == "RGBA" and png.width < 400 and png.height < 200
    alpha = np.asarray(png)[:, :, 3]
    assert alpha[0, 0] == 0 and alpha.max() == 255

    placed = place(
        SignaturePlaceParams(
            path=str(sample_pdf),
            output=str(tmp_path / "signed.pdf"),
            placements=[
                SignaturePlacement(
                    page=2, x0=300, y0=700, x1=500, y1=780, png_base64=cleaned.png_base64
                )
            ],
        ),
        silent_progress(),
    )
    assert placed.placed == 1
    with pymupdf.open(placed.output) as document:
        assert len(document[1].get_images()) == 1 and len(document[0].get_images()) == 0
        info = document[1].get_image_info()[0]
        assert info["bbox"][0] >= 299 and info["bbox"][3] <= 781


def test_signature_clean_rejects_blank_image(tmp_path: Path) -> None:
    path = tmp_path / "blank.png"
    Image.new("RGB", (100, 100), (255, 255, 255)).save(path)
    with pytest.raises(OpError) as raised:
        clean(SignatureCleanParams(path=str(path)), silent_progress())
    assert raised.value.code == ErrorCode.INVALID_PARAMS


def oversized_png(path: Path, width: int = 60000, height: int = 60000) -> Path:
    import struct
    import zlib

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload))
        )

    signature = bytes([137, 80, 78, 71, 13, 10, 26, 10])
    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    rows = bytes(4 * (width + 1))
    path.write_bytes(
        signature
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(rows, 9))
        + chunk(b"IEND", b"")
    )
    return path


def test_a_picture_that_claims_a_huge_size_is_refused_politely(tmp_path: Path) -> None:
    bomb = oversized_png(tmp_path / "bomb.png")
    with pytest.raises(OpError) as raised:
        clean(SignatureCleanParams(path=str(bomb)), silent_progress())
    assert raised.value.code == ErrorCode.INVALID_PARAMS


def test_a_photo_that_claims_a_huge_size_is_refused_politely(tmp_path: Path) -> None:
    bomb = oversized_png(tmp_path / "bomb.png")
    with pytest.raises(OpError) as raised:
        from_photo(
            PhotoParams(images=[str(bomb)], output=str(tmp_path / "out.pdf"), overwrite=True),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.INVALID_PARAMS


def test_every_frame_of_a_multi_page_tiff_becomes_a_page(tmp_path: Path) -> None:
    first = Image.new("RGB", (400, 560), (250, 250, 250))
    second = Image.new("RGB", (400, 560), (240, 240, 240))
    ImageDraw.Draw(second).rectangle((60, 80, 340, 100), fill=(20, 20, 20))
    path = tmp_path / "tarayıcı çıktısı.tif"
    first.save(path, save_all=True, append_images=[second], compression="tiff_lzw")
    result = from_photo(
        PhotoParams(images=[str(path)], output=str(tmp_path / "tiff.pdf")), silent_progress()
    )
    assert result.page_count == 2
    assert [page.source for page in result.pages] == [str(path), str(path)]


def test_a_picture_that_is_already_the_page_is_not_reported_as_cropped(tmp_path: Path) -> None:
    image = Image.new("RGB", (900, 1270), (252, 252, 250))
    draw = ImageDraw.Draw(image)
    for row in range(12):
        draw.rectangle((90, 120 + row * 80, 800, 132 + row * 80), fill=(20, 20, 20))
    assert find_paper_quad(image) is None


def test_auto_colour_mode_turns_a_text_photo_into_black_and_white(tmp_path: Path) -> None:
    photo = _photo(tmp_path)
    result = from_photo(
        PhotoParams(images=[str(photo)], output=str(tmp_path / "auto.pdf"), mode="auto"),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        assert document[0].get_images(full=True)[0][4] == 1
