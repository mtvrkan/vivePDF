from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._watermark_style import WatermarkParams
from vivepdf.ops.security import DecryptParams, EncryptParams, Permissions, decrypt, encrypt
from vivepdf.ops.security_watermark import watermark
from vivepdf.ops.watermark_detection import DetectWatermarkParams, detect_watermark
from vivepdf.ops.watermark_removal import RemoveWatermarkParams, remove_watermark
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

LONG_MARK = "GIZLI - COGALTILAMAZ - SIRKET ICI KULLANIM ICINDIR"


def _square(path: Path, size: int, color: tuple[int, int, int]) -> Path:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, size, size))
    pixmap.set_rect(pixmap.irect, color)
    pixmap.save(path)
    return path


@pytest.fixture
def report_pdf(tmp_path: Path) -> Path:
    logo = _square(tmp_path / "logo.png", 60, (12, 140, 230))
    document = pymupdf.open()
    for _index in range(8):
        page = document.new_page(width=595, height=842)
        for line in range(10):
            page.insert_text((72, 120 + line * 18), f"Satir {line + 1}", fontsize=11)
        page.insert_image(pymupdf.Rect(480, 40, 540, 100), filename=str(logo))
    path = tmp_path / "report.pdf"
    document.save(path)
    document.close()
    return path


