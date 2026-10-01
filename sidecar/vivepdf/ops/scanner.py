import io
import sys
import tempfile
from pathlib import Path
from typing import Literal

import pymupdf
from PIL import Image
from pydantic import Field

from vivepdf.external import sane
from vivepdf.ops._blank import blank_image
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops.scan import (
    ColorMode,
    apply_color_mode,
    deskew,
    despeckle,
    encode_image,
    estimate_skew,
    whiten,
)
from vivepdf.ops.scan_session import session_part
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

SCANNER_DEVICE_TYPE = 1
FORMAT_BMP = "{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}"
DEVICE_NAME = 4098
DEVICE_DESCRIPTION = 4099
HANDLING_SELECT = 3088
HANDLING_STATUS = 3087
HANDLING_CAPABILITIES = 3086
FEEDER = 1
FLATBED = 2
DUPLEX = 4
FEED_READY = 1
ITEM_DATA_TYPE = 4103
ITEM_INTENT = 6146
ITEM_HORIZONTAL_DPI = 6147
ITEM_VERTICAL_DPI = 6148
ITEM_HORIZONTAL_EXTENT = 6151
ITEM_VERTICAL_EXTENT = 6152
DATA_TYPES: dict[ColorMode, int] = {"bw": 0, "gray": 2, "color": 3}
INTENTS: dict[ColorMode, int] = {"color": 1, "gray": 2, "bw": 4}
MAX_SHEETS = 200
WIA_PAPER_JAM = 0x80210002
WIA_PAPER_EMPTY = 0x80210003
WIA_OFFLINE = 0x80210005
WIA_BUSY = 0x80210006
WIA_COVER_OPEN = 0x80210016
WIA_REASONS: dict[int, str] = {
    WIA_PAPER_JAM: "paperJam",
    WIA_PAPER_EMPTY: "feederEmpty",
    WIA_OFFLINE: "scannerOffline",
    WIA_BUSY: "scannerBusy",
    WIA_COVER_OPEN: "coverOpen",
}
Interruption = Literal["paperJam", "coverOpen", "scannerOffline", "scannerStopped"]


class ScannerDevice(RpcModel):
    id: str
    name: str
    feeder: bool = False
    flatbed: bool = True
    duplex: bool = False


class ScannerDevicesParams(RpcModel):
    pass


class ScannerDevicesResult(RpcModel):
    supported: bool
    devices: list[ScannerDevice]
    reason: Literal["saneMissing", "deviceError"] | None = None


class ScannerAcquireParams(RpcModel):
    device_id: str | None = None
    output: str = ""
    session: bool = False
    overwrite: bool = False
    source: Literal["auto", "flatbed", "feeder"] = "auto"
    dpi: int = Field(default=300, ge=75, le=1200)
    mode: ColorMode = "color"
    sheets: int = Field(default=0, ge=0, le=MAX_SHEETS)
    duplex: bool = False
    deskew: bool = True
    despeckle: bool = False
    whiten: bool = False
    skip_blank: bool = False
    jpeg_quality: int = Field(default=85, ge=30, le=100)


class ScannerAcquireResult(OutputResult):
    device: str
    sheets: int
    skipped_blank: int = 0
    interrupted: Interruption | None = None


def windows() -> bool:
    return sys.platform == "win32"


def _property_value(properties: object, wanted: int, fallback: str = "") -> str:
    for position in range(1, properties.Count + 1):  # type: ignore[attr-defined]
        item = properties(position)  # type: ignore[operator]
        if item.PropertyID == wanted:
            try:
                return str(item.Value)
            except Exception:  # noqa: BLE001
                return fallback
    return fallback


def _property_number(properties: object, wanted: int) -> int | None:
    for position in range(1, properties.Count + 1):  # type: ignore[attr-defined]
        item = properties(position)  # type: ignore[operator]
        if item.PropertyID == wanted:
            try:
                return int(item.Value)
            except Exception:  # noqa: BLE001
                return None
    return None


def _set_property(properties: object, wanted: int, value: int) -> bool:
    for position in range(1, properties.Count + 1):  # type: ignore[attr-defined]
        item = properties(position)  # type: ignore[operator]
        if item.PropertyID == wanted:
            try:
                item.Value = value
            except Exception:  # noqa: BLE001
                return False
            return True
    return False


def _device_manager() -> object:
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    return win32com.client.Dispatch("WIA.DeviceManager")


