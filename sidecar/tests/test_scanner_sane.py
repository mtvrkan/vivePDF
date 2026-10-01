import io
import sys
import textwrap
import time
from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.external import sane
from vivepdf.external._process import system_environment
from vivepdf.ops import scanner
from vivepdf.ops.scanner import ScannerAcquireParams, ScannerDevicesParams, acquire, devices
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

DEVICE_LIST = (
    "escl:http://192.168.1.20:80\tHP\tOfficeJet 8010\tflatbed scanner\n"
    "epson2:libusb:001:004\tEpson\tDS-530\tsheetfed scanner\n"
)
FLATBED_OPTIONS = """
All options specific to device `escl:http://192.168.1.20:80':
  Scan mode:
    --mode Gray|Color [Color]
        Selects the scan mode (e.g., lineart, monochrome, or color).
    --resolution 75|100|150|200|300|600dpi [75]
        Sets the resolution of the scanned image.
    --source Flatbed [Flatbed]
        Selects the scan source (such as a document-feeder).
  Geometry:
    -l 0..215.9mm [0]
"""
FEEDER_OPTIONS = """
All options specific to device `epson2:libusb:001:004':
    --mode Lineart|Gray|Color [Lineart]
    --resolution 50..600dpi (in steps of 1) [300]
    --source Flatbed|ADF Front|ADF Duplex [Flatbed]
"""


def pnm_bytes(width: int = 120, height: int = 160, shade: int = 250) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (shade, shade, shade)).save(buffer, format="PPM")
    return buffer.getvalue()


def printed_pnm(width: int = 600, height: int = 800) -> bytes:
    image = Image.new("RGB", (width, height), (255, 255, 255))
    for row in range(100, height - 100, 20):
        image.paste((0, 0, 0), (60, row, width - 60, row + 6))
    buffer = io.BytesIO()
    image.save(buffer, format="PPM")
    return buffer.getvalue()


def fake_scanimage(tmp_path: Path, body: str) -> list[str]:
    script = tmp_path / "fake_scanimage.py"
    script.write_text(
        "import sys, time\n"
        "from pathlib import Path\n"
        "batch = next(a.split('=', 1)[1] for a in sys.argv if a.startswith('--batch='))\n"
        + textwrap.dedent(body),
        encoding="utf-8",
    )
    return [sys.executable, str(script)]


def batch(tmp_path: Path, body: str) -> tuple[list[str], Path]:
    folder = tmp_path / "out"
    folder.mkdir()
    command = fake_scanimage(tmp_path, body)
    return [*command, f"--batch={folder / sane.BATCH_PATTERN}"], folder


def test_device_list_is_parsed_with_readable_names() -> None:
    found = sane.parse_devices(DEVICE_LIST)
    assert [device.id for device in found] == [
        "escl:http://192.168.1.20:80",
        "epson2:libusb:001:004",
    ]
    assert [device.name for device in found] == ["HP OfficeJet 8010", "Epson DS-530"]
    assert sane.parse_devices("\n\n") == []


def test_options_are_parsed_as_lists_and_ranges() -> None:
    options = sane.parse_options(FEEDER_OPTIONS)
    assert options["mode"].values == ["Lineart", "Gray", "Color"]
    assert (options["resolution"].low, options["resolution"].high) == (50, 600)
    assert options["source"].values == ["Flatbed", "ADF Front", "ADF Duplex"]


def test_capabilities_come_from_the_source_option() -> None:
    flatbed = sane.capabilities(sane.parse_options(FLATBED_OPTIONS))
    assert (flatbed.feeder, flatbed.flatbed, flatbed.duplex) == (False, True, False)
    feeder = sane.capabilities(sane.parse_options(FEEDER_OPTIONS))
    assert (feeder.feeder, feeder.flatbed, feeder.duplex) == (True, True, True)
    assert sane.capabilities({}) == sane.SaneCapabilities(feeder=False, flatbed=True, duplex=False)


