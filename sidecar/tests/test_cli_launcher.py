import json
import subprocess
import sys
from pathlib import Path

import pytest

from vivepdf import cli_launcher


def test_engine_path_is_the_sidecar_next_to_the_launcher(tmp_path: Path) -> None:
    launcher = tmp_path / "engine" / "vivepdf-cli"

    engine = cli_launcher.engine_path(str(launcher))

    assert engine.parent == launcher.parent.resolve()
    assert engine.stem == "vivepdf-sidecar"


def test_engine_command_forwards_every_argument_after_the_cli_flag(tmp_path: Path) -> None:
    command = cli_launcher.engine_command(str(tmp_path / "vivepdf-cli"), ["info", "a b.pdf"])

    assert command[1:] == ["--cli", "info", "a b.pdf"]


def test_main_exits_with_the_engine_exit_code(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[list[str]] = []

    def fake_call(command: list[str]) -> int:
        calls.append(command)
        return 3

    monkeypatch.setattr(cli_launcher.sys, "platform", "win32")
    monkeypatch.setattr(cli_launcher.sys, "executable", str(tmp_path / "vivepdf-cli.exe"))
    monkeypatch.setattr(cli_launcher.sys, "argv", ["vivepdf-cli", "selftest"])
    monkeypatch.setattr(cli_launcher.subprocess, "call", fake_call)

    with pytest.raises(SystemExit) as excinfo:
        cli_launcher.main()

    assert excinfo.value.code == 3
    assert calls == [[str((tmp_path / "vivepdf-sidecar.exe").resolve()), "--cli", "selftest"]]


def test_module_runs_the_cli_behind_the_cli_flag(sample_pdf: Path) -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "vivepdf", "--cli", "info", str(sample_pdf)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout.strip().splitlines()[-1])["pageCount"] == 3