def list_devices() -> list[ScannerDevice]:
    manager = _device_manager()
    devices: list[ScannerDevice] = []
    for index in range(1, manager.DeviceInfos.Count + 1):  # type: ignore[attr-defined]
        info = manager.DeviceInfos(index)  # type: ignore[operator]
        if info.Type != SCANNER_DEVICE_TYPE:
            continue
        name = _property_value(info.Properties, DEVICE_NAME) or _property_value(
            info.Properties, DEVICE_DESCRIPTION
        )
        capabilities = 0
        try:
            connected = info.Connect()
            capabilities = _property_number(connected.Properties, HANDLING_CAPABILITIES) or 0
        except Exception:  # noqa: BLE001
            capabilities = 0
        devices.append(
            ScannerDevice(
                id=str(info.DeviceID),
                name=name or str(info.DeviceID),
                feeder=bool(capabilities & FEEDER),
                flatbed=not capabilities or bool(capabilities & FLATBED),
                duplex=bool(capabilities & DUPLEX),
            )
        )
    return devices


def _sane_device(binary: Path, found: sane.SaneDevice) -> ScannerDevice:
    try:
        abilities = sane.capabilities(sane.device_options(binary, found.id))
    except OpError:
        abilities = sane.SaneCapabilities(feeder=False, flatbed=True, duplex=False)
    return ScannerDevice(
        id=found.id,
        name=found.name,
        feeder=abilities.feeder,
        flatbed=abilities.flatbed,
        duplex=abilities.duplex,
    )


def list_sane_devices(binary: Path) -> list[ScannerDevice]:
    return [_sane_device(binary, found) for found in sane.list_devices(binary)]


@op("scanner.devices", ScannerDevicesParams)
def devices(_params: ScannerDevicesParams, _progress: Progress) -> ScannerDevicesResult:
    if windows():
        try:
            return ScannerDevicesResult(supported=True, devices=list_devices())
        except Exception:  # noqa: BLE001
            return ScannerDevicesResult(supported=True, devices=[], reason="deviceError")
    binary = sane.find_scanimage()
    if binary is None:
        return ScannerDevicesResult(supported=False, devices=[], reason="saneMissing")
    try:
        return ScannerDevicesResult(supported=True, devices=list_sane_devices(binary))
    except Exception:  # noqa: BLE001
        return ScannerDevicesResult(supported=True, devices=[], reason="deviceError")


def _connect(device_id: str | None) -> object:
    manager = _device_manager()
    count = manager.DeviceInfos.Count  # type: ignore[attr-defined]
    for index in range(1, count + 1):
        info = manager.DeviceInfos(index)  # type: ignore[operator]
        if info.Type != SCANNER_DEVICE_TYPE:
            continue
        if device_id and str(info.DeviceID) != device_id:
            continue
        try:
            return info.Connect()
        except Exception as error:  # noqa: BLE001
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "the scanner could not be opened",
                {"reason": "scannerBusy"},
            ) from error
    raise OpError(ErrorCode.INVALID_PARAMS, "no scanner was found", {"reason": "noScanner"})


def _configure(item: object, params: ScannerAcquireParams) -> tuple[float, float]:
    properties = item.Properties  # type: ignore[attr-defined]
    horizontal = _property_number(properties, ITEM_HORIZONTAL_EXTENT)
    vertical = _property_number(properties, ITEM_VERTICAL_EXTENT)
    previous = _property_number(properties, ITEM_HORIZONTAL_DPI) or 0
    _set_property(properties, ITEM_INTENT, INTENTS[params.mode])
    _set_property(properties, ITEM_DATA_TYPE, DATA_TYPES[params.mode])
    if _set_property(properties, ITEM_HORIZONTAL_DPI, params.dpi):
        _set_property(properties, ITEM_VERTICAL_DPI, params.dpi)
        if horizontal and vertical and previous:
            _set_property(
                properties, ITEM_HORIZONTAL_EXTENT, round(horizontal * params.dpi / previous)
            )
            _set_property(properties, ITEM_VERTICAL_EXTENT, round(vertical * params.dpi / previous))
    actual_x = _property_number(properties, ITEM_HORIZONTAL_DPI) or params.dpi
    actual_y = _property_number(properties, ITEM_VERTICAL_DPI) or actual_x
    return float(actual_x), float(actual_y)


def _select_source(device: object, params: ScannerAcquireParams) -> tuple[bool, bool]:
    capabilities = _property_number(device.Properties, HANDLING_CAPABILITIES) or 0  # type: ignore[attr-defined]
    wants_feeder = params.source == "feeder" or (
        params.source == "auto" and bool(capabilities & FEEDER)
    )
    if params.source == "feeder" and not capabilities & FEEDER:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "this scanner has no document feeder", {"reason": "noFeeder"}
        )
    if not wants_feeder:
        _set_property(device.Properties, HANDLING_SELECT, FLATBED)  # type: ignore[attr-defined]
        return False, False
    duplex = bool(params.duplex and capabilities & DUPLEX)
    selection = FEEDER | (DUPLEX if duplex else 0)
    _set_property(device.Properties, HANDLING_SELECT, selection)  # type: ignore[attr-defined]
    return True, duplex


