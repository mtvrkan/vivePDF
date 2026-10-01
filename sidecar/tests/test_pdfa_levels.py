import io
from pathlib import Path

import pymupdf
import pytest
from PIL import Image, ImageCms

from vivepdf.ops._pdfa_levels import claim_satisfies, srgb_profile_v2
from vivepdf.ops.pdfa import PdfaCheckParams, PdfaConvertParams, check, convert
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


def _checks(report) -> dict[str, object]:
    return {item.id: item for item in report.checks}


def _jpx_image() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (24, 24), (200, 30, 30)).save(buffer, "JPEG2000")
    return buffer.getvalue()


@pytest.fixture
def part_one_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Archive level one", fontname="helv")
    page.insert_image(pymupdf.Rect(100, 100, 200, 200), stream=_jpx_image())
    document.xref_set_key(page.xref, "Group", "<< /S /Transparency /CS /DeviceRGB >>")
    layer = document.add_ocg("Notes", on=True)
    page.insert_text((72, 300), "Layered", fontname="helv", oc=layer)
    path = tmp_path / "part-one.pdf"
    document.save(path, use_objstms=True)
    document.close()
    return path


def test_level_one_lists_its_own_checks(part_one_pdf: Path):
    report = check(PdfaCheckParams(path=str(part_one_pdf), level="1b"), silent_progress())
    checks = _checks(report)
    assert report.level == "1b"
    for failing in ("transparency", "jpeg2000", "objectStreams", "layers"):
        assert checks[failing].status == "fail", failing
        assert checks[failing].fixable, failing
    assert "unicode" not in checks
    assert report.convertible


def test_level_two_does_not_list_level_one_checks(part_one_pdf: Path):
    checks = _checks(check(PdfaCheckParams(path=str(part_one_pdf)), silent_progress()))
    assert checks["layers"].fixable
    for absent in ("transparency", "jpeg2000", "objectStreams", "unicode"):
        assert absent not in checks


def test_level_one_conversion_writes_a_classic_file(part_one_pdf: Path, tmp_path: Path):
    target = tmp_path / "archive.pdf"
    result = convert(
        PdfaConvertParams(path=str(part_one_pdf), output=str(target), level="1b"),
        silent_progress(),
    )
    assert result.report.ready, [item for item in result.report.checks if item.status == "fail"]
    assert result.report.claimed == "PDF/A-1b"
    assert {"transparency", "jpeg2000", "objectStreams", "layers"} <= set(result.fixed)
    raw = target.read_bytes()
    assert b"/ObjStm" not in raw
    assert b"JPXDecode" not in raw
    with pymupdf.open(target) as document:
        catalog = document.pdf_catalog()
        assert document.xref_get_key(catalog, "OCProperties")[0] == "null"
        assert "Layered" in document[0].get_text()
        intent = int(document.xref_get_key(catalog, "OutputIntents")[1].strip("[]").split()[0])
        profile = int(document.xref_get_key(intent, "DestOutputProfile")[1].split()[0])
        assert document.xref_stream(profile)[8] == 2


def test_a_version_four_profile_is_replaced_for_level_one(tmp_path: Path):
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Profile", fontname="helv")
    source = tmp_path / "plain.pdf"
    document.save(source)
    document.close()
    archived = tmp_path / "archived.pdf"
    convert(PdfaConvertParams(path=str(source), output=str(archived)), silent_progress())
    intent = _checks(check(PdfaCheckParams(path=str(archived), level="1b"), silent_progress()))[
        "outputIntent"
    ]
    assert intent.status == "fail"
    assert intent.fixable
    assert intent.value == "iccVersion"
    again = tmp_path / "again.pdf"
    result = convert(
        PdfaConvertParams(path=str(archived), output=str(again), level="1b"), silent_progress()
    )
    assert _checks(result.report)["outputIntent"].status == "pass"


