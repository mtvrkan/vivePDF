from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.rename import (
    RenameApplyItem,
    RenameApplyParams,
    RenamePreviewParams,
    apply,
    clean_title,
    preview,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _pdf(path: Path, title: str = "", subject: str = "", text: str = "Body") -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), text, fontsize=11)
    document.set_metadata({"title": title, "subject": subject})
    document.save(path)
    document.close()
    return path


def test_counter_is_padded_to_the_batch_size(tmp_path: Path) -> None:
    paths = [str(_pdf(tmp_path / f"f{index}.pdf")) for index in range(12)]
    result = preview(RenamePreviewParams(paths=paths, pattern="Scan {n}"), silent_progress())
    assert [item.new_name for item in result.items][:2] == ["Scan 01", "Scan 02"]
    assert result.items[-1].new_name == "Scan 12"
    assert not any(item.conflict for item in result.items)


def test_subject_field_and_date_format(tmp_path: Path) -> None:
    path = _pdf(tmp_path / "a.pdf", subject="Kira Sözleşmesi", text="Tarih: 05.09.2026")
    result = preview(
        RenamePreviewParams(paths=[str(path)], pattern="{date} {subject}", date_format="%d.%m.%Y"),
        silent_progress(),
    )
    assert result.items[0].new_name == "05.09.2026 Kira Sözleşmesi"


def test_invalid_date_format_is_refused_up_front(tmp_path: Path) -> None:
    path = _pdf(tmp_path / "a.pdf")
    with pytest.raises(OpError) as caught:
        preview(
            RenamePreviewParams(paths=[str(path)], pattern="{date}", date_format="%Q"),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Microsoft Word - Rapor_son.docx", "Rapor_son"),
        ("Microsoft PowerPoint - Sunum.pptx", "Sunum"),
        ("Untitled", ""),
        ("PowerPoint Presentation", ""),
        ("Yıllık Rapor 2025", "Yıllık Rapor 2025"),
    ],
)
def test_clean_title_drops_producer_noise(raw: str, expected: str) -> None:
    assert clean_title(raw) == expected


def test_placeholder_title_falls_back_to_the_largest_line(tmp_path: Path) -> None:
    path = _pdf(tmp_path / "a.pdf", title="Untitled", text="Lease Agreement")
    result = preview(RenamePreviewParams(paths=[str(path)], pattern="{title}"), silent_progress())
    assert result.items[0].new_name == "Lease Agreement"


def test_case_only_rename_really_renames(tmp_path: Path) -> None:
    source = _pdf(tmp_path / "report.pdf")
    result = apply(
        RenameApplyParams(items=[RenameApplyItem(path=str(source), new_name="Report")]),
        silent_progress(),
    )
    assert result.renamed == 1
    assert [entry.name for entry in tmp_path.iterdir()] == ["Report.pdf"]


def test_unchanged_name_is_not_counted(tmp_path: Path) -> None:
    source = _pdf(tmp_path / "same.pdf")
    result = apply(
        RenameApplyParams(items=[RenameApplyItem(path=str(source), new_name="same")]),
        silent_progress(),
    )
    assert result.renamed == 0
    assert result.results[0].ok


def test_a_chain_of_renames_in_one_batch_gets_the_exact_names(tmp_path: Path) -> None:
    first = _pdf(tmp_path / "a.pdf", text="first")
    second = _pdf(tmp_path / "b.pdf", text="second")
    result = apply(
        RenameApplyParams(
            items=[
                RenameApplyItem(path=str(first), new_name="b"),
                RenameApplyItem(path=str(second), new_name="c"),
            ]
        ),
        silent_progress(),
    )
    assert result.renamed == 2
    assert sorted(entry.name for entry in tmp_path.iterdir()) == ["b.pdf", "c.pdf"]
    with pymupdf.open(tmp_path / "b.pdf") as document:
        assert "first" in document[0].get_text()


def test_two_files_can_swap_names(tmp_path: Path) -> None:
    first = _pdf(tmp_path / "a.pdf", text="first")
    second = _pdf(tmp_path / "b.pdf", text="second")
    result = apply(
        RenameApplyParams(
            items=[
                RenameApplyItem(path=str(first), new_name="b"),
                RenameApplyItem(path=str(second), new_name="a"),
            ]
        ),
        silent_progress(),
    )
    assert all(entry.ok for entry in result.results)
    assert sorted(entry.name for entry in tmp_path.iterdir()) == ["a.pdf", "b.pdf"]
    with pymupdf.open(tmp_path / "a.pdf") as document:
        assert "second" in document[0].get_text()


def test_a_file_keeping_its_name_is_not_taken_by_another(tmp_path: Path) -> None:
    kept = _pdf(tmp_path / "a.pdf", text="kept")
    other = _pdf(tmp_path / "x.pdf", text="other")
    result = apply(
        RenameApplyParams(
            items=[
                RenameApplyItem(path=str(other), new_name="a"),
                RenameApplyItem(path=str(kept), new_name="a"),
            ]
        ),
        silent_progress(),
    )
    assert [Path(entry.output or "").name for entry in result.results] == ["a-2.pdf", "a.pdf"]
    with pymupdf.open(tmp_path / "a.pdf") as document:
        assert "kept" in document[0].get_text()


def test_preview_reads_each_file_once_until_it_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from vivepdf.ops import rename

    path = _pdf(tmp_path / "cached.pdf", title="First")
    opened: list[str] = []
    original = rename.open_document

    def counting(raw: str, password: str | None = None):
        opened.append(raw)
        return original(raw, password)

    monkeypatch.setattr(rename, "open_document", counting)
    params = RenamePreviewParams(paths=[str(path)], pattern="{title}")
    assert preview(params, silent_progress()).items[0].new_name == "First"
    assert preview(params.model_copy(update={"pattern": "{title} {n}"}), silent_progress())
    assert len(opened) == 1
    _pdf(path, title="Second title")
    assert preview(params, silent_progress()).items[0].new_name == "Second title"
    assert len(opened) == 2