def _feed_ready(device: object) -> bool:
    status = _property_number(device.Properties, HANDLING_STATUS)  # type: ignore[attr-defined]
    return bool(status is not None and status & FEED_READY)


def _wia_codes(error: BaseException) -> set[int]:
    codes: set[int] = set()
    arguments = getattr(error, "args", ())
    if arguments and isinstance(arguments[0], int):
        codes.add(arguments[0] & 0xFFFFFFFF)
    if len(arguments) > 2 and isinstance(arguments[2], tuple) and len(arguments[2]) > 5:
        scode = arguments[2][5]
        if isinstance(scode, int):
            codes.add(scode & 0xFFFFFFFF)
    hresult = getattr(error, "hresult", None)
    if isinstance(hresult, int):
        codes.add(hresult & 0xFFFFFFFF)
    return codes


def transfer_error(error: BaseException) -> OpError:
    for code in _wia_codes(error):
        reason = WIA_REASONS.get(code)
        if reason:
            return OpError(
                ErrorCode.INVALID_PARAMS, f"the scanner reported {reason}", {"reason": reason}
            )
    return OpError(
        ErrorCode.EXTERNAL_TOOL_FAILED,
        "the scanner stopped during the scan",
        {"reason": "scannerStopped"},
    )


def _transfer(item: object) -> bytes:
    try:
        transferred = item.Transfer(FORMAT_BMP)  # type: ignore[attr-defined]
        return bytes(transferred.FileData.BinaryData)
    except Exception as error:  # noqa: BLE001
        raise transfer_error(error) from error


def process_sheet(payload: bytes, params: ScannerAcquireParams) -> Image.Image:
    try:
        with Image.open(io.BytesIO(payload)) as opened:
            image = opened.convert("RGB")
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED, "the scanner returned an unreadable image"
        ) from error
    if params.deskew:
        angle = estimate_skew(image)
        if angle:
            image = deskew(image, angle)
    if params.despeckle:
        image = despeckle(image)
    if params.whiten:
        image = whiten(image)
    return apply_color_mode(image, params.mode)


def _append_page(
    document: pymupdf.Document,
    image: Image.Image,
    params: ScannerAcquireParams,
    resolution: tuple[float, float],
) -> None:
    data = encode_image(image, params.mode, params.jpeg_quality)
    width = image.width * 72.0 / resolution[0]
    height = image.height * 72.0 / resolution[1]
    page = document.new_page(width=width, height=height)
    page.insert_image(page.rect, stream=data, keep_proportion=True)


def build_pdf(images: list[Image.Image], params: ScannerAcquireParams) -> pymupdf.Document:
    document = pymupdf.open()
    for image in images:
        _append_page(document, image, params, (params.dpi, params.dpi))
    return document


class SheetCollector:
    def __init__(self, params: ScannerAcquireParams, resolution: tuple[float, float]) -> None:
        self.params = params
        self.resolution = resolution
        self.document = pymupdf.open()
        self.pages = 0
        self.skipped = 0
        self.interrupted: Interruption | None = None

    @property
    def received(self) -> int:
        return self.pages + self.skipped

    def add(self, payload: bytes) -> None:
        sheet = process_sheet(payload, self.params)
        if self.params.skip_blank and blank_image(sheet, round(self.resolution[0])):
            self.skipped += 1
            return
        _append_page(self.document, sheet, self.params, self.resolution)
        self.pages += 1

    def close(self) -> None:
        self.document.close()


def _write_result(
    collector: SheetCollector,
    target: Path,
    name: str,
    progress: Progress,
) -> ScannerAcquireResult:
    if not collector.pages:
        reason = collector.interrupted or ("allBlank" if collector.skipped else "noSheets")
        raise OpError(ErrorCode.INVALID_PARAMS, "the scanner produced no pages", {"reason": reason})
    progress.report(0.95, "progress.saving")
    saved = save_document(collector.document, target)
    return ScannerAcquireResult(
        **saved.model_dump(),
        device=name,
        sheets=collector.pages,
        skipped_blank=collector.skipped,
        interrupted=collector.interrupted,
    )


def _side_limit(params: ScannerAcquireParams, from_feeder: bool, duplex: bool) -> int:
    sides = 2 if duplex else 1
    if params.sheets:
        return params.sheets * sides
    return MAX_SHEETS * sides if from_feeder else 1


