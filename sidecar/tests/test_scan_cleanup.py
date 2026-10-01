import io
from pathlib import Path

import numpy as np
import pymupdf
import pytest
import zxingcpp
from PIL import Image, ImageDraw

from vivepdf.ops._blank import blank_image, blank_page
from vivepdf.ops.scan import (
    EnhanceParams,
    ScanSplitParams,
    clean_edges,
    detect_color_mode,
    enhance,
    split_scans,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

SHEET = (1240, 1754)


def speckled(image: Image.Image, share: float = 0.004, seed: int = 5) -> Image.Image:
    generator = np.random.default_rng(seed)
    array = np.asarray(image.convert("RGB")).astype(np.int16) - np.array([19, 25, 37])
    mask = generator.random(array.shape[:2]) < share
    array[mask] = generator.integers(0, 90, size=(int(mask.sum()), 1))
    array = array + generator.normal(0, 6, array.shape)
    return Image.fromarray(np.clip(array, 0, 255).astype(np.uint8))


def blank_sheet() -> Image.Image:
    return speckled(Image.new("RGB", SHEET, (255, 255, 255)))


def text_sheet(lines: int = 30) -> Image.Image:
    image = Image.new("RGB", SHEET, (255, 255, 255))
    draw = ImageDraw.Draw(image)
    for row in range(lines):
        top = 160 + row * 48
        draw.rectangle((140, top, SHEET[0] - 140, top + 12), fill=(20, 20, 20))
    return speckled(image)


def image_page(document: pymupdf.Document, image: Image.Image) -> None:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    page = document.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=buffer.getvalue())


def scanned_pdf(path: Path, images: list[Image.Image]) -> Path:
    document = pymupdf.open()
    for image in images:
        image_page(document, image)
    document.save(path)
    document.close()
    return path


def barcode_sheet(text: str) -> Image.Image:
    barcode = zxingcpp.create_barcode(text, zxingcpp.BarcodeFormat.Code128)
    code = Image.fromarray(np.array(zxingcpp.write_barcode_to_image(barcode, scale=4)))
    code = code.convert("RGB").rotate(90, expand=True, fillcolor=(255, 255, 255))
    sheet = Image.new("RGB", SHEET, (255, 255, 255))
    sheet.paste(code, (120, 180))
    return speckled(sheet)


def test_a_scanned_blank_sheet_is_blank_and_a_single_word_is_not() -> None:
    assert blank_image(blank_sheet(), 150)
    word = Image.new("RGB", SHEET, (255, 255, 255))
    ImageDraw.Draw(word).rectangle((150, 300, 230, 330), fill=(0, 0, 0))
    assert not blank_image(speckled(word), 150)
    assert not blank_image(Image.new("RGB", SHEET, (10, 10, 10)), 150)


def test_a_dark_scanner_edge_does_not_make_a_blank_sheet_look_printed() -> None:
    sheet = Image.new("RGB", SHEET, (255, 255, 255))
    ImageDraw.Draw(sheet).rectangle((0, 0, 40, SHEET[1]), fill=(20, 20, 20))
    assert blank_image(speckled(sheet), 150)


def test_split_by_blank_pages_finds_a_scanned_separator(tmp_path: Path) -> None:
    source = scanned_pdf(
        tmp_path / "yığın.pdf",
        [text_sheet(), text_sheet(), blank_sheet(), text_sheet(), text_sheet(), text_sheet()],
    )
    with pymupdf.open(source) as document:
        assert blank_page(document[2])
        assert not blank_page(document[0])
    result = split_scans(
        ScanSplitParams(path=str(source), output_dir=str(tmp_path / "parts"), mode="blank"),
        silent_progress(),
    )
    assert result.separator_pages == [3]
    assert [part.page_count for part in result.outputs] == [2, 3]


