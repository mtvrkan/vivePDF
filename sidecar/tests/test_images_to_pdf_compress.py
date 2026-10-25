from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image

from vivepdf.ops.convert_images import ImagesToPdfParams, images_to_pdf, lossless_webp
from vivepdf.rpc.progress import silent_progress


def noisy_photo(width: int, height: int) -> Image.Image:
    generator = np.random.default_rng(7)
    pixels = generator.integers(0, 60, (height, width, 3), dtype=np.uint8)
    pixels[:, : width // 2, 0] += 190
    pixels[:, width // 2 :, 2] += 190
    return Image.fromarray(pixels)


def placed_images(path: str) -> list[tuple[str, int]]:
    with pymupdf.open(path) as document:
        return [
            (document.xref_get_key(xref, "Filter")[1], int(document.xref_get_key(xref, "Width")[1]))
            for xref, *_rest in document[0].get_images()
        ]


def converted(tmp_path: Path, image: Path, **options: object) -> str:
    params = ImagesToPdfParams(images=[str(image)], output=str(tmp_path / "o.pdf"), **options)
    return images_to_pdf(params, silent_progress()).output


def test_a_lossless_webp_stays_lossless_in_the_pdf(tmp_path: Path) -> None:
    source = tmp_path / "page.webp"
    noisy_photo(300, 200).save(source, lossless=True)

    output = converted(tmp_path, source)

    assert lossless_webp(source)
    assert placed_images(output) == [("/FlateDecode", 300)]


def test_a_lossy_webp_is_still_placed_as_a_jpeg(tmp_path: Path) -> None:
    source = tmp_path / "photo.webp"
    noisy_photo(300, 200).save(source, quality=80)

    output = converted(tmp_path, source)

    assert not lossless_webp(source)
    assert placed_images(output) == [("/DCTDecode", 300)]


def test_a_file_that_is_not_webp_is_not_called_lossless(tmp_path: Path) -> None:
    source = tmp_path / "fake.webp"
    source.write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt ")

    assert not lossless_webp(source)
    assert not lossless_webp(tmp_path / "missing.webp")


def test_compressing_turns_a_large_png_photo_into_a_smaller_jpeg(tmp_path: Path) -> None:
    source = tmp_path / "photo.png"
    noisy_photo(4000, 3000).save(source)

    output = converted(tmp_path, source, compress_photos=True)

    [(image_filter, width)] = placed_images(output)
    assert image_filter == "/DCTDecode"
    assert width < 2400
    assert Path(output).stat().st_size < source.stat().st_size / 3


def test_without_compressing_the_png_photo_keeps_every_pixel(tmp_path: Path) -> None:
    source = tmp_path / "photo.png"
    noisy_photo(4000, 3000).save(source)

    output = converted(tmp_path, source)

    assert placed_images(output) == [("/FlateDecode", 4000)]


def test_compressing_leaves_a_drawing_lossless(tmp_path: Path) -> None:
    source = tmp_path / "chart.png"
    drawing = Image.new("RGB", (4000, 3000), (255, 255, 255))
    drawing.paste((30, 90, 200), (400, 400, 1400, 2600))
    drawing.save(source)

    output = converted(tmp_path, source, compress_photos=True)

    assert placed_images(output) == [("/FlateDecode", 4000)]


def test_compressing_keeps_a_jpeg_that_is_already_small_enough(tmp_path: Path) -> None:
    source = tmp_path / "small.jpg"
    noisy_photo(800, 600).save(source, quality=85)

    output = converted(tmp_path, source, compress_photos=True)

    with pymupdf.open(output) as document:
        [(xref, *_rest)] = document[0].get_images()
        assert document.xref_stream_raw(xref) == source.read_bytes()


def test_a_compressed_photo_is_turned_upright_by_its_exif_orientation(tmp_path: Path) -> None:
    source = tmp_path / "turned.jpg"
    photo = noisy_photo(4800, 2400)
    exif = photo.getexif()
    exif[0x0112] = 6
    photo.save(source, exif=exif, quality=90)

    output = converted(tmp_path, source, compress_photos=True)

    with pymupdf.open(output) as document:
        pixmap = document[0].get_pixmap(dpi=36)
        [info] = document[0].get_image_info()
    box = pymupdf.Rect(info["bbox"])
    assert box.height > box.width
    top = pixmap.pixel(pixmap.width // 2, int(box.y0 / 2) + 3)
    bottom = pixmap.pixel(pixmap.width // 2, int(box.y1 / 2) - 3)
    assert top[0] > 150 and top[2] < 120
    assert bottom[2] > 150 and bottom[0] < 120
    assert placed_images(output)[0][1] < 2400
