import importlib
import sys
import threading
import traceback

from vivepdf.ops._catalog import MODULE_OPERATIONS, OPERATION_MODULES
from vivepdf.rpc.registry import Operation, get_operation

_IMPORT_LOCK = threading.Lock()


def _import(module: str) -> None:
    with _IMPORT_LOCK:
        importlib.import_module(f"vivepdf.ops.{module}")


def load_all() -> None:
    for module in MODULE_OPERATIONS:
        _import(module)


def load_operation(name: str) -> Operation | None:
    operation = get_operation(name)
    if operation is not None:
        return operation
    module = OPERATION_MODULES.get(name)
    if module is None:
        load_all()
    else:
        _import(module)
    return get_operation(name)


def _warm_up() -> None:
    for module in MODULE_OPERATIONS:
        try:
            _import(module)
        except Exception:  # noqa: BLE001
            print(
                f"[warm-up] vivepdf.ops.{module} failed to load: {traceback.format_exc()}",
                file=sys.stderr,
                flush=True,
            )


def start_warm_up() -> threading.Thread:
    thread = threading.Thread(target=_warm_up, name="vivepdf-warm-up", daemon=True)
    thread.start()
    return thread
