import json
import os
import queue
import re
import sys
import threading
import traceback
import uuid
from collections.abc import Iterable
from concurrent.futures import Future, ThreadPoolExecutor, wait
from typing import Any, BinaryIO

import pymupdf
from pydantic import BaseModel, ValidationError

from vivepdf.ops._content_budget import check_content_budget
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.failures import document_failure
from vivepdf.rpc.loader import load_operation, start_warm_up
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import Request, error_line, progress_line, result_line
from vivepdf.rpc.registry import Operation

_PATH_PATTERN = re.compile(r'[A-Za-z]:\\[^\s"]+|/[^\s"]+')
MAX_LINE_BYTES = 8 * 1024 * 1024
LIGHT_METHODS = frozenset(
    {
        "system.ping",
        "info.get",
        "info.thumbnail",
        "info.page_labels",
        "bookmarks.get",
        "attachments.list",
        "comments.list",
        "layers.list",
        "links.list",
        "forms.fields",
        "studio.thumbnail",
        "studio.image_info",
    }
)


def _redact_message(text: str) -> str:
    return _PATH_PATTERN.sub(lambda match: re.split(r"[\\/]", match.group(0))[-1], text)


def _extract_id(raw: str) -> str | None:
    try:
        parsed = json.loads(raw)
    except ValueError:
        return None
    if isinstance(parsed, dict) and isinstance(parsed.get("id"), str):
        return parsed["id"]
    return None


def run_operation(
    operation: Operation, raw_params: dict[str, Any], progress: Progress, method: str
) -> BaseModel:
    try:
        params = operation.params_model.model_validate(raw_params, by_alias=True, by_name=False)
    except ValidationError as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "invalid parameters",
            {"errors": json.loads(error.json(include_input=False, include_url=False))},
        ) from error
    check_content_budget(raw_params)
    try:
        return operation.handler(params, progress)
    except OpError:
        raise
    except Exception as error:
        translated = document_failure(error)
        if translated is None:
            raise
        print(
            f"[document] {method} refused a damaged document: {traceback.format_exc()}",
            file=sys.stderr,
            flush=True,
        )
        raise translated from error


class _LineWriter:
    def __init__(self, out: BinaryIO):
        self._out = out
        self._lines: queue.Queue[bytes] = queue.Queue()
        self._broken = False
        threading.Thread(target=self._write_forever, name="rpc-writer", daemon=True).start()

    def put(self, line: bytes) -> None:
        self._lines.put(line)

    def drain(self) -> None:
        self._lines.join()

    def _write_forever(self) -> None:
        while True:
            line = self._lines.get()
            try:
                if not self._broken:
                    self._out.write(line)
                    if self._lines.empty():
                        self._out.flush()
            except (OSError, ValueError):
                self._broken = True
            finally:
                self._lines.task_done()


class Server:
    def __init__(self, out: BinaryIO, max_workers: int = 4, light_workers: int = 2):
        self._writer = _LineWriter(out)
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="rpc-heavy")
        self._light_pool = ThreadPoolExecutor(
            max_workers=light_workers, thread_name_prefix="rpc-light"
        )
        self._jobs_lock = threading.Lock()
        self._cancel_events: dict[str, threading.Event] = {}
        self._futures: set[Future[None]] = set()

    def write(self, payload: dict[str, Any]) -> None:
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        self._writer.put(line.encode("utf-8"))

    def _reply_now(self, payload: dict[str, Any]) -> None:
        self.write(payload)
        self._writer.drain()

    def handle_line(self, raw: str) -> None:
        try:
            request = Request.model_validate_json(raw)
        except ValidationError as error:
            self._reply_now(
                error_line(
                    _extract_id(raw),
                    ErrorCode.INVALID_PARAMS,
                    "malformed request",
                    json.loads(error.json(include_input=False, include_url=False)),
                )
            )
            return
        if request.method == "cancel":
            self._cancel(request)
            return
        cancel_event = threading.Event()
        with self._jobs_lock:
            self._cancel_events[request.id] = cancel_event
            pool = self._light_pool if request.method in LIGHT_METHODS else self._pool
            future = pool.submit(self._run, request, cancel_event)
            self._futures.add(future)
            future.add_done_callback(self._futures.discard)

    def _run(self, request: Request, cancel_event: threading.Event) -> None:
        try:
            operation = load_operation(request.method)
            if operation is None:
                self.write(
                    error_line(
                        request.id, ErrorCode.UNKNOWN_METHOD, f"unknown method: {request.method}"
                    )
                )
                return
            progress = Progress(
                lambda value, message, detail: self.write(
                    progress_line(request.id, value, message, detail)
                ),
                cancel_event,
            )
            progress.check_cancelled()
            result = run_operation(operation, request.params, progress, request.method)
            self.write(result_line(request.id, result))
        except OpError as error:
            self.write(error_line(request.id, error.code, error.message, error.data))
        except Exception as error:  # noqa: BLE001
            correlation_id = uuid.uuid4().hex[:8]
            print(
                f"[{correlation_id}] unhandled exception in {request.method}: "
                f"{traceback.format_exc()}",
                file=sys.stderr,
                flush=True,
            )
            message = _redact_message(f"{type(error).__name__}: {error}")
            self.write(
                error_line(
                    request.id,
                    ErrorCode.INTERNAL,
                    message,
                    {"correlationId": correlation_id},
                )
            )
        finally:
            with self._jobs_lock:
                self._cancel_events.pop(request.id, None)

    def _cancel(self, request: Request) -> None:
        target = request.params.get("target")
        with self._jobs_lock:
            event = self._cancel_events.get(target) if isinstance(target, str) else None
        if event is not None:
            event.set()
        self._reply_now({"id": request.id, "result": {"cancelled": event is not None}})

    def wait_idle(self, timeout: float | None = None) -> None:
        with self._jobs_lock:
            pending = list(self._futures)
        wait(pending, timeout=timeout)
        self._writer.drain()

    def serve(self, lines: Iterable[bytes]) -> None:
        for raw in lines:
            if len(raw) > MAX_LINE_BYTES:
                self._reply_now(
                    error_line(
                        None,
                        ErrorCode.INVALID_PARAMS,
                        "request line too large",
                        {"maxBytes": MAX_LINE_BYTES},
                    )
                )
                continue
            text = raw.decode("utf-8-sig", errors="replace").strip()
            if text:
                self.handle_line(text)
        self._pool.shutdown(wait=False, cancel_futures=True)
        self._light_pool.shutdown(wait=False, cancel_futures=True)
        self._writer.drain()

    def finish(self) -> None:
        self._pool.shutdown(wait=True)
        self._light_pool.shutdown(wait=True)
        self._writer.drain()


def detach_stdio() -> tuple[BinaryIO, BinaryIO]:
    sys.stdout.flush()
    requests = os.fdopen(os.dup(sys.stdin.fileno()), "rb")
    replies = os.fdopen(os.dup(sys.stdout.fileno()), "wb")
    null = os.open(os.devnull, os.O_RDONLY)
    try:
        os.dup2(null, sys.stdin.fileno())
    finally:
        os.close(null)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    return requests, replies


def main() -> None:
    requests, replies = detach_stdio()
    sys.stdout = sys.stderr
    pymupdf.set_messages(stream=sys.stderr)
    pymupdf.set_log(stream=sys.stderr)
    server = Server(replies)
    start_warm_up()
    server.serve(requests)
    server.finish()