def _sane_target(binary: Path, device_id: str | None) -> tuple[str, str]:
    if device_id:
        return device_id, device_id
    found = sane.list_devices(binary)
    if not found:
        raise OpError(ErrorCode.INVALID_PARAMS, "no scanner was found", {"reason": "noScanner"})
    return found[0].id, found[0].name


def _acquire_sane(
    params: ScannerAcquireParams, target: Path, progress: Progress
) -> ScannerAcquireResult:
    binary = sane.require_scanimage()
    device, name = _sane_target(binary, params.device_id)
    options = sane.device_options(binary, device)
    abilities = sane.capabilities(options)
    if params.source == "feeder" and not abilities.feeder:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "this scanner has no document feeder", {"reason": "noFeeder"}
        )
    from_feeder = params.source == "feeder" or (params.source == "auto" and abilities.feeder)
    duplex = from_feeder and params.duplex and abilities.duplex
    resolution = sane.choose_resolution(options, params.dpi)
    limit = _side_limit(params, from_feeder, duplex)
    reported = [-1]

    def on_sheet(count: int) -> None:
        progress.check_cancelled()
        if count == reported[0]:
            return
        reported[0] = count
        progress.report(
            min(0.8, 0.1 + 0.7 * count / max(1, limit)),
            "progress.scanning",
            {"current": min(limit, max(1, count)), "total": limit},
        )

    scanned = params.model_copy(update={"dpi": resolution})
    collector = SheetCollector(scanned, (float(resolution), float(resolution)))
    try:
        with tempfile.TemporaryDirectory(prefix="vivepdf-scan-") as folder:
            source = sane.choose_source(options, from_feeder, duplex)
            arguments = sane.scan_arguments(
                binary,
                device,
                Path(folder),
                resolution,
                sane.choose_mode(options, params.mode),
                source,
                limit,
                sane.feeder_mode_arguments(options, source, from_feeder, duplex),
            )
            batch = sane.run_batch(arguments, Path(folder), on_sheet)
            collector.interrupted = batch.interrupted
            last = len(batch.sheets) - 1
            for position, sheet_path in enumerate(batch.sheets):
                progress.check_cancelled()
                try:
                    collector.add(sheet_path.read_bytes())
                except OpError:
                    if batch.interrupted and position == last:
                        break
                    raise
                sheet_path.unlink(missing_ok=True)
        return _write_result(collector, target, name, progress)
    finally:
        collector.close()


def _acquire_target(params: ScannerAcquireParams) -> Path:
    if params.session:
        return session_part()
    if not params.output.strip():
        raise OpError(ErrorCode.INVALID_PARAMS, "an output path is required")
    return prepare_output(params.output, [], params.overwrite)


@op("scanner.acquire", ScannerAcquireParams)
def acquire(params: ScannerAcquireParams, progress: Progress) -> ScannerAcquireResult:
    target = _acquire_target(params)
    if not windows():
        return _acquire_sane(params, target, progress)
    device = _connect(params.device_id)
    name = _property_value(device.Properties, DEVICE_NAME) or params.device_id or ""  # type: ignore[attr-defined]
    from_feeder, duplex = _select_source(device, params)
    limit = _side_limit(params, from_feeder, duplex)
    item = device.Items(1)  # type: ignore[attr-defined]
    collector = SheetCollector(params, _configure(item, params))
    try:
        pulled = 0
        while pulled < limit:
            progress.check_cancelled()
            if from_feeder and pulled and not _feed_ready(device):
                break
            progress.report(
                min(0.9, 0.1 + 0.8 * pulled / max(1, limit)),
                "progress.scanning",
                {"current": pulled + 1, "total": limit},
            )
            try:
                payload = _transfer(item)
            except OpError as error:
                stop = _stop_reason(error, from_feeder, collector.received)
                if stop is None:
                    raise
                collector.interrupted = stop if stop != "feederEmpty" else None
                break
            collector.add(payload)
            pulled += 1
            if not from_feeder:
                break
        return _write_result(collector, target, name, progress)
    finally:
        collector.close()


def _stop_reason(error: OpError, from_feeder: bool, received: int) -> str | None:
    if not from_feeder or not received:
        if error.data and error.data.get("reason") == "feederEmpty":
            raise OpError(
                ErrorCode.INVALID_PARAMS, "the scanner produced no pages", {"reason": "noSheets"}
            ) from error
        return None
    reason = (error.data or {}).get("reason", "scannerStopped")
    if reason in ("feederEmpty", "paperJam", "coverOpen", "scannerOffline"):
        return reason
    return "scannerStopped"
