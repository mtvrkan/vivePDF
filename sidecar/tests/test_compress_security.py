from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._watermark_style import WatermarkParams
from vivepdf.ops.compress import CompressParams, compress
from vivepdf.ops.security import DecryptParams, EncryptParams, Permissions, decrypt, encrypt
from vivepdf.ops.security_watermark import watermark
from vivepdf.ops.watermark_removal import RemoveWatermarkParams, remove_watermark
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def image_pdf(tmp_path: Path) -> Path:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 1600, 1200), False)
    pixmap.set_rect(pixmap.irect, (200, 30, 30))
    pixmap.set_rect(pymupdf.IRect(200, 200, 1400, 1000), (30, 30, 200))
    image = tmp_path / "big.png"
    pixmap.save(image)
    document = pymupdf.open()
    for _ in range(2):
        page = document.new_page(width=595, height=842)
        page.insert_image(pymupdf.Rect(36, 36, 559, 428), filename=str(image))
        page.insert_text((72, 500), "Görüntü sayfası")
    path = tmp_path / "images.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def logo_png(tmp_path: Path) -> Path:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 100), False)
    pixmap.set_rect(pixmap.irect, (0, 120, 60))
    path = tmp_path / "logo.png"
    pixmap.save(path)
    return path


def test_compress_reduces_size_and_keeps_pages(image_pdf: Path, tmp_path: Path) -> None:
    result = compress(
        CompressParams(path=str(image_pdf), output=str(tmp_path / "small.pdf"), profile="strong"),
        silent_progress(),
    )
    assert result.page_count == 2
    assert result.bytes_before == image_pdf.stat().st_size
    assert result.bytes_after < result.bytes_before
    with pymupdf.open(result.output) as document:
        assert "Görüntü" in document[0].get_text()


def test_compress_light_and_grayscale(image_pdf: Path, tmp_path: Path) -> None:
    light = compress(
        CompressParams(path=str(image_pdf), output=str(tmp_path / "light.pdf"), profile="light"),
        silent_progress(),
    )
    assert light.bytes_after > 0
    gray = compress(
        CompressParams(
            path=str(image_pdf),
            output=str(tmp_path / "gray.pdf"),
            profile="balanced",
            grayscale=True,
            strip_metadata=True,
        ),
        silent_progress(),
    )
    with pymupdf.open(gray.output) as document:
        xref = document[0].get_images()[0][0]
        assert document.extract_image(xref)["colorspace"] == 1


