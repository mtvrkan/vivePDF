from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.comments import CommentsExportParams, export_comments
from vivepdf.ops.comments_xfdf import CommentsImportParams, import_comments
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def styled_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    path_line = page.add_polyline_annot([(100, 100), (200, 150), (300, 100)])
    path_line.set_line_ends(pymupdf.PDF_ANNOT_LE_OPEN_ARROW, pymupdf.PDF_ANNOT_LE_CIRCLE)
    path_line.update()
    dashed = page.add_rect_annot(pymupdf.Rect(100, 300, 250, 400))
    dashed.set_border(width=2, dashes=[4, 2])
    dashed.update()
    cloud = page.add_polygon_annot([(350, 300), (500, 300), (425, 420)])
    cloud.set_border(width=1, clouds=2)
    cloud.update()
    path = tmp_path / "styled.pdf"
    document.save(path)
    document.close()
    return path


def _blank(tmp_path: Path) -> Path:
    document = pymupdf.open()
    document.new_page(width=595, height=842)
    path = tmp_path / "blank.pdf"
    document.save(path)
    document.close()
    return path


def _export(path: Path, target: Path, format: str) -> Path:
    params = CommentsExportParams(path=str(path), output=str(target), format=format)
    return Path(export_comments(params, silent_progress()).output)


def _import(path: Path, source: Path, output: Path):
    params = CommentsImportParams(path=str(path), source=str(source), output=str(output))
    return import_comments(params, silent_progress())


def _styles(path: Path) -> dict[str, dict[str, str]]:
    document = pymupdf.open(path)
    styles = {}
    for annot in document[0].annots():
        styles[annot.type[1]] = {
            key: document.xref_get_key(annot.xref, key)[1]
            for key in ("LE", "BS/S", "BS/D", "BE/S", "BE/I")
        }
    document.close()
    return styles


def test_line_ends_dashes_and_clouds_survive_an_xfdf_round_trip(
    styled_pdf: Path, tmp_path: Path
) -> None:
    exported = _export(styled_pdf, tmp_path / "styled.xfdf", "xfdf")
    text = exported.read_text(encoding="utf-8")
    assert 'head="OpenArrow"' in text and 'tail="Circle"' in text
    assert 'style="dash"' in text and 'dashes="4,2"' in text
    assert 'style="cloudy"' in text and 'intensity="2"' in text
    result = _import(_blank(tmp_path), exported, tmp_path / "restored.pdf")
    styles = _styles(Path(result.output))
    assert styles["PolyLine"]["LE"] == "[/OpenArrow/Circle]"
    assert styles["Square"]["BS/S"] == "/D" and styles["Square"]["BS/D"] == "[4 2]"
    assert styles["Polygon"]["BE/S"] == "/C" and styles["Polygon"]["BE/I"] == "2"


def test_importing_the_same_xfdf_twice_reports_duplicates(styled_pdf: Path, tmp_path: Path) -> None:
    exported = _export(styled_pdf, tmp_path / "styled.xfdf", "xfdf")
    with pytest.raises(OpError) as caught:
        _import(styled_pdf, exported, tmp_path / "again.pdf")
    assert caught.value.data == {"reason": "commentsAlreadyPresent", "count": 3}
    partial = pymupdf.open(styled_pdf)
    page = partial[0]
    page.delete_annot(next(annot for annot in page.annots() if annot.type[1] == "Square"))
    trimmed = tmp_path / "trimmed.pdf"
    partial.save(trimmed)
    partial.close()
    result = _import(trimmed, exported, tmp_path / "completed.pdf")
    assert (result.imported, result.duplicates) == (1, 2)
    restored = pymupdf.open(result.output)
    assert sorted(annot.type[1] for annot in restored[0].annots()) == [
        "PolyLine",
        "Polygon",
        "Square",
    ]
    restored.close()


def test_importing_the_same_fdf_twice_reports_duplicates(styled_pdf: Path, tmp_path: Path) -> None:
    exported = _export(styled_pdf, tmp_path / "styled.fdf", "fdf")
    with pytest.raises(OpError) as caught:
        _import(styled_pdf, exported, tmp_path / "again.pdf")
    assert caught.value.data == {"reason": "commentsAlreadyPresent", "count": 3}
    result = _import(_blank(tmp_path), exported, tmp_path / "copy.pdf")
    assert (result.imported, result.duplicates) == (3, 0)


@pytest.mark.parametrize(
    ("content", "reason"),
    [
        (b"<notes/>", "notXfdf"),
        (b"<xfdf", "notXfdf"),
        (b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><xfdf/>', "commentFileDoctype"),
        (b"%FDF-1.2\ntrailer\n<< >>\n%%EOF", "notFdf"),
        (b'<xfdf xmlns="http://ns.adobe.com/xfdf/"><annots/></xfdf>', "noCommentsToImport"),
    ],
)
def test_unusable_comment_files_explain_why(tmp_path: Path, content: bytes, reason: str) -> None:
    source = tmp_path / "comments.xfdf"
    source.write_bytes(content)
    with pytest.raises(OpError) as caught:
        _import(_blank(tmp_path), source, tmp_path / "out.pdf")
    assert caught.value.data["reason"] == reason
