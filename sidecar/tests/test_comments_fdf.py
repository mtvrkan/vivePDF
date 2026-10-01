import base64
import zlib
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.comments import CommentsExportParams, export_comments
from vivepdf.ops.comments_xfdf import CommentsImportParams, import_comments
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

IMAGE_BYTES = bytes(range(256)) * 3


def _custom_stamp(page: pymupdf.Page, document: pymupdf.Document) -> int:
    stamp = page.add_stamp_annot(pymupdf.Rect(300, 600, 420, 660), stamp=0)
    stamp.set_info(title="Onay", content="Custom stamp")
    stamp.update()
    image = document.get_new_xref()
    document.update_object(
        image,
        "<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceRGB"
        " /BitsPerComponent 8 /Filter /FlateDecode >>",
    )
    document.update_stream(image, zlib.compress(IMAGE_BYTES), compress=False)
    document.xref_set_key(image, "Filter", "/FlateDecode")
    form = document.get_new_xref()
    document.update_object(
        form,
        f"<< /Type /XObject /Subtype /Form /BBox [0 0 120 60]"
        f" /Resources << /XObject << /Im0 {image} 0 R >> >> >>",
    )
    document.update_stream(form, b"q 120 0 0 60 0 0 cm /Im0 Do Q")
    document.xref_set_key(stamp.xref, "AP", f"<< /N {form} 0 R >>")
    return stamp.xref


@pytest.fixture
def reviewed_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    first = document.new_page(width=595, height=842)
    first.insert_text((72, 100), "Quarterly figures are final", fontsize=12)
    note = first.add_text_annot((300, 300), "Please check ğüşıöç")
    note.set_info(title="Ayşe", subject="Review")
    note.update()
    highlight = first.add_highlight_annot(first.search_for("Quarterly")[0])
    highlight.set_colors(stroke=(1, 0.8, 0))
    highlight.update()
    first.add_ink_annot([[(100, 500), (150, 520), (200, 510)], [(100, 600), (160, 640)]])
    _custom_stamp(first, document)
    second = document.new_page(width=842, height=595)
    second.add_line_annot((50, 50), (300, 200))
    second.add_polygon_annot([(400, 100), (500, 100), (450, 200)])
    second.add_rect_annot(pymupdf.Rect(100, 300, 250, 400))
    second.add_freetext_annot(pymupdf.Rect(500, 300, 700, 360), "Typed remark", fontsize=11)
    path = tmp_path / "reviewed ş.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def clean_copy(tmp_path: Path, reviewed_pdf: Path) -> Path:
    document = pymupdf.open(reviewed_pdf)
    for page in document:
        for xref in [annot.xref for annot in page.annots()]:
            page.delete_annot(page.load_annot(xref))
    path = tmp_path / "clean.pdf"
    document.save(path)
    document.close()
    return path


def _summary(path: Path) -> list[tuple]:
    document = pymupdf.open(path)
    rows = []
    for page in document:
        for annot in page.annots():
            kind, value = document.xref_get_key(annot.xref, "Rect")
            numbers = [round(float(item), 1) for item in value.strip("[]").split()]
            rows.append((page.number, annot.type[1], annot.info.get("content"), numbers))
    document.close()
    return sorted(rows, key=lambda row: (row[0], row[1]))


def _stamp_appearance(path: Path) -> tuple[bytes, bytes]:
    document = pymupdf.open(path)
    try:
        stamp = next(annot for annot in document[0].annots() if annot.type[1] == "Stamp")
        form = int(document.xref_get_key(stamp.xref, "AP/N")[1].split()[0])
        image = int(document.xref_get_key(form, "Resources/XObject/Im0")[1].split()[0])
        return document.xref_stream(form), document.xref_stream(image)
    finally:
        document.close()


def _round_trip(fmt: str, reviewed_pdf: Path, clean_copy: Path, tmp_path: Path) -> Path:
    exported = export_comments(
        CommentsExportParams(path=str(reviewed_pdf), output=str(tmp_path / "c"), format=fmt),
        silent_progress(),
    )
    assert exported.output.endswith(f".{fmt}")
    assert exported.count == 8
    result = import_comments(
        CommentsImportParams(
            path=str(clean_copy), source=exported.output, output=str(tmp_path / f"{fmt}.pdf")
        ),
        silent_progress(),
    )
    assert result.imported == 8
    assert result.skipped == 0
    return Path(result.output)


@pytest.mark.parametrize("fmt", ["fdf", "xfdf"])
def test_round_trip_keeps_comments_and_custom_stamp_appearance(
    fmt: str, reviewed_pdf: Path, clean_copy: Path, tmp_path: Path
) -> None:
    output = _round_trip(fmt, reviewed_pdf, clean_copy, tmp_path)
    assert _summary(output) == _summary(reviewed_pdf)
    content, image = _stamp_appearance(output)
    assert content.strip() == b"q 120 0 0 60 0 0 cm /Im0 Do Q"
    assert image == IMAGE_BYTES
    document = pymupdf.open(output)
    note = next(annot for annot in document[0].annots() if annot.type[1] == "Text")
    assert note.info["title"] == "Ayşe"
    assert note.info["content"] == "Please check ğüşıöç"
    document.close()


