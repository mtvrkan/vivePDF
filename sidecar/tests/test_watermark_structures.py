from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._content import content_tokens, cut_spans, invocation_spans, marked_spans
from vivepdf.ops.watermark_detection import DetectWatermarkParams, detect_watermark
from vivepdf.ops.watermark_removal import RemoveWatermarkParams, remove_watermark
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def stamp(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=300, height=300)
    page.insert_text((40, 150), "GIZLI", fontsize=48, color=(1, 0, 0))
    path = tmp_path / "stamp.pdf"
    document.save(path)
    document.close()
    return path


def _body(document: pymupdf.Document) -> pymupdf.Page:
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 120), "govde metni burada", fontsize=14)
    return page


@pytest.fixture
def tagged(tmp_path: Path, stamp: Path) -> Path:
    mark = pymupdf.open(stamp)
    document = pymupdf.open()
    for _index in range(3):
        page = _body(document)
        page.show_pdf_page(pymupdf.Rect(150, 300, 450, 600), mark, 0, overlay=True)
        form = next(item[0] for item in page.get_xobjects() if not item[2])
        document.xref_set_key(
            form,
            "PieceInfo",
            "<</ADBE_CompoundType<</LastModified(D:20260917120000)/Private/Watermark>>>>",
        )
    path = tmp_path / "tagged.pdf"
    document.save(path)
    document.close()
    mark.close()
    return path


@pytest.fixture
def layered(tmp_path: Path, stamp: Path) -> Path:
    mark = pymupdf.open(stamp)
    document = pymupdf.open()
    layer = document.add_ocg("Filigran")
    for _index in range(3):
        page = _body(document)
        page.show_pdf_page(pymupdf.Rect(150, 300, 450, 600), mark, 0, overlay=True, oc=layer)
    path = tmp_path / "layered.pdf"
    document.save(path)
    document.close()
    mark.close()
    return path


