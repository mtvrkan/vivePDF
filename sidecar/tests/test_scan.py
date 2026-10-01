import io
from pathlib import Path

import numpy as np
import pymupdf
import pytest
import zxingcpp
from PIL import Image, ImageDraw

from vivepdf.ops._naming import render_name, sanitize_file_name, unique_name
from vivepdf.ops.scan import (
    EnhanceParams,
    ScanSplitParams,
    ScanSplitRules,
    enhance,
    estimate_skew,
    preview_split,
    read_qr_labels,
    split_scans,
    whiten,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _text_lines_image(width: int = 1200, height: int = 1600) -> Image.Image:
    image = Image.new("RGB", (width, height), (232, 228, 220))
    draw = ImageDraw.Draw(image)
    for row in range(160, height - 160, 44):
        draw.rectangle((140, row, width - 140, row + 12), fill=(20, 20, 20))
    return image


def _image_page(document: pymupdf.Document, image: Image.Image) -> None:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    page = document.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=buffer.getvalue())


@pytest.fixture
def skewed_scan(tmp_path: Path) -> Path:
    document = pymupdf.open()
    tilted = _text_lines_image().rotate(
        2.5, resample=Image.Resampling.BICUBIC, fillcolor=(232, 228, 220)
    )
    _image_page(document, tilted)
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 72), "Vector page with real text that must stay untouched " * 3)
    path = tmp_path / "scan.pdf"
    document.save(path)
    document.close()
    return path


def test_estimate_skew_finds_tilt() -> None:
    tilted = _text_lines_image().rotate(
        2.5, resample=Image.Resampling.BICUBIC, fillcolor=(232, 228, 220)
    )
    assert abs(estimate_skew(tilted) + 2.5) < 0.4
    assert estimate_skew(_text_lines_image()) == 0.0


def test_whiten_pushes_background_to_white() -> None:
    result = whiten(_text_lines_image())
    corner = np.asarray(result)[20:60, 20:60]
    assert corner.min() >= 250


def test_enhance_only_touches_scanned_pages(skewed_scan: Path, tmp_path: Path) -> None:
    result = enhance(
        EnhanceParams(
            path=str(skewed_scan), output=str(tmp_path / "clean.pdf"), dpi=100, mode="gray"
        ),
        silent_progress(),
    )
    assert result.page_count == 2
    assert result.enhanced_pages == 1
    assert result.skipped_pages == 1
    assert result.deskewed_pages == 1
    with pymupdf.open(result.output) as document:
        assert "real text" in document[1].get_text()
        assert document[0].get_images()
        assert abs(document[0].rect.width - 595) < 0.5


def test_enhance_rejects_missing_orientation_language(skewed_scan: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as error:
        enhance(
            EnhanceParams(
                path=str(skewed_scan),
                output=str(tmp_path / "x.pdf"),
                orientation=True,
                languages=["zzz"],
            ),
            silent_progress(),
        )
    assert error.value.code == ErrorCode.TESSDATA_MISSING


def _qr_image(text: str) -> Image.Image:
    barcode = zxingcpp.create_barcode(text, zxingcpp.BarcodeFormat.QRCode)
    raw = zxingcpp.write_barcode_to_image(barcode, scale=8)
    array = np.array(raw, copy=False)
    sheet = Image.new("L", (1200, 1600), 255)
    code = Image.fromarray(array).convert("L")
    sheet.paste(code, (300, 400))
    return sheet.convert("RGB")


@pytest.fixture
def batch_scan(tmp_path: Path) -> Path:
    document = pymupdf.open()
    _image_page(document, _qr_image("VIVE:Invoice A"))
    for number in (1, 2):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 72), f"Invoice A page {number}")
    document.new_page(width=595, height=842)
    _image_page(document, _qr_image("VIVE:Invoice B"))
    for number in (1, 2, 3):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 72), f"FATURA NO: B-{number}")
    path = tmp_path / "batch.pdf"
    document.save(path)
    document.close()
    return path


