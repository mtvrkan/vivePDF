import json
import subprocess
import sys
import threading
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops import _docx_parallel as parallel

SIDECAR = Path(__file__).resolve().parent.parent


def test_every_stdout_line_is_protocol_even_when_pymupdf_warns(
    sample_pdf: Path, tmp_path: Path
) -> None:
    requests = [
        {
            "id": "docx",
            "method": "convert.to_docx",
            "params": {"path": str(sample_pdf), "output": str(tmp_path / "çıktı.docx")},
        },
    ]
    completed = subprocess.run(
        [sys.executable, "-m", "vivepdf"],
        input="".join(json.dumps(request) + "\n" for request in requests).encode("utf-8"),
        capture_output=True,
        cwd=SIDECAR,
        timeout=300,
        check=True,
    )
    lines = [line for line in completed.stdout.decode("utf-8").splitlines() if line.strip()]
    messages = [json.loads(line) for line in lines]
    assert any(message.get("id") == "docx" and "result" in message for message in messages)
    assert "fitz" in completed.stderr.decode("utf-8", "replace")


@pytest.mark.skipif(parallel.worker_count(parallel.PARALLEL_MIN_PAGES) < 2, reason="one cpu")
def test_pool_workers_start_while_the_server_is_reading_its_stdin(tmp_path: Path) -> None:
    source = tmp_path / "uzun.pdf"
    document = pymupdf.open()
    for number in range(parallel.PARALLEL_MIN_PAGES):
        document.new_page().insert_text((72, 72), f"Page {number + 1}")
    document.save(source)
    document.close()
    request = {
        "id": "docx",
        "method": "convert.to_docx",
        "params": {"path": str(source), "output": str(tmp_path / "uzun.docx")},
    }
    process = subprocess.Popen(
        [sys.executable, "-m", "vivepdf"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        cwd=SIDECAR,
    )
    answers: list[dict] = []

    def read_answer() -> None:
        for line in process.stdout:
            message = json.loads(line)
            if message.get("id") == "docx" and "progress" not in message:
                answers.append(message)
                return

    reader = threading.Thread(target=read_answer, daemon=True)
    reader.start()
    try:
        process.stdin.write(json.dumps(request).encode("utf-8") + b"\n")
        process.stdin.flush()
        reader.join(timeout=240)
    finally:
        _stop(process)
    assert answers
    assert "result" in answers[0]


def _stop(process: subprocess.Popen) -> None:
    process.stdin.close()
    try:
        process.wait(timeout=60)
    except subprocess.TimeoutExpired:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], check=False)
        process.kill()
        process.wait()