def test_source_mode_and_resolution_are_matched_to_what_the_device_offers() -> None:
    feeder = sane.parse_options(FEEDER_OPTIONS)
    assert sane.choose_source(feeder, feeder=True, duplex=True) == "ADF Duplex"
    assert sane.choose_source(feeder, feeder=True, duplex=False) == "ADF Front"
    assert sane.choose_source(feeder, feeder=False, duplex=False) == "Flatbed"
    assert sane.choose_mode(feeder, "bw") == "Lineart"
    assert sane.choose_resolution(feeder, 1200) == 600
    flatbed = sane.parse_options(FLATBED_OPTIONS)
    assert sane.choose_mode(flatbed, "bw") == "Gray"
    assert sane.choose_mode(flatbed, "color") == "Color"
    assert sane.choose_resolution(flatbed, 250) == 300
    assert sane.choose_resolution(flatbed, 400) == 300
    assert sane.choose_resolution({}, 300) == 300


def test_scan_arguments_are_a_list_with_the_device_passed_verbatim(tmp_path: Path) -> None:
    device = "net:host;$(rm -rf ~)"
    arguments = sane.scan_arguments(
        Path("/usr/bin/scanimage"), device, tmp_path, 300, "Color", "ADF Front", 5
    )
    assert arguments[1:3] == ["-d", device]
    assert "--batch-count=5" in arguments
    assert arguments[arguments.index("--source") + 1] == "ADF Front"
    assert f"--batch={tmp_path / sane.BATCH_PATTERN}" in arguments


def test_batch_collects_every_sheet_until_the_feeder_is_empty(tmp_path: Path) -> None:
    arguments, folder = batch(
        tmp_path,
        f"""
        for index in range(1, 4):
            Path(batch % index).write_bytes({pnm_bytes()!r})
        print("scanimage: sane_start: Document feeder out of documents", file=sys.stderr)
        sys.exit(7)
        """,
    )
    seen: list[int] = []
    result = sane.run_batch(arguments, folder, seen.append)
    assert len(result.sheets) == 3
    assert result.interrupted is None
    assert all(sheet.read_bytes().startswith(b"P6") for sheet in result.sheets)


@pytest.mark.parametrize(
    ("stderr", "code", "reason"),
    [
        ("scanimage: sane_start: Document feeder out of documents", 7, "noSheets"),
        ("scanimage: open of device x failed: Device busy", 1, "scannerBusy"),
        ("scanimage: open of device x failed: Invalid argument", 1, "noScanner"),
        ("", 0, "noSheets"),
    ],
)
def test_batch_failures_map_to_scanner_reasons(
    tmp_path: Path, stderr: str, code: int, reason: str
) -> None:
    arguments, folder = batch(tmp_path, f"print({stderr!r}, file=sys.stderr)\nsys.exit({code})\n")
    with pytest.raises(OpError) as caught:
        sane.run_batch(arguments, folder, lambda _count: None)
    assert caught.value.data["reason"] == reason


def test_an_unknown_failure_is_a_tool_error_without_the_home_path(tmp_path: Path) -> None:
    home = str(Path.home())
    arguments, folder = batch(
        tmp_path, f"print({'paper jam near ' + home!r}, file=sys.stderr)\nsys.exit(9)\n"
    )
    with pytest.raises(OpError) as caught:
        sane.run_batch(arguments, folder, lambda _count: None)
    assert caught.value.code == ErrorCode.EXTERNAL_TOOL_FAILED
    assert caught.value.data["exitCode"] == 9
    assert home not in caught.value.data["detail"]


def test_cancelling_stops_the_scanner_process(tmp_path: Path) -> None:
    marker = tmp_path / "still-running"
    arguments, folder = batch(
        tmp_path,
        f"""
        time.sleep(2)
        Path({str(marker)!r}).write_text("x")
        """,
    )
    calls = [0]

    def cancel(_count: int) -> None:
        calls[0] += 1
        if calls[0] == 2:
            raise OpError(ErrorCode.CANCELLED, "cancelled")

    with pytest.raises(OpError) as caught:
        sane.run_batch(arguments, folder, cancel)
    assert caught.value.code == ErrorCode.CANCELLED
    time.sleep(2.5)
    assert not marker.exists()


def test_a_scanner_that_goes_quiet_times_out(tmp_path: Path) -> None:
    arguments, folder = batch(tmp_path, "time.sleep(30)\n")
    with pytest.raises(OpError) as caught:
        sane.run_batch(arguments, folder, lambda _count: None, idle_timeout=0.5)
    assert caught.value.data["reason"] == "timeout"