def test_split_by_qr_names_parts_from_codes(batch_scan: Path, tmp_path: Path) -> None:
    result = split_scans(
        ScanSplitParams(
            path=str(batch_scan),
            output_dir=str(tmp_path / "parts"),
            mode="qr",
            qr_prefix="VIVE:",
            pattern="{n}-{label}",
        ),
        silent_progress(),
    )
    assert result.separator_pages == [1, 5]
    assert [part.label for part in result.outputs] == ["Invoice A", "Invoice B"]
    assert [part.page_count for part in result.outputs] == [3, 3]
    assert Path(result.outputs[0].output).name == "1-Invoice A.pdf"


def test_split_by_blank_pages(batch_scan: Path, tmp_path: Path) -> None:
    result = split_scans(
        ScanSplitParams(path=str(batch_scan), output_dir=str(tmp_path / "blank"), mode="blank"),
        silent_progress(),
    )
    assert result.separator_pages == [4]
    assert [part.page_count for part in result.outputs] == [3, 4]


def test_split_by_text_pattern(batch_scan: Path, tmp_path: Path) -> None:
    result = split_scans(
        ScanSplitParams(
            path=str(batch_scan),
            output_dir=str(tmp_path / "text"),
            mode="text",
            text_pattern=r"FATURA NO: (\S+)",
            pattern="{label}",
        ),
        silent_progress(),
    )
    labels = [part.label for part in result.outputs]
    assert labels == [None, "B-1", "B-2", "B-3"]
    assert [part.page_count for part in result.outputs] == [5, 1, 1, 1]
    names = sorted(Path(part.output).name for part in result.outputs)
    assert "B-1.pdf" in names


def test_naming_helpers() -> None:
    assert render_name("{name}-{n}", {"name": "a/b", "n": "01"}) == "a-b-01"
    assert render_name("{unknown}-{n}", {"n": 2}) == "{unknown}-2"
    assert sanitize_file_name("  ..bad:name?  ") == "bad-name"
    taken: set[str] = set()
    assert unique_name("x", taken) == "x"
    assert unique_name("X", taken) == "X-2"


def test_split_by_text_pattern_with_unmatched_optional_group(
    batch_scan: Path, tmp_path: Path
) -> None:
    result = split_scans(
        ScanSplitParams(
            path=str(batch_scan),
            output_dir=str(tmp_path / "optional"),
            mode="text",
            text_pattern=r"FATURA NO: (Z)?",
        ),
        silent_progress(),
    )
    assert [part.page_count for part in result.outputs] == [5, 1, 1, 1]
    assert [part.label for part in result.outputs][1:] == ["", "", ""]


def test_split_keeps_protection_and_page_labels(batch_scan: Path, tmp_path: Path) -> None:
    locked = tmp_path / "locked.pdf"
    with pymupdf.open(batch_scan) as document:
        document.set_page_labels(
            [{"startpage": 0, "prefix": "S-", "style": "D", "firstpagenum": 1}]
        )
        document.save(
            locked, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner"
        )
    result = split_scans(
        ScanSplitParams(
            path=str(locked), password="secret", output_dir=str(tmp_path / "sealed"), mode="blank"
        ),
        silent_progress(),
    )
    with pymupdf.open(result.outputs[1].output) as part:
        assert part.needs_pass
        assert part.authenticate("secret")
        assert part[0].get_label() == "S-5"


def test_split_checks_every_target_before_writing(batch_scan: Path, tmp_path: Path) -> None:
    folder = tmp_path / "taken"
    folder.mkdir()
    (folder / "batch-2.pdf").write_bytes(b"keep")
    with pytest.raises(OpError) as error:
        split_scans(
            ScanSplitParams(path=str(batch_scan), output_dir=str(folder), mode="blank"),
            silent_progress(),
        )
    assert error.value.data == {"exists": True, "path": str((folder / "batch-2.pdf").resolve())}
    assert sorted(path.name for path in folder.iterdir()) == ["batch-2.pdf"]
    assert (folder / "batch-2.pdf").read_bytes() == b"keep"


