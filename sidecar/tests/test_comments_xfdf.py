from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.comments import CommentsExportParams, export_comments
from vivepdf.ops.comments_xfdf import CommentsImportParams, import_comments
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


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
    second = document.new_page(width=842, height=595)
    second.add_line_annot((50, 50), (300, 200))
    second.add_polygon_annot([(400, 100), (500, 100), (450, 200)])
    second.add_rect_annot(pymupdf.Rect(100, 300, 250, 400))
    second.add_freetext_annot(pymupdf.Rect(500, 300, 700, 360), "Typed remark", fontsize=11)
    second.set_rotation(90)
    path = tmp_path / "reviewed.pdf"
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


def test_export_then_import_reproduces_the_comments(
    reviewed_pdf: Path, clean_copy: Path, tmp_path: Path
) -> None:
    exported = export_comments(
        CommentsExportParams(path=str(reviewed_pdf), output=str(tmp_path / "c"), format="xfdf"),
        silent_progress(),
    )
    assert exported.output.endswith(".xfdf")
    assert exported.count == 7
    text = Path(exported.output).read_text(encoding="utf-8")
    assert 'xmlns="http://ns.adobe.com/xfdf/"' in text
    assert "Please check ğüşıöç" in text
    result = import_comments(
        CommentsImportParams(
            path=str(clean_copy), source=exported.output, output=str(tmp_path / "back.pdf")
        ),
        silent_progress(),
    )
    assert result.imported == 7
    assert result.skipped == 0
    assert _summary(Path(result.output)) == _summary(reviewed_pdf)
    document = pymupdf.open(result.output)
    page = document[0]
    note = next(annot for annot in page.annots() if annot.type[1] == "Text")
    assert note.info["title"] == "Ayşe"
    ink = next(annot for annot in page.annots() if annot.type[1] == "Ink")
    assert len(ink.vertices) == 2
    document.close()


def test_import_reads_adobe_style_xfdf_with_replies(clean_copy: Path, tmp_path: Path) -> None:
    source = tmp_path / "adobe.xfdf"
    source.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">
<annots>
<highlight color="#FFFF00" date="D:20240101120000Z" flags="print" name="h1" page="0"
 rect="70,735,160,752" title="Reviewer" coords="70,752,160,752,70,735,160,735">
<contents>Check</contents></highlight>
<text page="0" rect="300,500,320,520" name="r1" inreplyto="h1" title="Author" icon="Comment">
<contents>Done</contents></text>
<square page="5" rect="0,0,10,10" name="far"/>
<unknownthing page="0" rect="0,0,1,1"/>
</annots>
<f href="clean.pdf"/>
</xfdf>""",
        encoding="utf-8",
    )
    result = import_comments(
        CommentsImportParams(path=str(clean_copy), source=str(source), output=str(tmp_path / "o")),
        silent_progress(),
    )
    assert result.imported == 2
    assert result.skipped == 2
    document = pymupdf.open(result.output)
    annots = {annot.type[1]: annot for annot in document[0].annots()}
    assert annots["Highlight"].info["content"] == "Check"
    kind, value = document.xref_get_key(annots["Text"].xref, "IRT")
    assert kind == "xref" and int(value.split()[0]) == annots["Highlight"].xref
    document.close()


def test_import_refuses_doctype_and_garbage(clean_copy: Path, tmp_path: Path) -> None:
    hostile = tmp_path / "hostile.xfdf"
    hostile.write_text(
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]>'
        '<xfdf xmlns="http://ns.adobe.com/xfdf/"><annots/></xfdf>',
        encoding="utf-8",
    )
    garbage = tmp_path / "garbage.xfdf"
    garbage.write_text("not xml at all", encoding="utf-8")
    empty = tmp_path / "empty.xfdf"
    empty.write_text('<xfdf xmlns="http://ns.adobe.com/xfdf/"><annots/></xfdf>', encoding="utf-8")
    for source in (hostile, garbage, empty):
        with pytest.raises(OpError) as caught:
            import_comments(
                CommentsImportParams(
                    path=str(clean_copy), source=str(source), output=str(tmp_path / "x.pdf")
                ),
                silent_progress(),
            )
        assert caught.value.code == ErrorCode.INVALID_PARAMS
    with pytest.raises(OpError) as missing:
        import_comments(
            CommentsImportParams(
                path=str(clean_copy),
                source=str(tmp_path / "nope.xfdf"),
                output=str(tmp_path / "x.pdf"),
            ),
            silent_progress(),
        )
    assert missing.value.code == ErrorCode.FILE_NOT_FOUND


def test_replace_existing_drops_the_old_comments(reviewed_pdf: Path, tmp_path: Path) -> None:
    source = tmp_path / "one.xfdf"
    source.write_text(
        '<xfdf xmlns="http://ns.adobe.com/xfdf/"><annots>'
        '<square page="0" rect="10,10,50,50" name="only"/></annots></xfdf>',
        encoding="utf-8",
    )
    result = import_comments(
        CommentsImportParams(
            path=str(reviewed_pdf),
            source=str(source),
            output=str(tmp_path / "replaced.pdf"),
            replace_existing=True,
        ),
        silent_progress(),
    )
    rows = _summary(Path(result.output))
    assert [row[1] for row in rows] == ["Square"]


def test_page_summary_shows_each_page_with_numbered_comments(
    reviewed_pdf: Path, tmp_path: Path
) -> None:
    result = export_comments(
        CommentsExportParams(
            path=str(reviewed_pdf),
            output=str(tmp_path / "summary.pdf"),
            format="pdf",
            layout="pages",
            page_label="Sayfa",
        ),
        silent_progress(),
    )
    assert result.count == 7
    summary = pymupdf.open(result.output)
    assert summary.page_count == 2
    first = summary[0].get_text()
    assert "Sayfa 1" in first and "Please check ğüşıöç" in first
    assert len(summary[0].get_images()) == 1
    assert "Typed remark" in summary[1].get_text()
    summary.close()


def test_imported_comments_get_unique_names_across_pages(
    reviewed_pdf: Path, clean_copy: Path, tmp_path: Path
) -> None:
    exported = export_comments(
        CommentsExportParams(path=str(reviewed_pdf), output=str(tmp_path / "n"), format="xfdf"),
        silent_progress(),
    )
    result = import_comments(
        CommentsImportParams(
            path=str(clean_copy), source=exported.output, output=str(tmp_path / "named.pdf")
        ),
        silent_progress(),
    )
    document = pymupdf.open(result.output)
    names = [
        document.xref_get_key(xref, "NM")[1]
        for page in document
        for xref, _kind, _name in page.annot_xrefs()
    ]
    document.close()
    assert len(names) == 7
    assert len(set(names)) == len(names)
