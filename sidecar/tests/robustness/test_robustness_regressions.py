import importlib
import threading
from pathlib import Path

import pymupdf
import pytest
import robustness_corpus

from vivepdf.ops._output import DEDUPLICATE_OBJECT_LIMIT, garbage_level, save_document
from vivepdf.ops.codes import decode_pixmap
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.failures import document_failure
from vivepdf.rpc.progress import Progress, silent_progress
from vivepdf.rpc.registry import get_operation
from vivepdf.rpc.server import run_operation

pytestmark = pytest.mark.robustness

importlib.import_module("vivepdf.rpc.loader").load_all()


def _variant(folder: Path, name: str) -> Path:
    variant = next(item for item in robustness_corpus.build_variants() if item.name == name)
    target = folder / variant.file_name
    target.write_bytes(variant.build())
    return target


def _run(method: str, params: dict, progress: Progress | None = None):
    operation = get_operation(method)
    return run_operation(operation, params, progress or silent_progress(), method)


def _files(folder: Path) -> set[str]:
    return {item.name for item in folder.rglob("*") if item.is_file()}


def test_a_page_tree_cycle_is_reported_as_a_damaged_pdf(tmp_path: Path):
    source = tmp_path / "cycle.pdf"
    source.write_bytes(robustness_corpus.cyclic_kid_is_root())
    with pytest.raises(OpError) as caught:
        _run("codes.read", {"path": str(source)})
    assert caught.value.code == ErrorCode.INVALID_PDF
    assert caught.value.data == {"reason": "damaged"}


def test_a_lying_page_count_is_reported_as_a_damaged_pdf(tmp_path: Path):
    source = tmp_path / "count.pdf"
    source.write_bytes(robustness_corpus.lying_count())
    with pytest.raises(OpError) as caught:
        _run("bookmarks.get", {"path": str(source)})
    assert caught.value.code == ErrorCode.INVALID_PDF


def test_a_deeply_nested_outline_is_refused_instead_of_overflowing(tmp_path: Path):
    source = tmp_path / "deep.pdf"
    source.write_bytes(robustness_corpus.outline_chain(1500))
    with pytest.raises(OpError) as caught:
        _run("bookmarks.get", {"path": str(source)})
    assert caught.value.code == ErrorCode.INVALID_PDF
    assert caught.value.data == {"reason": "tooDeep"}


def test_plain_programming_errors_are_not_disguised_as_damage():
    assert document_failure(RuntimeError("failed reading input.pdf")) is None
    assert document_failure(KeyError("missing")) is None
    assert document_failure(RuntimeError("code=7: cycle in page tree")).code == (
        ErrorCode.INVALID_PDF
    )


def test_in_place_attachment_falls_back_to_a_rewrite_on_a_repaired_file(tmp_path: Path):
    source = _variant(tmp_path, "huge_object_number")
    extra = tmp_path / "note.txt"
    extra.write_text("x", encoding="utf-8")
    _run("attachments.add", {"path": str(source), "files": [str(extra)]})
    with pymupdf.open(source) as document:
        assert document.embfile_names() == ["note.txt"]
    assert not list(tmp_path.glob("*.vivepdf-tmp"))


def test_a_failed_save_leaves_neither_the_output_nor_a_partial_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    document = pymupdf.open(stream=robustness_corpus.single_page(), filetype="pdf")
    target = tmp_path / "out.pdf"

    def refuse(destination: Path, **_options: object) -> None:
        Path(destination).write_bytes(b"%PDF-1.7 partial")
        raise RuntimeError("disk full")

    monkeypatch.setattr(document, "save", refuse)
    with pytest.raises(RuntimeError):
        save_document(document, target)
    assert _files(tmp_path) == set()


def test_huge_object_counts_skip_the_quadratic_duplicate_merge():
    small = pymupdf.open(stream=robustness_corpus.single_page(), filetype="pdf")
    large = pymupdf.open(
        stream=robustness_corpus.pages_document(DEDUPLICATE_OBJECT_LIMIT), filetype="pdf"
    )
    assert garbage_level(small) == 3
    assert garbage_level(small, 4) == 4
    assert garbage_level(large) == 2


def test_repair_removes_its_output_when_no_page_can_be_recovered(tmp_path: Path):
    source = tmp_path / "cycle.pdf"
    source.write_bytes(robustness_corpus.cyclic_self_page())
    output = tmp_path / "out" / "repaired.pdf"
    with pytest.raises(OpError):
        _run("repair.run", {"path": str(source), "output": str(output)})
    assert not output.exists()


def test_accessibility_fix_writes_nothing_when_the_document_cannot_be_scored(tmp_path: Path):
    source = tmp_path / "pattern.pdf"
    source.write_bytes(robustness_corpus.pattern_recursive())
    output = tmp_path / "fixed.pdf"
    with pytest.raises(OpError) as caught:
        _run("a11y.fix", {"path": str(source), "output": str(output), "title": "T"})
    assert caught.value.code == ErrorCode.INVALID_PDF
    assert not output.exists()


