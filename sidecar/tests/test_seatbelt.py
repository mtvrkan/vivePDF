import subprocess
import sys
from pathlib import Path

import pytest

from vivepdf.external import _seatbelt

on_macos = pytest.mark.skipif(
    sys.platform != "darwin" or not _seatbelt.available(), reason="needs macOS sandbox-exec"
)


def test_the_profile_names_folders_only_through_parameters() -> None:
    profile = _seatbelt.office_profile(2)

    assert '(param "PRIVATE_0")' in profile
    assert '(param "PRIVATE_1")' in profile
    assert "PRIVATE_2" not in profile
    assert "/Users/" not in profile


def test_the_install_is_the_whole_app_bundle(tmp_path: Path) -> None:
    soffice = tmp_path / "LibreOffice.app" / "Contents" / "MacOS" / "soffice"
    soffice.parent.mkdir(parents=True)
    soffice.write_text("")

    root = _seatbelt.bundle_root(soffice)

    assert root == (tmp_path / "LibreOffice.app").resolve()


@pytest.mark.parametrize(
    ("exit_code", "detail", "failed"),
    [
        (65, "sandbox-exec: unbound variable: PRIVATE_0", True),
        (71, "sandbox-exec: execvp() of 'soffice' failed", True),
        (1, "sandbox-exec: something", False),
        (65, "Error: source file could not be loaded", False),
    ],
)
def test_only_a_sandbox_exec_error_counts_as_a_setup_failure(
    exit_code: int, detail: str, failed: bool
) -> None:
    assert _seatbelt.setup_failed(exit_code, detail) is failed


def _sandboxed(tool: list[str], private: Path, home: Path) -> subprocess.CompletedProcess[str]:
    arguments = _seatbelt.contained_arguments(Path("/bin/cat"), [private], home, tool)
    return subprocess.run(arguments, capture_output=True, text=True, check=False)  # noqa: S603


@on_macos
def test_inside_the_sandbox_only_private_folders_are_readable_and_writable(tmp_path: Path) -> None:
    home = tmp_path / "Ev"
    secret = home / "Belgeler" / "gizli.txt"
    secret.parent.mkdir(parents=True)
    secret.write_text("gizli")
    private = home / "Özel"
    private.mkdir()
    allowed = private / "girdi.txt"
    allowed.write_text("açık")

    read_private = _sandboxed(["/bin/cat", str(allowed)], private, home)
    read_secret = _sandboxed(["/bin/cat", str(secret)], private, home)
    write_outside = _sandboxed(["/usr/bin/touch", str(home / "yeni.txt")], private, home)
    write_private = _sandboxed(["/usr/bin/touch", str(private / "çıktı.pdf")], private, home)

    assert read_private.returncode == 0
    assert read_private.stdout == "açık"
    assert read_secret.returncode != 0
    assert write_outside.returncode != 0
    assert not (home / "yeni.txt").exists()
    assert write_private.returncode == 0
