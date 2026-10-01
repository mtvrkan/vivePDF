import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

FULL_MARKER = "robustness_full"


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "robustness: fast hostile-input matrix over every RPC op")
    config.addinivalue_line(
        "markers", "robustness_full: full hostile-input matrix, run with -m robustness_full"
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if FULL_MARKER in (config.getoption("markexpr") or ""):
        return
    kept = [item for item in items if item.get_closest_marker(FULL_MARKER) is None]
    dropped = [item for item in items if item.get_closest_marker(FULL_MARKER) is not None]
    if dropped:
        config.hook.pytest_deselected(items=dropped)
        items[:] = kept