def test_compress_missing_file(tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        compress(
            CompressParams(path=str(tmp_path / "nope.pdf"), output=str(tmp_path / "o.pdf")),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.FILE_NOT_FOUND


def test_encrypt_then_decrypt(sample_pdf: Path, tmp_path: Path) -> None:
    locked = encrypt(
        EncryptParams(
            path=str(sample_pdf),
            output=str(tmp_path / "locked.pdf"),
            user_password="user",
            owner_password="owner",
            permissions=Permissions(copy_text=False, print=False),
        ),
        silent_progress(),
    )
    with pymupdf.open(locked.output) as document:
        assert document.needs_pass
        assert document.authenticate("user")
        assert not (document.permissions & pymupdf.PDF_PERM_COPY)
        assert not (document.permissions & pymupdf.PDF_PERM_PRINT)
    with pytest.raises(OpError) as raised:
        decrypt(
            DecryptParams(path=locked.output, password="wrong", output=str(tmp_path / "x.pdf")),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.NEEDS_PASSWORD
    unlocked = decrypt(
        DecryptParams(path=locked.output, password="owner", output=str(tmp_path / "open.pdf")),
        silent_progress(),
    )
    with pymupdf.open(unlocked.output) as document:
        assert not document.needs_pass
        assert document.page_count == 3


def test_encrypt_requires_a_password(sample_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        encrypt(
            EncryptParams(path=str(sample_pdf), output=str(tmp_path / "o.pdf")), silent_progress()
        )
    assert raised.value.code == ErrorCode.INVALID_PARAMS


def test_text_watermark_with_turkish_characters(sample_pdf: Path, tmp_path: Path) -> None:
    result = watermark(
        WatermarkParams(
            path=str(sample_pdf),
            output=str(tmp_path / "wm.pdf"),
            text="GİZLİ ŞABLON",
            position="tile",
            pages="1-2",
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        assert "GİZLİ ŞABLON" in document[0].get_text()
        assert "GİZLİ" not in document[2].get_text()


def test_image_watermark_and_validation(sample_pdf: Path, logo_png: Path, tmp_path: Path) -> None:
    result = watermark(
        WatermarkParams(
            path=str(sample_pdf),
            output=str(tmp_path / "logo.pdf"),
            kind="image",
            image_path=str(logo_png),
            position="bottom-right",
            opacity=0.5,
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        assert len(document[0].get_images()) == 1
    with pytest.raises(OpError):
        watermark(
            WatermarkParams(
                path=str(sample_pdf), output=str(tmp_path / "bad.pdf"), kind="text", text="  "
            ),
            silent_progress(),
        )
    with pytest.raises(OpError):
        watermark(
            WatermarkParams(path=str(sample_pdf), output=str(tmp_path / "bad2.pdf"), color="red"),
            silent_progress(),
        )


def test_remove_text_watermark_keeps_body_text(sample_pdf: Path, tmp_path: Path) -> None:
    stamped = watermark(
        WatermarkParams(
            path=str(sample_pdf), output=str(tmp_path / "wm.pdf"), text="GİZLİ", position="center"
        ),
        silent_progress(),
    )
    result = remove_watermark(
        RemoveWatermarkParams(
            path=stamped.output, output=str(tmp_path / "clean.pdf"), text="gizli"
        ),
        silent_progress(),
    )
    assert result.removed_text > 0
    with pymupdf.open(result.output) as document:
        assert document.page_count == 3
        assert "GİZLİ" not in document[0].get_text()
        assert "Page 1" in document[0].get_text()


def test_remove_repeated_image_and_stamp_annotations(
    sample_pdf: Path, logo_png: Path, tmp_path: Path
) -> None:
    mark = pymupdf.Rect(150, 300, 450, 600)
    with pymupdf.open(sample_pdf) as document:
        for page in document:
            page.insert_image(mark, filename=str(logo_png))
        document[0].add_stamp_annot(pymupdf.Rect(72, 200, 300, 260), stamp=0)
        document.save(tmp_path / "logo.pdf")
    kept = remove_watermark(
        RemoveWatermarkParams(path=str(tmp_path / "logo.pdf"), output=str(tmp_path / "kept.pdf")),
        silent_progress(),
    )
    assert kept.removed_annotations == 0
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(tmp_path / "logo.pdf"),
            output=str(tmp_path / "clean.pdf"),
            stamp_annotations=True,
        ),
        silent_progress(),
    )
    assert result.removed_images == 3
    assert result.removed_annotations == 1
    with pymupdf.open(result.output) as document:
        clip = mark
        for page in document:
            pixmap = page.get_pixmap(clip=clip)
            assert pixmap.samples.count(255) == len(pixmap.samples)
        assert not list(document[0].annots())


def test_remove_watermark_requires_a_target(sample_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        remove_watermark(
            RemoveWatermarkParams(
                path=str(sample_pdf),
                output=str(tmp_path / "x.pdf"),
                annotations=False,
                repeated_images=False,
            ),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.INVALID_PARAMS


def test_compress_grayscale_with_metadata_strip(image_pdf: Path, tmp_path: Path) -> None:
    with pymupdf.open(image_pdf) as document:
        document.set_metadata(
            {
                "title": "Renkli",
                "author": "Test",
                "creator": "Word",
                "producer": "Adobe PDF Library",
                "subject": "Deneme",
                "keywords": "gizli",
            }
        )
        document.save(tmp_path / "titled.pdf")
    result = compress(
        CompressParams(
            path=str(tmp_path / "titled.pdf"),
            output=str(tmp_path / "gray.pdf"),
            profile="strong",
            grayscale=True,
            strip_metadata=True,
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        left = {
            key: value
            for key, value in (document.metadata or {}).items()
            if value and key in {"title", "author", "subject", "keywords", "creator", "producer"}
        }
        assert left == {}, left
        assert document.page_count == 2
        pixmap = document[0].get_pixmap(dpi=36)
        red, green, blue = pixmap.pixel(pixmap.width // 2, pixmap.height // 4)
        assert red == green == blue


def test_compress_to_target_size_walks_the_ladder(image_pdf: Path, tmp_path: Path) -> None:
    generous = compress(
        CompressParams(
            path=str(image_pdf), output=str(tmp_path / "big.pdf"), target_bytes=50_000_000
        ),
        silent_progress(),
    )
    assert generous.target_met is True and generous.profile_used == "light"
    tight = compress(
        CompressParams(
            path=str(image_pdf), output=str(tmp_path / "tight.pdf"), target_bytes=10_000
        ),
        silent_progress(),
    )
    assert tight.target_met is True and tight.profile_used != "light"
    assert tight.bytes_after <= 10_000 < generous.bytes_after
    with pymupdf.open(tight.output) as document:
        assert document.page_count == 2


def test_owner_only_protection_is_reported_and_removed_without_a_password(
    sample_pdf: Path, tmp_path: Path
) -> None:
    from vivepdf.ops.info import InfoGetParams, get_info

    owner_only = encrypt(
        EncryptParams(
            path=str(sample_pdf),
            output=str(tmp_path / "rights only.pdf"),
            owner_password="owner",
            permissions=Permissions(copy_text=False),
        ),
        silent_progress(),
    )
    both = encrypt(
        EncryptParams(
            path=str(sample_pdf),
            output=str(tmp_path / "both.pdf"),
            user_password="user",
            owner_password="owner",
        ),
        silent_progress(),
    )
    info = get_info(InfoGetParams(path=owner_only.output), silent_progress())
    assert info.encrypted and info.owner_only
    locked = get_info(InfoGetParams(path=both.output, password="user"), silent_progress())
    assert locked.encrypted and not locked.owner_only
    plain = get_info(InfoGetParams(path=str(sample_pdf)), silent_progress())
    assert not plain.encrypted and not plain.owner_only
    unlocked = decrypt(
        DecryptParams(path=owner_only.output, output=str(tmp_path / "open.pdf")),
        silent_progress(),
    )
    with pymupdf.open(unlocked.output) as document:
        assert not document.is_encrypted
        assert document.metadata.get("encryption") is None
    with pytest.raises(OpError) as raised:
        decrypt(DecryptParams(path=both.output, output=str(tmp_path / "no.pdf")), silent_progress())
    assert raised.value.code == ErrorCode.NEEDS_PASSWORD
