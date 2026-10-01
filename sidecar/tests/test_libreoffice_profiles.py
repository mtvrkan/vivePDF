import shutil
import sys
import tempfile
import threading
from pathlib import Path

import pymupdf
import pytest
from docx import Document

from vivepdf.external import libreoffice
from vivepdf.rpc.errors import OpError


@pytest.fixture
def short_data_dir(monkeypatch: pytest.MonkeyPatch):
    directory = Path(tempfile.mkdtemp(prefix="vp"))
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(directory))
    yield directory
    shutil.rmtree(directory, ignore_errors=True)


def test_concurrent_slots_get_their_own_profile(short_data_dir: Path) -> None:
    with libreoffice.profile_slot() as first, libreoffice.profile_slot() as second:
        assert first != second
        assert first.parent == second.parent == short_data_dir / "office-profiles"
    with libreoffice.profile_slot() as again:
        assert again == first


def test_overflow_slots_are_removed_afterwards(short_data_dir: Path) -> None:
    with (
        libreoffice.profile_slot() as first,
        libreoffice.profile_slot() as second,
        libreoffice.profile_slot() as third,
    ):
        for slot in (first, second, third):
            (slot / "user").mkdir(parents=True)
    root = short_data_dir / "office-profiles"
    assert first.is_dir() and second.is_dir()
    assert not third.exists()
    assert not (root / f"{third.name}.lock").exists()


def test_arguments_keep_every_write_inside_the_profile(short_data_dir: Path) -> None:
    with libreoffice.profile_slot() as slot:
        arguments = libreoffice.profile_arguments(slot)
    assert arguments[0] == f"-env:UserInstallation={slot.resolve().as_uri()}"
    assert arguments[1].startswith("-env:UNO_SHARED_PACKAGES_CACHE=")
    assert arguments[1].endswith((slot / "shared").resolve().as_uri())
    environment = libreoffice.conversion_environment()
    assert environment["SAL_DISABLE_OPENCL"] == "1"
    assert not any(key.upper().startswith("PYTHON") for key in environment)


def _letter(folder: Path, number: int) -> Path:
    document = Document()
    document.add_paragraph(f"Mektup {number}: çalışma ağı şöyle")
    path = folder / f"mektup {number}.docx"
    document.save(path)
    return path


def test_three_conversions_run_side_by_side(short_data_dir: Path, tmp_path: Path) -> None:
    if libreoffice.find_soffice() is None:
        pytest.skip("LibreOffice is not available")
    sources = [_letter(tmp_path, number) for number in range(3)]
    produced: dict[int, Path] = {}
    failures: list[BaseException] = []

    def convert(number: int) -> None:
        try:
            produced[number] = libreoffice.convert_to_pdf(
                sources[number], tmp_path / f"out{number}"
            )
        except BaseException as error:  # noqa: BLE001
            failures.append(error)

    threads = [threading.Thread(target=convert, args=(number,)) for number in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not failures
    for number in range(3):
        with pymupdf.open(produced[number]) as document:
            assert f"Mektup {number}" in document[0].get_text()
    profiles = short_data_dir / "office-profiles"
    assert sorted(item.name for item in profiles.iterdir() if item.is_dir()) == ["p0", "p1"]


@pytest.mark.skipif(sys.platform != "win32", reason="the path limit is a Windows rule")
def test_a_deep_data_folder_falls_back_to_a_short_profile_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    deep = tmp_path / ("uzun-klasör-" * 12)
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(deep))
    root = libreoffice.profiles_root()
    assert len(str(root)) <= libreoffice.PROFILE_ROOT_LIMIT
    assert root.name == "vivepdf-office"


@pytest.mark.skipif(sys.platform != "win32", reason="the path limit is a Windows rule")
def test_no_short_root_is_a_clear_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(tmp_path / ("a" * 120)))
    monkeypatch.setattr(libreoffice.tempfile, "gettempdir", lambda: str(tmp_path / ("b" * 120)))
    with pytest.raises(OpError) as refused:
        libreoffice.profiles_root()
    assert refused.value.data["reason"] == "officeProfilePath"
