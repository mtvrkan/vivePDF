import hashlib
import io
import sys
import tarfile
from pathlib import Path

import pytest

from vivepdf.external import libreoffice, office_download, office_packages
from vivepdf.ops import office
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress

OFFICE_ROOT = "opt/libreoffice26.2"


def tar_bytes(entries: dict[str, bytes], links: dict[str, str] | None = None) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:xz") as archive:
        for name, payload in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            info.mode = 0o755
            archive.addfile(info, io.BytesIO(payload))
        for name, target in (links or {}).items():
            info = tarfile.TarInfo(name)
            info.type = tarfile.SYMTYPE
            info.linkname = target
            archive.addfile(info)
    return buffer.getvalue()


def ar_member(name: str, payload: bytes) -> bytes:
    header = f"{name:<16}{0:<12}{0:<6}{0:<6}{100644:<8}{len(payload):<10}`\n".encode("ascii")
    return header + payload + (b"\n" if len(payload) % 2 else b"")


def deb_bytes(data: bytes) -> bytes:
    return (
        office_packages.AR_MAGIC
        + ar_member("debian-binary", b"2.0\n")
        + ar_member("control.tar.xz", b"x")
        + ar_member("data.tar.xz", data)
    )


def write_bundle(target: Path) -> Path:
    core = deb_bytes(
        tar_bytes(
            {
                f"./{OFFICE_ROOT}/program/soffice": b"#!/bin/sh\n",
                f"./{OFFICE_ROOT}/program/soffice.bin": b"binary",
                "../escaped.txt": b"outside",
            },
            {"./usr/local/bin/libreoffice26.2": f"/{OFFICE_ROOT}/program/soffice"},
        )
    )
    dictionary = deb_bytes(tar_bytes({f"./{OFFICE_ROOT}/share/dict.txt": b"words"}))
    menus = deb_bytes(tar_bytes({"./usr/share/applications/menu.desktop": b"menu"}))
    folder = "LibreOffice_26.2.6.3_Linux_x86-64_deb/DEBS"
    with tarfile.open(target, "w:gz") as bundle:
        for name, payload in {
            f"{folder}/libobasis26.2-core_26.2.6.3-3_amd64.deb": core,
            f"{folder}/libreoffice26.2-dict-en_26.2.6.3-3_amd64.deb": dictionary,
            f"{folder}/desktop-integration/libreoffice26.2-debian-menus_all.deb": menus,
            f"{folder}/../readmes/README_en-US": b"readme",
        }.items():
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            bundle.addfile(info, io.BytesIO(payload))
    return target


@pytest.mark.parametrize(
    ("platform", "machine", "folder"),
    [
        ("win32", "AMD64", "win/x86_64"),
        ("win32", "ARM64", "win/x86_64"),
        ("darwin", "x86_64", "mac/x86_64"),
        ("darwin", "arm64", "mac/aarch64"),
        ("linux", "x86_64", "deb/x86_64"),
        ("linux", "aarch64", "deb/aarch64"),
    ],
)
def test_each_desktop_platform_gets_its_published_package(monkeypatch, platform, machine, folder):
    monkeypatch.setattr(office_download.sys, "platform", platform)
    monkeypatch.setattr(office_download.platform, "machine", lambda: machine)
    package = office_download.current_package()
    assert package is not None
    assert package.folder == folder


@pytest.mark.parametrize(("platform", "machine"), [("linux", "riscv64"), ("freebsd", "amd64")])
def test_platforms_without_a_package_are_unsupported(monkeypatch, platform, machine):
    monkeypatch.setattr(office_download.sys, "platform", platform)
    monkeypatch.setattr(office_download.platform, "machine", lambda: machine)
    assert office_download.current_package() is None
    assert office.office_status(office.OfficeStatusParams(), silent_progress()).supported is False