def test_devices_without_sane_say_how_to_get_it(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(scanner, "windows", lambda: False)
    monkeypatch.setattr(sane, "find_scanimage", lambda: None)
    result = devices(ScannerDevicesParams(), silent_progress())
    assert (result.supported, result.devices, result.reason) == (False, [], "saneMissing")


def with_sane(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(scanner, "windows", lambda: False)
    monkeypatch.setattr(sane, "find_scanimage", lambda: Path("/usr/bin/scanimage"))
    monkeypatch.setattr(sane, "list_devices", lambda _binary: sane.parse_devices(DEVICE_LIST))


def test_devices_list_sane_scanners_with_their_capabilities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with_sane(monkeypatch)
    outputs = {
        "escl:http://192.168.1.20:80": FLATBED_OPTIONS,
        "epson2:libusb:001:004": FEEDER_OPTIONS,
    }
    monkeypatch.setattr(
        sane, "device_options", lambda _binary, device: sane.parse_options(outputs[device])
    )
    result = devices(ScannerDevicesParams(), silent_progress())
    assert result.supported is True
    assert result.reason is None
    assert [(item.name, item.feeder, item.duplex) for item in result.devices] == [
        ("HP OfficeJet 8010", False, False),
        ("Epson DS-530", True, True),
    ]


def test_a_device_whose_options_cannot_be_read_is_still_listed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with_sane(monkeypatch)

    def broken(_binary: Path, _device: str) -> dict:
        raise OpError(ErrorCode.EXTERNAL_TOOL_FAILED, "scanimage timed out")

    monkeypatch.setattr(sane, "device_options", broken)
    result = devices(ScannerDevicesParams(), silent_progress())
    assert len(result.devices) == 2
    assert all(item.flatbed and not item.feeder for item in result.devices)


def sane_acquire(
    monkeypatch: pytest.MonkeyPatch,
    options: str,
    sheets: list[bytes],
    interrupted: str | None = None,
) -> list[list[str]]:
    with_sane(monkeypatch)
    calls: list[list[str]] = []
    monkeypatch.setattr(sane, "device_options", lambda _b, _d: sane.parse_options(options))

    def run_batch(arguments: list[str], folder: Path, on_sheet) -> sane.SaneBatch:
        calls.append(arguments)
        on_sheet(len(sheets))
        paths = []
        for index, payload in enumerate(sheets, start=1):
            path = folder / f"sheet{index:04d}.pnm"
            path.write_bytes(payload)
            paths.append(path)
        return sane.SaneBatch(paths, interrupted)

    monkeypatch.setattr(sane, "run_batch", run_batch)
    return calls


def test_sane_flatbed_scan_writes_a_page_sized_by_the_real_resolution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = sane_acquire(monkeypatch, FLATBED_OPTIONS, [pnm_bytes(300, 600)])
    output = tmp_path / "tarama.pdf"
    result = acquire(
        ScannerAcquireParams(output=str(output), dpi=250, deskew=False), silent_progress()
    )
    assert result.sheets == 1
    assert result.device == "HP OfficeJet 8010"
    arguments = calls[0]
    assert arguments[arguments.index("--resolution") + 1] == "300"
    assert "--batch-count=1" in arguments
    assert arguments[arguments.index("--source") + 1] == "Flatbed"
    with pymupdf.open(output) as document:
        assert document.page_count == 1
        assert round(document[0].rect.width) == 72
        assert round(document[0].rect.height) == 144


def test_sane_feeder_scan_uses_duplex_and_skips_blank_backs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    blank = pnm_bytes(600, 800, 255)
    calls = sane_acquire(monkeypatch, FEEDER_OPTIONS, [printed_pnm(), blank, printed_pnm(), blank])
    result = acquire(
        ScannerAcquireParams(
            output=str(tmp_path / "toplu.pdf"),
            device_id="epson2:libusb:001:004",
            duplex=True,
            skip_blank=True,
            deskew=False,
            dpi=100,
        ),
        silent_progress(),
    )
    assert (result.sheets, result.skipped_blank) == (2, 2)
    assert result.device == "epson2:libusb:001:004"
    arguments = calls[0]
    assert arguments[arguments.index("--source") + 1] == "ADF Duplex"
    assert f"--batch-count={scanner.MAX_SHEETS * 2}" in arguments


def test_sane_feeder_request_on_a_flatbed_only_scanner_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    sane_acquire(monkeypatch, FLATBED_OPTIONS, [])
    with pytest.raises(OpError) as caught:
        acquire(
            ScannerAcquireParams(output=str(tmp_path / "x.pdf"), source="feeder"),
            silent_progress(),
        )
    assert caught.value.data["reason"] == "noFeeder"


def test_sane_scan_without_scanners_or_scanimage_is_explained(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with_sane(monkeypatch)
    monkeypatch.setattr(sane, "list_devices", lambda _binary: [])
    with pytest.raises(OpError) as caught:
        acquire(ScannerAcquireParams(output=str(tmp_path / "x.pdf")), silent_progress())
    assert caught.value.data["reason"] == "noScanner"
    monkeypatch.setattr(sane, "find_scanimage", lambda: None)
    with pytest.raises(OpError) as caught:
        acquire(ScannerAcquireParams(output=str(tmp_path / "y.pdf")), silent_progress())
    assert caught.value.code == ErrorCode.UNSUPPORTED
    assert caught.value.data["reason"] == "saneMissing"


def test_frozen_engines_hand_system_tools_the_original_loader_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setenv("LD_LIBRARY_PATH", "/tmp/_MEI123")
    monkeypatch.setenv("LD_LIBRARY_PATH_ORIG", "/opt/lib")
    monkeypatch.setenv("DYLD_LIBRARY_PATH", "/tmp/_MEI123")
    monkeypatch.setenv("PYTHONHOME", "/tmp/_MEI123")
    environment = system_environment()
    assert environment["LD_LIBRARY_PATH"] == "/opt/lib"
    assert "LD_LIBRARY_PATH_ORIG" not in environment
    assert "DYLD_LIBRARY_PATH" not in environment
    assert "PYTHONHOME" not in environment


def test_unfrozen_engines_keep_the_loader_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.setenv("LD_LIBRARY_PATH", "/opt/lib")
    assert system_environment()["LD_LIBRARY_PATH"] == "/opt/lib"


def test_a_jam_keeps_the_sheets_scanned_before_it(tmp_path: Path) -> None:
    arguments, folder = batch(
        tmp_path,
        f"""
        for index in range(1, 3):
            Path(batch % index).write_bytes({pnm_bytes()!r})
        print("scanimage: sane_read: Document feeder jammed", file=sys.stderr)
        sys.exit(9)
        """,
    )
    result = sane.run_batch(arguments, folder, lambda _count: None)
    assert len(result.sheets) == 2
    assert result.interrupted == "paperJam"


def test_an_interrupted_sane_batch_is_saved_without_its_torn_last_sheet(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    torn = b"P6\n600 800\n255\n"
    sane_acquire(monkeypatch, FEEDER_OPTIONS, [printed_pnm(), printed_pnm(), torn], "paperJam")
    result = acquire(
        ScannerAcquireParams(output=str(tmp_path / "yarım.pdf"), deskew=False, dpi=100),
        silent_progress(),
    )
    assert result.sheets == 2
    assert result.interrupted == "paperJam"


def test_a_duplex_sheet_limit_counts_paper_not_sides(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = sane_acquire(monkeypatch, FEEDER_OPTIONS, [printed_pnm()] * 4)
    acquire(
        ScannerAcquireParams(
            output=str(tmp_path / "iki yaprak.pdf"), duplex=True, sheets=2, deskew=False, dpi=100
        ),
        silent_progress(),
    )
    assert "--batch-count=4" in calls[0]


SANE_FIXTURES = Path(__file__).parent / "fixtures" / "sane"
REAL_OUT_OF_DOCUMENTS = (
    "Scanning 200 pages, incrementing by 1, numbering from 1\n"
    "Scanning page 1\n"
    "scanimage: sane_read: Document feeder out of documents\n"
    "Scanned page 1. (scanner status = 7)\n"
    "Batch terminated, 1 page scanned\n"
    "scanimage: received signal 13\n"
    "scanimage: trying to stop scanner\n"
)


def real_output(name: str) -> str:
    return (SANE_FIXTURES / name).read_text(encoding="utf-8")


def test_real_test_backend_output_is_understood() -> None:
    found = sane.parse_devices(real_output("devices.txt"))
    assert [device.id for device in found] == ["test:0", "test:1", "pnm:0", "pnm:1"]
    assert found[0].name == "Noname frontend-tester"
    options = sane.parse_options(real_output("test_backend_options.txt"))
    assert options["mode"].values == ["Gray", "Color"]
    assert (options["resolution"].low, options["resolution"].high) == (1, 1200)
    assert options["source"].values == ["Flatbed", "Automatic Document Feeder"]
    assert sane.capabilities(options) == sane.SaneCapabilities(
        feeder=True, flatbed=True, duplex=False
    )
    assert sane.choose_source(options, feeder=True, duplex=True) == "Automatic Document Feeder"
    assert sane.choose_source(options, feeder=False, duplex=False) == "Flatbed"
    assert sane.choose_mode(options, "bw") == "Gray"
    assert sane.choose_mode(options, "color") == "Color"
    assert sane.choose_resolution(options, 300) == 300


def test_real_pnm_backend_output_without_mode_or_source_is_a_plain_flatbed() -> None:
    options = sane.parse_options(real_output("pnm_backend_options.txt"))
    assert "auto" in options["resolution"].values
    assert "" not in options["resolution"].values
    assert sane.capabilities(options) == sane.SaneCapabilities(
        feeder=False, flatbed=True, duplex=False
    )
    assert sane.choose_mode(options, "color") is None
    assert sane.choose_source(options, feeder=False, duplex=False) is None
    assert sane.choose_resolution(options, 105) == 100
    assert sane.choose_resolution(options, 600) == 300


@pytest.mark.parametrize(
    ("stderr", "code", "reason"),
    [
        ("scanimage: sane_read: Document feeder jammed", 6, "paperJam"),
        ("scanimage: sane_read: Scanner cover is open", 8, "coverOpen"),
    ],
)
def test_a_jam_or_open_cover_before_the_first_sheet_names_the_cause(
    tmp_path: Path, stderr: str, code: int, reason: str
) -> None:
    arguments, folder = batch(tmp_path, f"print({stderr!r}, file=sys.stderr)\nsys.exit({code})\n")
    with pytest.raises(OpError) as caught:
        sane.run_batch(arguments, folder, lambda _count: None)
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data["reason"] == reason


def test_an_invalid_argument_while_scanning_is_not_a_missing_scanner(tmp_path: Path) -> None:
    arguments, folder = batch(
        tmp_path, "print('scanimage: sane_start: Invalid argument', file=sys.stderr)\nsys.exit(4)\n"
    )
    with pytest.raises(OpError) as caught:
        sane.run_batch(arguments, folder, lambda _count: None)
    assert caught.value.code == ErrorCode.EXTERNAL_TOOL_FAILED
    assert caught.value.data["exitCode"] == 4


def test_sheets_before_an_invalid_argument_are_kept(tmp_path: Path) -> None:
    arguments, folder = batch(
        tmp_path,
        f"""
        Path(batch % 1).write_bytes({pnm_bytes()!r})
        print("scanimage: sane_start: Invalid argument", file=sys.stderr)
        sys.exit(4)
        """,
    )
    result = sane.run_batch(arguments, folder, lambda _count: None)
    assert len(result.sheets) == 1
    assert result.interrupted == "scannerStopped"


@pytest.mark.parametrize(
    ("detail", "reason"),
    [
        ("scanimage: open of device test:9 failed: Invalid argument", "noScanner"),
        ("scanimage: open of device epson2:libusb:001:004 failed: Device busy", "scannerBusy"),
    ],
)
def test_reading_options_of_an_unopenable_scanner_names_the_cause(
    monkeypatch: pytest.MonkeyPatch, detail: str, reason: str
) -> None:
    def failing(*_args: object, **_kwargs: object) -> None:
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED,
            "scanimage failed (exit 1)",
            {"tool": "scanimage", "exitCode": 1, "detail": detail},
        )

    monkeypatch.setattr(sane, "run_tool", failing)
    with pytest.raises(OpError) as caught:
        sane.device_options(Path("/usr/bin/scanimage"), "test:9")
    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data["reason"] == reason


def test_reading_options_keeps_a_timeout_as_it_is(monkeypatch: pytest.MonkeyPatch) -> None:
    def slow(*_args: object, **_kwargs: object) -> None:
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED,
            "scanimage timed out",
            {"tool": "scanimage", "reason": "timeout"},
        )

    monkeypatch.setattr(sane, "run_tool", slow)
    with pytest.raises(OpError) as caught:
        sane.device_options(Path("/usr/bin/scanimage"), "test:0")
    assert caught.value.data["reason"] == "timeout"


def test_a_scanimage_that_hangs_after_its_batch_ends_is_stopped_and_its_sheets_kept(
    tmp_path: Path,
) -> None:
    arguments, folder = batch(
        tmp_path,
        f"""
        for index in range(1, 4):
            Path(batch % index).write_bytes({pnm_bytes()!r})
        print("Scanning page 4", file=sys.stderr)
        print("scanimage: sane_start: Document feeder out of documents", file=sys.stderr)
        print("Batch terminated, 3 pages scanned", file=sys.stderr, flush=True)
        time.sleep(60)
        """,
    )
    started = time.monotonic()
    result = sane.run_batch(arguments, folder, lambda _count: None, exit_grace=0.5)
    assert time.monotonic() - started < 20
    assert len(result.sheets) == 3
    assert result.interrupted is None


def test_a_hang_after_a_jam_still_reports_the_jam(tmp_path: Path) -> None:
    arguments, folder = batch(
        tmp_path,
        f"""
        Path(batch % 1).write_bytes({pnm_bytes()!r})
        print("scanimage: sane_read: Document feeder jammed", file=sys.stderr)
        print("Batch terminated, 2 pages scanned", file=sys.stderr, flush=True)
        time.sleep(60)
        """,
    )
    result = sane.run_batch(arguments, folder, lambda _count: None, exit_grace=0.5)
    assert len(result.sheets) == 1
    assert result.interrupted == "paperJam"


def test_a_hang_after_an_empty_feeder_with_no_sheets_is_no_sheets(tmp_path: Path) -> None:
    arguments, folder = batch(
        tmp_path,
        f"sys.stderr.write({REAL_OUT_OF_DOCUMENTS!r})\nsys.stderr.flush()\ntime.sleep(60)\n",
    )
    with pytest.raises(OpError) as caught:
        sane.run_batch(arguments, folder, lambda _count: None, exit_grace=0.5)
    assert caught.value.data["reason"] == "noSheets"


EPSON_OPTIONS = """Options specific to device `epson2:libusb:001:004':
  Scan Mode:
    --mode Lineart|Gray|Color [Lineart]
    --resolution 75|300|600|1200dpi [75]
  Optional equipment:
    --source Flatbed|Automatic Document Feeder [Flatbed]
    --auto-eject[=(yes|no)] [yes]
    --adf-mode Simplex|Duplex [inactive]
"""


def test_a_feeder_with_a_separate_duplex_mode_scans_both_sides(tmp_path: Path) -> None:
    options = sane.parse_options(EPSON_OPTIONS)
    assert sane.capabilities(options) == sane.SaneCapabilities(
        feeder=True, flatbed=True, duplex=True
    )
    source = sane.choose_source(options, feeder=True, duplex=True)
    assert source == "Automatic Document Feeder"
    extra = sane.feeder_mode_arguments(options, source, feeder=True, duplex=True)
    assert extra == ["--adf-mode", "Duplex"]
    arguments = sane.scan_arguments(
        Path("scanimage"), "epson2:libusb:001:004", tmp_path, 300, "Color", source, 4, extra
    )
    assert arguments[-4:] == ["--source", "Automatic Document Feeder", "--adf-mode", "Duplex"]
    assert sane.feeder_mode_arguments(options, source, feeder=True, duplex=False) == [
        "--adf-mode",
        "Simplex",
    ]


def test_the_feeder_mode_is_left_alone_for_flatbed_and_duplex_sources() -> None:
    options = sane.parse_options(EPSON_OPTIONS)
    assert sane.feeder_mode_arguments(options, "Flatbed", feeder=False, duplex=False) == []
    assert sane.feeder_mode_arguments(options, "ADF Duplex", feeder=True, duplex=True) == []
    assert sane.feeder_mode_arguments({}, "ADF", feeder=True, duplex=True) == []
    plain = sane.parse_options(
        EPSON_OPTIONS.replace("    --adf-mode Simplex|Duplex [inactive]\n", "")
    )
    assert sane.capabilities(plain).duplex is False
