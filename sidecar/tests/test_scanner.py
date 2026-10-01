import io
import sys
from pathlib import Path

import pymupdf
import pytest
from PIL import Image, ImageDraw

from vivepdf.external import sane
from vivepdf.ops import scanner
from vivepdf.ops.scanner import (
    DUPLEX,
    FEEDER,
    FLATBED,
    HANDLING_CAPABILITIES,
    HANDLING_SELECT,
    HANDLING_STATUS,
    ITEM_HORIZONTAL_DPI,
    ITEM_HORIZONTAL_EXTENT,
    ITEM_VERTICAL_DPI,
    ITEM_VERTICAL_EXTENT,
    ScannerAcquireParams,
    ScannerDevicesParams,
    acquire,
    build_pdf,
    devices,
    process_sheet,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


class FakeProperty:
    def __init__(self, identifier: int, value: object, writable: bool = True) -> None:
        self.PropertyID = identifier
        self._value = value
        self._writable = writable

    @property
    def Value(self) -> object:  # noqa: N802
        return self._value

    @Value.setter
    def Value(self, value: object) -> None:  # noqa: N802
        if not self._writable:
            raise RuntimeError("read only")
        self._value = value


class FakeProperties:
    def __init__(self, values: dict[int, object], readonly: set[int] | None = None) -> None:
        blocked = readonly or set()
        self._items = [
            FakeProperty(identifier, value, identifier not in blocked)
            for identifier, value in values.items()
        ]

    @property
    def Count(self) -> int:  # noqa: N802
        return len(self._items)

    def __call__(self, position: int) -> FakeProperty:
        return self._items[position - 1]

    def value_of(self, identifier: int) -> object:
        for item in self._items:
            if item.PropertyID == identifier:
                return item.Value
        return None


class FakeItem:
    def __init__(self, properties: FakeProperties) -> None:
        self.Properties = properties


class FakeDevice:
    def __init__(self, properties: FakeProperties, item: FakeItem) -> None:
        self.Properties = properties
        self._item = item

    def Items(self, position: int) -> FakeItem:  # noqa: N802
        assert position == 1
        return self._item


def sheet_bytes(width: int = 120, height: int = 160) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (250, 250, 250)).save(buffer, format="BMP")
    return buffer.getvalue()


def make_device(capabilities: int, ready_sheets: int = 0) -> FakeDevice:
    device_properties = FakeProperties(
        {
            HANDLING_CAPABILITIES: capabilities,
            HANDLING_SELECT: FLATBED,
            HANDLING_STATUS: 1 if ready_sheets else 0,
            scanner.DEVICE_NAME: "Fake Scanner",
        }
    )
    item = FakeItem(
        FakeProperties(
            {
                scanner.ITEM_INTENT: 1,
                scanner.ITEM_DATA_TYPE: 3,
                ITEM_HORIZONTAL_DPI: 150,
                ITEM_VERTICAL_DPI: 150,
                ITEM_HORIZONTAL_EXTENT: 1275,
                ITEM_VERTICAL_EXTENT: 1650,
            }
        )
    )
    return FakeDevice(device_properties, item)


def test_devices_reports_support_and_never_raises() -> None:
    result = devices(ScannerDevicesParams(), silent_progress())
    assert result.supported == (sys.platform == "win32" or sane.find_scanimage() is not None)
    assert isinstance(result.devices, list)


def test_configure_scales_the_scan_area_with_the_resolution() -> None:
    device = make_device(FLATBED)
    item = device.Items(1)
    scanner._configure(item, ScannerAcquireParams(output="x.pdf", dpi=300))
    assert item.Properties.value_of(ITEM_HORIZONTAL_DPI) == 300
    assert item.Properties.value_of(ITEM_VERTICAL_DPI) == 300
    assert item.Properties.value_of(ITEM_HORIZONTAL_EXTENT) == 2550
    assert item.Properties.value_of(ITEM_VERTICAL_EXTENT) == 3300


def test_source_selection_prefers_the_feeder_when_one_exists() -> None:
    device = make_device(FEEDER | FLATBED | DUPLEX)
    assert scanner._select_source(device, ScannerAcquireParams(output="x.pdf")) == (True, False)
    assert device.Properties.value_of(HANDLING_SELECT) == FEEDER

    device = make_device(FEEDER | FLATBED | DUPLEX)
    assert scanner._select_source(device, ScannerAcquireParams(output="x.pdf", duplex=True)) == (
        True,
        True,
    )
    assert device.Properties.value_of(HANDLING_SELECT) == FEEDER | DUPLEX

    device = make_device(FEEDER | FLATBED)
    assert scanner._select_source(
        device, ScannerAcquireParams(output="x.pdf", source="flatbed")
    ) == (False, False)
    assert device.Properties.value_of(HANDLING_SELECT) == FLATBED


