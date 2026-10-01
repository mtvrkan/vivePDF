import sys
from pathlib import Path

import pytest

from vivepdf.external import libreoffice, office_download, office_packages
from vivepdf.ops import office
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def test_installer_url_uses_the_windows_package():
    url = office_download.installer_url("26.2.6")
    assert url.endswith("/26.2.6/win/x86_64/LibreOffice_26.2.6_Win_x86-64.msi")
    assert url.startswith("https://download.documentfoundation.org/")


def test_candidate_versions_always_include_the_pinned_release(monkeypatch):
    monkeypatch.setattr(office_download, "_newest_versions", lambda: ["26.8.0", "26.2.5"])
    assert office_download.candidate_versions() == [
        "26.8.0",
        "26.2.5",
        office_download.PINNED_VERSION,
    ]
    monkeypatch.setattr(office_download, "_newest_versions", lambda: [])
    assert office_download.candidate_versions() == [office_download.PINNED_VERSION]


def test_newest_versions_sorts_numerically(monkeypatch):
    listing = (
        '<a href="25.8.7/">25.8.7/</a><a href="26.2.6/">26.2.6/</a><a href="26.10.1/">26.10.1/</a>'
    )

    class FakeResponse:
        def read(self):
            return listing.encode()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(office_download.urllib.request, "urlopen", lambda *_a, **_k: FakeResponse())
    assert office_download._newest_versions() == ["26.10.1", "26.2.6", "25.8.7"]


def test_managed_directory_follows_the_override(monkeypatch, tmp_path):
    monkeypatch.setenv("VIVEPDF_OFFICE_DIR", str(tmp_path / "office"))
    assert libreoffice.managed_office_dir() == tmp_path / "office"
    assert libreoffice.find_managed_soffice() is None


def test_unix_data_follows_an_absolute_xdg_data_home(monkeypatch, tmp_path):
    from vivepdf._data_home import unix_data_home
    from vivepdf.ops._appdata import user_data_dir

    monkeypatch.delenv("VIVEPDF_OFFICE_DIR", raising=False)
    monkeypatch.delenv("VIVEPDF_DATA_DIR", raising=False)
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    assert unix_data_home() == tmp_path / "data"
    assert libreoffice.managed_office_dir() == tmp_path / "data" / "vivepdf" / "libreoffice"
    assert user_data_dir() == tmp_path / "data" / "vivepdf"
    monkeypatch.setenv("XDG_DATA_HOME", "relative/data")
    assert unix_data_home() == Path.home() / ".local" / "share"
    monkeypatch.setenv("XDG_DATA_HOME", "")
    assert unix_data_home() == Path.home() / ".local" / "share"


def test_managed_binary_is_found_and_preferred(monkeypatch, tmp_path):
    managed = tmp_path / "office"
    binary = managed / "program" / ("soffice.exe" if sys.platform == "win32" else "soffice")
    binary.parent.mkdir(parents=True)
    binary.write_text("stub", encoding="utf-8")
    monkeypatch.setenv("VIVEPDF_OFFICE_DIR", str(managed))
    assert libreoffice.find_managed_soffice() == binary
    assert libreoffice.find_soffice() == binary


def test_status_reports_the_managed_install(monkeypatch, tmp_path):
    managed = tmp_path / "office"
    binary = managed / "program" / ("soffice.exe" if sys.platform == "win32" else "soffice")
    binary.parent.mkdir(parents=True)
    binary.write_bytes(b"0123456789")
    monkeypatch.setenv("VIVEPDF_OFFICE_DIR", str(managed))
    status = office.office_status(office.OfficeStatusParams(), silent_progress())
    assert status.installed is True
    assert status.source == "managed"
    assert status.size_bytes == 10


def test_remove_clears_the_managed_directory(monkeypatch, tmp_path):
    managed = tmp_path / "office"
    (managed / "program").mkdir(parents=True)
    (managed / "program" / "soffice.exe").write_text("stub", encoding="utf-8")
    monkeypatch.setenv("VIVEPDF_OFFICE_DIR", str(managed))
    status = office.office_remove(office.OfficeRemoveParams(), silent_progress())
    assert not managed.exists()
    assert status.installed is False or status.source == "system"


def test_install_refuses_where_no_package_is_published(monkeypatch, tmp_path):
    monkeypatch.setenv("VIVEPDF_OFFICE_DIR", str(tmp_path / "office"))
    monkeypatch.setattr(office_download.sys, "platform", "freebsd")
    with pytest.raises(OpError) as caught:
        office.office_install(office.OfficeInstallParams(), silent_progress())
    assert caught.value.code == ErrorCode.UNSUPPORTED


def test_prune_removes_help_and_bundled_python(tmp_path):
    directory = tmp_path / "office"
    (directory / "program").mkdir(parents=True)
    (directory / "help" / "en").mkdir(parents=True)
    (directory / "readmes").mkdir()
    (directory / "program" / "soffice.exe").write_text("stub", encoding="utf-8")
    (directory / "program" / "python.exe").write_text("stub", encoding="utf-8")
    (directory / "program" / "python313.dll").write_text("stub", encoding="utf-8")
    (directory / "LibreOffice.msi").write_text("stub", encoding="utf-8")
    office._prune(directory)
    assert not (directory / "help").exists()
    assert not (directory / "readmes").exists()
    assert not (directory / "program" / "python.exe").exists()
    assert not (directory / "program" / "python313.dll").exists()
    assert list(directory.glob("*.msi")) == []
    assert (directory / "program" / "soffice.exe").is_file()


