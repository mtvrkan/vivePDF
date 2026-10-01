from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.scan import (
    ScanSplitParams,
    ScanSplitPart,
    ScanSplitRules,
    SeparatorSheetParams,
    blank_runs,
    preview_split,
    separator_sheet,
    split_scans,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


def _document(path: Path, pages: list[str]) -> Path:
    document = pymupdf.open()
    for text in pages:
        page = document.new_page()
        if text:
            page.insert_text((72, 120), text, fontsize=24)
    document.save(path)
    document.close()
    return path


def test_blank_runs_keep_only_long_enough_runs() -> None:
    flags = [False, True, False, True, True, False, True, True, True]
    assert blank_runs(flags, 1) == {1, 3, 4, 6, 7, 8}
    assert blank_runs(flags, 2) == {3, 4, 6, 7, 8}
    assert blank_runs(flags, 3) == {6, 7, 8}


def test_two_blank_pages_in_a_row_split_but_a_single_blank_back_stays(tmp_path: Path) -> None:
    source = _document(tmp_path / "duplex.pdf", ["Alpha", "", "Bravo", "", "", "Charlie"])
    preview = preview_split(ScanSplitRules(path=str(source), blank_run=2), silent_progress())
    assert [(part.first_page, part.last_page) for part in preview.parts] == [(1, 3), (6, 6)]
    assert preview.separator_pages == [4, 5]


def test_kept_blank_run_starts_only_one_part(tmp_path: Path) -> None:
    source = _document(tmp_path / "keep.pdf", ["Alpha", "", "", "Bravo"])
    preview = preview_split(
        ScanSplitRules(path=str(source), blank_run=2, drop_separators=False), silent_progress()
    )
    assert [(part.first_page, part.last_page) for part in preview.parts] == [(1, 1), (2, 4)]


def test_edited_parts_from_the_preview_are_written(tmp_path: Path) -> None:
    source = _document(tmp_path / "edit.pdf", ["One", "Two", "Three", "Four"])
    result = split_scans(
        ScanSplitParams(
            path=str(source),
            output_dir=str(tmp_path / "out"),
            pattern="{name}-{n}-{label}",
            parts=[
                ScanSplitPart(first_page=1, last_page=2, label="Fatura"),
                ScanSplitPart(first_page=4, last_page=4),
            ],
        ),
        silent_progress(),
    )
    assert [(item.first_page, item.last_page, item.label) for item in result.outputs] == [
        (1, 2, "Fatura"),
        (4, 4, None),
    ]
    assert result.separator_pages == [3]
    assert Path(result.outputs[0].output).name == "edit-1-Fatura.pdf"


@pytest.mark.parametrize(
    "parts",
    [
        [ScanSplitPart(first_page=1, last_page=3), ScanSplitPart(first_page=3, last_page=4)],
        [ScanSplitPart(first_page=2, last_page=1)],
        [ScanSplitPart(first_page=1, last_page=9)],
    ],
)
def test_broken_parts_are_refused(tmp_path: Path, parts: list[ScanSplitPart]) -> None:
    source = _document(tmp_path / "bad.pdf", ["One", "Two", "Three", "Four"])
    with pytest.raises(OpError) as caught:
        split_scans(
            ScanSplitParams(path=str(source), output_dir=str(tmp_path / "out"), parts=parts),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "parts"}
    assert not list((tmp_path / "out").glob("*.pdf"))


def test_printed_separator_sheets_split_the_scan_by_their_labels(tmp_path: Path) -> None:
    sheets = separator_sheet(
        SeparatorSheetParams(
            output=str(tmp_path / "sheets.pdf"),
            labels=["Fatura 7", ""],
            prefix="VIVE:",
            title="Ayırıcı sayfa",
            hint="Bu sayfayı taranacak belgenin önüne koyun.",
        ),
        silent_progress(),
    )
    assert sheets.separator_sheets == 2
    with pymupdf.open(sheets.output) as printed:
        assert "Ayırıcı sayfa" in printed[0].get_text()
        assert "Fatura 7" in printed[0].get_text()
        scan = pymupdf.open()
        scan.insert_pdf(printed, from_page=0, to_page=0)
        for text in ("First", "Second"):
            scan.new_page().insert_text((72, 120), text, fontsize=24)
        scan.insert_pdf(printed, from_page=1, to_page=1)
        scan.new_page().insert_text((72, 120), "Third", fontsize=24)
    source = tmp_path / "scan.pdf"
    scan.save(source)
    scan.close()
    preview = preview_split(
        ScanSplitRules(path=str(source), mode="qr", qr_prefix="VIVE:"), silent_progress()
    )
    assert [(part.first_page, part.last_page, part.label) for part in preview.parts] == [
        (2, 3, "Fatura 7"),
        (5, 5, ""),
    ]
