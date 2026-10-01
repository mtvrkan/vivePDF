import sys
import threading
from pathlib import Path

import pytest

from vivepdf.ops import _output
from vivepdf.ops._output import replace_patiently, unlink_patiently, write_atomically


class SharingViolation(PermissionError):
    winerror = 32


def _no_waiting(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    pauses: list[float] = []
    monkeypatch.setattr(_output.time, "sleep", pauses.append)
    return pauses


@pytest.mark.skipif(sys.platform != "win32", reason="sharing violations are a Windows lock")
def test_a_target_another_program_holds_open_is_replaced_once_it_lets_go(tmp_path: Path) -> None:
    target = tmp_path / "sources.json"
    target.write_bytes(b"old")
    opened = threading.Event()

    def hold() -> None:
        with target.open("rb"):
            opened.set()
            threading.Event().wait(0.2)

    holder = threading.Thread(target=hold)
    holder.start()
    opened.wait()
    write_atomically(target, lambda partial: partial.write_bytes(b"new"))
    holder.join()
    assert target.read_bytes() == b"new"
    assert [path.name for path in tmp_path.iterdir()] == ["sources.json"]


def test_a_lock_that_never_lifts_is_reported_after_the_last_try(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pauses = _no_waiting(monkeypatch)
    calls: list[Path] = []

    def busy(self: Path, target: Path) -> Path:
        calls.append(target)
        raise SharingViolation(13, "in use")

    monkeypatch.setattr(Path, "replace", busy)
    with pytest.raises(SharingViolation):
        replace_patiently(tmp_path / "a", tmp_path / "b")
    assert len(calls) == _output.SHARING_RETRIES
    assert len(pauses) == _output.SHARING_RETRIES - 1


def test_a_real_permission_error_is_raised_at_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pauses = _no_waiting(monkeypatch)
    calls: list[Path] = []

    def denied(self: Path, missing_ok: bool = False) -> None:
        calls.append(self)
        raise PermissionError(13, "denied")

    monkeypatch.setattr(Path, "unlink", denied)
    with pytest.raises(PermissionError):
        unlink_patiently(tmp_path / "locked.cer")
    assert len(calls) == 1
    assert pauses == []


def test_a_failed_write_leaves_neither_the_target_nor_a_partial_file(tmp_path: Path) -> None:
    def broken(partial: Path) -> None:
        partial.write_bytes(b"half")
        raise ValueError("disk full")

    with pytest.raises(ValueError, match="disk full"):
        write_atomically(tmp_path / "out.json", broken)
    assert list(tmp_path.iterdir()) == []