def test_split_by_barcode_reads_a_sideways_code128_separator(tmp_path: Path) -> None:
    source = scanned_pdf(
        tmp_path / "batch.pdf",
        [text_sheet(), barcode_sheet("SEP:Contract"), text_sheet(), text_sheet()],
    )
    only_qr = split_scans(
        ScanSplitParams(path=str(source), output_dir=str(tmp_path / "qr"), mode="qr"),
        silent_progress(),
    )
    assert only_qr.separator_pages == []
    result = split_scans(
        ScanSplitParams(
            path=str(source),
            output_dir=str(tmp_path / "codes"),
            mode="barcode",
            qr_prefix="SEP:",
            pattern="{n}-{label}",
        ),
        silent_progress(),
    )
    assert result.separator_pages == [2]
    assert [part.label for part in result.outputs] == [None, "Contract"]
    assert Path(result.outputs[1].output).name == "2-Contract.pdf"


def test_enhance_can_drop_blank_pages(tmp_path: Path) -> None:
    source = scanned_pdf(tmp_path / "scan.pdf", [text_sheet(), blank_sheet(), text_sheet()])
    result = enhance(
        EnhanceParams(
            path=str(source), output=str(tmp_path / "clean.pdf"), remove_blank=True, deskew=False
        ),
        silent_progress(),
    )
    assert result.removed_pages == 1
    assert result.page_count == 2
    assert result.enhanced_pages == 2


def test_enhance_refuses_to_write_an_empty_document(tmp_path: Path) -> None:
    source = scanned_pdf(tmp_path / "blank.pdf", [blank_sheet(), blank_sheet()])
    with pytest.raises(OpError) as raised:
        enhance(
            EnhanceParams(path=str(source), output=str(tmp_path / "out.pdf"), remove_blank=True),
            silent_progress(),
        )
    assert raised.value.data == {"reason": "allBlank"}


def test_enhance_keeps_blank_pages_outside_the_selected_range(tmp_path: Path) -> None:
    source = scanned_pdf(tmp_path / "scan.pdf", [blank_sheet(), text_sheet(), blank_sheet()])
    result = enhance(
        EnhanceParams(
            path=str(source),
            output=str(tmp_path / "out.pdf"),
            pages="2-3",
            remove_blank=True,
            deskew=False,
        ),
        silent_progress(),
    )
    assert result.removed_pages == 1
    assert result.page_count == 2


def test_colour_mode_is_detected_from_the_page() -> None:
    assert detect_color_mode(text_sheet()) == "bw"
    coloured = Image.new("RGB", (600, 800), (255, 255, 255))
    ImageDraw.Draw(coloured).rectangle((100, 100, 400, 400), fill=(200, 30, 30))
    assert detect_color_mode(coloured) == "color"
    gradient = np.tile(np.linspace(0, 255, 600, dtype=np.uint8), (800, 1))
    assert detect_color_mode(Image.fromarray(gradient).convert("RGB")) == "gray"


def test_auto_mode_writes_text_scans_as_black_and_white(tmp_path: Path) -> None:
    coloured = Image.new("RGB", SHEET, (255, 255, 255))
    ImageDraw.Draw(coloured).rectangle((200, 200, 900, 900), fill=(30, 90, 200))
    source = scanned_pdf(tmp_path / "mixed.pdf", [text_sheet(), coloured])
    result = enhance(
        EnhanceParams(path=str(source), output=str(tmp_path / "auto.pdf"), mode="auto"),
        silent_progress(),
    )
    assert result.enhanced_pages == 2
    with pymupdf.open(result.output) as document:
        depths = [document[index].get_images(full=True)[0][4] for index in range(2)]
        channels = [
            pymupdf.Pixmap(document, document[index].get_images(full=True)[0][0]).n
            for index in range(2)
        ]
    assert depths[0] == 1
    assert channels[1] == 3


def test_clean_edges_whitens_a_scanner_shadow_and_keeps_the_content() -> None:
    image = Image.new("RGB", (800, 1000), (245, 245, 245))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 30, 1000), fill=(25, 25, 25))
    draw.rectangle((200, 400, 600, 420), fill=(10, 10, 10))
    cleaned = np.asarray(clean_edges(image))
    assert cleaned[:, :30].min() == 255
    assert cleaned[410, 300].max() < 50
    untouched = Image.new("RGB", (800, 1000), (245, 245, 245))
    assert clean_edges(untouched) is untouched
