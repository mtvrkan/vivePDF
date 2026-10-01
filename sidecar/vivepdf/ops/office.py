import shutil
import tempfile
from pathlib import Path

from vivepdf.external import libreoffice, office_download, office_packages
from vivepdf.external.office_download import DOWNLOAD_PHASE, OfficePackage, PackageKind
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MIN_INSTALLER_BYTES = 100 * 1024 * 1024
PRUNED_DIRECTORIES = ("help", "readmes")
PRUNED_PROGRAM_FILES = ("python.exe", "python313.dll")
DEB_PHASE = 0.1
EXTRACT_TOOLS: dict[PackageKind, str] = {"msi": "msiexec", "deb": "deb", "dmg": "hdiutil"}
FRESH_SUFFIX = ".new"
RETIRED_SUFFIX = ".old"
STAGING_PREFIX = ".vivepdf-office-"


def _directory_size(directory: Path) -> int:
    total = 0
    for item in directory.rglob("*"):
        if item.is_file():
            try:
                total += item.stat().st_size
            except OSError:
                continue
    return total


def _prune(directory: Path) -> None:
    for leftover in directory.glob("*.msi"):
        leftover.unlink(missing_ok=True)
    for name in PRUNED_DIRECTORIES:
        shutil.rmtree(directory / name, ignore_errors=True)
    for name in PRUNED_PROGRAM_FILES:
        (directory / "program" / name).unlink(missing_ok=True)


class OfficeStatusParams(RpcModel):
    pass


class OfficeStatusResult(RpcModel):
    installed: bool
    source: str | None
    path: str | None
    directory: str
    size_bytes: int
    supported: bool


def _status() -> OfficeStatusResult:
    directory = libreoffice.managed_office_dir()
    managed = libreoffice.find_managed_soffice()
    path = managed or libreoffice.find_soffice()
    return OfficeStatusResult(
        installed=path is not None,
        source="managed" if managed is not None else ("system" if path is not None else None),
        path=str(path) if path else None,
        directory=str(directory),
        size_bytes=_directory_size(directory) if directory.is_dir() else 0,
        supported=office_download.current_package() is not None,
    )


@op("system.office_status", OfficeStatusParams)
def office_status(_params: OfficeStatusParams, _progress: Progress) -> OfficeStatusResult:
    return _status()


class OfficeInstallParams(RpcModel):
    pass


def _unpack_debs(tarball: Path, directory: Path, staging: Path, progress: Progress) -> None:
    unpacked = staging / "unpacked"
    unpacked.mkdir()

    def on_package(index: int, total: int) -> None:
        progress.check_cancelled()
        share = (1.0 - DOWNLOAD_PHASE - DEB_PHASE) * index / total
        progress.report(DOWNLOAD_PHASE + share, "progress.installing", {})

    office_packages.extract_debs(tarball, unpacked, on_package)
    office_packages.flatten_office_tree(unpacked, directory)


def _unpack(
    package: OfficePackage, installer: Path, directory: Path, staging: Path, progress: Progress
) -> None:
    if package.kind == "msi":
        office_packages.verify_msi_publisher(installer)
        progress.report(DOWNLOAD_PHASE, "progress.installing", {})
        office_packages.extract_msi(installer, directory)
    elif package.kind == "deb":
        progress.report(DOWNLOAD_PHASE, "progress.installing", {})
        _unpack_debs(installer, directory, staging, progress)
    else:
        progress.report(DOWNLOAD_PHASE, "progress.installing", {})
        office_packages.install_app_bundle(installer, directory, staging / "mount")


def _office_in_use(error: OSError) -> OpError:
    return OpError(
        ErrorCode.PERMISSION_DENIED,
        "LibreOffice is in use and cannot be replaced",
        {"reason": "officeInUse"},
    )


def _swap_in(fresh: Path, directory: Path) -> None:
    retired = directory.with_name(f"{directory.name}{RETIRED_SUFFIX}")
    shutil.rmtree(retired, ignore_errors=True)
    if directory.exists():
        try:
            directory.rename(retired)
        except OSError as error:
            raise _office_in_use(error) from error
    try:
        fresh.rename(directory)
    except OSError as error:
        if retired.exists():
            retired.rename(directory)
        raise _office_in_use(error) from error
    shutil.rmtree(retired, ignore_errors=True)


def _drop_stale_staging(parent: Path) -> None:
    for leftover in parent.glob(f"{STAGING_PREFIX}*"):
        shutil.rmtree(leftover, ignore_errors=True)


@op("system.office_install", OfficeInstallParams)
def office_install(_params: OfficeInstallParams, progress: Progress) -> OfficeStatusResult:
    package = office_download.current_package()
    if package is None:
        raise OpError(ErrorCode.UNSUPPORTED, "LibreOffice download is not available here")
    directory = libreoffice.managed_office_dir()
    fresh = directory.with_name(f"{directory.name}{FRESH_SUFFIX}")
    shutil.rmtree(fresh, ignore_errors=True)
    fresh.mkdir(parents=True, exist_ok=True)
    _drop_stale_staging(directory.parent)
    staging = Path(tempfile.mkdtemp(prefix=STAGING_PREFIX, dir=directory.parent))
    installer = staging / f"libreoffice.{package.kind}"
    try:
        received = 0
        url = ""
        last_error: OpError | None = None
        for version in office_download.candidate_versions():
            url = office_download.installer_url(version, package)
            try:
                received = office_download.download(url, installer, progress)
            except OpError as error:
                last_error = error
                continue
            if received >= MIN_INSTALLER_BYTES:
                break
            last_error = OpError(ErrorCode.NETWORK, "installer download was incomplete")
        if received < MIN_INSTALLER_BYTES:
            raise last_error or OpError(ErrorCode.NETWORK, "installer download failed")
        office_download.verify_checksum(url, installer)
        _unpack(package, installer, fresh, staging, progress)
        _prune(fresh)
        if not libreoffice.office_candidates(fresh):
            raise OpError(
                ErrorCode.EXTERNAL_TOOL_FAILED,
                "LibreOffice was not found after extraction",
                {"tool": EXTRACT_TOOLS[package.kind]},
            )
        _swap_in(fresh, directory)
    except BaseException:
        shutil.rmtree(fresh, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    progress.report(1.0, "progress.installing", {})
    return _status()


class OfficeRemoveParams(RpcModel):
    pass


@op("system.office_remove", OfficeRemoveParams)
def office_remove(_params: OfficeRemoveParams, _progress: Progress) -> OfficeStatusResult:
    directory = libreoffice.managed_office_dir()
    if directory.is_dir():
        shutil.rmtree(directory, ignore_errors=True)
    return _status()