def test_installer_urls_follow_the_foundation_layout():
    mac = office_download.PACKAGES[("darwin", "aarch64")]
    linux = office_download.PACKAGES[("linux", "x86_64")]
    assert office_download.installer_url("26.2.6", mac).endswith(
        "/26.2.6/mac/aarch64/LibreOffice_26.2.6_MacOS_aarch64.dmg"
    )
    assert office_download.installer_url("26.2.6", linux).endswith(
        "/26.2.6/deb/x86_64/LibreOffice_26.2.6_Linux_x86-64_deb.tar.gz"
    )


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def serve(monkeypatch, body: bytes, requested: list[str]) -> None:
    def urlopen(request, timeout):
        requested.append(request.full_url)
        return FakeResponse(body)

    monkeypatch.setattr(office_download.urllib.request, "urlopen", urlopen)


def test_expected_checksum_reads_the_foundation_sha256_file(monkeypatch):
    requested: list[str] = []
    digest = "AB" * 32
    serve(monkeypatch, f"{digest}  LibreOffice_x.dmg\n".encode(), requested)
    assert (
        office_download.expected_checksum("https://example.org/a/LibreOffice_x.dmg")
        == digest.lower()
    )
    assert requested == ["https://example.org/a/LibreOffice_x.dmg.sha256"]


@pytest.mark.parametrize(
    "body",
    [b"not a checksum", ("ab" * 32 + "  Other_file.dmg").encode(), b"ab12  LibreOffice_x.dmg"],
)
def test_malformed_or_mismatched_checksum_files_are_rejected(monkeypatch, body):
    serve(monkeypatch, body, [])
    with pytest.raises(OpError) as caught:
        office_download.expected_checksum("https://example.org/a/LibreOffice_x.dmg")
    assert caught.value.data == {"tool": "sha256"}


def test_unreachable_checksum_is_a_network_error(monkeypatch):
    def urlopen(*_args, **_kwargs):
        raise OSError("offline")

    monkeypatch.setattr(office_download.urllib.request, "urlopen", urlopen)
    with pytest.raises(OpError) as caught:
        office_download.expected_checksum("https://example.org/a/LibreOffice_x.dmg")
    assert caught.value.code == ErrorCode.NETWORK


def test_verify_checksum_rejects_a_tampered_download(monkeypatch, tmp_path):
    installer = tmp_path / "libreoffice.deb"
    installer.write_bytes(b"tampered")
    monkeypatch.setattr(office_download, "expected_checksum", lambda _url: "0" * 64)
    with pytest.raises(OpError) as caught:
        office_download.verify_checksum("https://example.org/x.tar.gz", installer)
    assert caught.value.data == {"tool": "sha256"}
    good = hashlib.sha256(b"tampered").hexdigest()
    monkeypatch.setattr(office_download, "expected_checksum", lambda _url: good)
    office_download.verify_checksum("https://example.org/x.tar.gz", installer)


def test_deb_payload_finds_the_data_archive():
    assert office_packages.deb_payload(deb_bytes(b"odd")) == b"odd"


@pytest.mark.parametrize(
    "blob",
    [
        b"PK\x03\x04 not an ar archive",
        office_packages.AR_MAGIC + ar_member("debian-binary", b"2.0\n"),
        office_packages.AR_MAGIC + ar_member("data.tar.xz", b"payload")[:-3],
    ],
)
def test_damaged_debs_are_rejected(blob):
    with pytest.raises(OpError) as caught:
        office_packages.deb_payload(blob)
    assert caught.value.data == {"tool": "deb"}


def test_extract_debs_keeps_the_office_tree_and_nothing_outside(tmp_path):
    bundle = write_bundle(tmp_path / "bundle.tar.gz")
    unpacked = tmp_path / "unpacked"
    unpacked.mkdir()
    seen: list[tuple[int, int]] = []
    office_packages.extract_debs(bundle, unpacked, lambda index, total: seen.append((index, total)))
    assert seen == [(0, 1)]
    assert (unpacked / OFFICE_ROOT / "program" / "soffice").is_file()
    assert not (unpacked / OFFICE_ROOT / "share" / "dict.txt").exists()
    assert not (unpacked / "usr" / "local" / "bin" / "libreoffice26.2").exists()
    assert not (tmp_path / "escaped.txt").exists()
    directory = tmp_path / "office"
    directory.mkdir()
    office_packages.flatten_office_tree(unpacked, directory)
    assert (directory / "program" / "soffice.bin").is_file()


