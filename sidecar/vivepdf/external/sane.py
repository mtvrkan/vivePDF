import contextlib
import re
import shutil
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from vivepdf.external._process import (
    KILL_TIMEOUT,
    _sanitize_detail,
    kill_tree,
    run_tool,
    system_environment,
)
from vivepdf.rpc.errors import ErrorCode, OpError

TOOL = "scanimage"
LIST_TIMEOUT = 45.0
OPTIONS_TIMEOUT = 30.0
SHEET_IDLE_TIMEOUT = 300.0
EXIT_GRACE = 10.0
POLL_INTERVAL = 0.2
DEVICE_FORMAT = "%d\t%v\t%m\t%t%n"
BATCH_PATTERN = "sheet%04d.pnm"
LOG_NAME = "scanimage.log"
BATCH_FINISHED = "batch terminated"
SCAN_ERRORS = ("sane_start:", "sane_read:")
OPTION_LINE = re.compile(r"^\s+--([A-Za-z][\w-]*)\s+(.+?)(?:\s+\[(.*)\])?\s*$")
RANGE_VALUE = re.compile(r"^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)")
NUMBER_VALUE = re.compile(r"^(-?\d+(?:\.\d+)?)")
SEARCH_PATHS = {
    "darwin": (
        "/opt/homebrew/bin/scanimage",
        "/usr/local/bin/scanimage",
        "/opt/local/bin/scanimage",
    ),
    "linux": ("/usr/bin/scanimage", "/usr/local/bin/scanimage", "/snap/bin/scanimage"),
}
MODE_NAMES = {
    "color": ("color", "colour", "24bit color", "rgb"),
    "gray": ("gray", "grey", "grayscale", "8bit gray"),
    "bw": ("lineart", "binary", "black & white", "black and white", "halftone"),
}
FEEDER_WORDS = ("adf", "feeder", "automatic document")
FEEDER_MODE = "adf-mode"
FLATBED_WORDS = ("flatbed", "platen", "document table", "glass")
OUT_OF_PAPER = ("out of documents", "no docs", "document feeder out")
BUSY = ("device busy", "busy")
MISSING_DEVICE = ("open of device", "no such device", "failed to open device")
JAMMED = ("jam", "jammed")
COVER_OPEN = ("cover open", "cover is open")
STOP_STATUSES = ("document feeder jammed", "scanner cover is open")


@dataclass
class SaneDevice:
    id: str
    name: str


@dataclass
class SaneOption:
    values: list[str] = field(default_factory=list)
    low: float | None = None
    high: float | None = None


@dataclass
class SaneBatch:
    sheets: list[Path]
    interrupted: Literal["paperJam", "coverOpen", "scannerStopped"] | None = None


@dataclass
class SaneCapabilities:
    feeder: bool
    flatbed: bool
    duplex: bool


def find_scanimage() -> Path | None:
    found = shutil.which(TOOL)
    if found:
        return Path(found)
    for candidate in SEARCH_PATHS.get(sys.platform, SEARCH_PATHS["linux"]):
        if Path(candidate).is_file():
            return Path(candidate)
    return None


def require_scanimage() -> Path:
    binary = find_scanimage()
    if binary is None:
        raise OpError(
            ErrorCode.UNSUPPORTED, "scanimage (SANE) is not installed", {"reason": "saneMissing"}
        )
    return binary


def parse_devices(output: str) -> list[SaneDevice]:
    devices: list[SaneDevice] = []
    for line in output.splitlines():
        parts = line.split("\t")
        if not parts or not parts[0].strip():
            continue
        identifier = parts[0].strip()
        label = " ".join(part.strip() for part in parts[1:3] if part.strip())
        devices.append(SaneDevice(identifier, label or identifier))
    return devices


def list_devices(binary: Path) -> list[SaneDevice]:
    completed = run_tool(
        [str(binary), "-f", DEVICE_FORMAT], LIST_TIMEOUT, TOOL, env=system_environment()
    )
    return parse_devices(completed.stdout)


def parse_options(output: str) -> dict[str, SaneOption]:
    options: dict[str, SaneOption] = {}
    for line in output.splitlines():
        matched = OPTION_LINE.match(line)
        if not matched:
            continue
        name, raw = matched.group(1), matched.group(2).strip()
        ranged = RANGE_VALUE.match(raw)
        if ranged:
            options[name] = SaneOption(low=float(ranged.group(1)), high=float(ranged.group(2)))
            continue
        options[name] = SaneOption(values=[value.strip() for value in raw.split("|") if value])
    return options


