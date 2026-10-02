import contextlib
import io
import json
import os
import shutil
import subprocess
import tarfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from vivepdf.external._process import run_tool, system_environment
from vivepdf.rpc.errors import ErrorCode, OpError

AR_MAGIC = b"!<arch>\n"
AR_HEADER_BYTES = 60
DEB_FOLDER = "DEBS"
SKIPPED_DEB_WORDS = (
    "debian-menus",
    "desktop-integration",
    "onlineupdate",
    "dict-",
    "pyuno",
    "python-script-provider",
    "extension-nlpsolver",
    "extension-report-builder",
    "extension-mediawiki-publisher",
    "librelogo",
    "firebird",
    "postgresql-sdbc",
    "gnome-integration",
    "kde-integration",
)
DMG_TIMEOUT = 300.0
COPY_TIMEOUT = 900.0
CODESIGN_TIMEOUT = 600.0
APP_NAME = "LibreOffice.app"
EXTRACT_TIMEOUT = 900.0
TRUSTED_PUBLISHER = "The Document Foundation"
TRUSTED_ORGANIZATION = f"O={TRUSTED_PUBLISHER}"
SIGNATURE_TIMEOUT = 120.0
SIGNED_FILE_VARIABLE = "VIVEPDF_SIGNED_FILE"
SIGNATURE_SCRIPT = (
    f"$signature = Get-AuthenticodeSignature -LiteralPath $env:{SIGNED_FILE_VARIABLE}; "
    "$certificate = $signature.SignerCertificate; "
    "$name = if ($certificate) { $certificate.GetNameInfo("
    "[System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) } "
    "else { '' }; "
    "ConvertTo-Json -Compress @{status = [string]$signature.Status; "
    "kind = [string]$signature.SignatureType; name = [string]$name; "
    "subject = [string]$certificate.Subject}"
)
SIGNING_REQUIREMENT = (
    "=anchor apple generic"
    " and certificate 1[field.1.2.840.113635.100.6.2.6] exists"
    " and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
    ' and certificate leaf[subject.O] = "The Document Foundation"'
)


def _package_error(message: str, tool: str) -> OpError:
    return OpError(ErrorCode.EXTERNAL_TOOL_FAILED, message, {"tool": tool})


def wanted_deb(name: str) -> bool:
    parts = Path(name).parts
    if len(parts) < 2 or parts[-2] != DEB_FOLDER or not name.endswith(".deb"):
        return False
    return not any(word in parts[-1] for word in SKIPPED_DEB_WORDS)


def deb_payload(deb: bytes) -> bytes:
    if not deb.startswith(AR_MAGIC):
        raise _package_error("package is not a Debian archive", "deb")
    position = len(AR_MAGIC)
    while position + AR_HEADER_BYTES <= len(deb):
        header = deb[position : position + AR_HEADER_BYTES]
        name = header[:16].decode("ascii", "replace").strip().rstrip("/")
        try:
            size = int(header[48:58].decode("ascii").strip())
        except ValueError as error:
            raise _package_error("package header is damaged", "deb") from error
        start = position + AR_HEADER_BYTES
        if size < 0 or start + size > len(deb):
            raise _package_error("package is truncated", "deb")
        if name.startswith("data.tar"):
            return deb[start : start + size]
        position = start + size + (size & 1)
    raise _package_error("package has no data archive", "deb")


def _inside_only(member: tarfile.TarInfo, destination: str) -> tarfile.TarInfo | None:
    try:
        return tarfile.data_filter(member, destination)
    except tarfile.FilterError:
        return None


def extract_debs(tarball: Path, destination: Path, on_package: Callable[[int, int], None]) -> None:
    try:
        with tarfile.open(tarball, "r:*") as outer:
            packages = [member for member in outer.getmembers() if wanted_deb(member.name)]
            if not packages:
                raise _package_error("archive holds no LibreOffice packages", "deb")
            for index, member in enumerate(packages):
                on_package(index, len(packages))
                handle = outer.extractfile(member)
                if handle is None:
                    raise _package_error("package could not be read", "deb")
                payload = deb_payload(handle.read())
                with tarfile.open(fileobj=io.BytesIO(payload), mode="r:*") as inner:
                    inner.extractall(destination, filter=_inside_only)
    except (tarfile.TarError, EOFError, OSError) as error:
        raise _package_error(f"archive could not be unpacked: {error}", "deb") from error


