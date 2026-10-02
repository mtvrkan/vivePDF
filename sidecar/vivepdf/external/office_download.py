import hashlib
import platform
import re
import sys
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass
from http.client import HTTPResponse
from pathlib import Path
from typing import Literal
from urllib.error import HTTPError, URLError

from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress

STABLE_INDEX_URL = "https://download.documentfoundation.org/libreoffice/stable/"
MIRRORS = (
    "https://ftp.fau.de/tdf/libreoffice/stable/",
    "https://ftp.gwdg.de/pub/tdf/libreoffice/stable/",
    "https://mirrors.dotsrc.org/tdf/libreoffice/stable/",
    "https://ftp.halifax.rwth-aachen.de/tdf/libreoffice/stable/",
    "https://ftp.linux.org.tr/tdf/libreoffice/stable/",
    "https://www.mirrorservice.org/sites/download.documentfoundation.org/tdf/libreoffice/stable/",
    "https://mirrors.ocf.berkeley.edu/tdf/libreoffice/stable/",
    STABLE_INDEX_URL,
)
PINNED_VERSION = "26.2.6"
NEWEST_VERSIONS = 3
INDEX_TIMEOUT = 8.0
INDEX_MAX_BYTES = 512 * 1024
PROBE_TIMEOUT = 10.0
READ_TIMEOUT = 60.0
CHECKSUM_TIMEOUT = 30.0
RESUME_ATTEMPTS = 2
MIN_INSTALLER_BYTES = 100 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
USER_AGENT = "vivePDF"
VERSION_PATTERN = re.compile(r"(\d+\.\d+\.\d+)/")
CONTENT_RANGE_PATTERN = re.compile(r"^bytes (\d+)-\d+/(\d+|\*)$")
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

    def path(self, version: str) -> str:
        return f"{version}/{self.folder}/{self.file_name(version)}"


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


class _HttpsOnlyRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.lower().startswith("https://"):
            raise URLError(f"refused to follow a redirect away from https: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(_HttpsOnlyRedirects)


def _open(request: urllib.request.Request, timeout: float) -> HTTPResponse:
    return _OPENER.open(request, timeout=timeout)


def _request(url: str, method: str = "GET", headers: dict[str, str] | None = None):
    return urllib.request.Request(
        url, method=method, headers={"User-Agent": USER_AGENT, **(headers or {})}
    )


def _download_error(message: str) -> OpError:
    return OpError(ErrorCode.NETWORK, message, {"reason": "officeDownload", "phase": "download"})


def current_package() -> OfficePackage | None:
    machine = MACHINE_ALIASES.get(platform.machine().casefold())
    if machine is None:
        return None
    return PACKAGES.get((sys.platform, machine))


def installer_url(version: str, package: OfficePackage = WINDOWS_PACKAGE) -> str:
    return f"{STABLE_INDEX_URL}{package.path(version)}"


def _version_key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def _versions_at(index_url: str) -> list[str]:
    try:
        with _open(_request(index_url), INDEX_TIMEOUT) as response:
            body = response.read(INDEX_MAX_BYTES).decode("utf-8", "replace")
    except (URLError, OSError, ValueError):
        return []
    return sorted(set(VERSION_PATTERN.findall(body)), key=_version_key, reverse=True)


def _newest_versions() -> list[str]:
    for mirror in MIRRORS:
        found = _versions_at(mirror)
        if found:
            return found[:NEWEST_VERSIONS]
    return []


def candidate_versions() -> list[str]:
    versions = _newest_versions()
    if PINNED_VERSION not in versions:
        versions.append(PINNED_VERSION)
    return versions


@dataclass(frozen=True)
class Probe:
    reachable: bool
    size: int | None


def probe(url: str) -> Probe:
    try:
        with _open(_request(url, "HEAD"), PROBE_TIMEOUT) as response:
            length = response.headers.get("Content-Length")
    except HTTPError:
        return Probe(True, None)
    except (URLError, OSError, ValueError):
        return Probe(False, None)
    try:
        size = int(length) if length else 0
    except ValueError:
        return Probe(True, None)
    return Probe(True, size if size >= MIN_INSTALLER_BYTES else None)


@dataclass(frozen=True)
class Source:
    version: str
    url: str
    size: int


def sources(package: OfficePackage, versions: list[str]) -> Iterator[Source]:
    unreachable: set[str] = set()
    for version in versions:
        for mirror in MIRRORS:
            if mirror in unreachable:
                continue
            url = f"{mirror}{package.path(version)}"
            found = probe(url)
            if not found.reachable:
                unreachable.add(mirror)
            elif found.size is not None:
                yield Source(version, url, found.size)


def _resume_offset(response: HTTPResponse, received: int) -> int:
    if response.status != 206:
        return 0
    matched = CONTENT_RANGE_PATTERN.match(response.headers.get("Content-Range", ""))
    if not matched or int(matched.group(1)) != received:
        raise _download_error("server resumed at the wrong position")
    return received


def _report(progress: Progress, received: int, total: int | None) -> None:
    share = min(DOWNLOAD_PHASE, received / total * DOWNLOAD_PHASE) if total else 0.4
    progress.report(share, "progress.downloading", {"received": received, "total": total})


def download(url: str, target: Path, progress: Progress, expected: int | None = None) -> int:
    received = 0
    attempts = 0
    next_report = CHUNK_SIZE
    with target.open("wb") as handle:
        while True:
            progress.check_cancelled()
            headers = {"Range": f"bytes={received}-"} if received else {}
            try:
                response = _open(_request(url, headers=headers), READ_TIMEOUT)
            except (URLError, OSError, ValueError) as error:
                if attempts >= RESUME_ATTEMPTS:
                    raise _download_error(f"download failed: {error}") from error
                attempts += 1
                continue
            with response:
                received = _resume_offset(response, received)
                handle.seek(received)
                handle.truncate()
                try:
                    while True:
                        progress.check_cancelled()
                        chunk = response.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        handle.write(chunk)
                        received += len(chunk)
                        if received >= next_report:
                            _report(progress, received, expected)
                            next_report += CHUNK_SIZE
                except OSError as error:
                    if attempts >= RESUME_ATTEMPTS:
                        raise _download_error(f"download failed: {error}") from error
                    attempts += 1
                    handle.flush()
                    continue
            if expected is None or received >= expected:
                return received
            if attempts >= RESUME_ATTEMPTS:
                raise _download_error("installer download was incomplete")
            attempts += 1


def expected_checksum(url: str) -> str:
    try:
        with _open(_request(url + CHECKSUM_SUFFIX), CHECKSUM_TIMEOUT) as response:
            body = response.read(MAX_CHECKSUM_BYTES).decode("ascii", "replace")
    except (URLError, OSError, ValueError) as error:
        raise OpError(
            ErrorCode.NETWORK,
            f"checksum download failed: {error}",
            {"reason": "officeChecksum", "phase": "verify", "tool": "sha256"},
        ) from error
    matched = CHECKSUM_PATTERN.match(body.strip())
    if not matched or matched.group(2) != url.rsplit("/", 1)[-1]:
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED,
            "checksum file is malformed",
            {"reason": "officeChecksum", "phase": "verify", "tool": "sha256"},
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
            {"reason": "officeChecksum", "phase": "verify", "tool": "sha256"},
        )
