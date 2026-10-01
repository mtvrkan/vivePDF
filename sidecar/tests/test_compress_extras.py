import base64
from pathlib import Path

import pymupdf
import pytest
from pydantic import ValidationError

from vivepdf.ops import compress as compress_module
from vivepdf.ops._compress_cleanup import Cleanup
from vivepdf.ops.compress import CompressParams, Shrunk, compress, image_settings
from vivepdf.ops.compress_preview import CompressPreviewParams, compress_preview
from vivepdf.ops.space import SpaceParams, space
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


def _noisy_pixmap(width: int, height: int) -> pymupdf.Pixmap:
    samples = bytes(
        (x * 7 + y * 13 + (x * y) % 97) % 256
        for y in range(height)
        for x in range(width)
        for _ in range(3)
    )
    return pymupdf.Pixmap(pymupdf.csRGB, width, height, samples, False)


@pytest.fixture
def photo(tmp_path: Path) -> Path:
    document = pymupdf.open()
    big = _noisy_pixmap(1200, 900)
    small = _noisy_pixmap(200, 150)
    first = document.new_page(width=595, height=842)
    first.insert_image(pymupdf.Rect(0, 0, 288, 216), stream=big.tobytes("jpeg", jpg_quality=95))
    second = document.new_page(width=595, height=842)
    second.insert_image(pymupdf.Rect(0, 0, 144, 108), pixmap=small)
    second.insert_text((72, 400), "Gövde metni", fontsize=12, fontname="dejavu", fontfile=FONT)
    path = tmp_path / "photo.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def cluttered(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 100), "Body", fontsize=12)
    page.add_text_annot((100, 100), "note")
    page.add_highlight_annot(pymupdf.Rect(72, 88, 120, 104))
    page.add_file_annot((200, 200), b"attached bytes", "note.txt")
    page.insert_link(
        {
            "kind": pymupdf.LINK_URI,
            "from": pymupdf.Rect(300, 300, 400, 320),
            "uri": "https://example.com",
        }
    )
    widget = pymupdf.Widget()
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.field_name = "name"
    widget.rect = pymupdf.Rect(72, 500, 272, 520)
    page.add_widget(widget)
    document.embfile_add("data.xml", b"<data/>", filename="data.xml")
    script = document.get_new_xref()
    document.update_object(script, "<</S/JavaScript/JS(app.alert\\(1\\))>>")
    document.xref_set_key(document.pdf_catalog(), "OpenAction", f"{script} 0 R")
    path = tmp_path / "cluttered.pdf"
    document.save(path)
    document.close()
    return path


def _image_widths(path: str) -> list[int]:
    with pymupdf.open(path) as document:
        return sorted(entry[2] for entry in document.get_page_images(0, full=True))


def test_custom_profile_resamples_to_the_chosen_dpi(photo: Path, tmp_path: Path) -> None:
    result = compress(
        CompressParams(
            path=str(photo),
            output=str(tmp_path / "custom.pdf"),
            profile="custom",
            custom_dpi=100,
            custom_quality=50,
        ),
        silent_progress(),
    )
    assert result.profile_used == "custom"
    assert result.bytes_after < result.bytes_before
    assert _image_widths(result.output)[-1] <= 600


def test_custom_settings_derive_the_threshold_from_the_dpi() -> None:
    settings = image_settings("custom", 150, 70)
    assert settings is not None
    assert (settings.dpi_target, settings.dpi_threshold, settings.quality) == (150, 200, 70)
    assert image_settings("light", 150, 70) is None


def test_custom_values_are_bounded() -> None:
    with pytest.raises(ValidationError):
        CompressParams(path="a.pdf", output="b.pdf", profile="custom", custom_dpi=20)
    with pytest.raises(ValidationError):
        CompressParams(path="a.pdf", output="b.pdf", profile="custom", custom_quality=100)


