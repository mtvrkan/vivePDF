from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.attachments import (
    AttachmentsAddParams,
    AttachmentsExtractParams,
    AttachmentsListParams,
    AttachmentsNamesParams,
    add_attachments,
    extract_attachments,
    list_attachments,
    remove_attachments,
)
from vivepdf.ops.stamp import StampParams, render_stamp_text, stamp
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def test_stamp_draws_text_on_selected_pages(sample_pdf: Path, tmp_path: Path) -> None:
    result = stamp(
        StampParams(
            path=str(sample_pdf),
            output=str(tmp_path / "stamped.pdf"),
            pages="1-2",
            text="ONAYLANDI",
            name="Ayşe",
            position="top-right",
        ),
        silent_progress(),
    )
    assert result.stamped == 2 and result.page_count == 3
    with pymupdf.open(result.output) as document:
        assert "ONAYLANDI" in document[0].get_text()
        assert "ONAYLANDI" in document[1].get_text()
        assert "ONAYLANDI" not in document[2].get_text()
        words = document[0].get_text("words")
        stamp_words = [word for word in words if word[4] == "ONAYLANDI"]
        assert stamp_words and stamp_words[0][0] > document[0].rect.width / 2


def test_stamp_tokens_and_turkish_text(sample_pdf: Path, tmp_path: Path) -> None:
    text = render_stamp_text(
        "{name} · {page}/{total} · {file}", 2, 3, "Şule", str(sample_pdf), "%Y"
    )
    assert text == "Şule · 2/3 · sample"
    result = stamp(
        StampParams(
            path=str(sample_pdf),
            output=str(tmp_path / "tr.pdf"),
            text="GİZLİ",
            position="center",
            rotation=0,
            border=False,
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        assert "GİZLİ" in document[0].get_text()


def test_attachments_add_list_extract_remove(sample_pdf: Path, tmp_path: Path) -> None:
    payload = tmp_path / "notlar.txt"
    payload.write_text("merhaba", encoding="utf-8")
    added = add_attachments(
        AttachmentsAddParams(
            path=str(sample_pdf), files=[str(payload), str(payload)], description="Ek"
        ),
        silent_progress(),
    )
    assert added.names == ["notlar.txt", "notlar-2.txt"]
    listed = list_attachments(AttachmentsListParams(path=str(sample_pdf)), silent_progress())
    assert listed.count == 2 and listed.items[0].size == 7 and listed.items[0].description == "Ek"
    extracted = extract_attachments(
        AttachmentsExtractParams(
            path=str(sample_pdf), names=["notlar-2.txt"], output_dir=str(tmp_path / "out")
        ),
        silent_progress(),
    )
    assert Path(extracted.outputs[0]).read_text(encoding="utf-8") == "merhaba"
    removed = remove_attachments(
        AttachmentsNamesParams(path=str(sample_pdf), names=["notlar.txt", "yok.txt"]),
        silent_progress(),
    )
    assert removed.changed == 1
    assert (
        list_attachments(AttachmentsListParams(path=str(sample_pdf)), silent_progress()).count == 1
    )
    with pymupdf.open(sample_pdf) as document:
        assert document.page_count == 3


def test_attachments_remove_purges_bytes_from_file(sample_pdf: Path, tmp_path: Path) -> None:
    payload = tmp_path / "secret.txt"
    marker = b"REMOVE-ME-MARKER-BYTES"
    payload.write_bytes(marker)
    add_attachments(
        AttachmentsAddParams(path=str(sample_pdf), files=[str(payload)]),
        silent_progress(),
    )
    assert marker in sample_pdf.read_bytes()
    removed = remove_attachments(
        AttachmentsNamesParams(path=str(sample_pdf), names=["secret.txt"]),
        silent_progress(),
    )
    assert removed.changed == 1
    assert marker not in sample_pdf.read_bytes()


def test_attachments_missing_file_and_missing_name(sample_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as raised:
        add_attachments(
            AttachmentsAddParams(path=str(sample_pdf), files=[str(tmp_path / "yok.bin")]),
            silent_progress(),
        )
    assert raised.value.code == ErrorCode.FILE_NOT_FOUND
    with pytest.raises(OpError) as raised:
        extract_attachments(
            AttachmentsExtractParams(
                path=str(sample_pdf), names=["yok"], output_dir=str(tmp_path / "o")
            ),
            silent_progress(),
        )
    assert raised.value.data == {"reason": "missingAttachment"}


@pytest.mark.parametrize(
    "hostile_name",
    [
        "..\..\escaped.txt",
        "../../escaped.txt",
        "C:\Windows\escaped.txt",
        "..",
        "sub/dir/escaped.txt",
    ],
)
def test_extracting_an_attachment_cannot_write_outside_the_chosen_folder(
    tmp_path: Path, hostile_name: str
) -> None:
    source = tmp_path / "hostile.pdf"
    document = pymupdf.open()
    document.new_page()
    document.embfile_add("payload", b"payload", filename=hostile_name, ufilename=hostile_name)
    document.save(source)
    document.close()

    target_dir = tmp_path / "extracted"
    target_dir.mkdir()
    listed = list_attachments(AttachmentsListParams(path=str(source)), silent_progress())
    result = extract_attachments(
        AttachmentsExtractParams(
            path=str(source),
            output_dir=str(target_dir),
            names=[item.name for item in listed.items],
        ),
        silent_progress(),
    )
    for written in result.outputs:
        assert Path(written).resolve().parent == target_dir.resolve(), written
    assert list(tmp_path.glob("escaped.txt")) == []
    assert list(tmp_path.parent.glob("escaped.txt")) == []
