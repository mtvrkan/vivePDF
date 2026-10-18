import contextlib
import subprocess
import sys
from pathlib import Path

import pytest

from vivepdf.external import _landlock, _seatbelt, libreoffice
from vivepdf.rpc.errors import ErrorCode, OpError


@pytest.fixture
def data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    directory = tmp_path / "data"
    monkeypatch.setenv("VIVEPDF_DATA_DIR", str(directory))
    return directory


@pytest.fixture
def document(tmp_path: Path) -> Path:
    folder = tmp_path / "Belgelerim"
    folder.mkdir()
    source = folder / "rapor.docx"
    source.write_bytes(b"PK\x03\x04document")
    return source


@pytest.fixture
def linux(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, data_dir: Path) -> Path:
    profile = data_dir / "office-profiles" / "p0"
    monkeypatch.setattr(libreoffice, "profile_slot", lambda: contextlib.nullcontext(profile))
    install = tmp_path / "opt" / "libreoffice"
    soffice = install / "program" / "soffice"
    soffice.parent.mkdir(parents=True)
    soffice.write_text("")
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(_landlock, "abi_version", lambda: 4)
    monkeypatch.setattr(libreoffice, "find_soffice", lambda: soffice)
    return soffice


@pytest.fixture
def mac(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, data_dir: Path) -> Path:
    profile = data_dir / "office-profiles" / "p0"
    monkeypatch.setattr(libreoffice, "profile_slot", lambda: contextlib.nullcontext(profile))
    bundle = tmp_path / "Programlar" / "LibreOffice.app"
    soffice = bundle / "Contents" / "MacOS" / "soffice"
    soffice.parent.mkdir(parents=True)
    soffice.write_text("")
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(_seatbelt, "available", lambda: True)
    monkeypatch.setattr(libreoffice, "find_soffice", lambda: soffice)
    return soffice


def _defined(arguments: list[str]) -> dict[str, str]:
    pairs = [arguments[index + 1] for index, item in enumerate(arguments) if item == "-D"]
    return dict(pair.split("=", 1) for pair in pairs)