def test_cleanup_removes_attachments_comments_and_scripts(cluttered: Path, tmp_path: Path) -> None:
    result = compress(
        CompressParams(
            path=str(cluttered),
            output=str(tmp_path / "clean.pdf"),
            profile="light",
            remove_attachments=True,
            remove_comments=True,
            remove_scripts=True,
        ),
        silent_progress(),
    )
    assert (result.attachments_removed, result.comments_removed) == (2, 2)
    assert result.scripts_removed >= 1
    with pymupdf.open(result.output) as document:
        page = document[0]
        assert document.embfile_count() == 0
        assert list(page.annots()) == []
        assert len(page.get_links()) == 1
        assert len(list(page.widgets())) == 1
        catalog = document.pdf_catalog()
        assert document.xref_get_key(catalog, "OpenAction")[0] == "null"
        assert "app.alert" not in document.tobytes(garbage=0).decode("latin-1")


def test_cleanup_is_off_by_default(cluttered: Path, tmp_path: Path) -> None:
    result = compress(
        CompressParams(path=str(cluttered), output=str(tmp_path / "kept.pdf"), profile="light"),
        silent_progress(),
    )
    assert (result.attachments_removed, result.comments_removed, result.scripts_removed) == (
        0,
        0,
        0,
    )
    with pymupdf.open(result.output) as document:
        assert document.embfile_count() == 1
        assert len(list(document[0].annots())) >= 3


def test_comments_alone_keep_file_attachments(cluttered: Path, tmp_path: Path) -> None:
    result = compress(
        CompressParams(
            path=str(cluttered),
            output=str(tmp_path / "c.pdf"),
            profile="light",
            remove_comments=True,
        ),
        silent_progress(),
    )
    assert result.comments_removed == 2
    with pymupdf.open(result.output) as document:
        kinds = {annot.type[0] for annot in document[0].annots()}
        assert kinds == {pymupdf.PDF_ANNOT_FILE_ATTACHMENT}


def test_a_cleanup_is_written_even_if_bigger(
    cluttered: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bloated = Shrunk(
        b"%PDF-1.7\n" + b"0" * (cluttered.stat().st_size * 2), 0, 0, Cleanup(comments=1)
    )
    monkeypatch.setattr(compress_module, "_shrink", lambda *args, **kwargs: bloated)
    monkeypatch.setattr(compress_module, "_privacy_only", lambda *args, **kwargs: bloated)
    result = compress(
        CompressParams(
            path=str(cluttered),
            output=str(tmp_path / "out.pdf"),
            profile="light",
            remove_comments=True,
        ),
        silent_progress(),
    )
    assert not result.kept_original
    assert result.comments_removed == 1


def test_space_lists_the_largest_images_and_fonts(photo: Path) -> None:
    report = space(SpaceParams(path=str(photo)), silent_progress())
    assert [image.bytes for image in report.largest_images] == sorted(
        (image.bytes for image in report.largest_images), reverse=True
    )
    biggest = report.largest_images[0]
    assert (biggest.width, biggest.height, biggest.format, biggest.pages) == (
        1200,
        900,
        "jpeg",
        [1],
    )
    assert biggest.dpi == 300
    assert report.largest_images[-1].pages == [2]
    font = report.largest_fonts[0]
    assert "DejaVu" in font.name
    assert font.format == "truetype"


def test_space_without_images_or_fonts(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page()
    path = tmp_path / "blank.pdf"
    document.save(path)
    document.close()
    report = space(SpaceParams(path=str(path)), silent_progress())
    assert report.largest_images == []
    assert report.largest_fonts == []


def test_preview_shows_the_page_before_and_after(photo: Path) -> None:
    result = compress_preview(
        CompressPreviewParams(
            path=str(photo), page=0, profile="custom", custom_dpi=72, custom_quality=30, dpi=60
        ),
        silent_progress(),
    )
    assert result.page_count == 2
    assert result.bytes_after < result.bytes_before
    for encoded in (result.before, result.after):
        assert base64.b64decode(encoded)[:2] == b"\xff\xd8"
    assert result.width == round(595 * 60 / 72)
    with pymupdf.open(photo) as document:
        assert document[0].get_images()[0][2] == 1200


def test_preview_light_changes_no_image(photo: Path) -> None:
    result = compress_preview(
        CompressPreviewParams(path=str(photo), page=0, profile="light"), silent_progress()
    )
    assert result.before == result.after


def test_preview_refuses_a_page_out_of_range(photo: Path) -> None:
    with pytest.raises(OpError) as caught:
        compress_preview(CompressPreviewParams(path=str(photo), page=5), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PARAMS
