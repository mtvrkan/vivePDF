from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.viewing import ViewPrepareParams, prepare_view
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture(autouse=True)
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(tmp_path / "data"))


def _annotated(tmp_path: Path, name: str, repeat: bool) -> Path:
    document = pymupdf.open()
    for index in range(2):
        page = document.new_page()
        note = page.add_text_annot((72, 72 + index * 20), f"note {index}")
        note.update()
    for page in document:
        for xref, kind, _name in page.annot_xrefs():
            if kind == pymupdf.PDF_ANNOT_POPUP:
                continue
            if repeat:
                document.xref_set_key(xref, "NM", pymupdf.get_pdf_str("fitz-A0"))
            else:
                document.xref_set_key(xref, "NM", pymupdf.get_pdf_str(f"note-{page.number}"))
    path = tmp_path / name
    document.save(path)
    document.close()
    return path


def test_unique_names_need_no_copy(tmp_path: Path) -> None:
    result = prepare_view(
        ViewPrepareParams(path=str(_annotated(tmp_path, "ok.pdf", False))), silent_progress()
    )
    assert result.view_path is None


def test_names_repeated_across_pages_are_made_unique_in_a_copy(tmp_path: Path) -> None:
    source = _annotated(tmp_path, "twins.pdf", True)
    before = source.read_bytes()
    result = prepare_view(ViewPrepareParams(path=str(source)), silent_progress())
    assert result.view_path is not None
    assert result.renamed == 1
    assert source.read_bytes() == before
    with pymupdf.open(result.view_path) as copy:
        names = [
            copy.xref_get_key(xref, "NM")[1]
            for page in copy
            for xref, kind, _name in page.annot_xrefs()
            if kind != pymupdf.PDF_ANNOT_POPUP
        ]
        assert len(names) == len(set(names)) == 2
        assert [page.first_annot.info["content"] for page in copy] == ["note 0", "note 1"]


def test_missing_file_is_an_op_error(tmp_path: Path) -> None:
    with pytest.raises(OpError):
        prepare_view(ViewPrepareParams(path=str(tmp_path / "none.pdf")), silent_progress())


def test_a_locked_file_is_checked_once_the_password_is_known(tmp_path: Path) -> None:
    from vivepdf.rpc.errors import ErrorCode

    source = _annotated(tmp_path, "twins.pdf", True)
    locked = tmp_path / "kilitli ş.pdf"
    with pymupdf.open(source) as document:
        document.save(
            locked, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="gizli", owner_pw="sahip"
        )
    with pytest.raises(OpError) as refused:
        prepare_view(ViewPrepareParams(path=str(locked)), silent_progress())
    assert refused.value.code == ErrorCode.NEEDS_PASSWORD
    result = prepare_view(ViewPrepareParams(path=str(locked), password="gizli"), silent_progress())
    assert result.view_path is not None and result.renamed == 1
    with pymupdf.open(result.view_path) as copy:
        assert copy.needs_pass
        assert copy.authenticate("gizli")
        names = [
            copy.xref_get_key(xref, "NM")[1]
            for page in copy
            for xref, kind, _name in page.annot_xrefs()
            if kind != pymupdf.PDF_ANNOT_POPUP
        ]
        assert len(set(names)) == 2
