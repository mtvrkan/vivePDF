import contextlib
import itertools
import os
import shutil
import sys
import tempfile
import zipfile
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import IO

from vivepdf._data_home import unix_data_home
from vivepdf.external._process import run_tool, system_environment
from vivepdf.rpc.errors import ErrorCode, OpError

OFFICE_EXTENSIONS = {
    "doc",
    "docx",
    "dot",
    "dotx",
    "odt",
    "ott",
    "rtf",
    "xls",
    "xlsx",
    "ods",
    "ots",
    "csv",
    "ppt",
    "pptx",
    "odp",
    "otp",
    "wpd",
    "pages",
    "numbers",
    "key",
}

CONVERT_TIMEOUT = 240.0


def clean_environment() -> dict[str, str]:
    return system_environment()


def conversion_environment() -> dict[str, str]:
    return {**clean_environment(), "SAL_DISABLE_OPENCL": "1"}


def managed_office_dir() -> Path:
    if override := os.environ.get("VIVEPDF_OFFICE_DIR"):
        return Path(override)
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "vivePDF" / "libreoffice"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "vivePDF" / "libreoffice"
    return unix_data_home() / "vivepdf" / "libreoffice"


def _managed_candidates() -> list[Path]:
    return office_candidates(managed_office_dir())


def office_candidates(base: Path) -> list[Path]:
    if not base.is_dir():
        return []
    names = ("soffice.exe",) if sys.platform == "win32" else ("soffice",)
    direct = [base / "program" / name for name in names]
    if sys.platform == "darwin":
        direct.insert(0, base / "LibreOffice.app" / "Contents" / "MacOS" / "soffice")
    found = [item for item in direct if item.is_file()]
    if found:
        return found
    return [item for name in names for item in sorted(base.rglob(f"program/{name}"))]


def find_managed_soffice() -> Path | None:
    for candidate in _managed_candidates():
        if candidate.is_file():
            return candidate
    return None


def _bundled_candidates() -> list[Path]:
    resources = os.environ.get("VIVEPDF_RESOURCES_DIR")
    if not resources:
        return []
    base = Path(resources) / "libreoffice"
    if sys.platform == "win32":
        return [base / "program" / "soffice.exe"]
    if sys.platform == "darwin":
        app_binary = base / "LibreOffice.app" / "Contents" / "MacOS" / "soffice"
        return [app_binary, base / "program" / "soffice"]
    return [base / "program" / "soffice", base / "opt" / "libreoffice" / "program" / "soffice"]


def _candidates() -> list[Path]:
    candidates: list[Path] = []
    if os.environ.get("VIVEPDF_DEV") == "1" and (override := os.environ.get("VIVEPDF_SOFFICE")):
        candidates.append(Path(override))
    candidates.extend(_managed_candidates())
    for name in ("soffice", "libreoffice", "soffice.exe"):
        found = shutil.which(name)
        if found:
            candidates.append(Path(found))
    if sys.platform == "win32":
        for root in (os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)")):
            if root:
                candidates.append(Path(root) / "LibreOffice" / "program" / "soffice.exe")
    elif sys.platform == "darwin":
        candidates.append(Path("/Applications/LibreOffice.app/Contents/MacOS/soffice"))
        candidates.append(
            Path.home() / "Applications" / "LibreOffice.app" / "Contents" / "MacOS" / "soffice"
        )
    else:
        candidates.extend(
            Path(item)
            for item in (
                "/usr/bin/soffice",
                "/usr/bin/libreoffice",
                "/usr/lib/libreoffice/program/soffice",
                "/snap/bin/libreoffice",
                "/opt/libreoffice/program/soffice",
            )
        )
    candidates.extend(_bundled_candidates())
    return candidates


def find_soffice() -> Path | None:
    for candidate in _candidates():
        if candidate.is_file():
            return candidate
    return None


