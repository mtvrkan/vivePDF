from pathlib import Path

import pymupdf

from vivepdf.ops._placement import drop_unplaceable_annotations
from vivepdf.ops.convert_text import MarkdownParams, to_markdown
from vivepdf.ops.letterhead import LetterheadParams, letterhead
from vivepdf.rpc.progress import silent_progress

BROKEN_RECT = "[2362231872 2791728576 -2362232000 -2791728700]"


def _turned_page_with_a_broken_highlight(path: Path) -> tuple[Path, str]:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.set_rotation(270)
    page.insert_text(
        pymupdf.Point(72, 100) * page.derotation_matrix,
        "Lecture notes on turned pages",
        fontsize=14,
        rotate=270,
    )
    kept = page.add_highlight_annot(pymupdf.Rect(72, 88, 200, 104))
    broken = page.add_highlight_annot(pymupdf.Rect(72, 120, 200, 136))
    document.xref_set_key(broken.xref, "QuadPoints", "null")
    document.xref_set_key(broken.xref, "Rect", BROKEN_RECT)
    kept_name = kept.info["id"]
    document.save(path)
    document.close()
    return path, kept_name


def test_only_the_annotation_without_a_usable_box_is_dropped(tmp_path: Path):
    source, kept_name = _turned_page_with_a_broken_highlight(tmp_path / "turned.pdf")
    document = pymupdf.open(source)
    page = document[0]

    dropped = drop_unplaceable_annotations(page)

    assert dropped == 1
    assert [annot.info["id"] for annot in page.annots()] == [kept_name]
    document.close()


def test_a_page_with_sound_annotations_keeps_them_all(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page()
    page.add_highlight_annot(pymupdf.Rect(72, 88, 200, 104))

    dropped = drop_unplaceable_annotations(page)

    assert dropped == 0
    assert len(list(page.annots())) == 1
    document.close()


def test_markdown_of_a_turned_page_with_a_broken_highlight_keeps_its_text(tmp_path: Path):
    source, _ = _turned_page_with_a_broken_highlight(tmp_path / "turned.pdf")
    output = tmp_path / "notes.md"

    to_markdown(MarkdownParams(path=str(source), output=str(output)), silent_progress())

    assert "Lecture notes on turned pages" in output.read_text(encoding="utf-8")
    with pymupdf.open(source) as original:
        assert len(list(original[0].annots())) == 2


def test_a_turned_template_with_a_broken_highlight_still_letterheads(tmp_path: Path):
    template, _ = _turned_page_with_a_broken_highlight(tmp_path / "template.pdf")
    document = pymupdf.open()
    document.new_page(width=595, height=842)
    source = tmp_path / "letter.pdf"
    document.save(source)
    document.close()
    output = tmp_path / "out.pdf"

    letterhead(
        LetterheadParams(path=str(source), output=str(output), template_path=str(template)),
        silent_progress(),
    )

    with pymupdf.open(output) as result:
        assert "Lecture notes" in result[0].get_text()
