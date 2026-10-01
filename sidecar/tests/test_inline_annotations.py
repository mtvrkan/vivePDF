from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._document import open_document
from vivepdf.ops._inline_annotations import promote_inline_annotations
from vivepdf.ops._output import deduplicate_annotation_names
from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.rpc.progress import silent_progress

INLINE_ANNOTS = (
    "[<</Type/Annot/Subtype/Text/Rect[100 700 120 720]/Contents(Kenar notu)/NM(same)>>"
    "<</Type/Annot/Subtype/Square/Rect[100 500 200 560]/C[1 0 0]/NM(same)>>]"
)


def _inline_pdf(path: Path, annots: str = INLINE_ANNOTS) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=400, height=800)
    page.insert_text((72, 72), "Inline annotations page")
    document.xref_set_key(page.xref, "Annots", annots)
    document.save(path)
    document.close()
    return path


def test_inline_annotations_become_objects_the_ops_can_see(tmp_path: Path):
    source = _inline_pdf(tmp_path / "inline.pdf")

    with open_document(str(source)) as document:
        xrefs = [item[0] for item in document[0].annot_xrefs()]
        kinds = [annot.type[1] for annot in document[0].annots()]

    assert all(xref > 0 for xref in xrefs)
    assert kinds == ["Text", "Square"]


def test_a_document_whose_annotations_are_already_objects_is_left_alone(tmp_path: Path):
    source = tmp_path / "indirect.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.add_text_annot((100, 100), "Zaten nesne")
    document.save(source)
    document.close()

    with pymupdf.open(source) as reopened:
        before = reopened[0].annot_xrefs()
        promoted = promote_inline_annotations(reopened)
        after = reopened[0].annot_xrefs()

    assert promoted == 0
    assert after == before


def test_a_mixed_list_keeps_the_existing_reference_and_promotes_the_rest(tmp_path: Path):
    source = tmp_path / "mixed.pdf"
    document = pymupdf.open()
    page = document.new_page()
    existing = page.add_text_annot((50, 50), "Var olan").xref
    document.xref_set_key(
        page.xref,
        "Annots",
        f"[{existing} 0 R <</Type/Annot/Subtype/Text/Rect[90 90 110 110]/Contents(Yeni)>>]",
    )
    document.save(source)
    document.close()

    with pymupdf.open(source) as reopened:
        promoted = promote_inline_annotations(reopened)
        xrefs = [item[0] for item in reopened[0].annot_xrefs()]

    assert promoted == 1
    assert xrefs[0] == existing
    assert xrefs[1] > 0 and xrefs[1] != existing


def test_saving_an_edit_keeps_inline_annotations_and_does_not_crash(tmp_path: Path):
    source = _inline_pdf(tmp_path / "inline.pdf")
    output = tmp_path / "edited.pdf"

    apply(
        EditorApplyParams(
            path=str(source),
            output=str(output),
            objects=[
                {"kind": "text", "page": 1, "x0": 72, "y0": 100, "x1": 300, "y1": 130, "text": "Ek"}
            ],
        ),
        silent_progress(),
    )

    with pymupdf.open(output) as saved:
        page = saved[0]
        annots = list(page.annots())
        names = {annot.info["id"] for annot in annots}
        assert [annot.type[1] for annot in annots] == ["Text", "Square"]
        assert annots[0].info["content"] == "Kenar notu"
        assert len(names) == 2
        assert "Ek" in page.get_text()


def test_deduplicating_names_skips_annotations_that_have_no_object_number(tmp_path: Path):
    source = _inline_pdf(tmp_path / "inline.pdf")

    with pymupdf.open(source) as document:
        renamed = deduplicate_annotation_names(document)

    assert renamed == 0


@pytest.mark.parametrize("annots", ["[]", "null"])
def test_pages_with_an_empty_or_missing_list_are_skipped(tmp_path: Path, annots: str):
    source = _inline_pdf(tmp_path / "empty.pdf", annots)

    with pymupdf.open(source) as document:
        assert promote_inline_annotations(document) == 0