def test_cancelled_image_export_removes_the_pages_already_written(tmp_path: Path):
    source = tmp_path / "three.pdf"
    source.write_bytes(robustness_corpus.pages_document(3))
    folder = tmp_path / "images"
    event = threading.Event()
    progress = Progress(lambda _value, _message, _detail: event.set(), event)
    with pytest.raises(OpError) as caught:
        _run("convert.to_images", {"path": str(source), "outputDir": str(folder)}, progress)
    assert caught.value.code == ErrorCode.CANCELLED
    assert _files(folder) == set()


def test_docx_conversion_of_a_broken_image_is_a_damaged_pdf_not_internal(tmp_path: Path):
    source = _variant(tmp_path, "image_jpx_garbage")
    output = tmp_path / "out.docx"
    try:
        _run("convert.to_docx", {"path": str(source), "output": str(output)})
    except OpError as error:
        assert error.code == ErrorCode.INVALID_PDF
        assert not output.exists()


def test_signing_a_document_with_broken_streams_is_refused_as_damaged(tmp_path: Path):
    sign = importlib.import_module("vivepdf.ops.sign_certificate")
    certificate = tmp_path / "signer.p12"
    sign.create_certificate(
        sign.CreateCertificateParams(output=str(certificate), password="pw-12345", common_name="T"),
        silent_progress(),
    )
    source = _variant(tmp_path, "stream_length_lies")
    output = tmp_path / "signed.pdf"
    params = {
        "path": str(source),
        "output": str(output),
        "certificatePath": str(certificate),
        "certificatePassword": "pw-12345",
    }
    with pytest.raises(OpError) as caught:
        _run("sign.run", params)
    assert caught.value.code == ErrorCode.INVALID_PDF
    assert not output.exists()


def test_blocks_without_visible_text_do_not_break_the_block_editor(tmp_path: Path):
    source = _variant(tmp_path, "font_widths_wrong")
    result = _run("editor.blocks", {"path": str(source), "page": 0})
    assert result.model_dump(by_alias=True)["width"] > 0


def test_a_data_row_longer_than_its_header_is_previewed(tmp_path: Path):
    data = tmp_path / "rows.csv"
    data.write_text("name,city\nAli,Ankara,extra,more\n", encoding="utf-8")
    result = _run("forms.data_preview", {"path": str(data)}).model_dump(by_alias=True)
    assert result["rows"][0]["name"] == "Ali"


def test_an_oversized_csv_field_is_an_invalid_data_file(tmp_path: Path):
    data = tmp_path / "huge.csv"
    data.write_text("name\n" + "x" * 200_000 + "\n", encoding="utf-8")
    with pytest.raises(OpError) as caught:
        _run("forms.data_preview", {"path": str(data)})
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_resizing_a_page_without_area_is_refused(tmp_path: Path):
    source = tmp_path / "flat.pdf"
    source.write_bytes(robustness_corpus.single_page(media_box=b"[0 0 0 792]"))
    with pytest.raises(OpError) as caught:
        _run(
            "pages.resize",
            {"path": str(source), "output": str(tmp_path / "o.pdf"), "width": 595, "height": 842},
        )
    assert caught.value.code == ErrorCode.INVALID_PDF


def test_an_empty_pixmap_holds_no_codes():
    document = pymupdf.open(stream=robustness_corpus.single_page(), filetype="pdf")
    pixmap = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 0, 0), False)
    assert decode_pixmap(document[0], pixmap, 72, None) == []


def test_a_failed_split_removes_the_parts_it_already_wrote(tmp_path: Path):
    source = tmp_path / "cycle.pdf"
    source.write_bytes(robustness_corpus.cyclic_kid_is_root())
    folder = tmp_path / "parts"
    with pytest.raises(OpError):
        _run(
            "pages.split",
            {"path": str(source), "mode": "every", "every": 1, "outputDir": str(folder)},
        )
    assert _files(folder) == set()


def test_code_scanning_bounds_the_render_size_of_giant_pages():
    from vivepdf.ops.codes import MAX_SCAN_PIXELS, bounded_dpi

    document = pymupdf.open(
        stream=robustness_corpus.single_page(media_box=b"[0 0 14400 14400]"), filetype="pdf"
    )
    dpi = bounded_dpi(document[0], 300)
    assert (14400 * dpi / 72) ** 2 <= MAX_SCAN_PIXELS
    assert bounded_dpi(document[0], 1) == 1


def test_compression_skips_objects_missing_from_an_object_stream(tmp_path: Path):
    source = tmp_path / "dangling.pdf"
    source.write_bytes(robustness_corpus.dangling_object_stream_entry())
    output = tmp_path / "small.pdf"
    result = _run("compress.run", {"path": str(source), "output": str(output)})
    assert result.page_count == 1
    assert output.exists()


def test_sanitizing_removes_scripts_from_a_document_with_missing_objects(tmp_path: Path):
    source = tmp_path / "dangling.pdf"
    source.write_bytes(robustness_corpus.dangling_object_stream_entry())
    output = tmp_path / "clean.pdf"
    params = {"path": str(source), "output": str(output), "javascript": True, "xmpMetadata": True}
    result = _run("security.sanitize", params)
    assert result.page_count == 1
    assert output.exists()
