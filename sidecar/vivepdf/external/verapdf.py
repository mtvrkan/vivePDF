import contextlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ElementTree
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from vivepdf.external._process import (
    KILL_TIMEOUT,
    _sanitize_detail,
    kill_tree,
    run_tool,
    system_environment,
)
from vivepdf.rpc.errors import ErrorCode, OpError

TOOL = "verapdf"
VERSION_TIMEOUT = 60.0
VALIDATE_TIMEOUT = 900.0
POLL_INTERVAL = 0.2
FLAVOURS = {"1b", "2b", "2u", "3b"}
INPUT_NAME = "input.pdf"
MAX_RULES = 50
SAFE_ARGUMENT = re.compile(r"[A-Za-z0-9_.-]+")
SAFE_BATCH_PATH = re.compile(r"[\w .:\\/-]+")
VERSION_PATTERN = re.compile(r"veraPDF\s+v?(\d+(?:\.\d+)+)")
REPORT_START = re.compile(r"<\?xml|<report")


@dataclass
class VeraRule:
    specification: str
    clause: str
    test_number: str
    description: str
    failed_checks: int


@dataclass
class VeraReport:
    compliant: bool
    profile: str
    failed_rules: int
    failed_checks: int
    rules: list[VeraRule] = field(default_factory=list)


def _launcher_names() -> tuple[str, ...]:
    return ("verapdf.bat",) if sys.platform == "win32" else ("verapdf",)


def _install_roots() -> list[Path]:
    roots = [Path.home() / "verapdf"]
    if sys.platform == "win32":
        for variable in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
            if base := os.environ.get(variable):
                roots.append(Path(base) / "veraPDF")
    else:
        roots += [Path("/opt/verapdf"), Path("/usr/local/verapdf"), Path("/Applications/verapdf")]
    return roots


def find_verapdf() -> Path | None:
    found = shutil.which(TOOL)
    if found:
        return Path(found)
    for root in _install_roots():
        for name in _launcher_names():
            if (root / name).is_file():
                return root / name
    return None


def launch_command(launcher: Path) -> list[str]:
    if sys.platform == "win32" and not SAFE_BATCH_PATH.fullmatch(str(launcher)):
        raise OpError(
            ErrorCode.UNSUPPORTED,
            "veraPDF is installed in a folder that cannot be started safely",
            {"reason": "veraPdfPath"},
        )
    return [str(launcher)]


def _checked(arguments: list[str]) -> list[str]:
    for argument in arguments:
        if not SAFE_ARGUMENT.fullmatch(argument):
            raise OpError(ErrorCode.INVALID_PARAMS, "unsafe veraPDF argument")
    return arguments


def version(launcher: Path) -> str | None:
    completed = run_tool(
        [*launch_command(launcher), *_checked(["--version"])],
        VERSION_TIMEOUT,
        TOOL,
        env=system_environment(),
    )
    match = VERSION_PATTERN.search(completed.stdout or "")
    return match.group(1) if match else None


def _integer(value: str | None) -> int:
    try:
        return int(value or 0)
    except ValueError:
        return 0


def parse_report(text: str) -> VeraReport:
    start = REPORT_START.search(text)
    if start is None:
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED,
            "veraPDF returned no report",
            {"tool": TOOL, "reason": "noReport", "detail": _sanitize_detail(text)},
        )
    try:
        root = ElementTree.fromstring(text[start.start() :])
    except ElementTree.ParseError as error:
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED,
            "veraPDF report could not be read",
            {"tool": TOOL, "reason": "noReport"},
        ) from error
    report = root.find(".//validationReport")
    if report is None:
        message = root.findtext(".//exceptionMessage") or root.findtext(".//taskException") or ""
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED,
            "veraPDF could not validate the file",
            {"tool": TOOL, "reason": "noReport", "detail": _sanitize_detail(message)},
        )
    details = report.find("details")
    rules = [
        VeraRule(
            specification=rule.get("specification", ""),
            clause=rule.get("clause", ""),
            test_number=rule.get("testNumber", ""),
            description=(rule.findtext("description") or "").strip(),
            failed_checks=_integer(rule.get("failedChecks")),
        )
        for rule in (details.findall("rule") if details is not None else [])
        if rule.get("status") == "failed"
    ]
    return VeraReport(
        compliant=report.get("isCompliant") == "true",
        profile=report.get("profileName", ""),
        failed_rules=_integer(details.get("failedRules")) if details is not None else len(rules),
        failed_checks=_integer(details.get("failedChecks")) if details is not None else 0,
        rules=rules,
    )


def _stop(process: subprocess.Popen[bytes]) -> None:
    kill_tree(process)  # type: ignore[arg-type]
    with contextlib.suppress(subprocess.TimeoutExpired, OSError, ValueError):
        process.wait(timeout=KILL_TIMEOUT)


def _wait(process: subprocess.Popen[bytes], cancelled: Callable[[], None], timeout: float) -> None:
    started = time.monotonic()
    try:
        while process.poll() is None:
            cancelled()
            if time.monotonic() - started > timeout:
                raise OpError(
                    ErrorCode.EXTERNAL_TOOL_FAILED,
                    "veraPDF timed out",
                    {"tool": TOOL, "reason": "timeout"},
                )
            time.sleep(POLL_INTERVAL)
    except BaseException:
        _stop(process)
        raise


def validate(
    launcher: Path,
    source: Path,
    flavour: str,
    cancelled: Callable[[], None],
    timeout: float = VALIDATE_TIMEOUT,
) -> VeraReport:
    if flavour not in FLAVOURS:
        raise OpError(ErrorCode.INVALID_PARAMS, f"unknown PDF/A level: {flavour}")
    arguments = [
        *launch_command(launcher),
        *_checked(["--format", "mrr", "--flavour", flavour, INPUT_NAME]),
    ]
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
    with tempfile.TemporaryDirectory(
        prefix="vivepdf-verapdf-", ignore_cleanup_errors=True
    ) as folder:
        work = Path(folder)
        shutil.copyfile(source, work / INPUT_NAME)
        report_path = work / "report.xml"
        errors_path = work / "errors.txt"
        with report_path.open("wb") as report_file, errors_path.open("wb") as errors_file:
            try:
                process = subprocess.Popen(  # noqa: S603
                    arguments,
                    cwd=work,
                    stdin=subprocess.DEVNULL,
                    stdout=report_file,
                    stderr=errors_file,
                    creationflags=creation_flags,
                    start_new_session=sys.platform != "win32",
                    env=system_environment(),
                )
            except OSError as error:
                raise OpError(
                    ErrorCode.EXTERNAL_TOOL_FAILED, f"{TOOL} could not start: {error}"
                ) from error
            _wait(process, cancelled, timeout)
        text = report_path.read_text(encoding="utf-8", errors="replace")
        if not text.strip():
            detail = errors_path.read_text(encoding="utf-8", errors="replace")
            raise OpError(
                ErrorCode.EXTERNAL_TOOL_FAILED,
                f"{TOOL} failed (exit {process.returncode})",
                {"tool": TOOL, "exitCode": process.returncode, "detail": _sanitize_detail(detail)},
            )
        return parse_report(text)
