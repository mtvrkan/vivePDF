import base64
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.a11y import CheckParams, check
from vivepdf.ops.a11y_fix import FixParams, fix
from vivepdf.ops.a11y_preview import FigurePreviewParams, figure_preview
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _untagged(tmp_path: Path, pages: int = 1) -> Path:
    document = pymupdf.open()
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), False)
    pixmap.set_rect(pixmap.irect, (30, 120, 200))
    for number in range(pages):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 90), f"Chapter {number + 1}", fontsize=24)
        page.insert_text((72, 130), "The first line of the body text.", fontsize=11)
        page.insert_text((72, 144), "The second line of the same paragraph.", fontsize=11)
        page.insert_image(pymupdf.Rect(72, 200, 272, 400), pixmap=pixmap)
        page.draw_rect(pymupdf.Rect(60, 60, 535, 420), color=(0.5, 0.5, 0.5))
        page.insert_link(
            {
                "kind": pymupdf.LINK_URI,
                "from": pymupdf.Rect(72, 120, 300, 134),
                "uri": "https://example.org",
            }
        )
    path = tmp_path / "plain.pdf"
    document.save(path)
    document.close()
    return path


def _statuses(path: Path) -> dict[str, str]:
    report = check(CheckParams(path=str(path)), silent_progress())
    return {item.id: item.status for item in report.checks}


def test_auto_tagging_builds_a_structure_that_passes_the_structure_checks(tmp_path: Path) -> None:
    source = _untagged(tmp_path, pages=2)
    output = tmp_path / "tagged.pdf"
    result = fix(FixParams(path=str(source), output=str(output), auto_tag=True), silent_progress())
    assert result.auto_tagged is not None
    assert result.auto_tagged.headings == 2
    assert result.auto_tagged.figures == 2
    assert result.auto_tagged.paragraphs == 2
    assert result.auto_tagged.annotations == 2
    assert result.figures_without_alt == 2
    statuses = _statuses(output)
    assert statuses["tagged"] == "pass"
    assert statuses["readingOrder"] == "pass"
    assert statuses["annotations"] == "pass"
    assert statuses["headings"] == "pass"
    assert statuses["tabOrder"] == "pass"
    assert statuses["altText"] == "fail"


def test_auto_tagging_keeps_what_the_page_shows(tmp_path: Path) -> None:
    source = _untagged(tmp_path)
    output = tmp_path / "tagged.pdf"
    fix(FixParams(path=str(source), output=str(output), auto_tag=True), silent_progress())
    with pymupdf.open(source) as before, pymupdf.open(output) as after:
        assert after[0].get_text() == before[0].get_text()
        assert before[0].get_pixmap().samples == after[0].get_pixmap().samples


def test_auto_tagging_leaves_a_tagged_file_alone(tmp_path: Path) -> None:
    source = _untagged(tmp_path)
    once = tmp_path / "once.pdf"
    twice = tmp_path / "twice.pdf"
    fix(FixParams(path=str(source), output=str(once), auto_tag=True), silent_progress())
    result = fix(
        FixParams(path=str(once), output=str(twice), auto_tag=True, title="T"), silent_progress()
    )
    assert result.auto_tagged is None
    assert result.changes == 1


def test_figure_preview_crops_to_the_tagged_picture(tmp_path: Path) -> None:
    source = _untagged(tmp_path)
    output = tmp_path / "tagged.pdf"
    fix(FixParams(path=str(source), output=str(output), auto_tag=True), silent_progress())
    figure = check(CheckParams(path=str(output)), silent_progress()).figures[0]
    preview = figure_preview(
        FigurePreviewParams(path=str(output), xref=figure.xref), silent_progress()
    )
    assert preview.exact is True
    assert preview.page == 1
    pixmap = pymupdf.Pixmap(base64.b64decode(preview.image))
    assert max(pixmap.width, pixmap.height) <= 240
    assert abs(pixmap.width - pixmap.height) <= 12


def test_figure_preview_finds_the_picture_through_its_marked_content(tmp_path: Path) -> None:
    source = _untagged(tmp_path)
    output = tmp_path / "tagged.pdf"
    fix(FixParams(path=str(source), output=str(output), auto_tag=True), silent_progress())
    figure = check(CheckParams(path=str(output)), silent_progress()).figures[0]
    with pymupdf.open(output) as document:
        document.xref_set_key(figure.xref, "A", "null")
        stripped = tmp_path / "no-box.pdf"
        document.save(stripped)
    preview = figure_preview(
        FigurePreviewParams(path=str(stripped), xref=figure.xref), silent_progress()
    )
    assert preview.exact is True


