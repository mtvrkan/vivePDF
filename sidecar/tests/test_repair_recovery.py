import re
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import repair as repair_module
from vivepdf.ops.repair import RepairParams, repair
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _pages(count: int, blank: set[int] | None = None) -> pymupdf.Document:
    document = pymupdf.open()
    for number in range(count):
        page = document.new_page(width=595, height=842)
        if number not in (blank or set()):
            page.insert_text((72, 120), f"Sayfa {number + 1}", fontsize=14)
    return document


def _written(path: Path, document: pymupdf.Document, **options) -> Path:
    document.save(path, garbage=0, deflate=False, use_objstms=False, **options)
    document.close()
    return path


def _texts(path: Path, password: str | None = None) -> list[str]:
    with pymupdf.open(path) as document:
        if password:
            assert document.needs_pass
            assert document.authenticate(password)
        return [page.get_text().strip() for page in document]


def _broken_catalog(path: Path) -> Path:
    data = path.read_bytes()
    path.write_bytes(re.sub(rb"/Root \d+ 0 R", b"/Root 999 0 R", data))
    return path


def _mupdf_gives_up(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*_args, **_kwargs):
        raise OpError(ErrorCode.INVALID_PDF, "cannot repair")

    monkeypatch.setattr(repair_module, "_repair_with_mupdf", refuse)


def test_pages_are_found_again_when_the_catalog_is_gone(tmp_path: Path):
    broken = _broken_catalog(_written(tmp_path / "broken.pdf", _pages(6)))
    target = tmp_path / "out.pdf"
    result = repair(RepairParams(path=str(broken), output=str(target)), silent_progress())
    assert result.recovered_by == "scavenged"
    assert result.rebuilt
    assert result.page_count == 6
    assert _texts(target) == [f"Sayfa {number}" for number in range(1, 7)]


def test_qpdf_takes_over_when_mupdf_cannot_repair(tmp_path: Path, monkeypatch):
    _mupdf_gives_up(monkeypatch)
    source = _written(tmp_path / "source.pdf", _pages(4))
    target = tmp_path / "out.pdf"
    result = repair(RepairParams(path=str(source), output=str(target)), silent_progress())
    assert result.recovered_by == "qpdf"
    assert result.page_count == 4
    assert result.issues == []
    assert _texts(target)[3] == "Sayfa 4"


def test_the_qpdf_path_keeps_the_password(tmp_path: Path, monkeypatch):
    _mupdf_gives_up(monkeypatch)
    source = _written(
        tmp_path / "locked.pdf",
        _pages(3),
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw="gizli",
        owner_pw="sahip",
    )
    target = tmp_path / "out.pdf"
    result = repair(
        RepairParams(path=str(source), password="gizli", output=str(target)), silent_progress()
    )
    assert result.recovered_by == "qpdf"
    assert _texts(target, "gizli") == ["Sayfa 1", "Sayfa 2", "Sayfa 3"]


def test_scavenged_pages_of_a_locked_file_stay_locked(tmp_path: Path):
    source = _written(
        tmp_path / "locked.pdf",
        _pages(3),
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw="gizli",
        owner_pw="sahip",
    )
    broken = _broken_catalog(source)
    target = tmp_path / "out.pdf"
    result = repair(
        RepairParams(path=str(broken), password="gizli", output=str(target)), silent_progress()
    )
    assert result.page_count == 3
    assert _texts(target, "gizli") == ["Sayfa 1", "Sayfa 2", "Sayfa 3"]


def test_the_report_names_each_page_with_a_problem(tmp_path: Path):
    source = _written(tmp_path / "blanks.pdf", _pages(5, blank={1, 3}))
    result = repair(
        RepairParams(path=str(source), output=str(tmp_path / "out.pdf")), silent_progress()
    )
    assert result.empty_pages == 2
    assert [(issue.page, issue.kind) for issue in result.issues] == [(2, "empty"), (4, "empty")]
    assert not result.issues_truncated
    assert result.model_dump(by_alias=True)["issues"][0] == {"page": 2, "kind": "empty"}


def test_a_file_nothing_can_recover_is_still_refused(tmp_path: Path):
    junk = tmp_path / "junk.pdf"
    junk.write_bytes(b"%PDF-1.7\n" + b"\x00garbage" * 200)
    with pytest.raises(OpError) as caught:
        repair(RepairParams(path=str(junk), output=str(tmp_path / "out.pdf")), silent_progress())
    assert caught.value.code == ErrorCode.INVALID_PDF
    assert not (tmp_path / "out.pdf").exists()
    assert list(tmp_path.glob("*.part*")) == []
    assert list(tmp_path.glob("*.qpdf")) == []
