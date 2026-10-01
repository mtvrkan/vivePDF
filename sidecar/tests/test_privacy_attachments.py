import io
import re
from pathlib import Path

import pymupdf
from PIL import Image

from vivepdf.ops._payloads import stripped_jpeg
from vivepdf.ops.privacy import InspectParams, inspect
from vivepdf.ops.privacy_sanitize import SanitizeParams, sanitize
from vivepdf.rpc.progress import silent_progress

PAYLOAD = b"<invoice>SECRETPAYLOAD</invoice>"


def _all_bytes(path: Path) -> bytes:
    with pymupdf.open(path) as document:
        return b"".join(
            document.xref_stream(xref) or b""
            for xref in range(1, document.xref_length())
            if document.xref_is_stream(xref)
        )


def _associated(document: pymupdf.Document, name: str) -> int:
    stream = document.get_new_xref()
    document.update_object(stream, "<</Type/EmbeddedFile>>")
    document.update_stream(stream, PAYLOAD)
    spec = document.get_new_xref()
    document.update_object(
        spec, f"<</Type/Filespec/F({name})/UF({name})/AFRelationship/Data/EF<</F {stream} 0 R>>>>"
    )
    return spec


def _photo(exif_text: str) -> bytes:
    picture = Image.new("RGB", (24, 24), (180, 40, 40))
    exif = Image.Exif()
    exif[0x010F] = exif_text
    buffer = io.BytesIO()
    picture.save(buffer, "JPEG", exif=exif.tobytes())
    return buffer.getvalue()


def _clean(source: Path, tmp_path: Path, **options: bool) -> Path:
    result = sanitize(
        SanitizeParams(path=str(source), output=str(tmp_path / f"clean-{source.name}"), **options),
        silent_progress(),
    )
    return Path(result.output)


def test_a_file_linked_only_through_af_is_found_and_removed(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Invoice")
    spec = _associated(document, "invoice.xml")
    document.xref_set_key(document.pdf_catalog(), "AF", f"[{spec} 0 R]")
    source = tmp_path / "af.pdf"
    document.save(source)
    document.close()
    assert inspect(InspectParams(path=str(source)), silent_progress()).embedded_files == [
        "invoice.xml"
    ]
    output = _clean(source, tmp_path)
    assert inspect(InspectParams(path=str(output)), silent_progress()).embedded_files == []
    assert b"SECRETPAYLOAD" not in _all_bytes(output)


def test_a_file_in_both_the_name_tree_and_af_is_counted_once(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page()
    document.embfile_add("factur-x.xml", PAYLOAD, filename="factur-x.xml", ufilename="factur-x.xml")
    catalog = document.pdf_catalog()
    names = document.xref_get_key(catalog, "Names/EmbeddedFiles/Names")[1]
    spec = int(re.findall(r"(\d+) 0 R", names)[0])
    document.xref_set_key(catalog, "AF", f"[{spec} 0 R]")
    document.xref_set_key(catalog, "Collection", "<</View/D>>")
    source = tmp_path / "pdfa3.pdf"
    document.save(source)
    document.close()
    assert inspect(InspectParams(path=str(source)), silent_progress()).embedded_files == [
        "factur-x.xml"
    ]
    output = _clean(source, tmp_path)
    assert b"SECRETPAYLOAD" not in _all_bytes(output)
    with pymupdf.open(output) as cleaned:
        catalog = cleaned.pdf_catalog()
        assert cleaned.xref_get_key(catalog, "AF")[0] == "null"
        assert cleaned.xref_get_key(catalog, "Collection")[0] == "null"


def test_camera_details_in_a_photo_are_found_and_removed(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_image(pymupdf.Rect(72, 72, 172, 172), stream=_photo("SECRETCAMERA"))
    source = tmp_path / "photo.pdf"
    document.save(source)
    document.close()
    assert inspect(InspectParams(path=str(source)), silent_progress()).image_metadata == 1
    result = sanitize(
        SanitizeParams(path=str(source), output=str(tmp_path / "clean.pdf")), silent_progress()
    )
    assert result.removed["imageMetadata"] == 1
    with pymupdf.open(result.output) as cleaned:
        xref = cleaned[0].get_images()[0][0]
        assert cleaned.xref_get_key(xref, "Filter")[1] == "/DCTDecode"
        assert b"SECRETCAMERA" not in cleaned.xref_stream_raw(xref)
        picture = pymupdf.Pixmap(cleaned, xref)
        assert (picture.width, picture.height) == (24, 24)
        assert picture.pixel(12, 12)[0] > 150


def test_photo_details_stay_when_not_asked(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_image(pymupdf.Rect(0, 0, 50, 50), stream=_photo("KEEPCAMERA"))
    source = tmp_path / "keep.pdf"
    document.save(source)
    document.close()
    output = _clean(source, tmp_path, image_metadata=False)
    assert inspect(InspectParams(path=str(output)), silent_progress()).image_metadata == 1


def test_jpeg_metadata_stripping_keeps_the_picture_segments() -> None:
    photo = _photo("CAM")
    cleaned = stripped_jpeg(photo)
    assert cleaned is not None
    assert b"Exif" not in cleaned
    assert cleaned.endswith(photo[-200:])
    assert stripped_jpeg(cleaned) is None
    commented = photo[:2] + b"\xff\xfe\x00\x07hello" + photo[2:]
    assert b"hello" not in (stripped_jpeg(commented) or b"hello")
    assert stripped_jpeg(b"\xff\xd8\xff\xe1\xff\xff") is None
    assert stripped_jpeg(b"not a jpeg") is None