def _office(calls: list[list[str]], fail: OpError | None = None):
    def run(arguments: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
        calls.append(arguments)
        if fail is not None and len(calls) == 1:
            raise fail
        outdir = Path(arguments[arguments.index("--outdir") + 1])
        (outdir / f"{Path(arguments[-1]).stem}.pdf").write_bytes(b"%PDF-1.7")
        return subprocess.CompletedProcess(arguments, 0, "", "")

    return run


def test_the_install_root_is_the_folder_above_program(tmp_path: Path) -> None:
    soffice = tmp_path / "lo" / "program" / "soffice"
    soffice.parent.mkdir(parents=True)
    soffice.write_text("")

    root = libreoffice.install_root(soffice)

    assert root == (tmp_path / "lo").resolve()


@pytest.mark.parametrize(
    ("platform", "path", "abi", "reason"),
    [
        ("win32", "/opt/lo/program/soffice", 4, "unsupported"),
        ("linux", "/snap/bin/libreoffice", 4, "snap"),
        ("linux", "/opt/lo/program/soffice", 0, "kernelTooOld"),
        ("linux", "/opt/lo/program/soffice", 1, None),
        ("darwin", "/Applications/LibreOffice.app/Contents/MacOS/soffice", 0, None),
    ],
)
def test_isolation_is_blocked_only_for_a_known_reason(
    monkeypatch: pytest.MonkeyPatch, platform: str, path: str, abi: int, reason: str | None
) -> None:
    monkeypatch.setattr(sys, "platform", platform)
    monkeypatch.setattr(_seatbelt, "available", lambda: True)
    monkeypatch.setattr(_landlock, "abi_version", lambda: abi)

    blocker = libreoffice.isolation_blocker(Path(path))

    assert blocker == reason


def test_libreoffice_only_ever_sees_a_private_copy_of_the_document(
    monkeypatch: pytest.MonkeyPatch, data_dir: Path, document: Path, tmp_path: Path
) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(libreoffice, "find_soffice", lambda: tmp_path / "soffice.exe")
    monkeypatch.setattr(libreoffice, "run_tool", _office(calls))
    output = tmp_path / "out"

    produced = libreoffice.convert_to_pdf(document, output)

    assert produced == output / "rapor.pdf"
    assert produced.read_bytes() == b"%PDF-1.7"
    staged = Path(calls[0][-1])
    assert staged.name == "rapor.docx"
    assert staged.parent != document.parent
    assert str(document.parent) not in " ".join(calls[0])
    assert sorted(item.name for item in output.iterdir()) == ["rapor.pdf"]


def test_on_linux_libreoffice_runs_inside_its_containment(
    monkeypatch: pytest.MonkeyPatch, data_dir: Path, document: Path, linux: Path, tmp_path: Path
) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(libreoffice, "run_tool", _office(calls))

    libreoffice.convert_to_pdf(document, tmp_path / "out")

    [arguments] = calls
    separator = arguments.index("--")
    assert arguments[separator - 2] == _landlock.CONTAIN_FLAG
    containment = _landlock.Containment.from_json(arguments[separator - 1])
    assert str(linux.parent.parent.resolve()) in containment.read
    assert any(Path(folder).is_relative_to(data_dir) for folder in containment.write)
    assert not any(Path(folder).is_relative_to(document.parent) for folder in containment.read)
    assert arguments[separator + 1] == str(linux)


def test_a_containment_that_cannot_be_set_up_falls_back_to_a_plain_run(
    monkeypatch: pytest.MonkeyPatch, data_dir: Path, document: Path, linux: Path, tmp_path: Path
) -> None:
    calls: list[list[str]] = []
    failure = OpError(
        ErrorCode.EXTERNAL_TOOL_FAILED,
        "LibreOffice failed (exit 126)",
        {"tool": "LibreOffice", "exitCode": 126, "detail": "[contain] Landlock is not available"},
    )
    monkeypatch.setattr(libreoffice, "run_tool", _office(calls, failure))

    produced = libreoffice.convert_to_pdf(document, tmp_path / "out")

    assert produced.is_file()
    assert _landlock.CONTAIN_FLAG in calls[0]
    assert calls[1][0] == str(linux)


def test_a_contained_libreoffice_that_fails_is_never_run_again_uncontained(
    monkeypatch: pytest.MonkeyPatch, data_dir: Path, document: Path, linux: Path, tmp_path: Path
) -> None:
    calls: list[list[str]] = []
    failure = OpError(
        ErrorCode.EXTERNAL_TOOL_FAILED,
        "LibreOffice failed (exit 1)",
        {"tool": "LibreOffice", "exitCode": 1, "detail": "crashed"},
    )
    monkeypatch.setattr(libreoffice, "run_tool", _office(calls, failure))

    with pytest.raises(OpError):
        libreoffice.convert_to_pdf(document, tmp_path / "out")

    assert len(calls) == 1
    assert not list((tmp_path / "out").iterdir())


def test_status_reports_isolation_only_where_it_exists(
    monkeypatch: pytest.MonkeyPatch, linux: Path
) -> None:
    assert libreoffice.isolation() == "landlock"
    monkeypatch.setattr(_landlock, "abi_version", lambda: 0)
    assert libreoffice.isolation() == "none"
    monkeypatch.setattr(sys, "platform", "win32")
    assert libreoffice.isolation() is None


def test_on_macos_libreoffice_runs_inside_the_system_sandbox(
    monkeypatch: pytest.MonkeyPatch, data_dir: Path, document: Path, mac: Path, tmp_path: Path
) -> None:
    calls: list[list[str]] = []
    folders: list[object] = []
    office = _office(calls)

    def run(arguments: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        folders.append(kwargs.get("cwd"))
        return office(arguments, **kwargs)

    monkeypatch.setattr(libreoffice, "run_tool", run)

    libreoffice.convert_to_pdf(document, tmp_path / "out")

    [arguments] = calls
    [folder] = folders
    assert isinstance(folder, Path)
    assert folder.parent == tmp_path / "out"
    assert arguments[:2] == [str(_seatbelt.SANDBOX_EXEC), "-p"]
    assert str(tmp_path) not in arguments[2]
    defined = _defined(arguments)
    assert defined["INSTALL"] == str(mac.parent.parent.parent.resolve())
    assert defined["HOME"] == str(Path.home().resolve())
    private = [Path(value) for key, value in defined.items() if key.startswith("PRIVATE_")]
    assert any(folder.is_relative_to(data_dir.resolve()) for folder in private)
    assert any(folder.is_relative_to((tmp_path / "out").resolve()) for folder in private)
    assert not any(document.parent.resolve().is_relative_to(folder) for folder in private)
    assert arguments[arguments.index(str(mac))] == str(mac)


def test_a_macos_sandbox_that_cannot_be_set_up_falls_back_to_a_plain_run(
    monkeypatch: pytest.MonkeyPatch, data_dir: Path, document: Path, mac: Path, tmp_path: Path
) -> None:
    calls: list[list[str]] = []
    failure = OpError(
        ErrorCode.EXTERNAL_TOOL_FAILED,
        "LibreOffice failed (exit 65)",
        {"tool": "LibreOffice", "exitCode": 65, "detail": "sandbox-exec: unbound variable"},
    )
    monkeypatch.setattr(libreoffice, "run_tool", _office(calls, failure))

    produced = libreoffice.convert_to_pdf(document, tmp_path / "out")

    assert produced.is_file()
    assert calls[0][0] == str(_seatbelt.SANDBOX_EXEC)
    assert calls[1][0] == str(mac)


def test_macos_reports_the_sandbox_and_runs_plainly_without_it(
    monkeypatch: pytest.MonkeyPatch, data_dir: Path, document: Path, mac: Path, tmp_path: Path
) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(libreoffice, "run_tool", _office(calls))
    assert libreoffice.isolation() == "sandbox"
    monkeypatch.setattr(_seatbelt, "available", lambda: False)

    libreoffice.convert_to_pdf(document, tmp_path / "out")

    assert libreoffice.isolation() is None
    assert calls[0][0] == str(mac)
