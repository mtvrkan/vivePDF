import hashlib
import platform
import re
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.error import URLError

from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress

STABLE_INDEX_URL = "https://download.documentfoundation.org/libreoffice/stable/"
PINNED_VERSION = "26.2.6"
DOWNLOAD_TIMEOUT = 120.0
INDEX_TIMEOUT = 20.0
CHUNK_SIZE = 1024 * 1024
USER_AGENT = "vivePDF"
VERSION_PATTERN = re.compile(r"(\d+\.\d+\.\d+)/")
DOWNLOAD_PHASE = 0.85
CHECKSUM_SUFFIX = ".sha256"
CHECKSUM_PATTERN = re.compile(r"^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$")
MAX_CHECKSUM_BYTES = 4096


PackageKind = Literal["msi", "dmg", "deb"]


@dataclass(frozen=True)
class OfficePackage:
    folder: str
    template: str
    kind: PackageKind

    def file_name(self, version: str) -> str:
        return self.template.format(version=version)


WINDOWS_PACKAGE = OfficePackage("win/x86_64", "LibreOffice_{version}_Win_x86-64.msi", "msi")
PACKAGES = {
    ("win32", "x86_64"): WINDOWS_PACKAGE,
    ("win32", "aarch64"): WINDOWS_PACKAGE,
    ("darwin", "x86_64"): OfficePackage(
        "mac/x86_64", "LibreOffice_{version}_MacOS_x86-64.dmg", "dmg"
    ),
    ("darwin", "aarch64"): OfficePackage(
        "mac/aarch64", "LibreOffice_{version}_MacOS_aarch64.dmg", "dmg"
    ),
    ("linux", "x86_64"): OfficePackage(
        "deb/x86_64", "LibreOffice_{version}_Linux_x86-64_deb.tar.gz", "deb"
    ),
    ("linux", "aarch64"): OfficePackage(
        "deb/aarch64", "LibreOffice_{version}_Linux_aarch64_deb.tar.gz", "deb"
    ),
}
MACHINE_ALIASES = {
    "x86_64": "x86_64",
    "amd64": "x86_64",
    "x64": "x86_64",
    "aarch64": "aarch64",
    "arm64": "aarch64",
}


def current_package() -> OfficePackage | None:
    machine = MACHINE_ALIASES.get(platform.machine().casefold())
    if machine is None:
        return None
    return PACKAGES.get((sys.platform, machine))


def installer_url(version: str, package: OfficePackage = WINDOWS_PACKAGE) -> str:
    return f"{STABLE_INDEX_URL}{version}/{package.folder}/{package.file_name(version)}"


def expected_checksum(url: str) -> str:
    request = urllib.request.Request(url + CHECKSUM_SUFFIX, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=INDEX_TIMEOUT) as response:  # noqa: S310
            body = response.read(MAX_CHECKSUM_BYTES).decode("ascii", "replace")
    except (URLError, OSError) as error:
        raise OpError(ErrorCode.NETWORK, f"checksum download failed: {error}") from error
    matched = CHECKSUM_PATTERN.match(body.strip())
    if not matched or matched.group(2) != url.rsplit("/", 1)[-1]:
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED, "checksum file is malformed", {"tool": "sha256"}
        )
    return matched.group(1).lower()


def _file_checksum(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def verify_checksum(url: str, installer: Path) -> None:
    if _file_checksum(installer) != expected_checksum(url):
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED,
            "installer does not match the published checksum",
            {"tool": "sha256"},
        )


def _newest_versions() -> list[str]:
    request = urllib.request.Request(STABLE_INDEX_URL, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=INDEX_TIMEOUT) as response:  # noqa: S310
            body = response.read().decode("utf-8", "replace")
    except (URLError, OSError):
        return []
    found = sorted(
        {match for match in VERSION_PATTERN.findall(body)},
        key=lambda item: tuple(int(part) for part in item.split(".")),
        reverse=True,
    )
    return found[:3]


def candidate_versions() -> list[str]:
    versions = _newest_versions()
    if PINNED_VERSION not in versions:
        versions.append(PINNED_VERSION)
    return versions


def download(url: str, target: Path, progress: Progress) -> int:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        response = urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT)  # noqa: S310
    except (URLError, OSError) as error:
        raise OpError(ErrorCode.NETWORK, f"download failed: {error}") from error
    received = 0
    with response, target.open("wb") as handle:
        total_header = response.headers.get("Content-Length")
        total = int(total_header) if total_header else None
        next_report = CHUNK_SIZE
        while True:
            progress.check_cancelled()
            try:
                chunk = response.read(CHUNK_SIZE)
            except OSError as error:
                raise OpError(ErrorCode.NETWORK, f"download failed: {error}") from error
            if not chunk:
                break
            handle.write(chunk)
            received += len(chunk)
            if received >= next_report:
                progress.report(
                    min(DOWNLOAD_PHASE, received / total * DOWNLOAD_PHASE) if total else 0.4,
                    "progress.downloading",
                    {"received": received, "total": total},
                )
                next_report += CHUNK_SIZE
    return received
