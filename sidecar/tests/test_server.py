import io
import json
from pathlib import Path
from typing import Any

import pytest

from vivepdf.rpc.registry import Operation
from vivepdf.rpc.server import Server, _redact_message


@pytest.fixture
def server() -> tuple[Server, io.BytesIO]:
    out = io.BytesIO()
    return Server(out, max_workers=2), out


def _lines(out: io.BytesIO) -> list[dict[str, Any]]:
    return [json.loads(line) for line in out.getvalue().decode("utf-8").splitlines() if line]


def _send(server: Server, payload: dict[str, Any]) -> None:
    server.handle_line(json.dumps(payload))
    server.wait_idle(timeout=10)


def test_ping_returns_result(server: tuple[Server, io.BytesIO]) -> None:
    srv, out = server
    _send(srv, {"id": "1", "method": "system.ping", "params": {}})

    [line] = _lines(out)
    assert line["id"] == "1"
    assert line["result"]["version"]
    assert line["result"]["pymupdf"]


def test_info_get_round_trip(server: tuple[Server, io.BytesIO], sample_pdf: Path) -> None:
    srv, out = server
    _send(srv, {"id": "2", "method": "info.get", "params": {"path": str(sample_pdf)}})

    [line] = _lines(out)
    assert line["result"]["pageCount"] == 3
    assert line["result"]["fileName"] == "sample.pdf"


def test_unknown_method(server: tuple[Server, io.BytesIO]) -> None:
    srv, out = server
    _send(srv, {"id": "3", "method": "nope.nothing"})

    [line] = _lines(out)
    assert line["error"]["code"] == "UNKNOWN_METHOD"


def test_invalid_params(server: tuple[Server, io.BytesIO]) -> None:
    srv, out = server
    _send(srv, {"id": "4", "method": "info.get", "params": {"pathh": "x"}})

    [line] = _lines(out)
    assert line["id"] == "4"
    assert line["error"]["code"] == "INVALID_PARAMS"
    assert line["error"]["data"]["errors"]


def test_invalid_params_do_not_echo_a_password(server: tuple[Server, io.BytesIO]) -> None:
    srv, out = server
    source = {"path": "a.pdf", "password": "hunter2-secret"}
    params = {"sources": [source], "pages": [{"source": "main", "index": 1}], "output": "b.pdf"}
    _send(srv, {"id": "4b", "method": "pages.assemble", "params": params})

    [line] = _lines(out)
    assert line["error"]["code"] == "INVALID_PARAMS"
    assert "hunter2-secret" not in json.dumps(line)


def test_malformed_json_keeps_id_when_possible(server: tuple[Server, io.BytesIO]) -> None:
    srv, out = server
    srv.handle_line('{"id": "5", "method": 12}')
    srv.handle_line("not json at all")

    lines = _lines(out)
    assert lines[0]["id"] == "5"
    assert lines[0]["error"]["code"] == "INVALID_PARAMS"
    assert lines[1]["id"] is None
    assert lines[1]["error"]["code"] == "INVALID_PARAMS"


def test_malformed_request_does_not_echo_its_input(server: tuple[Server, io.BytesIO]) -> None:
    srv, out = server
    srv.handle_line('{"id": "5c", "method": ["hunter2-secret"], "params": {"password": "x"}}')

    [line] = _lines(out)
    assert line["error"]["code"] == "INVALID_PARAMS"
    assert "hunter2-secret" not in json.dumps(line)


def test_error_from_operation_is_forwarded(
    server: tuple[Server, io.BytesIO], tmp_path: Path
) -> None:
    srv, out = server
    _send(srv, {"id": "6", "method": "info.get", "params": {"path": str(tmp_path / "missing.pdf")}})

    [line] = _lines(out)
    assert line["error"]["code"] == "FILE_NOT_FOUND"
    assert line["error"]["data"]["path"].endswith("missing.pdf")


def test_cancel_unknown_target(server: tuple[Server, io.BytesIO]) -> None:
    srv, out = server
    _send(srv, {"id": "7", "method": "cancel", "params": {"target": "ghost"}})

    [line] = _lines(out)
    assert line == {"id": "7", "result": {"cancelled": False}}


def test_unexpected_exception_returns_class_message_and_correlation_id(
    server: tuple[Server, io.BytesIO],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    srv, out = server

    def _boom(params: Any, progress: Any) -> Any:
        raise RuntimeError(r"failed reading C:\Users\bob\secret\input.pdf")

    from vivepdf.ops.info import InfoGetParams

    monkeypatch.setattr(
        "vivepdf.rpc.server.load_operation",
        lambda name: Operation(name=name, params_model=InfoGetParams, handler=_boom),
    )
    _send(srv, {"id": "8", "method": "info.get", "params": {"path": "input.pdf"}})

    [line] = _lines(out)
    assert line["error"]["code"] == "INTERNAL"
    assert line["error"]["message"] == "RuntimeError: failed reading input.pdf"
    assert "\\" not in line["error"]["message"]
    correlation_id = line["error"]["data"]["correlationId"]
    assert len(correlation_id) == 8

    stderr = capsys.readouterr().err
    assert correlation_id in stderr
    assert "Traceback" in stderr


def test_serve_rejects_oversized_line(server: tuple[Server, io.BytesIO]) -> None:
    srv, out = server
    oversized = b'{"id": "9", "method": "system.ping", "params": {}}' + b" " * (9 * 1024 * 1024)
    srv.serve([oversized])

    [line] = _lines(out)
    assert line["id"] is None
    assert line["error"]["code"] == "INVALID_PARAMS"
    assert line["error"]["data"]["maxBytes"]


def test_redact_message_strips_windows_and_posix_paths() -> None:
    text = r"error at C:\Users\bob\secret\file.pdf and /home/bob/other.pdf"
    result = _redact_message(text)
    assert result == "error at file.pdf and other.pdf"
    assert "Users" not in result
    assert "home" not in result


def test_a_request_line_with_a_byte_order_mark_is_accepted(
    server: tuple[Server, io.BytesIO],
) -> None:
    srv, out = server
    payload = json.dumps({"id": "bom", "method": "system.ping", "params": {}})
    srv.serve([b"\xef\xbb\xbf" + payload.encode("utf-8") + b"\n"])
    srv.wait_idle(timeout=10)
    [line] = _lines(out)
    assert line["id"] == "bom"
    assert "result" in line
