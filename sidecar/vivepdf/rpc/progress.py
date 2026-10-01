import threading
from collections.abc import Callable
from typing import Any

from vivepdf.rpc.errors import ErrorCode, OpError

ProgressSink = Callable[[float, str | None, dict[str, Any] | None], None]


class Progress:
    def __init__(self, sink: ProgressSink, cancel_event: threading.Event):
        self._sink = sink
        self._cancel_event = cancel_event

    def report(
        self, value: float, message: str | None = None, detail: dict[str, Any] | None = None
    ) -> None:
        self._sink(value, message, detail)

    def within(self, start: float, end: float) -> "Progress":
        span = end - start

        def scaled(
            value: float, message: str | None = None, detail: dict[str, Any] | None = None
        ) -> None:
            self._sink(start + span * min(max(value, 0.0), 1.0), message, detail)

        return Progress(scaled, self._cancel_event)

    @property
    def cancelled(self) -> bool:
        return self._cancel_event.is_set()

    def check_cancelled(self) -> None:
        if self._cancel_event.is_set():
            raise OpError(ErrorCode.CANCELLED, "operation cancelled")


def silent_progress() -> Progress:
    return Progress(lambda _value, _message, _detail: None, threading.Event())