def test_asking_for_a_feeder_the_scanner_lacks_is_rejected() -> None:
    device = make_device(FLATBED)
    with pytest.raises(OpError) as caught:
        scanner._select_source(device, ScannerAcquireParams(output="x.pdf", source="feeder"))
    assert caught.value.data == {"reason": "noFeeder"}


def test_flatbed_scan_writes_one_page_sized_by_the_resolution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = make_device(FLATBED)
    monkeypatch.setattr(scanner, "_connect", lambda device_id: device)
    monkeypatch.setattr(scanner, "_transfer", lambda item: sheet_bytes(300, 400))
    monkeypatch.setattr(scanner, "windows", lambda: True)
    result = acquire(
        ScannerAcquireParams(output=str(tmp_path / "tarama.pdf"), dpi=150, deskew=False),
        silent_progress(),
    )
    assert result.sheets == 1
    assert result.page_count == 1
    assert result.device == "Fake Scanner"
    with pymupdf.open(result.output) as document:
        rect = document[0].rect
    assert round(rect.width) == 144
    assert round(rect.height) == 192


def test_feeder_scan_keeps_pulling_sheets_until_the_tray_is_empty(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = make_device(FEEDER | FLATBED, ready_sheets=3)
    pulled = {"count": 0}

    def transfer(_item: object) -> bytes:
        pulled["count"] += 1
        if pulled["count"] >= 3:
            for position in range(1, device.Properties.Count + 1):
                item = device.Properties(position)
                if item.PropertyID == HANDLING_STATUS:
                    item.Value = 0
        return sheet_bytes()

    monkeypatch.setattr(scanner, "_connect", lambda device_id: device)
    monkeypatch.setattr(scanner, "_transfer", transfer)
    monkeypatch.setattr(scanner, "windows", lambda: True)
    result = acquire(
        ScannerAcquireParams(output=str(tmp_path / "yigin.pdf"), deskew=False), silent_progress()
    )
    assert result.sheets == 3
    assert result.page_count == 3


def test_sheet_limit_stops_the_feeder_early(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = make_device(FEEDER | FLATBED, ready_sheets=10)
    monkeypatch.setattr(scanner, "_connect", lambda device_id: device)
    monkeypatch.setattr(scanner, "_transfer", lambda item: sheet_bytes())
    monkeypatch.setattr(scanner, "windows", lambda: True)
    result = acquire(
        ScannerAcquireParams(output=str(tmp_path / "iki.pdf"), sheets=2, deskew=False),
        silent_progress(),
    )
    assert result.sheets == 2


def test_an_unreadable_transfer_is_reported_as_a_scanner_failure() -> None:
    with pytest.raises(OpError) as caught:
        process_sheet(b"not an image", ScannerAcquireParams(output="x.pdf"))
    assert caught.value.code == ErrorCode.EXTERNAL_TOOL_FAILED


def test_build_pdf_uses_the_requested_colour_mode(tmp_path: Path) -> None:
    image = Image.new("RGB", (100, 100), (12, 200, 90))
    document = build_pdf([image], ScannerAcquireParams(output="x.pdf", mode="gray", dpi=100))
    target = tmp_path / "gri.pdf"
    document.save(target)
    document.close()
    with pymupdf.open(target) as saved:
        assert saved.page_count == 1


def printed_sheet_bytes(width: int = 1240, height: int = 1754) -> bytes:
    image = Image.new("RGB", (width, height), (250, 250, 250))
    ImageDraw.Draw(image).rectangle((150, 300, 900, 340), fill=(10, 10, 10))
    buffer = io.BytesIO()
    image.save(buffer, format="BMP")
    return buffer.getvalue()


def test_blank_backs_of_a_duplex_batch_are_left_out(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = make_device(FEEDER | FLATBED | DUPLEX, ready_sheets=4)
    sheets = [printed_sheet_bytes(), sheet_bytes(1240, 1754), printed_sheet_bytes()]
    pulled = {"count": 0}

    def transfer(_item: object) -> bytes:
        payload = sheets[pulled["count"]]
        pulled["count"] += 1
        if pulled["count"] >= len(sheets):
            for position in range(1, device.Properties.Count + 1):
                item = device.Properties(position)
                if item.PropertyID == HANDLING_STATUS:
                    item.Value = 0
        return payload

    monkeypatch.setattr(scanner, "_connect", lambda device_id: device)
    monkeypatch.setattr(scanner, "_transfer", transfer)
    monkeypatch.setattr(scanner, "windows", lambda: True)
    result = acquire(
        ScannerAcquireParams(
            output=str(tmp_path / "çift yüz.pdf"), dpi=150, deskew=False, skip_blank=True
        ),
        silent_progress(),
    )
    assert result.sheets == 2
    assert result.skipped_blank == 1
    assert result.page_count == 2


def test_a_scan_of_only_blank_sheets_says_so(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = make_device(FLATBED)
    monkeypatch.setattr(scanner, "_connect", lambda device_id: device)
    monkeypatch.setattr(scanner, "_transfer", lambda item: sheet_bytes(600, 800))
    monkeypatch.setattr(scanner, "windows", lambda: True)
    with pytest.raises(OpError) as caught:
        acquire(
            ScannerAcquireParams(output=str(tmp_path / "bos.pdf"), dpi=150, skip_blank=True),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "allBlank"}


class FakeComError(Exception):
    pass


def jam_after(device: FakeDevice, good: int, code: int):
    pulled = {"count": 0}

    def transfer(_item: object) -> bytes:
        pulled["count"] += 1
        if pulled["count"] > good:
            raise scanner.transfer_error(
                FakeComError(-2147352567, "failed", (0, None, None, None, 0, code), None)
            )
        return printed_sheet_bytes()

    return transfer


def test_a_paper_jam_keeps_the_pages_scanned_before_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = make_device(FEEDER | FLATBED, ready_sheets=5)
    monkeypatch.setattr(scanner, "_connect", lambda device_id: device)
    signed_jam = scanner.WIA_PAPER_JAM - (1 << 32)
    monkeypatch.setattr(scanner, "_transfer", jam_after(device, 2, signed_jam))
    monkeypatch.setattr(scanner, "windows", lambda: True)
    result = acquire(
        ScannerAcquireParams(output=str(tmp_path / "sıkışma.pdf"), dpi=150, deskew=False),
        silent_progress(),
    )
    assert result.sheets == 2
    assert result.interrupted == "paperJam"


def test_an_empty_feeder_at_the_start_says_no_pages(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = make_device(FEEDER | FLATBED, ready_sheets=5)
    monkeypatch.setattr(scanner, "_connect", lambda device_id: device)
    monkeypatch.setattr(scanner, "_transfer", jam_after(device, 0, scanner.WIA_PAPER_EMPTY))
    monkeypatch.setattr(scanner, "windows", lambda: True)
    with pytest.raises(OpError) as caught:
        acquire(ScannerAcquireParams(output=str(tmp_path / "boş.pdf")), silent_progress())
    assert caught.value.data == {"reason": "noSheets"}


def test_a_jam_on_the_first_sheet_is_an_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = make_device(FEEDER | FLATBED, ready_sheets=5)
    monkeypatch.setattr(scanner, "_connect", lambda device_id: device)
    monkeypatch.setattr(scanner, "_transfer", jam_after(device, 0, scanner.WIA_PAPER_JAM))
    monkeypatch.setattr(scanner, "windows", lambda: True)
    with pytest.raises(OpError) as caught:
        acquire(ScannerAcquireParams(output=str(tmp_path / "sıkışma.pdf")), silent_progress())
    assert caught.value.data == {"reason": "paperJam"}


def test_a_refused_resolution_sizes_pages_by_what_the_scanner_used(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = make_device(FLATBED)
    item = device.Items(1)
    for position in range(1, item.Properties.Count + 1):
        entry = item.Properties(position)
        if entry.PropertyID in (ITEM_HORIZONTAL_DPI, ITEM_VERTICAL_DPI):
            entry._writable = False
    monkeypatch.setattr(scanner, "_connect", lambda device_id: device)
    monkeypatch.setattr(scanner, "_transfer", lambda item: sheet_bytes(300, 450))
    monkeypatch.setattr(scanner, "windows", lambda: True)
    result = acquire(
        ScannerAcquireParams(output=str(tmp_path / "çözünürlük.pdf"), dpi=600, deskew=False),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        rect = document[0].rect
    assert round(rect.width) == 144
    assert round(rect.height) == 216


def test_a_duplex_sheet_limit_pulls_both_sides(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = make_device(FEEDER | FLATBED | DUPLEX, ready_sheets=10)
    monkeypatch.setattr(scanner, "_connect", lambda device_id: device)
    monkeypatch.setattr(scanner, "_transfer", lambda item: printed_sheet_bytes())
    monkeypatch.setattr(scanner, "windows", lambda: True)
    result = acquire(
        ScannerAcquireParams(
            output=str(tmp_path / "çift.pdf"), sheets=2, duplex=True, deskew=False, dpi=150
        ),
        silent_progress(),
    )
    assert result.sheets == 4


def test_a_failing_device_list_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken() -> list:
        raise RuntimeError("WIA service stopped")

    monkeypatch.setattr(scanner, "windows", lambda: True)
    monkeypatch.setattr(scanner, "list_devices", broken)
    result = devices(ScannerDevicesParams(), silent_progress())
    assert result.devices == []
    assert result.reason == "deviceError"
