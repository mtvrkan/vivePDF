import os
import threading

from vivepdf.rpc.errors import ErrorCode, OpError

_lock = threading.Lock()
_offline = os.environ.get("VIVEPDF_OFFLINE") == "1"


def set_offline(offline: bool) -> None:
    global _offline
    with _lock:
        _offline = offline


def is_offline() -> bool:
    with _lock:
        return _offline


def require_online(feature: str) -> None:
    if is_offline():
        raise OpError(
            ErrorCode.OFFLINE,
            f"{feature} needs the internet and offline mode is on",
            {"feature": feature},
        )