def test_xfdf_carries_the_stamp_appearance_as_acrobat_writes_it(
    reviewed_pdf: Path, tmp_path: Path
) -> None:
    exported = export_comments(
        CommentsExportParams(path=str(reviewed_pdf), output=str(tmp_path / "c"), format="xfdf"),
        silent_progress(),
    )
    text = Path(exported.output).read_text(encoding="utf-8")
    start = text.index("<appearance>") + len("<appearance>")
    payload = base64.b64decode(text[start : text.index("</appearance>")]).decode("utf-8")
    assert payload.startswith('<?xml version="1.0" encoding="UTF-8" ?><DICT KEY="AP">')
    assert '<STREAM KEY="N">' in payload
    assert '<DATA MODE="FILTERED" ENCODING="ASCII">' in payload
    assert '<DATA MODE="RAW" ENCODING="HEX">' in payload


def test_fdf_export_is_a_self_contained_fdf_file(reviewed_pdf: Path, tmp_path: Path) -> None:
    exported = export_comments(
        CommentsExportParams(path=str(reviewed_pdf), output=str(tmp_path / "c.fdf"), format="fdf"),
        silent_progress(),
    )
    data = Path(exported.output).read_bytes()
    assert data.startswith(b"%FDF-1.2")
    assert b"/Annots [" in data and b"/Page 1" in data
    assert b"/P " not in data and b"/Popup" not in data


def test_imports_an_acrobat_style_fdf_with_reply_and_indirect_appearance(
    clean_copy: Path, tmp_path: Path
) -> None:
    content = b"0 0 1 rg 0 0 50 20 re f"
    source = tmp_path / "acrobat.fdf"
    source.write_bytes(
        b"%FDF-1.2\n%\xe2\xe3\xcf\xd3\n"
        b"1 0 obj\n<</FDF<</Annots[2 0 R 3 0 R 4 0 R 6 0 R]/F(clean.pdf)>>/Type/Catalog>>\nendobj\n"
        b"2 0 obj\n<</C[1 1 0]/Contents(Check this)/Page 0/Rect[70 735 160 752]/Subtype/Highlight"
        b"/QuadPoints[70 752 160 752 70 735 160 735]/T(Reviewer)/NM(h1)/Popup 7 0 R>>\nendobj\n"
        b"3 0 obj\n<</Contents(Done)/IRT 2 0 R/Page 0/Rect[300 500 320 520]/Subtype/Text"
        b"/T(Author)/Name/Comment>>\nendobj\n"
        b"4 0 obj\n<</Page 0/Rect[100 100 150 120]/Subtype/Stamp/Name/Draft"
        b"/AP<</N 5 0 R>>>>\nendobj\n"
        b"5 0 obj\n<</BBox[0 0 50 20]/Subtype/Form/Length "
        + str(len(content)).encode()
        + b">>stream\n"
        + content
        + b"\nendstream\nendobj\n"
        b"6 0 obj\n<</Page 9/Rect[0 0 1 1]/Subtype/Square>>\nendobj\n"
        b"7 0 obj\n<</Subtype/Popup/Page 0/Rect[0 0 1 1]>>\nendobj\n"
        b"trailer\n<</Root 1 0 R>>\n%%EOF\n"
    )
    result = import_comments(
        CommentsImportParams(
            path=str(clean_copy), source=str(source), output=str(tmp_path / "fdf.pdf")
        ),
        silent_progress(),
    )
    assert (result.imported, result.skipped) == (3, 1)
    document = pymupdf.open(result.output)
    annots = {annot.type[1]: annot for annot in document[0].annots()}
    assert annots["Highlight"].info["content"] == "Check this"
    kind, value = document.xref_get_key(annots["Text"].xref, "IRT")
    assert kind == "xref" and int(value.split()[0]) == annots["Highlight"].xref
    form = int(document.xref_get_key(annots["Stamp"].xref, "AP/N")[1].split()[0])
    assert document.xref_stream(form) == content
    assert document.xref_get_key(annots["Stamp"].xref, "P")[0] == "xref"
    document.close()


def test_fdf_import_refuses_garbage(clean_copy: Path, tmp_path: Path) -> None:
    source = tmp_path / "bad.fdf"
    source.write_bytes(b"%FDF-1.2\n1 0 obj\n<< /Nothing 1 >>\nendobj\ntrailer\n<< >>\n")
    with pytest.raises(OpError) as caught:
        import_comments(
            CommentsImportParams(
                path=str(clean_copy), source=str(source), output=str(tmp_path / "x.pdf")
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_fdf_import_drops_actions(clean_copy: Path, tmp_path: Path) -> None:
    source = tmp_path / "actions.fdf"
    source.write_bytes(
        b"%FDF-1.2\n1 0 obj\n<</FDF<</Annots[<</Page 0/Rect[10 10 50 50]/Subtype/Square"
        b"/A<</S/JavaScript/JS(app.alert(1))>>/AA<</E 9 0 R>>>>]>>>>\nendobj\n"
        b"trailer\n<</Root 1 0 R>>\n%%EOF\n"
    )
    result = import_comments(
        CommentsImportParams(
            path=str(clean_copy), source=str(source), output=str(tmp_path / "a.pdf")
        ),
        silent_progress(),
    )
    assert result.imported == 1
    document = pymupdf.open(result.output)
    square = next(iter(document[0].annots()))
    assert document.xref_get_key(square.xref, "A")[0] == "null"
    assert document.xref_get_key(square.xref, "AA")[0] == "null"
    document.close()