def test_encrypt_rejects_a_password_longer_than_the_pdf_limit(sample_pdf: Path, tmp_path: Path):
    with pytest.raises(OpError) as caught:
        encrypt(
            EncryptParams(
                path=str(sample_pdf), output=str(tmp_path / "long.pdf"), user_password="a" * 128
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data == {"reason": "passwordTooLong", "maxBytes": 127}


def test_encrypt_accepts_the_longest_allowed_password(sample_pdf: Path, tmp_path: Path):
    target = tmp_path / "limit.pdf"
    encrypt(
        EncryptParams(path=str(sample_pdf), output=str(target), user_password="a" * 40),
        silent_progress(),
    )
    document = pymupdf.open(target)
    assert document.authenticate("a" * 40)
    document.close()


def test_a_watermark_wider_than_the_page_is_shrunk_to_fit(sample_pdf: Path, tmp_path: Path):
    target = tmp_path / "wide.pdf"
    watermark(
        WatermarkParams(
            path=str(sample_pdf), output=str(target), text=LONG_MARK, font_size=48, rotation=45
        ),
        silent_progress(),
    )
    document = pymupdf.open(target)
    page = document[0]
    words = [word for word in page.get_text("words") if word[4] in {"GIZLI", "ICINDIR"}]
    box = pymupdf.Rect(words[0][:4])
    for word in words[1:]:
        box |= pymupdf.Rect(word[:4])
    bounds = pymupdf.Rect(page.rect) + (-1, -1, 1, 1)
    document.close()
    assert len(words) == 2
    assert box in bounds


def test_a_header_logo_is_listed_but_not_preselected(report_pdf: Path):
    result = detect_watermark(DetectWatermarkParams(path=str(report_pdf)), silent_progress())
    images = [item for item in result.candidates if item.kind == "image"]
    assert len(images) == 1
    assert images[0].pages == 8
    assert images[0].confident is False


def test_a_centred_picture_mark_is_preselected(tmp_path: Path, report_pdf: Path):
    mark = _square(tmp_path / "mark.png", 400, (220, 220, 220))
    target = tmp_path / "picture-mark.pdf"
    watermark(
        WatermarkParams(
            path=str(report_pdf), output=str(target), kind="image", image_path=str(mark)
        ),
        silent_progress(),
    )
    result = detect_watermark(DetectWatermarkParams(path=str(target)), silent_progress())
    confident = [item for item in result.candidates if item.kind == "image" and item.confident]
    assert len(confident) == 1


def test_blind_image_removal_keeps_a_header_logo(report_pdf: Path, tmp_path: Path):
    target = tmp_path / "kept.pdf"
    result = remove_watermark(
        RemoveWatermarkParams(path=str(report_pdf), output=str(target), repeated_images=True),
        silent_progress(),
    )
    document = pymupdf.open(target)
    sizes = [
        (image[2], image[3])
        for index in range(document.page_count)
        for image in document[index].get_images(full=True)
    ]
    document.close()
    assert result.removed_images == 0
    assert all(width > 1 and height > 1 for width, height in sizes)


def test_a_mark_on_a_single_page_is_still_detected(report_pdf: Path, tmp_path: Path):
    target = tmp_path / "cover.pdf"
    watermark(
        WatermarkParams(path=str(report_pdf), output=str(target), text="ORNEKTIR", pages="1"),
        silent_progress(),
    )
    result = detect_watermark(DetectWatermarkParams(path=str(target)), silent_progress())
    assert any(item.kind == "text" and item.text == "ORNEKTIR" for item in result.candidates)


def test_clipped_tiles_do_not_produce_partial_duplicates(report_pdf: Path, tmp_path: Path):
    target = tmp_path / "tiled.pdf"
    watermark(
        WatermarkParams(
            path=str(report_pdf),
            output=str(target),
            text="DENEME",
            position="tile",
            font_size=28,
        ),
        silent_progress(),
    )
    result = detect_watermark(DetectWatermarkParams(path=str(target)), silent_progress())
    texts = [item.text for item in result.candidates if item.kind == "text"]
    assert "DENEME" in texts
    assert not any(text != "DENEME" and text in "DENEME" for text in texts)


def test_a_protected_document_stays_protected_after_a_watermark_run(
    sample_pdf: Path, tmp_path: Path
):
    locked = tmp_path / "locked.pdf"
    encrypt(
        EncryptParams(
            path=str(sample_pdf),
            output=str(locked),
            user_password="pw",
            permissions=Permissions(copy_text=False),
        ),
        silent_progress(),
    )
    before = pymupdf.open(locked)
    before.authenticate("pw")
    permissions = before.permissions
    before.close()

    target = tmp_path / "locked-mark.pdf"
    watermark(
        WatermarkParams(path=str(locked), password="pw", output=str(target), text="TASLAK"),
        silent_progress(),
    )
    after = pymupdf.open(target)
    assert after.needs_pass
    assert after.authenticate("pw")
    assert after.permissions == permissions
    after.close()


def test_removing_the_password_still_produces_an_open_file(sample_pdf: Path, tmp_path: Path):
    locked = tmp_path / "locked2.pdf"
    encrypt(
        EncryptParams(path=str(sample_pdf), output=str(locked), user_password="pw"),
        silent_progress(),
    )
    target = tmp_path / "open.pdf"
    decrypt(DecryptParams(path=str(locked), password="pw", output=str(target)), silent_progress())
    document = pymupdf.open(target)
    assert not document.needs_pass
    assert not document.is_encrypted
    document.close()


def test_compressing_a_protected_document_keeps_the_password(sample_pdf: Path, tmp_path: Path):
    from vivepdf.ops.compress import CompressParams, compress

    locked = tmp_path / "locked3.pdf"
    encrypt(
        EncryptParams(path=str(sample_pdf), output=str(locked), user_password="pw"),
        silent_progress(),
    )
    target = tmp_path / "small.pdf"
    compress(
        CompressParams(path=str(locked), password="pw", output=str(target), profile="balanced"),
        silent_progress(),
    )
    document = pymupdf.open(target)
    assert document.needs_pass
    assert document.authenticate("pw")
    document.close()


def test_an_in_place_rewrite_keeps_the_password(sample_pdf: Path, tmp_path: Path):
    from vivepdf.ops._inplace import rewrite_in_place

    locked = tmp_path / "locked4.pdf"
    encrypt(
        EncryptParams(path=str(sample_pdf), output=str(locked), user_password="pw"),
        silent_progress(),
    )
    document = pymupdf.open(locked)
    document.authenticate("pw")
    rewrite_in_place(document, str(locked))
    reopened = pymupdf.open(locked)
    assert reopened.needs_pass
    assert reopened.authenticate("pw")
    reopened.close()


def test_decrypt_refuses_a_file_without_a_password(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page()
    source = tmp_path / "plain.pdf"
    document.save(source)
    document.close()
    with pytest.raises(OpError) as error:
        decrypt(
            DecryptParams(path=str(source), password="", output=str(tmp_path / "out.pdf")),
            silent_progress(),
        )
    assert error.value.code is ErrorCode.INVALID_PARAMS
    assert error.value.data == {"reason": "notEncrypted"}