def test_naming_blocks_every_reserved_device_name() -> None:
    for reserved in ("COM0", "lpt¹", "CONIN$", "conout$.pdf", "Nul "):
        assert sanitize_file_name(reserved).lower().split(".")[0].endswith("-file")


def test_naming_limits_length_in_bytes() -> None:
    clipped = sanitize_file_name("文" * 120)
    assert len(clipped.encode("utf-8")) <= 180
    assert clipped == "文" * 60


def test_naming_ignores_format_specs_and_attributes() -> None:
    assert render_name("{name:>999999999}", {"name": "a"}) == "{name-999999999}"
    assert render_name("{name.__class__}-{n}", {"name": "a", "n": 3}) == "{name._class_}-3"


def test_split_preview_lists_parts_without_writing(batch_scan: Path, tmp_path: Path) -> None:
    before = sorted(tmp_path.iterdir())
    result = preview_split(
        ScanSplitRules(path=str(batch_scan), mode="qr", qr_prefix="VIVE:"), silent_progress()
    )
    assert [(part.first_page, part.last_page, part.label) for part in result.parts] == [
        (2, 4, "Invoice A"),
        (6, 8, "Invoice B"),
    ]
    assert result.separator_pages == [1, 5]
    assert result.page_count == 8
    assert sorted(tmp_path.iterdir()) == before


def test_split_preview_counts_pages_without_text(batch_scan: Path) -> None:
    result = preview_split(
        ScanSplitRules(path=str(batch_scan), mode="text", text_pattern=r"FATURA NO: (\S+)"),
        silent_progress(),
    )
    assert result.pages_without_text == 3
    assert [part.page_count for part in result.parts] == [5, 1, 1, 1]


def test_split_preview_refuses_a_broken_pattern(batch_scan: Path) -> None:
    with pytest.raises(OpError) as caught:
        preview_split(
            ScanSplitRules(path=str(batch_scan), mode="text", text_pattern="(unclosed"),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_split_preview_matches_plain_spaces_against_non_breaking_ones(tmp_path: Path) -> None:
    path = tmp_path / "nbsp.pdf"
    document = pymupdf.open()
    for number in range(1, 5):
        document.new_page().insert_text((72, 72), f"Invoice {number}")
    document.save(path)
    document.close()
    result = preview_split(
        ScanSplitRules(path=str(path), mode="text", text_pattern="Invoice ([13])"),
        silent_progress(),
    )
    assert [(part.first_page, part.last_page, part.label) for part in result.parts] == [
        (1, 2, "1"),
        (3, 4, "3"),
    ]


def _small_qr_page(document: pymupdf.Document, text: str) -> pymupdf.Page:
    barcode = zxingcpp.create_barcode(text, zxingcpp.BarcodeFormat.QRCode)
    code = Image.fromarray(np.array(zxingcpp.write_barcode_to_image(barcode, scale=2)))
    sheet = Image.new("L", (2400, 3200), 255)
    sheet.paste(code.convert("L"), (600, 800))
    buffer = io.BytesIO()
    sheet.save(buffer, format="PNG")
    page = document.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=buffer.getvalue())
    return page


def test_a_small_qr_code_is_read_on_a_sharper_second_look() -> None:
    document = pymupdf.open()
    assert read_qr_labels(_small_qr_page(document, "VIVE:Small")) == ["VIVE:Small"]


def test_a_page_without_codes_reads_no_labels() -> None:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 72), "No code here")
    assert read_qr_labels(page) == []
    assert read_qr_labels(page, any_format=True) == []


def test_a_short_first_part_is_joined_to_the_next_one(batch_scan: Path) -> None:
    result = preview_split(
        ScanSplitRules(path=str(batch_scan), mode="blank", min_pages=4), silent_progress()
    )
    assert [(part.first_page, part.last_page) for part in result.parts] == [(1, 8)]
