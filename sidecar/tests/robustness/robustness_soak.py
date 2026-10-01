import ctypes
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SIDECAR_ROOT = Path(__file__).resolve().parents[2]


MAX_RESIDENT_GROWTH = 0.5


class _Counters(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.c_ulong),
        ("PageFaultCount", ctypes.c_ulong),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


class _ProcessEntry(ctypes.Structure):
    _fields_ = [
        ("dwSize", ctypes.c_ulong),
        ("cntUsage", ctypes.c_ulong),
        ("th32ProcessID", ctypes.c_ulong),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", ctypes.c_ulong),
        ("cntThreads", ctypes.c_ulong),
        ("th32ParentProcessID", ctypes.c_ulong),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", ctypes.c_ulong),
        ("szExeFile", ctypes.c_wchar * 260),
    ]


def _windows_tree(pid: int) -> list[int]:
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
    snapshot = kernel.CreateToolhelp32Snapshot(0x2, 0)
    parents: dict[int, int] = {}
    try:
        entry = _ProcessEntry()
        entry.dwSize = ctypes.sizeof(_ProcessEntry)
        found = kernel.Process32FirstW(ctypes.c_void_p(snapshot), ctypes.byref(entry))
        while found:
            parents[int(entry.th32ProcessID)] = int(entry.th32ParentProcessID)
            found = kernel.Process32NextW(ctypes.c_void_p(snapshot), ctypes.byref(entry))
    finally:
        kernel.CloseHandle(ctypes.c_void_p(snapshot))
    tree = [pid]
    for candidate in tree:
        tree.extend(child for child, parent in parents.items() if parent == candidate)
    return tree


def _windows_resident(pid: int) -> int:
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.restype = ctypes.c_void_p
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    psapi.GetProcessMemoryInfo.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(_Counters),
        ctypes.c_ulong,
    ]
    handle = kernel.OpenProcess(0x0410, False, pid)
    if not handle:
        return 0
    try:
        counters = _Counters()
        counters.cb = ctypes.sizeof(_Counters)
        if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            return 0
        return int(counters.WorkingSetSize)
    finally:
        kernel.CloseHandle(ctypes.c_void_p(handle))


def resident_bytes(pid: int) -> int:
    if sys.platform == "win32":
        return sum(_windows_resident(member) for member in _windows_tree(pid))
    statm = Path(f"/proc/{pid}/statm")
    if statm.exists():
        return int(statm.read_text().split()[1]) * os.sysconf("SC_PAGE_SIZE")
    return 0


@dataclass
class SoakReport:
    calls: int = 0
    errors: list[str] = field(default_factory=list)
    locked_files: list[str] = field(default_factory=list)
    resident: list[int] = field(default_factory=list)

    def growth(self) -> float:
        if len(self.resident) < 40:
            return 0.0
        quarter = len(self.resident) // 4
        early = sorted(self.resident[quarter : 2 * quarter])[quarter // 2]
        late = sorted(self.resident[-quarter:])[quarter // 2]
        return (late - early) / max(early, 1)


def soak_requests(source: Path, work: Path, calls: int) -> list[tuple[str, dict[str, Any], bool]]:
    plans: list[tuple[str, Any, bool]] = [
        ("info.get", lambda i, p: {"path": p}, False),
        ("info.thumbnail", lambda i, p: {"path": p, "page": i % 5}, False),
        ("info.text", lambda i, p: {"path": p, "pages": str(1 + i % 5)}, False),
        ("bookmarks.get", lambda i, p: {"path": p}, False),
        ("links.list", lambda i, p: {"path": p}, False),
        ("comments.list", lambda i, p: {"path": p}, False),
        ("security.inspect", lambda i, p: {"path": p}, False),
        ("textedit.spans", lambda i, p: {"path": p, "page": i % 5}, False),
        (
            "pages.extract",
            lambda i, p: {
                "path": p,
                "pages": [1 + i % 5, 2 + i % 5],
                "output": str(work / f"extract-{i}.pdf"),
            },
            True,
        ),
        (
            "pages.rotate",
            lambda i, p: {
                "path": p,
                "degrees": 90,
                "pages": "1-3",
                "output": str(work / f"rotate-{i}.pdf"),
            },
            True,
        ),
    ]
    requests = []
    for index in range(calls):
        method, build, writes = plans[index % len(plans)]
        requests.append((method, build(index, str(source)), writes))
    return requests


def run_soak(source: Path, work: Path, calls: int = 200, timeout: float = 120) -> SoakReport:
    work.mkdir(parents=True, exist_ok=True)
    target = work / "soak input.pdf"
    shutil.copyfile(source, target)
    environment = dict(os.environ)
    environment["VIVEPDF_DATA_DIR"] = str(work / "appdata")
    environment["PYTHONPATH"] = str(SIDECAR_ROOT)
    process = subprocess.Popen(
        [sys.executable, "-m", "vivepdf"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        cwd=str(SIDECAR_ROOT),
        env=environment,
    )
    lines: queue.Queue = queue.Queue()

    def pump() -> None:
        for line in process.stdout:
            lines.put(line)
        lines.put(None)

    threading.Thread(target=pump, daemon=True).start()
    report = SoakReport()
    try:
        for index, (method, params, writes) in enumerate(soak_requests(target, work, calls)):
            request = {"id": f"soak-{index}", "method": method, "params": params}
            process.stdin.write((json.dumps(request) + "\n").encode("utf-8"))
            process.stdin.flush()
            while True:
                line = lines.get(timeout=timeout)
                if line is None:
                    report.errors.append(f"{method}: server exited")
                    return report
                message = json.loads(line)
                if message.get("id") == request["id"] and "progress" not in message:
                    break
            report.calls += 1
            if "error" in message:
                report.errors.append(f"{method}: {message['error'].get('code')}")
            moved = work / "soak renamed.pdf"
            try:
                target.rename(moved)
                moved.rename(target)
            except OSError as error:
                report.locked_files.append(f"{method} input: {error}")
            if writes and "result" in message:
                output = Path(message["result"]["output"])
                try:
                    output.unlink()
                except OSError as error:
                    report.locked_files.append(f"{method} output: {error}")
            report.resident.append(resident_bytes(process.pid))
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
    return report
