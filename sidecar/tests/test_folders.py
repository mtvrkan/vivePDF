from pathlib import Path

import pytest

from vivepdf.ops.folders import ListPdfsParams, MoveToFolderParams, list_pdfs, move_to_folder
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"%PDF-1.7\n")
    return path


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    for name in ["doc10.pdf", "doc2.pdf", "Doc1.PDF", "notes.txt", ".hidden.pdf"]:
        _touch(tmp_path / name)
    _touch(tmp_path / "scan.1-compressed.tmp-vivepdf.pdf")
    _touch(tmp_path / "sub" / "inner.pdf")
    _touch(tmp_path / ".cache" / "cached.pdf")
    return tmp_path


def _names(result, root: Path) -> list[str]:
    return [str(Path(item).relative_to(root)).replace("\\", "/") for item in result.files]


def test_lists_top_level_pdfs_in_natural_order(folder: Path) -> None:
    result = list_pdfs(ListPdfsParams(folder=str(folder)), silent_progress())
    assert _names(result, folder) == ["Doc1.PDF", "doc2.pdf", "doc10.pdf"]
    assert result.truncated is False


def test_recursive_includes_subfolders_but_skips_hidden(folder: Path) -> None:
    result = list_pdfs(ListPdfsParams(folder=str(folder), recursive=True), silent_progress())
    assert _names(result, folder) == ["Doc1.PDF", "doc2.pdf", "doc10.pdf", "sub/inner.pdf"]


def test_limit_marks_truncated(folder: Path) -> None:
    result = list_pdfs(ListPdfsParams(folder=str(folder), limit=2), silent_progress())
    assert len(result.files) == 2
    assert result.truncated is True


def test_empty_folder_lists_nothing(tmp_path: Path) -> None:
    result = list_pdfs(ListPdfsParams(folder=str(tmp_path)), silent_progress())
    assert result.files == []


def test_missing_folder_raises_not_found(tmp_path: Path) -> None:
    with pytest.raises(OpError) as caught:
        list_pdfs(ListPdfsParams(folder=str(tmp_path / "missing")), silent_progress())
    assert caught.value.code == ErrorCode.FILE_NOT_FOUND


def test_exclude_skips_named_subfolders_and_entries_carry_size(folder: Path) -> None:
    _touch(folder / "done" / "old.pdf")
    result = list_pdfs(
        ListPdfsParams(folder=str(folder), recursive=True, exclude=[str(folder / "done")]),
        silent_progress(),
    )
    assert "done/old.pdf" not in _names(result, folder)
    assert "sub/inner.pdf" in _names(result, folder)
    assert all(entry.size == 9 and entry.modified > 0 for entry in result.entries)


def test_move_to_folder_creates_folder_and_never_overwrites(tmp_path: Path) -> None:
    target = tmp_path / "Processed"
    _touch(target / "scan.pdf")
    source = _touch(tmp_path / "scan.pdf")
    result = move_to_folder(
        MoveToFolderParams(path=str(source), folder=str(target)), silent_progress()
    )
    assert Path(result.output) == target / "scan (2).pdf"
    assert not source.exists()
    assert (target / "scan.pdf").exists()


def test_move_into_own_folder_keeps_the_file(tmp_path: Path) -> None:
    source = _touch(tmp_path / "scan.pdf")
    result = move_to_folder(
        MoveToFolderParams(path=str(source), folder=str(tmp_path)), silent_progress()
    )
    assert Path(result.output) == source
    assert source.exists()


def test_move_missing_file_raises_not_found(tmp_path: Path) -> None:
    with pytest.raises(OpError) as caught:
        move_to_folder(
            MoveToFolderParams(path=str(tmp_path / "gone.pdf"), folder=str(tmp_path / "x")),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.FILE_NOT_FOUND