@pytest.fixture
def artifact(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for _index in range(3):
        page = _body(document)
        xref = page.get_contents()[0]
        document.update_stream(
            xref,
            document.xref_stream(xref) + b"\nq /Artifact <</Subtype/Watermark>> BDC\n"
            b"BT 1 0 0 1 180 400 Tm /helv 40 Tf [<54415354414b>] TJ ET\nEMC Q\n",
        )
    path = tmp_path / "artifact.pdf"
    document.save(path)
    document.close()
    return path


def _text_of(path: Path) -> str:
    document = pymupdf.open(path)
    text = " ".join(page.get_text() for page in document)
    document.close()
    return text


def test_a_tagged_watermark_is_found_and_named(tagged: Path):
    result = detect_watermark(DetectWatermarkParams(path=str(tagged)), silent_progress())
    marks = [candidate for candidate in result.candidates if candidate.kind == "tagged"]
    assert len(marks) == 1
    assert marks[0].pages == 3


def test_removing_a_tagged_watermark_leaves_the_body_alone(tagged: Path, tmp_path: Path):
    target = tmp_path / "clean.pdf"
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(tagged),
            output=str(target),
            tagged=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert result.removed_marks == 3
    text = _text_of(target)
    assert "GIZLI" not in text
    assert text.count("govde metni burada") == 3


def test_a_removed_watermark_takes_its_resources_with_it(tagged: Path, tmp_path: Path):
    target = tmp_path / "clean.pdf"
    remove_watermark(
        RemoveWatermarkParams(
            path=str(tagged),
            output=str(target),
            tagged=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    document = pymupdf.open(target)
    assert document[0].get_xobjects() == []
    document.close()


def test_a_layer_is_offered_by_its_own_name(layered: Path):
    result = detect_watermark(DetectWatermarkParams(path=str(layered)), silent_progress())
    layers = [candidate for candidate in result.candidates if candidate.kind == "layer"]
    assert len(layers) == 1
    assert layers[0].text == "Filigran"
    assert layers[0].confident


def test_removing_a_layer_removes_its_content_and_the_layer_itself(layered: Path, tmp_path: Path):
    found = detect_watermark(DetectWatermarkParams(path=str(layered)), silent_progress())
    layer = next(candidate.layer for candidate in found.candidates if candidate.kind == "layer")
    target = tmp_path / "clean.pdf"
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(layered),
            output=str(target),
            layers=[layer or 0],
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert result.removed_marks == 3
    assert "GIZLI" not in _text_of(target)
    document = pymupdf.open(target)
    assert document.get_ocgs() == {}
    document.close()


def test_a_marked_watermark_is_found_and_cut_out(artifact: Path, tmp_path: Path):
    found = detect_watermark(DetectWatermarkParams(path=str(artifact)), silent_progress())
    assert any(candidate.kind == "artifact" for candidate in found.candidates)
    target = tmp_path / "clean.pdf"
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(artifact),
            output=str(target),
            artifacts=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert result.removed_marks == 3
    text = _text_of(target)
    assert "TASTAK" not in text
    assert text.count("govde metni burada") == 3


def test_a_document_without_structure_offers_none_of_it(tmp_path: Path):
    document = pymupdf.open()
    _body(document)
    path = tmp_path / "plain.pdf"
    document.save(path)
    document.close()
    result = detect_watermark(DetectWatermarkParams(path=str(path)), silent_progress())
    assert [candidate.kind for candidate in result.candidates] == []


def test_the_tokenizer_keeps_its_hands_off_strings_and_inline_images():
    data = (
        b"BT (BDC EMC /Artifact) Tj ET\n"
        b"q /Artifact <</Subtype/Watermark>> BDC BI /W 2 /H 2 ID \x00\x01BDC\x02 EI EMC Q\n"
    )
    tokens = content_tokens(data)
    spans = marked_spans(tokens, lambda tag, prop: tag == b"/Artifact" and b"/Watermark" in prop)
    assert len(spans) == 1
    rest = cut_spans(data, spans)
    assert b"(BDC EMC /Artifact) Tj" in rest
    assert b"/Subtype/Watermark" not in rest


def test_only_the_named_form_call_is_cut():
    data = b"q /Fm0 Do Q q /Fm1 Do Q"
    tokens = content_tokens(data)
    rest = cut_spans(data, invocation_spans(tokens, {b"/Fm0"}))
    assert rest == b"q  Q q /Fm1 Do Q"


def test_looking_for_marks_does_not_rewrite_the_document(tmp_path: Path):
    document = pymupdf.open()
    page = _body(document)
    extra = document.get_new_xref()
    document.update_object(extra, "<<>>")
    document.update_stream(extra, b"\nq 1 0 0 RG 10 10 m 100 100 l S Q\n", new=True)
    document.xref_set_key(page.xref, "Contents", f"[{page.get_contents()[0]} 0 R {extra} 0 R]")
    path = tmp_path / "split.pdf"
    document.save(path)
    document.close()

    before = pymupdf.open(path)
    assert len(before[0].get_contents()) == 2
    before.close()

    detect_watermark(DetectWatermarkParams(path=str(path)), silent_progress())

    after = pymupdf.open(path)
    assert len(after[0].get_contents()) == 2
    after.close()


def test_a_property_that_is_not_a_layer_is_not_offered_as_one(tmp_path: Path):
    document = pymupdf.open()
    for _index in range(2):
        page = _body(document)
        holder = document.get_new_xref()
        document.update_object(holder, "<</Kind/Other>>")
        kind, value = document.xref_get_key(page.xref, "Resources")
        resources = int(value.split()[0]) if kind == "xref" else page.xref
        key = "Properties" if kind == "xref" else "Resources/Properties"
        document.xref_set_key(resources, key, f"<</MC0 {holder} 0 R>>")
    path = tmp_path / "properties.pdf"
    document.save(path)
    document.close()
    result = detect_watermark(DetectWatermarkParams(path=str(path)), silent_progress())
    assert not any(candidate.kind == "layer" for candidate in result.candidates)


def test_the_resource_entry_goes_rather_than_being_left_as_a_stub(tagged: Path, tmp_path: Path):
    target = tmp_path / "clean.pdf"
    remove_watermark(
        RemoveWatermarkParams(
            path=str(tagged),
            output=str(target),
            tagged=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    document = pymupdf.open(target)
    page = document[0]
    kind, value = document.xref_get_key(page.xref, "Resources")
    holder = int(value.split()[0]) if kind == "xref" else page.xref
    key = "XObject" if kind == "xref" else "Resources/XObject"
    stored = document.xref_get_key(holder, key)
    assert "fzFrm" not in stored[1]
    assert "replace me" not in stored[1]
    assert "null" not in stored[1]
    document.close()


@pytest.fixture
def named_artifact(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for _index in range(3):
        page = _body(document)
        holder = document.get_new_xref()
        document.update_object(holder, "<</Type/Pagination/Subtype/Watermark>>")
        kind, value = document.xref_get_key(page.xref, "Resources")
        resources = int(value.split()[0]) if kind == "xref" else page.xref
        key = "Properties" if kind == "xref" else "Resources/Properties"
        document.xref_set_key(resources, key, f"<</Mark0 {holder} 0 R>>")
        xref = page.get_contents()[0]
        document.update_stream(
            xref,
            document.xref_stream(xref) + b"\nq /Artifact /Mark0 BDC\n"
            b"BT 1 0 0 1 180 400 Tm /helv 40 Tf [<54415354414b>] TJ ET\nEMC Q\n",
        )
    path = tmp_path / "named.pdf"
    document.save(path)
    document.close()
    return path


def test_a_watermark_artifact_named_through_the_property_list_is_found(named_artifact: Path):
    result = detect_watermark(DetectWatermarkParams(path=str(named_artifact)), silent_progress())
    assert any(candidate.kind == "artifact" for candidate in result.candidates)


def test_a_named_watermark_artifact_is_cut_out_too(named_artifact: Path, tmp_path: Path):
    target = tmp_path / "clean.pdf"
    result = remove_watermark(
        RemoveWatermarkParams(
            path=str(named_artifact),
            output=str(target),
            artifacts=True,
            annotations=False,
            repeated_images=False,
        ),
        silent_progress(),
    )
    assert result.removed_marks == 3
    text = _text_of(target)
    assert "TASTAK" not in text
    assert text.count("govde metni burada") == 3