def test_an_archive_without_packages_is_rejected(tmp_path):
    empty = tmp_path / "empty.tar.gz"
    with tarfile.open(empty, "w:gz"):
        pass
    with pytest.raises(OpError):
        office_packages.extract_debs(empty, tmp_path, lambda *_args: None)
    broken = tmp_path / "broken.tar.gz"
    broken.write_bytes(b"not gzip")
    with pytest.raises(OpError) as caught:
        office_packages.extract_debs(broken, tmp_path, lambda *_args: None)
    assert caught.value.data == {"tool": "deb"}


def linux_install(monkeypatch, tmp_path, checksum: str | None):
    bundle = write_bundle(tmp_path / "source.tar.gz")
    monkeypatch.setenv("VIVEPDF_OFFICE_DIR", str(tmp_path / "office"))
    monkeypatch.setattr(office_download.sys, "platform", "linux")
    monkeypatch.setattr(office_download.platform, "machine", lambda: "x86_64")
    monkeypatch.setattr(office_download, "candidate_versions", lambda: ["26.2.6"])
    monkeypatch.setattr(office, "MIN_INSTALLER_BYTES", 1)
    urls: list[str] = []

    def download(url, target, _progress):
        urls.append(url)
        target.write_bytes(bundle.read_bytes())
        return target.stat().st_size

    real = hashlib.sha256(bundle.read_bytes()).hexdigest()
    monkeypatch.setattr(office_download, "download", download)
    monkeypatch.setattr(office_download, "expected_checksum", lambda _url: checksum or real)
    return urls


def test_linux_install_unpacks_the_verified_packages(monkeypatch, tmp_path):
    urls = linux_install(monkeypatch, tmp_path, None)
    status = office.office_install(office.OfficeInstallParams(), silent_progress())
    assert urls[0].endswith("/deb/x86_64/LibreOffice_26.2.6_Linux_x86-64_deb.tar.gz")
    assert status.installed is True
    assert status.source == "managed"
    assert status.supported is True
    assert Path(status.path) == tmp_path / "office" / "program" / "soffice"


def test_linux_install_with_a_wrong_checksum_leaves_nothing(monkeypatch, tmp_path):
    linux_install(monkeypatch, tmp_path, "0" * 64)
    with pytest.raises(OpError) as caught:
        office.office_install(office.OfficeInstallParams(), silent_progress())
    assert caught.value.data == {"tool": "sha256"}
    assert not (tmp_path / "office").exists()


def test_linux_install_stages_beside_the_office_folder_and_clears_old_staging(
    monkeypatch, tmp_path
):
    urls = linux_install(monkeypatch, tmp_path, None)
    stale = tmp_path / f"{office.STAGING_PREFIX}crashed"
    stale.mkdir()
    (stale / "libreoffice.deb").write_bytes(b"left over")
    seen: list[Path] = []
    real_extract = office_packages.extract_debs

    def extract(tarball, destination, on_package):
        seen.append(tarball)
        real_extract(tarball, destination, on_package)

    monkeypatch.setattr(office_packages, "extract_debs", extract)
    office.office_install(office.OfficeInstallParams(), silent_progress())
    assert urls
    assert seen[0].parent.parent == tmp_path
    assert seen[0].parent.name.startswith(office.STAGING_PREFIX)
    assert sorted(path.name for path in tmp_path.iterdir()) == ["office", "source.tar.gz"]


class ToolRecorder:
    def __init__(self, failing: str | None = None) -> None:
        self.calls: list[list[str]] = []
        self.failing = failing

    def __call__(self, arguments, _timeout, tool, env=None):
        self.calls.append(arguments)
        if tool == self.failing:
            raise OpError(ErrorCode.EXTERNAL_TOOL_FAILED, f"{tool} failed", {"tool": tool})
        if arguments[:2] == ["hdiutil", "attach"]:
            mount = Path(arguments[arguments.index("-mountpoint") + 1])
            (mount / "LibreOffice.app" / "Contents" / "MacOS").mkdir(parents=True)
        if tool == "ditto":
            target = Path(arguments[2]) / "Contents" / "MacOS"
            target.mkdir(parents=True)
            (target / "soffice").write_text("stub", encoding="utf-8")


