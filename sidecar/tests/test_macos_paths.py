import datetime
import sys
from pathlib import Path

import pytest

from vivepdf import _data_home
from vivepdf.external import libreoffice
from vivepdf.ops import tessdata
from vivepdf.ops._appdata import user_data_dir
from vivepdf.ops.rename import formatted_date
from vivepdf.rpc.errors import ErrorCode, OpError


def test_mac_data_lives_in_application_support(monkeypatch, tmp_path):
    monkeypatch.delenv("VIVEPDF_OFFICE_DIR", raising=False)
    monkeypatch.delenv("VIVEPDF_DATA_DIR", raising=False)
    monkeypatch.delenv("VIVEPDF_TESSDATA_DIR", raising=False)
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    support = tmp_path / "Library" / "Application Support" / "vivePDF"
    assert user_data_dir() == support
    assert tessdata.writable_tessdata_dir() == support / "tessdata"
    assert libreoffice.managed_office_dir() == support / "libreoffice"


def test_mac_path_gains_homebrew_folders_once(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setenv("PATH", "/usr/bin:/bin:/usr/local/bin")
    _data_home.extend_macos_path()
    _data_home.extend_macos_path()
    assert _data_home.os.environ["PATH"] == "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin"


def test_path_is_left_alone_elsewhere(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setenv("PATH", "/usr/bin")
    _data_home.extend_macos_path()
    assert _data_home.os.environ["PATH"] == "/usr/bin"


@pytest.mark.skipif(sys.platform == "win32", reason="the C library checks the format on Windows")
@pytest.mark.parametrize("date_format", ["%Q", "%Y-%", "%d.%k"])
def test_unknown_date_directives_are_refused_on_posix(date_format):
    with pytest.raises(OpError) as caught:
        formatted_date(datetime.date(2026, 9, 5), date_format)
    assert caught.value.code == ErrorCode.INVALID_PARAMS


@pytest.mark.parametrize(
    ("date_format", "expected"),
    [("%d.%m.%Y", "05.09.2026"), ("%Y%%%m", "2026%09"), ("%-d %B", "5 September")],
)
def test_common_date_directives_still_format(date_format, expected):
    if sys.platform == "win32" and "%-" in date_format:
        pytest.skip("glibc/BSD flag")
    assert formatted_date(datetime.date(2026, 9, 5), date_format) == expected
