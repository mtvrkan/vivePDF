import os
import sys
from pathlib import Path

from vivepdf._data_home import unix_data_home


def user_data_dir() -> Path:
    if override := os.environ.get("VIVEPDF_DATA_DIR"):
        directory = Path(override)
    elif sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        directory = Path(base) / "vivePDF"
    elif sys.platform == "darwin":
        directory = Path.home() / "Library" / "Application Support" / "vivePDF"
    else:
        directory = unix_data_home() / "vivepdf"
    directory.mkdir(parents=True, exist_ok=True)
    return directory