def test_mac_bundle_is_signature_checked_before_it_is_copied(monkeypatch, tmp_path):
    recorder = ToolRecorder()
    monkeypatch.setattr(office_packages, "run_tool", recorder)
    directory = tmp_path / "office"
    directory.mkdir()
    office_packages.install_app_bundle(tmp_path / "lo.dmg", directory, tmp_path / "mount")
    tools = [call[0] for call in recorder.calls]
    assert tools == ["hdiutil", "codesign", "ditto", "hdiutil"]
    assert recorder.calls[-1][1] == "detach"
    codesign = recorder.calls[1]
    assert "--strict" in codesign
    assert any("anchor apple generic" in part for part in codesign)
    assert any('subject.O] = "The Document Foundation"' in part for part in codesign)
    assert (directory / "LibreOffice.app" / "Contents" / "MacOS" / "soffice").is_file()


def test_an_unsigned_mac_bundle_is_never_copied_and_the_image_is_detached(monkeypatch, tmp_path):
    recorder = ToolRecorder(failing="codesign")
    monkeypatch.setattr(office_packages, "run_tool", recorder)
    directory = tmp_path / "office"
    directory.mkdir()
    with pytest.raises(OpError):
        office_packages.install_app_bundle(tmp_path / "lo.dmg", directory, tmp_path / "mount")
    tools = [call[0] for call in recorder.calls]
    assert "ditto" not in tools
    assert recorder.calls[-1][:2] == ["hdiutil", "detach"]
    assert list(directory.iterdir()) == []


def test_managed_mac_app_bundle_is_found(monkeypatch, tmp_path):
    managed = tmp_path / "office"
    binary = managed / "LibreOffice.app" / "Contents" / "MacOS" / "soffice"
    binary.parent.mkdir(parents=True)
    binary.write_text("stub", encoding="utf-8")
    monkeypatch.setenv("VIVEPDF_OFFICE_DIR", str(managed))
    monkeypatch.setattr(libreoffice.sys, "platform", "darwin")
    assert libreoffice.find_managed_soffice() == binary


@pytest.mark.skipif(sys.platform == "win32", reason="exec bits are POSIX-only")
def test_extracted_launcher_stays_executable(tmp_path):
    bundle = write_bundle(tmp_path / "bundle.tar.gz")
    unpacked = tmp_path / "unpacked"
    unpacked.mkdir()
    office_packages.extract_debs(bundle, unpacked, lambda *_args: None)
    launcher = unpacked / OFFICE_ROOT / "program" / "soffice"
    assert launcher.stat().st_mode & 0o100


def test_a_failed_reinstall_keeps_the_working_copy(monkeypatch, tmp_path):
    linux_install(monkeypatch, tmp_path, "0" * 64)
    working = tmp_path / "office" / "program"
    working.mkdir(parents=True)
    (working / "soffice").write_text("stub", encoding="utf-8")
    with pytest.raises(OpError):
        office.office_install(office.OfficeInstallParams(), silent_progress())
    assert (working / "soffice").read_text(encoding="utf-8") == "stub"
    assert not (tmp_path / "office.new").exists()


def test_a_reinstall_replaces_the_old_copy_only_once_the_new_one_works(monkeypatch, tmp_path):
    linux_install(monkeypatch, tmp_path, None)
    old = tmp_path / "office" / "leftover.txt"
    old.parent.mkdir(parents=True)
    old.write_text("old", encoding="utf-8")
    status = office.office_install(office.OfficeInstallParams(), silent_progress())
    assert status.installed is True
    assert not old.exists()
    assert (tmp_path / "office" / "program" / "soffice").is_file()
    assert not (tmp_path / "office.old").exists()
    assert not (tmp_path / "office.new").exists()