LOCKED_SETTINGS = (
    ("/org.openoffice.Office.Common/Security/Scripting", "MacroSecurityLevel", "3"),
    ("/org.openoffice.Office.Common/Security/Scripting", "DisableMacrosExecution", "true"),
    ("/org.openoffice.Office.Common/Security/Scripting", "BlockUntrustedRefererLinks", "true"),
    ("/org.openoffice.Office.Writer/Content/Update", "Link", "2"),
    ("/org.openoffice.Office.Calc/Content/Update", "Link", "1"),
    ("/org.openoffice.Office.Calc/Formula/Load", "OOXMLRecalcMode", "1"),
    ("/org.openoffice.Office.Calc/Formula/Load", "ODFRecalcMode", "1"),
)
REGISTRY_HEADER = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<oor:items xmlns:oor="http://openoffice.org/2001/registry" '
    'xmlns:xs="http://www.w3.org/2001/XMLSchema" '
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'
)


def _registry_item(path: str, name: str, value: str) -> str:
    return (
        f'<item oor:path="{path}"><prop oor:name="{name}" oor:op="fuse">'
        f"<value>{value}</value></prop></item>"
    )


def _registry_document() -> str:
    body = "".join(f"  {_registry_item(*setting)}\n" for setting in LOCKED_SETTINGS)
    return REGISTRY_HEADER + body + "</oor:items>\n"


def registry_locked(text: str) -> bool:
    return all(_registry_item(*setting) in text for setting in LOCKED_SETTINGS)


def lock_down_profile(profile: Path) -> Path:
    registry = profile / "user" / "registrymodifications.xcu"
    try:
        registry.parent.mkdir(parents=True, exist_ok=True)
        if registry.is_file() and registry_locked(registry.read_text(encoding="utf-8")):
            return registry
        registry.write_text(_registry_document(), encoding="utf-8")
    except OSError:
        return registry
    return registry


PROFILE_POOL_SIZE = 2
LEGACY_PROFILE = "vivepdf-libreoffice-profile"


PROFILE_ROOT_LIMIT = 110


def profiles_root() -> Path:
    from vivepdf.ops._appdata import user_data_dir

    preferred = user_data_dir() / "office-profiles"
    if sys.platform != "win32" or len(str(preferred)) <= PROFILE_ROOT_LIMIT:
        return preferred
    fallback = Path(tempfile.gettempdir()) / "vivepdf-office"
    if len(str(fallback)) <= PROFILE_ROOT_LIMIT:
        return fallback
    raise OpError(
        ErrorCode.EXTERNAL_TOOL_FAILED,
        "The LibreOffice profile folder path is too long for Windows",
        {"tool": "LibreOffice", "reason": "officeProfilePath", "path": str(preferred)},
    )


def _try_lock(path: Path) -> IO[bytes] | None:
    handle = path.open("a+b")
    try:
        if sys.platform == "win32":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle


def _unlock(handle: IO[bytes]) -> None:
    with contextlib.suppress(OSError):
        if sys.platform == "win32":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    handle.close()


def _remove_legacy_profile() -> None:
    legacy = Path(tempfile.gettempdir()) / LEGACY_PROFILE
    if legacy.is_dir():
        shutil.rmtree(legacy, ignore_errors=True)


@contextlib.contextmanager
def profile_slot() -> Iterator[Path]:
    root = profiles_root()
    root.mkdir(parents=True, exist_ok=True)
    _remove_legacy_profile()
    for index in itertools.count():
        lock_path = root / f"p{index}.lock"
        handle = _try_lock(lock_path)
        if handle is None:
            continue
        slot = root / f"p{index}"
        try:
            yield slot
        finally:
            if index >= PROFILE_POOL_SIZE:
                shutil.rmtree(slot, ignore_errors=True)
            _unlock(handle)
            if index >= PROFILE_POOL_SIZE:
                with contextlib.suppress(OSError):
                    lock_path.unlink()
        return


def profile_arguments(slot: Path) -> list[str]:
    return [
        f"-env:UserInstallation={slot.resolve().as_uri()}",
        f"-env:UNO_SHARED_PACKAGES_CACHE={(slot / 'shared').resolve().as_uri()}",
    ]