def device_options(binary: Path, device: str) -> dict[str, SaneOption]:
    try:
        completed = run_tool(
            [str(binary), "-d", device, "-A"], OPTIONS_TIMEOUT, TOOL, env=system_environment()
        )
    except OpError as error:
        mapped = _open_failure(str((error.data or {}).get("detail", "")).casefold())
        if mapped is None:
            raise
        raise mapped from error
    return parse_options(completed.stdout)


def _has_word(value: str, words: tuple[str, ...]) -> bool:
    folded = value.casefold()
    return any(word in folded for word in words)


def feeder_sources(option: SaneOption | None) -> list[str]:
    if option is None:
        return []
    return [value for value in option.values if _has_word(value, FEEDER_WORDS)]


def capabilities(options: dict[str, SaneOption]) -> SaneCapabilities:
    source = options.get("source")
    if source is None:
        return SaneCapabilities(feeder=False, flatbed=True, duplex=False)
    feeders = feeder_sources(source)
    return SaneCapabilities(
        feeder=bool(feeders),
        flatbed=any(_has_word(value, FLATBED_WORDS) for value in source.values) or not feeders,
        duplex=any("duplex" in value.casefold() for value in source.values)
        or bool(feeders and _feeder_mode(options, "duplex")),
    )


def _feeder_mode(options: dict[str, SaneOption], wanted: str) -> str | None:
    option = options.get(FEEDER_MODE)
    if option is None:
        return None
    return next((value for value in option.values if wanted in value.casefold()), None)


def feeder_mode_arguments(
    options: dict[str, SaneOption], source: str | None, feeder: bool, duplex: bool
) -> list[str]:
    if not feeder or (source is not None and "duplex" in source.casefold()):
        return []
    value = _feeder_mode(options, "duplex" if duplex else "simplex")
    return [f"--{FEEDER_MODE}", value] if value else []


def choose_source(options: dict[str, SaneOption], feeder: bool, duplex: bool) -> str | None:
    source = options.get("source")
    if source is None:
        return None
    if not feeder:
        return next((value for value in source.values if _has_word(value, FLATBED_WORDS)), None)
    feeders = feeder_sources(source)
    double = [value for value in feeders if "duplex" in value.casefold()]
    single = [value for value in feeders if "duplex" not in value.casefold()]
    if duplex and double:
        return double[0]
    if single:
        return single[0]
    return feeders[0] if feeders else None


def choose_mode(options: dict[str, SaneOption], mode: str) -> str | None:
    option = options.get("mode")
    if option is None:
        return None
    for wanted in (mode, "gray", "color"):
        for name in MODE_NAMES[wanted]:
            for value in option.values:
                if value.casefold() == name:
                    return value
        for value in option.values:
            if value.casefold().startswith(MODE_NAMES[wanted][0]):
                return value
    return None


def _number(value: str) -> float | None:
    matched = NUMBER_VALUE.match(value.strip())
    return float(matched.group(1)) if matched else None


def choose_resolution(options: dict[str, SaneOption], dpi: int) -> int:
    option = options.get("resolution")
    if option is None:
        return dpi
    if option.low is not None and option.high is not None:
        return int(round(min(max(dpi, option.low), option.high)))
    numbers = [number for number in (_number(value) for value in option.values) if number]
    if not numbers:
        return dpi
    return int(round(min(numbers, key=lambda number: (abs(number - dpi), -number))))


def scan_arguments(
    binary: Path,
    device: str,
    folder: Path,
    resolution: int,
    mode: str | None,
    source: str | None,
    count: int | None,
    extra: list[str] | None = None,
) -> list[str]:
    arguments = [
        str(binary),
        "-d",
        device,
        "--format=pnm",
        f"--batch={folder / BATCH_PATTERN}",
        "--resolution",
        str(resolution),
    ]
    if count:
        arguments.append(f"--batch-count={count}")
    if mode:
        arguments.extend(["--mode", mode])
    if source:
        arguments.extend(["--source", source])
    arguments.extend(extra or [])
    return arguments


def _sheets(folder: Path) -> list[Path]:
    return sorted(folder.glob("sheet*.pnm"))


