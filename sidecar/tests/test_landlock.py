import socket
import subprocess
import sys
from pathlib import Path

import pytest

from vivepdf.external import _landlock

needs_landlock = pytest.mark.skipif(
    _landlock.abi_version() < 1, reason="the kernel has no Landlock"
)


def test_the_first_abi_handles_only_the_original_file_rights() -> None:
    attributes, size = _landlock.ruleset_attributes(1)

    assert size == 8
    assert attributes.handled_access_fs == (1 << 13) - 1
    assert attributes.handled_access_net == 0


def test_a_newer_abi_also_handles_tcp_and_scopes() -> None:
    attributes, size = _landlock.ruleset_attributes(6)

    assert size == 24
    assert attributes.handled_access_fs & _landlock.REFER
    assert attributes.handled_access_fs & _landlock.TRUNCATE
    assert attributes.handled_access_fs & _landlock.IOCTL_DEV
    assert attributes.handled_access_net == _landlock.NET_BIND_TCP | _landlock.NET_CONNECT_TCP
    assert attributes.scoped == (_landlock.SCOPE_ABSTRACT_UNIX_SOCKET | _landlock.SCOPE_SIGNAL)


def test_tcp_is_handled_from_the_fourth_abi_without_scopes() -> None:
    attributes, size = _landlock.ruleset_attributes(4)

    assert size == 16
    assert attributes.handled_access_net
    assert attributes.scoped == 0


def test_the_office_containment_opens_only_the_install_fonts_and_private_folders(
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    install = tmp_path / "lo"
    private = [tmp_path / "profile", tmp_path / "work"]

    containment = _landlock.office_containment(install, private, home)

    assert str(install) in containment.read
    assert str(home / ".local/share/fonts") in containment.read
    assert str(home) not in containment.read + containment.write
    assert [str(folder) for folder in private] == containment.write[-2:]
    assert containment.sockets == ["/tmp"]


def test_a_containment_survives_its_command_line_form(tmp_path: Path) -> None:
    containment = _landlock.Containment(read=["/usr"], write=[str(tmp_path)], sockets=["/tmp"])

    arguments = _landlock.contained_arguments(containment, ["/bin/true"])

    separator = arguments.index("--")
    assert arguments[separator - 2] == _landlock.CONTAIN_FLAG
    assert _landlock.Containment.from_json(arguments[separator - 1]) == containment
    assert arguments[separator + 1 :] == ["/bin/true"]


def test_a_contain_call_without_a_program_is_refused() -> None:
    with pytest.raises(SystemExit) as stopped:
        _landlock.contain_main(["{}", "--"])

    assert stopped.value.code == 2


def test_no_landlock_answers_version_zero_outside_linux(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "platform", "win32")

    assert _landlock.abi_version() == 0


def _python_folders() -> list[str]:
    folders = {sys.prefix, sys.base_prefix, str(Path(sys.executable).resolve().parents[1])}
    return sorted(folders)


def _contained_run(tmp_path: Path, program: list[str]) -> subprocess.CompletedProcess[str]:
    inside = tmp_path / "inside"
    containment = _landlock.Containment(
        read=[*_landlock.SYSTEM_READ, *_python_folders()], write=[str(inside), "/dev/null"]
    )
    return subprocess.run(  # noqa: S603
        _landlock.contained_arguments(containment, program),
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


@pytest.fixture
def folders(tmp_path: Path) -> tuple[Path, Path]:
    inside = tmp_path / "inside"
    inside.mkdir()
    (inside / "ok.txt").write_text("inside")
    outside = tmp_path / "outside.txt"
    outside.write_text("secret")
    return inside / "ok.txt", outside


@needs_landlock
def test_a_contained_program_reads_its_own_folder(
    tmp_path: Path, folders: tuple[Path, Path]
) -> None:
    inside, _ = folders

    completed = _contained_run(tmp_path, ["/bin/cat", str(inside)])

    assert completed.returncode == 0
    assert completed.stdout == "inside"


@needs_landlock
def test_a_contained_program_cannot_read_beside_its_folder(
    tmp_path: Path, folders: tuple[Path, Path]
) -> None:
    _, outside = folders

    completed = _contained_run(tmp_path, ["/bin/cat", str(outside)])

    assert completed.returncode != 0
    assert "secret" not in completed.stdout
    assert "Permission denied" in completed.stderr


@needs_landlock
def test_a_contained_program_cannot_open_a_tcp_connection(tmp_path: Path) -> None:
    if _landlock.abi_version() < 4:
        pytest.skip("this kernel's Landlock does not handle TCP")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        probe = f"import socket; socket.create_connection(('127.0.0.1', {port}), timeout=5)"

        completed = _contained_run(tmp_path, [sys.executable, "-c", probe])

    assert completed.returncode != 0
    assert "PermissionError" in completed.stderr


def test_the_contained_program_gets_the_loader_paths_of_the_system(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started: dict[str, object] = {}
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setenv("LD_LIBRARY_PATH", "/engine/_internal")
    monkeypatch.setenv("LD_LIBRARY_PATH_ORIG", "/usr/local/lib")
    monkeypatch.setattr(_landlock, "restrict", lambda containment: 4)
    monkeypatch.setattr(
        _landlock.os,
        "execve",
        lambda program, arguments, environment: started.update(
            program=program, environment=environment
        ),
        raising=False,
    )

    _landlock.contain_main(["{}", "--", "/usr/bin/soffice", "--headless"])

    assert started["program"] == "/usr/bin/soffice"
    assert started["environment"]["LD_LIBRARY_PATH"] == "/usr/local/lib"


def test_a_containment_that_cannot_be_set_up_stops_before_the_program_runs(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def unavailable(containment: _landlock.Containment) -> int:
        raise OSError("Landlock is not available")

    monkeypatch.setattr(_landlock, "restrict", unavailable)

    with pytest.raises(SystemExit) as stopped:
        _landlock.contain_main(["{}", "--", "/usr/bin/soffice"])

    assert stopped.value.code == 126
    assert capsys.readouterr().err.startswith("[contain]")
