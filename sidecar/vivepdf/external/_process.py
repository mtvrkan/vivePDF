import contextlib
import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path

from vivepdf.rpc.errors import ErrorCode, OpError

DETAIL_CHARS = 200
KILL_TIMEOUT = 10.0
CANCEL_POLL = 0.5
INHERITED_PYTHON_PREFIXES = ("PYTHON", "UV_", "VIRTUAL_ENV", "PIP_")
LOADER_PATHS = ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH")


def system_environment() -> dict[str, str]:
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.upper().startswith(INHERITED_PYTHON_PREFIXES)
    }
    if not getattr(sys, "frozen", False):
        return environment
    for name in LOADER_PATHS:
        original = environment.pop(f"{name}_ORIG", None)
        environment.pop(name, None)
        if original:
            environment[name] = original
    return environment


def _sanitize_detail(text: str) -> str:
    home = str(Path.home())
    sanitized = text.replace(home, "~") if home else text
    return sanitized.strip()[-DETAIL_CHARS:]


def kill_tree(process: subprocess.Popen[str]) -> None:
    if sys.platform == "win32":
        with contextlib.suppress(OSError, subprocess.TimeoutExpired):
            subprocess.run(  # noqa: S603
                ["taskkill", "/F", "/T", "/PID", str(process.pid)],  # noqa: S607
                capture_output=True,
                timeout=KILL_TIMEOUT,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
    else:
        with contextlib.suppress(OSError, AttributeError):
            os.killpg(process.pid, getattr(signal, "SIGKILL", signal.SIGTERM))
    with contextlib.suppress(OSError):
        process.kill()


def _stop(process: subprocess.Popen[str]) -> None:
    kill_tree(process)
    with contextlib.suppress(subprocess.TimeoutExpired, OSError, ValueError):
        process.communicate(timeout=KILL_TIMEOUT)


def _communicate(
    process: subprocess.Popen[str],
    timeout: float,
    check_cancelled: Callable[[], None] | None,
) -> tuple[str, str]:
    if check_cancelled is None:
        return process.communicate(timeout=timeout)
    deadline = time.monotonic() + timeout
    while True:
        check_cancelled()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise subprocess.TimeoutExpired(process.args, timeout)
        try:
            return process.communicate(timeout=min(CANCEL_POLL, remaining))
        except subprocess.TimeoutExpired:
            continue


def run_tool(
    arguments: list[str],
    timeout: float,
    tool: str,
    env: dict[str, str] | None = None,
    check_cancelled: Callable[[], None] | None = None,
) -> subprocess.CompletedProcess[str]:
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
    try:
        process = subprocess.Popen(  # noqa: S603
            arguments,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=creation_flags,
            start_new_session=sys.platform != "win32",
            env=env,
        )
    except OSError as error:
        raise OpError(ErrorCode.EXTERNAL_TOOL_FAILED, f"{tool} could not start: {error}") from error
    try:
        stdout, stderr = _communicate(process, timeout, check_cancelled)
    except subprocess.TimeoutExpired as error:
        _stop(process)
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED, f"{tool} timed out", {"tool": tool, "reason": "timeout"}
        ) from error
    except BaseException:
        _stop(process)
        raise
    completed = subprocess.CompletedProcess(arguments, process.returncode, stdout, stderr)
    if completed.returncode != 0:
        raw_output = completed.stderr or completed.stdout or ""
        print(f"[{tool}] exit {completed.returncode}: {raw_output}", file=sys.stderr)
        detail = _sanitize_detail(raw_output)
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED,
            f"{tool} failed (exit {completed.returncode})",
            {"tool": tool, "exitCode": completed.returncode, "detail": detail},
        )
    return completed