OLE_SIGNATURE = bytes.fromhex("d0cf11e0a1b11ae1")
OOXML_EXTENSIONS = {"docx", "dotx", "xlsx", "pptx"}
ODF_EXTENSIONS = {"odt", "ott", "ods", "ots", "odp", "otp"}
ENCRYPTED_PACKAGE_NAME = "EncryptedPackage".encode("utf-16-le")
ODF_MANIFEST = "META-INF/manifest.xml"
ODF_ENCRYPTION_MARKER = b"encryption-data"
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
SCAN_CHUNK = 1024 * 1024
UNREADABLE_MARKER = "could not be loaded"


def _contains(source: Path, needle: bytes) -> bool:
    overlap = len(needle) - 1
    tail = b""
    with source.open("rb") as handle:
        while chunk := handle.read(SCAN_CHUNK):
            if needle in tail + chunk:
                return True
            tail = chunk[-overlap:]
    return False


def _is_encrypted_ole(source: Path) -> bool:
    with source.open("rb") as handle:
        if handle.read(len(OLE_SIGNATURE)) != OLE_SIGNATURE:
            return False
    return _contains(source, ENCRYPTED_PACKAGE_NAME)


def _is_encrypted_odf(source: Path) -> bool:
    try:
        with zipfile.ZipFile(source) as archive:
            info = archive.getinfo(ODF_MANIFEST)
            if info.file_size > MAX_MANIFEST_BYTES:
                return False
            return ODF_ENCRYPTION_MARKER in archive.read(info)
    except (KeyError, zipfile.BadZipFile, RuntimeError, ValueError, NotImplementedError):
        return False


def is_encrypted_office(source: Path) -> bool:
    extension = source.suffix.lower().lstrip(".")
    try:
        if extension in OOXML_EXTENSIONS:
            return _is_encrypted_ole(source)
        if extension in ODF_EXTENSIONS:
            return _is_encrypted_odf(source)
    except OSError:
        return False
    return False


def _unreadable(source: Path) -> OpError:
    return OpError(
        ErrorCode.INVALID_PARAMS,
        f"LibreOffice could not read {source.name}",
        {"reason": "officeUnreadable", "tool": "LibreOffice"},
    )


def convert_to_pdf(
    source: Path,
    output_dir: Path,
    infilter: str | None = None,
    check_cancelled: Callable[[], None] | None = None,
) -> Path:
    soffice = find_soffice()
    if soffice is None:
        raise OpError(ErrorCode.LIBREOFFICE_MISSING, "LibreOffice was not found")
    if is_encrypted_office(source):
        raise OpError(
            ErrorCode.ENCRYPTED,
            f"the document is password protected: {source.name}",
            {"reason": "officeEncrypted"},
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        with profile_slot() as profile:
            lock_down_profile(profile)
            arguments = [
                str(soffice),
                "--headless",
                "--norestore",
                "--nolockcheck",
                *profile_arguments(profile),
            ]
            if infilter:
                arguments.append(f"--infilter={infilter}")
            arguments.extend(["--convert-to", "pdf", "--outdir", str(output_dir), str(source)])
            completed = run_tool(
                arguments,
                timeout=CONVERT_TIMEOUT,
                tool="LibreOffice",
                env=conversion_environment(),
                check_cancelled=check_cancelled,
            )
    except OpError as error:
        detail = str((error.data or {}).get("detail") or "")
        if UNREADABLE_MARKER in detail:
            raise _unreadable(source) from error
        raise
    produced = output_dir / f"{source.stem}.pdf"
    if not produced.is_file():
        if UNREADABLE_MARKER in f"{completed.stdout or ''}{completed.stderr or ''}":
            raise _unreadable(source)
        raise OpError(
            ErrorCode.EXTERNAL_TOOL_FAILED,
            "LibreOffice produced no output",
            {"tool": "LibreOffice"},
        )
    return produced