def test_real_transparency_blocks_level_one(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    page.draw_rect(
        pymupdf.Rect(50, 50, 200, 200), color=(0, 0, 1), fill=(1, 0, 0), fill_opacity=0.4
    )
    source = tmp_path / "see-through.pdf"
    document.save(source)
    document.close()
    report = check(PdfaCheckParams(path=str(source), level="1b"), silent_progress())
    transparency = _checks(report)["transparency"]
    assert transparency.status == "fail"
    assert not transparency.fixable
    assert not report.convertible
    with pytest.raises(OpError) as raised:
        convert(
            PdfaConvertParams(path=str(source), output=str(tmp_path / "out.pdf"), level="1b"),
            silent_progress(),
        )
    assert raised.value.data["checks"] == ["transparency"]


def test_hidden_layers_block_level_one(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    layer = document.add_ocg("Hidden", on=False)
    page.insert_text((72, 72), "Invisible", fontname="helv", oc=layer)
    source = tmp_path / "hidden.pdf"
    document.save(source)
    document.close()
    layers = _checks(check(PdfaCheckParams(path=str(source), level="1b"), silent_progress()))[
        "layers"
    ]
    assert layers.status == "fail"
    assert not layers.fixable


def test_level_2u_needs_readable_text(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    page.insert_font(fontname="F1", fontbuffer=pymupdf.Font("helv").buffer)
    page.insert_text((72, 72), "Hello", fontname="F1")
    for font in page.get_fonts(full=True):
        document.xref_set_key(font[0], "ToUnicode", "null")
    source = tmp_path / "no-unicode.pdf"
    document.save(source)
    document.close()
    report = check(PdfaCheckParams(path=str(source), level="2u"), silent_progress())
    unicode = _checks(report)["unicode"]
    assert unicode.status == "fail"
    assert unicode.count == 1
    assert not unicode.fixable
    assert "unicode" not in _checks(check(PdfaCheckParams(path=str(source)), silent_progress()))


def test_level_2u_conversion_claims_2u(tmp_path: Path):
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Readable", fontname="helv")
    source = tmp_path / "plain.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "archive.pdf"
    result = convert(
        PdfaConvertParams(path=str(source), output=str(target), level="2u"), silent_progress()
    )
    assert result.report.ready
    assert result.report.claimed == "PDF/A-2u"


def test_level_3b_keeps_attachments_and_associates_them(tmp_path: Path):
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Invoice", fontname="helv")
    document.embfile_add("invoice.xml", b"<invoice total='12'/>", filename="invoice.xml")
    source = tmp_path / "invoice.pdf"
    document.save(source)
    document.close()
    before = check(PdfaCheckParams(path=str(source), level="3b"), silent_progress())
    attachments = _checks(before)["attachments"]
    assert attachments.status == "fail"
    assert attachments.fixable
    target = tmp_path / "archive.pdf"
    result = convert(
        PdfaConvertParams(path=str(source), output=str(target), level="3b"), silent_progress()
    )
    assert result.report.ready, [item for item in result.report.checks if item.status == "fail"]
    assert result.report.claimed == "PDF/A-3b"
    with pymupdf.open(target) as written:
        assert written.embfile_count() == 1
        assert written.embfile_get(0) == b"<invoice total='12'/>"
        catalog = written.pdf_catalog()
        associated = written.xref_get_key(catalog, "AF")
        assert associated[0] == "array"
        spec = int(associated[1].strip("[]").split()[0])
        assert written.xref_get_key(spec, "AFRelationship")[1] == "/Unspecified"
        stream = int(written.xref_get_key(spec, "EF/F")[1].split()[0])
        assert written.xref_get_key(stream, "Subtype")[1] in ("/application/xml", "/text/xml")


def test_level_2b_still_removes_attachments(tmp_path: Path):
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Invoice", fontname="helv")
    document.embfile_add("invoice.xml", b"<invoice/>")
    source = tmp_path / "invoice.pdf"
    document.save(source)
    document.close()
    target = tmp_path / "archive.pdf"
    convert(PdfaConvertParams(path=str(source), output=str(target)), silent_progress())
    with pymupdf.open(target) as written:
        assert written.embfile_count() == 0


def test_a_different_claim_fails_the_metadata_check(tmp_path: Path):
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Claimed", fontname="helv")
    source = tmp_path / "plain.pdf"
    document.save(source)
    document.close()
    archived = tmp_path / "archived.pdf"
    convert(PdfaConvertParams(path=str(source), output=str(archived)), silent_progress())
    metadata = _checks(check(PdfaCheckParams(path=str(archived), level="3b"), silent_progress()))[
        "metadata"
    ]
    assert metadata.status == "fail"
    assert metadata.value == "PDF/A-2b"


@pytest.mark.parametrize(
    ("claimed", "level", "expected"),
    [
        ("PDF/A-2b", "2b", True),
        ("PDF/A-2u", "2b", True),
        ("PDF/A-2a", "2u", True),
        ("PDF/A-2b", "2u", False),
        ("PDF/A-1b", "2b", False),
        ("PDF/A-2", "2b", False),
        (None, "1b", False),
    ],
)
def test_claims_count_when_they_cover_the_level(claimed, level, expected):
    assert claim_satisfies(claimed, level) is expected


def test_the_part_one_profile_is_a_valid_version_two_icc():
    data = srgb_profile_v2("sRGB IEC61966-2.1")
    profile = ImageCms.ImageCmsProfile(io.BytesIO(data))
    assert data[8] == 2
    assert int.from_bytes(data[:4], "big") == len(data)
    transform = ImageCms.buildTransform(ImageCms.createProfile("sRGB"), profile, "RGB", "RGB")
    pixel = ImageCms.applyTransform(Image.new("RGB", (1, 1), (200, 100, 50)), transform)
    assert pixel.getpixel((0, 0)) == (200, 100, 50)
