import sys

import pytest

from vivepdf.external._process import run_tool
from vivepdf.rpc.errors import ErrorCode, OpError


def test_run_tool_returns_completed_process_on_success():
    result = run_tool([sys.executable, "-c", "print('ok')"], timeout=10.0, tool="python")
    assert result.returncode == 0
    assert "ok" in result.stdout


def test_run_tool_raises_op_error_with_bounded_detail_on_failure():
    long_message = "x" * 5000
    with pytest.raises(OpError) as raised:
        run_tool(
            [sys.executable, "-c", f"import sys; sys.stderr.write('{long_message}'); sys.exit(1)"],
            timeout=10.0,
            tool="python",
        )
    assert raised.value.code == ErrorCode.EXTERNAL_TOOL_FAILED
    assert raised.value.data["tool"] == "python"
    assert raised.value.data["exitCode"] == 1
    assert len(raised.value.data["detail"]) <= 200


def test_run_tool_raises_on_missing_executable(tmp_path):
    missing = tmp_path / "does-not-exist-xyz"
    with pytest.raises(OpError) as raised:
        run_tool([str(missing)], timeout=5.0, tool="ghost")
    assert raised.value.code == ErrorCode.EXTERNAL_TOOL_FAILED