def test_clean_environment_drops_inherited_python_settings(monkeypatch):
    monkeypatch.setenv("PYTHONHOME", "C:/python")
    monkeypatch.setenv("PYTHONPATH", "C:/python/lib")
    monkeypatch.setenv("VIRTUAL_ENV", "C:/venv")
    monkeypatch.setenv("PATH", "C:/windows")
    cleaned = libreoffice.clean_environment()
    assert "PYTHONHOME" not in cleaned
    assert "PYTHONPATH" not in cleaned
    assert "VIRTUAL_ENV" not in cleaned
    assert cleaned["PATH"] == "C:/windows"


def test_conversion_profile_is_locked_down(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    registry = libreoffice.lock_down_profile(profile)
    assert registry.is_file()
    text = registry.read_text(encoding="utf-8")
    assert "MacroSecurityLevel" in text
    assert "<value>3</value>" in text
    assert "DisableMacrosExecution" in text


def test_conversion_profile_never_updates_links_or_recalculates(tmp_path: Path) -> None:
    text = libreoffice.lock_down_profile(tmp_path / "profile").read_text(encoding="utf-8")
    writer = '<item oor:path="/org.openoffice.Office.Writer/Content/Update">'
    calc = '<item oor:path="/org.openoffice.Office.Calc/Content/Update">'
    assert f'{writer}<prop oor:name="Link" oor:op="fuse"><value>2</value>' in text
    assert f'{calc}<prop oor:name="Link" oor:op="fuse"><value>1</value>' in text
    assert "OOXMLRecalcMode" in text
    assert "ODFRecalcMode" in text


def test_a_profile_locked_by_an_older_version_gets_the_new_settings(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    registry = profile / "user" / "registrymodifications.xcu"
    registry.parent.mkdir(parents=True)
    registry.write_text(
        '<oor:items><item oor:path="/org.openoffice.Office.Common/Security/Scripting">'
        '<prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop>'
        "</item></oor:items>",
        encoding="utf-8",
    )
    libreoffice.lock_down_profile(profile)
    assert libreoffice.registry_locked(registry.read_text(encoding="utf-8"))


def test_locking_down_twice_keeps_the_existing_registry(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    registry = libreoffice.lock_down_profile(profile)
    registry.write_text(
        registry.read_text(encoding="utf-8").replace("</oor:items>", "  <!--kept-->\n</oor:items>"),
        encoding="utf-8",
    )
    libreoffice.lock_down_profile(profile)
    assert "kept" in registry.read_text(encoding="utf-8")


TDF_SUBJECT = (
    "E=info@documentfoundation.org, CN=The Document Foundation, O=The Document Foundation, "
    "OU=LibreOffice Build Team, L=Berlin, S=Berlin, C=DE"
)


def test_verify_publisher_accepts_a_valid_foundation_signature(monkeypatch, tmp_path):
    monkeypatch.setattr(office_packages, "msi_signature", lambda _path: ("Valid", TDF_SUBJECT))
    office_packages.verify_msi_publisher(tmp_path / "libreoffice.msi")


@pytest.mark.parametrize(
    ("status", "subject"),
    [
        ("HashMismatch", TDF_SUBJECT),
        ("NotSigned", ""),
        ("Valid", "CN=The Document Foundation Mirror, O=Someone Else"),
    ],
)
def test_verify_publisher_rejects_untrusted_installers(monkeypatch, tmp_path, status, subject):
    monkeypatch.setattr(office_packages, "msi_signature", lambda _path: (status, subject))
    with pytest.raises(OpError) as caught:
        office_packages.verify_msi_publisher(tmp_path / "libreoffice.msi")
    assert caught.value.code == ErrorCode.EXTERNAL_TOOL_FAILED
    assert caught.value.data == {"tool": "authenticode", "status": status, "subject": subject}


def test_install_verifies_the_signature_before_extracting(monkeypatch, tmp_path):
    monkeypatch.setenv("VIVEPDF_OFFICE_DIR", str(tmp_path / "office"))
    monkeypatch.setattr(office_download.sys, "platform", "win32")
    monkeypatch.setattr(office_download, "candidate_versions", lambda: ["26.2.6"])
    monkeypatch.setattr(office_download.platform, "machine", lambda: "AMD64")
    monkeypatch.setattr(office_download, "download", lambda *_args: office.MIN_INSTALLER_BYTES)
    monkeypatch.setattr(office_download, "verify_checksum", lambda *_args: None)
    monkeypatch.setattr(
        office_packages, "msi_signature", lambda _path: ("HashMismatch", TDF_SUBJECT)
    )
    extracted: list[Path] = []
    monkeypatch.setattr(
        office_packages, "extract_msi", lambda installer, *_args: extracted.append(installer)
    )
    with pytest.raises(OpError) as caught:
        office.office_install(office.OfficeInstallParams(), silent_progress())
    assert caught.value.data["tool"] == "authenticode"
    assert extracted == []


@pytest.mark.skipif(sys.platform != "win32", reason="Authenticode is Windows-only")
def test_signature_of_an_unsigned_file_is_not_valid(tmp_path):
    unsigned = tmp_path / "unsigned.msi"
    unsigned.write_bytes(b"not an installer")
    status, _subject = office_packages.msi_signature(unsigned)
    assert status != "Valid"
    with pytest.raises(OpError):
        office_packages.verify_msi_publisher(unsigned)