def _interruption(detail: str) -> Literal["paperJam", "coverOpen", "scannerStopped"]:
    folded = detail.casefold()
    if _has_word(folded, JAMMED):
        return "paperJam"
    if _has_word(folded, COVER_OPEN):
        return "coverOpen"
    return "scannerStopped"


def _open_failure(folded: str) -> OpError | None:
    if _has_word(folded, BUSY):
        return OpError(
            ErrorCode.INVALID_PARAMS, "the scanner could not be opened", {"reason": "scannerBusy"}
        )
    if _has_word(folded, MISSING_DEVICE):
        return OpError(ErrorCode.INVALID_PARAMS, "no scanner was found", {"reason": "noScanner"})
    return None


def _failure(returncode: int, detail: str, sheets: int) -> OpError | None:
    folded = detail.casefold()
    if sheets and (returncode == 0 or _has_word(folded, OUT_OF_PAPER)):
        return None
    if _has_word(folded, OUT_OF_PAPER):
        return OpError(
            ErrorCode.INVALID_PARAMS, "the scanner produced no pages", {"reason": "noSheets"}
        )
    if returncode == 0 and not sheets:
        return OpError(
            ErrorCode.INVALID_PARAMS, "the scanner produced no pages", {"reason": "noSheets"}
        )
    if not sheets and _has_word(folded, STOP_STATUSES):
        reason = _interruption(detail)
        return OpError(
            ErrorCode.INVALID_PARAMS, f"the scanner reported {reason}", {"reason": reason}
        )
    opening = _open_failure(folded)
    if opening is not None:
        return opening
    return OpError(
        ErrorCode.EXTERNAL_TOOL_FAILED,
        f"{TOOL} failed (exit {returncode})",
        {"tool": TOOL, "exitCode": returncode, "detail": _sanitize_detail(detail)},
    )


def _stop(process: subprocess.Popen[bytes]) -> None:
    kill_tree(process)  # type: ignore[arg-type]
    with contextlib.suppress(subprocess.TimeoutExpired, OSError, ValueError):
        process.wait(timeout=KILL_TIMEOUT)


def _log_text(log: Path) -> str:
    try:
        return log.read_bytes().decode("utf-8", errors="replace")
    except OSError:
        return ""


def _exit_code(returncode: int, detail: str, stopped: bool) -> int:
    if stopped and not _has_word(detail.casefold(), SCAN_ERRORS):
        return 0
    return returncode


def run_batch(
    arguments: list[str],
    folder: Path,
    on_sheet: Callable[[int], None],
    idle_timeout: float = SHEET_IDLE_TIMEOUT,
    exit_grace: float = EXIT_GRACE,
) -> SaneBatch:
    log = folder / LOG_NAME
    with log.open("wb") as errors:
        try:
            process = subprocess.Popen(  # noqa: S603
                arguments,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=errors,
                start_new_session=True,
                env=system_environment(),
            )
        except OSError as error:
            raise OpError(
                ErrorCode.EXTERNAL_TOOL_FAILED, f"{TOOL} could not start: {error}"
            ) from error
        seen = 0
        last_change = time.monotonic()
        finished: float | None = None
        stopped = False
        try:
            while process.poll() is None:
                count = len(_sheets(folder))
                if count != seen:
                    seen = count
                    last_change = time.monotonic()
                on_sheet(seen)
                now = time.monotonic()
                if finished is None and BATCH_FINISHED in _log_text(log).casefold():
                    finished = now
                if finished is not None and now - finished > exit_grace:
                    _stop(process)
                    stopped = True
                    break
                if now - last_change > idle_timeout:
                    raise OpError(
                        ErrorCode.EXTERNAL_TOOL_FAILED,
                        f"{TOOL} timed out",
                        {"tool": TOOL, "reason": "timeout"},
                    )
                time.sleep(POLL_INTERVAL)
        except BaseException:
            _stop(process)
            raise
    detail = _log_text(log)
    sheets = _sheets(folder)
    failure = _failure(_exit_code(process.returncode, detail, stopped), detail, len(sheets))
    if failure is None:
        return SaneBatch(sheets)
    if sheets and failure.code == ErrorCode.EXTERNAL_TOOL_FAILED:
        return SaneBatch(sheets, _interruption(detail))
    raise failure
