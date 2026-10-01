from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops import _image_files, _story, convert_images
from vivepdf.ops.convert_images import ImagesToPdfParams, images_to_pdf
from vivepdf.ops.convert_to_pdf import FileToPdfParams, file_to_pdf
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _pdf_page_sizes(path: str) -> list[tuple[float, float]]:
    with pymupdf.open(path) as document:
        return [(round(page.rect.width), round(page.rect.height)) for page in document]


def test_image_sized_pages_follow_the_picture_resolution(tmp_path: Path) -> None:
    scan = tmp_path / "tarama.png"
    Image.new("RGB", (2480, 3508), "white").save(scan, dpi=(300, 300))
    result = images_to_pdf(
        ImagesToPdfParams(images=[str(scan)], output=str(tmp_path / "a4.pdf"), page_size="image"),
        silent_progress(),
    )
    assert _pdf_page_sizes(result.output) == [(595, 842)]


def test_pictures_without_a_resolution_are_laid_out_at_96_dpi(tmp_path: Path) -> None:
    plain = tmp_path / "duz.png"
    Image.new("RGB", (960, 480), "white").save(plain)
    result = images_to_pdf(
        ImagesToPdfParams(images=[str(plain)], output=str(tmp_path / "p.pdf"), page_size="image"),
        silent_progress(),
    )
    assert _pdf_page_sizes(result.output) == [(720, 360)]


def test_sixteen_bit_pages_of_a_tiff_keep_their_greys(tmp_path: Path) -> None:
    tiff = tmp_path / "derin.tif"
    frames = [Image.new("I;16", (60, 40), 32000) for _ in range(2)]
    frames[0].save(tiff, save_all=True, append_images=frames[1:])
    result = images_to_pdf(
        ImagesToPdfParams(images=[str(tiff)], output=str(tmp_path / "t.pdf"), page_size="image"),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        assert document.page_count == 2
        pixel = document[1].get_pixmap().pixel(20, 20)
    assert all(110 < value < 140 for value in pixel[:3])


def test_a_picture_above_the_safe_size_is_not_decoded_another_way(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(_image_files, "LARGE_PICTURE_PIXELS", 10_000)
    decoded: list[Path] = []
    monkeypatch.setattr(convert_images, "_native_frame", lambda image: decoded.append(image))
    big = tmp_path / "bomba.png"
    Image.new("1", (400, 400)).save(big)
    with pytest.raises(OpError) as caught:
        images_to_pdf(
            ImagesToPdfParams(images=[str(big)], output=str(tmp_path / "b.pdf")),
            silent_progress(),
        )
    assert caught.value.data["reason"] == "pictureTooLarge"
    assert decoded == []


def test_a_folder_picture_above_the_safe_size_is_skipped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(_image_files, "LARGE_PICTURE_PIXELS", 10_000)
    folder = tmp_path / "klasor"
    folder.mkdir()
    Image.new("1", (400, 400)).save(folder / "a-buyuk.png")
    Image.new("RGB", (40, 40), "red").save(folder / "b-kucuk.png")
    result = images_to_pdf(
        ImagesToPdfParams(folders=[str(folder)], output=str(tmp_path / "k.pdf")),
        silent_progress(),
    )
    assert result.page_count == 1
    assert result.skipped == ["a-buyuk.png"]


def test_avif_pictures_are_collected_from_folders(tmp_path: Path) -> None:
    folder = tmp_path / "avif"
    folder.mkdir()
    Image.new("RGB", (40, 30), "blue").save(folder / "resim.avif")
    result = images_to_pdf(
        ImagesToPdfParams(folders=[str(folder)], output=str(tmp_path / "v.pdf")),
        silent_progress(),
    )
    assert result.page_count == 1


def test_an_empty_folder_names_its_reason(tmp_path: Path) -> None:
    folder = tmp_path / "bos"
    folder.mkdir()
    with pytest.raises(OpError) as caught:
        images_to_pdf(
            ImagesToPdfParams(folders=[str(folder)], output=str(tmp_path / "e.pdf")),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "noImages"}


def test_an_unsupported_file_type_names_its_reason(tmp_path: Path) -> None:
    odd = tmp_path / "veri.xyz"
    odd.write_text("x", encoding="utf-8")
    with pytest.raises(OpError) as caught:
        file_to_pdf(
            FileToPdfParams(path=str(odd), output=str(tmp_path / "x.pdf")), silent_progress()
        )
    assert caught.value.data["reason"] == "unsupportedType"


def test_text_that_would_run_past_the_page_limit_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(_story, "MAX_STORY_PAGES", 2)
    long_text = tmp_path / "uzun.txt"
    long_text.write_text("satır\n" * 400, encoding="utf-8")
    target = tmp_path / "uzun.pdf"
    with pytest.raises(OpError) as caught:
        file_to_pdf(FileToPdfParams(path=str(long_text), output=str(target)), silent_progress())
    assert caught.value.data["reason"] == "tooManyPages"
    assert not target.exists()


def test_a_text_conversion_can_be_cancelled(tmp_path: Path) -> None:
    import threading

    from vivepdf.rpc.progress import Progress

    stopped = threading.Event()
    stopped.set()
    text = tmp_path / "metin.txt"
    text.write_text("satır\n" * 50, encoding="utf-8")
    with pytest.raises(OpError) as caught:
        file_to_pdf(
            FileToPdfParams(path=str(text), output=str(tmp_path / "m.pdf")),
            Progress(lambda *_args: None, stopped),
        )
    assert caught.value.code == ErrorCode.CANCELLED