def test_figure_preview_refuses_an_object_that_is_not_a_figure(tmp_path: Path) -> None:
    source = _untagged(tmp_path)
    with pytest.raises(OpError) as caught:
        figure_preview(FigurePreviewParams(path=str(source), xref=1), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_checks_list_the_pages_with_issues(tmp_path: Path) -> None:
    source = _untagged(tmp_path, pages=3)
    report = check(CheckParams(path=str(source)), silent_progress())
    pages = {item.id: item.pages for item in report.checks}
    assert pages["altText"] == [1, 2, 3]
    assert pages["readingOrder"] == [1, 2, 3]
    assert pages["annotations"] == [1, 2, 3]


def test_pdf_ua_identifier_and_suspects_are_reported(tmp_path: Path) -> None:
    source = _untagged(tmp_path)
    assert _statuses(source)["pdfUa"] == "warn"
    assert _statuses(source)["suspects"] == "pass"
    with pymupdf.open(source) as document:
        document.set_xml_metadata(
            '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
            '<rdf:Description xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/" pdfuaid:part="1"/>'
            "</rdf:RDF></x:xmpmeta>"
        )
        document.xref_set_key(document.pdf_catalog(), "MarkInfo", "<</Marked true/Suspects true>>")
        marked = tmp_path / "marked.pdf"
        document.save(marked)
    statuses = _statuses(marked)
    assert statuses["pdfUa"] == "pass"
    assert statuses["suspects"] == "fail"


def test_unmapped_structure_types_fail(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page()
    root = document.get_new_xref()
    custom = document.get_new_xref()
    document.update_object(root, f"<</Type/StructTreeRoot/K[{custom} 0 R]>>")
    document.update_object(custom, f"<</Type/StructElem/S/Sidebar/P {root} 0 R>>")
    document.xref_set_key(document.pdf_catalog(), "StructTreeRoot", f"{root} 0 R")
    document.xref_set_key(document.pdf_catalog(), "MarkInfo", "<</Marked true>>")
    path = tmp_path / "custom.pdf"
    document.save(path)
    document.close()
    report = check(CheckParams(path=str(path)), silent_progress())
    role = next(item for item in report.checks if item.id == "roleMap")
    assert role.status == "fail"
    assert report.unmapped_types == ["Sidebar"]


def test_figure_preview_on_a_turned_page(tmp_path: Path) -> None:
    source = _untagged(tmp_path)
    with pymupdf.open(source) as document:
        document[0].set_rotation(90)
        turned = tmp_path / "turned.pdf"
        document.save(turned)
    output = tmp_path / "tagged.pdf"
    fix(FixParams(path=str(turned), output=str(output), auto_tag=True), silent_progress())
    figure = check(CheckParams(path=str(output)), silent_progress()).figures[0]
    preview = figure_preview(
        FigurePreviewParams(path=str(output), xref=figure.xref), silent_progress()
    )
    assert preview.exact is True
    pixmap = pymupdf.Pixmap(base64.b64decode(preview.image))
    assert abs(pixmap.width - pixmap.height) <= 12
    red, green, blue = pixmap.pixel(pixmap.width // 2, pixmap.height // 2)[:3]
    assert (abs(red - 30), abs(green - 120), abs(blue - 200)) < (12, 12, 12)


def test_leftover_marked_content_is_replaced(tmp_path: Path) -> None:
    source = _untagged(tmp_path)
    with pymupdf.open(source) as document:
        page = document[0]
        xref = page.get_contents()[0]
        data = document.xref_stream(xref)
        document.update_stream(xref, b"/Span <</MCID 7>> BDC\n" + data + b"\nEMC\n")
        stale = tmp_path / "stale.pdf"
        document.save(stale)
    output = tmp_path / "tagged.pdf"
    fix(FixParams(path=str(stale), output=str(output), auto_tag=True), silent_progress())
    with pymupdf.open(output) as document:
        content = b"".join(document.xref_stream(x) for x in document[0].get_contents())
    assert b"MCID 7" not in content
    assert content.count(b"BDC") + content.count(b"BMC") == content.count(b"EMC")
    assert _statuses(output)["readingOrder"] == "pass"
