import importlib
import json
import queue
import sys
import threading
import time
import traceback
from collections.abc import Callable
from typing import Any

PROGRESS_INTERVAL = 0.5


def run_case(
    request: dict[str, Any], cancel_event: threading.Event, emit: Callable[[dict], None]
) -> dict[str, Any]:
    from vivepdf.rpc.errors import ErrorCode, OpError
    from vivepdf.rpc.progress import Progress
    from vivepdf.rpc.registry import get_operation
    from vivepdf.rpc.server import run_operation

    operation = get_operation(request["op"])
    if operation is None:
        return {"status": "unknown_op"}
    last = [0.0]

    def sink(value: float, _message: str | None, _detail: dict | None) -> None:
        now = time.monotonic()
        if now - last[0] >= PROGRESS_INTERVAL:
            last[0] = now
            emit({"status": "progress", "value": value})

    try:
        result = run_operation(
            operation, request["params"], Progress(sink, cancel_event), request["op"]
        )
        json.dumps(result.model_dump(by_alias=True, mode="json"))
    except OpError as error:
        return {
            "status": "error",
            "code": error.code.value,
            "message": error.message,
            "data": error.data if isinstance(error.data, dict) else None,
            "validation": error.code == ErrorCode.INVALID_PARAMS
            and error.message == "invalid parameters",
        }
    except BaseException as error:
        return {
            "status": "exception",
            "type": type(error).__name__,
            "message": str(error)[:500],
            "traceback": traceback.format_exc()[-4000:],
        }
    return {"status": "ok"}


def main() -> None:
    channel = sys.stdout.buffer
    sys.stdout = sys.stderr
    importlib.import_module("vivepdf.rpc.loader").load_all()
    write_lock = threading.Lock()

    def emit(payload: dict) -> None:
        with write_lock:
            channel.write((json.dumps(payload, default=str) + "\n").encode("utf-8"))
            channel.flush()

    requests: queue.Queue = queue.Queue()
    current = {"event": threading.Event()}

    def read_input() -> None:
        for line in sys.stdin.buffer:
            message = json.loads(line)
            if message.get("cancel"):
                current["event"].set()
            else:
                requests.put(message)
        requests.put(None)

    threading.Thread(target=read_input, daemon=True).start()
    emit({"status": "ready"})
    while (request := requests.get()) is not None:
        event = threading.Event()
        current["event"] = event
        emit(run_case(request, event, emit))


if __name__ == "__main__":
    main()