def flatten_office_tree(unpacked: Path, directory: Path) -> None:
    roots = sorted(unpacked.glob("opt/libreoffice*/program/soffice"))
    if not roots:
        raise _package_error("LibreOffice was not found in the packages", "deb")
    root = roots[0].parent.parent
    for item in root.iterdir():
        shutil.move(str(item), str(directory / item.name))


def verify_app_signature(app: Path) -> None:
    run_tool(
        [
            "codesign",
            "--verify",
            "--deep",
            "--strict",
            f"--test-requirement={SIGNING_REQUIREMENT}",
            str(app),
        ],
        CODESIGN_TIMEOUT,
        "codesign",
        env=system_environment(),
    )


def _detach(mount: Path) -> None:
    with contextlib.suppress(OpError):
        run_tool(
            ["hdiutil", "detach", str(mount), "-force"],
            DMG_TIMEOUT,
            "hdiutil",
            env=system_environment(),
        )


def install_app_bundle(image: Path, directory: Path, mount: Path) -> None:
    mount.mkdir(parents=True, exist_ok=True)
    run_tool(
        [
            "hdiutil",
            "attach",
            "-nobrowse",
            "-readonly",
            "-noautoopen",
            "-mountpoint",
            str(mount),
            str(image),
        ],
        DMG_TIMEOUT,
        "hdiutil",
        env=system_environment(),
    )
    try:
        app = mount / APP_NAME
        if not app.is_dir():
            raise _package_error("disk image holds no LibreOffice.app", "hdiutil")
        verify_app_signature(app)
        run_tool(
            ["ditto", str(app), str(directory / APP_NAME)],
            COPY_TIMEOUT,
            "ditto",
            env=system_environment(),
        )
    finally:
        _detach(mount)


@dataclass(frozen=True)
class MsiSignature:
    status: str
    kind: str
    name: str
    subject: str

    def trusted(self) -> bool:
        organizations = [part.strip() for part in self.subject.split(",")]
        return (
            self.status == "Valid"
            and self.kind == "Authenticode"
            and self.name == TRUSTED_PUBLISHER
            and TRUSTED_ORGANIZATION in organizations
        )


def msi_signature(installer: Path) -> MsiSignature:
    command = ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", SIGNATURE_SCRIPT]
    environment = {**os.environ, SIGNED_FILE_VARIABLE: str(installer)}
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=SIGNATURE_TIMEOUT,
            check=False,
            env=environment,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED,
            f"signature check failed: {error}",
            {"tool": "authenticode", "reason": "officeUnsigned", "phase": "verify"},
        ) from error
    try:
        payload = json.loads(completed.stdout or "{}")
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return MsiSignature(
        status=str(payload.get("status") or ""),
        kind=str(payload.get("kind") or ""),
        name=str(payload.get("name") or ""),
        subject=str(payload.get("subject") or ""),
    )


def verify_msi_publisher(installer: Path) -> None:
    signature = msi_signature(installer)
    if not signature.trusted():
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED,
            "installer is not signed by The Document Foundation",
            {
                "tool": "authenticode",
                "reason": "officeUnsigned",
                "phase": "verify",
                "status": signature.status,
                "subject": signature.subject,
            },
        )


def extract_msi(installer: Path, directory: Path) -> None:
    command = [
        "msiexec.exe",
        "/a",
        str(installer),
        "/qn",
        f"TARGETDIR={directory}",
    ]
    try:
        completed = subprocess.run(  # noqa: S603
            command,
            capture_output=True,
            timeout=EXTRACT_TIMEOUT,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED, f"extract failed: {error}", {"tool": "msiexec"}
        ) from error
    if completed.returncode != 0:
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED,
            f"msiexec exited with {completed.returncode}",
            {"tool": "msiexec", "code": completed.returncode},
        )
