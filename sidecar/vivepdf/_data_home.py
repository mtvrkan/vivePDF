import os
import sys
from pathlib import Path

MACOS_TOOL_DIRS = ("/opt/homebrew/bin", "/usr/local/bin")


def extend_macos_path() -> None:
    if sys.platform != "darwin":
        return
    entries = [entry for entry in os.environ.get("PATH", "").split(os.pathsep) if entry]
    missing = [entry for entry in MACOS_TOOL_DIRS if entry not in entries]
    if missing:
        os.environ["PATH"] = os.pathsep.join([*entries, *missing])


def unix_data_home() -> Path:
    configured = os.environ.get("XDG_DATA_HOME", "")
    if configured and Path(configured).is_absolute():
        return Path(configured)
    return Path.home() / ".local" / "share"
