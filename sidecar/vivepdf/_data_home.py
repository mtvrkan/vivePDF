import os
from pathlib import Path


def unix_data_home() -> Path:
    configured = os.environ.get("XDG_DATA_HOME", "")
    if configured and Path(configured).is_absolute():
        return Path(configured)
    return Path.home() / ".local" / "share"
