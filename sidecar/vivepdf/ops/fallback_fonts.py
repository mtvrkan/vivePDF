import hashlib
import os
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from urllib.error import URLError

from vivepdf.ops._appdata import user_data_dir
from vivepdf.ops._output import replace_patiently, unlink_patiently
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

DOWNLOAD_BASE = "https://github.com/mtvrkan/vivePDF/releases/download/fonts-1"
FONTS_DIR_NAME = "fallback-fonts"
DOWNLOAD_TIMEOUT = 60.0
CHUNK_SIZE = 256 * 1024
USER_AGENT = "vivePDF"


@dataclass(frozen=True)
class FontFile:
    name: str
    size: int
    sha256: str


@dataclass(frozen=True)
class FontSet:
    id: str
    files: tuple[FontFile, ...]

    @property
    def size(self) -> int:
        return sum(entry.size for entry in self.files)


FONT_SETS: dict[str, FontSet] = {
    font_set.id: font_set
    for font_set in (
        FontSet(
            "ja",
            (
                FontFile(
                    "NotoSansJP-Regular.otf",
                    4538888,
                    "dcc75e20d91d09c793fa5a97c9c7678e8b580d0fc255314cbc45c08b075f46f1",
                ),
            ),
        ),
        FontSet(
            "ko",
            (
                FontFile(
                    "NotoSansKR-Regular.otf",
                    4579008,
                    "ff59f91fe8d6e6246f548bb67bf371810af3d5cc53b65e8680461fabd043b506",
                ),
            ),
        ),
        FontSet(
            "zh-Hans",
            (
                FontFile(
                    "NotoSansHans-Regular.otf",
                    8364644,
                    "7db3c634bbd0301b3082a80ffcac2f422e8ef9ce0730f8b279c3e8f756598f68",
                ),
            ),
        ),
        FontSet(
            "zh-Hant",
            (
                FontFile(
                    "NotoSansHant-Regular.otf",
                    5663120,
                    "81f39cffba8b45367a21249720782603b852bee71aad710f8f66fec3d3776af3",
                ),
            ),
        ),
    )
}


def fonts_dir() -> Path:
    directory = user_data_dir() / FONTS_DIR_NAME
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _download_base() -> str:
    return (os.environ.get("VIVEPDF_FONTS_URL") or DOWNLOAD_BASE).rstrip("/")


def _installed(font_set: FontSet, directory: Path) -> bool:
    return all(
        (directory / entry.name).is_file() and (directory / entry.name).stat().st_size == entry.size
        for entry in font_set.files
    )


def _font_set(set_id: str) -> FontSet:
    font_set = FONT_SETS.get(set_id)
    if font_set is None:
        raise OpError(ErrorCode.INVALID_PARAMS, f"unknown font set: {set_id}", {"set": set_id})
    return font_set


def _network_error(set_id: str, error: BaseException) -> OpError:
    return OpError(ErrorCode.NETWORK, f"font download failed: {error}", {"set": set_id})


def _fetch(
    set_id: str, entry: FontFile, directory: Path, progress: Progress, done: int, total: int
) -> None:
    request = urllib.request.Request(
        f"{_download_base()}/{entry.name}", headers={"User-Agent": USER_AGENT}
    )
    temp_fd, temp_name = tempfile.mkstemp(dir=directory, prefix=f".{entry.name}-", suffix=".part")
    temp_path = Path(temp_name)
    try:
        try:
            response = urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT)  # noqa: S310
        except (URLError, OSError, ValueError) as error:
            os.close(temp_fd)
            raise _network_error(set_id, error) from error
        digest = hashlib.sha256()
        received = 0
        with response, os.fdopen(temp_fd, "wb") as handle:
            while True:
                progress.check_cancelled()
                try:
                    chunk = response.read(CHUNK_SIZE)
                except OSError as error:
                    raise _network_error(set_id, error) from error
                if not chunk:
                    break
                received += len(chunk)
                if received > entry.size:
                    raise OpError(
                        ErrorCode.NETWORK,
                        f"{entry.name} is larger than expected",
                        {"set": set_id, "reason": "fontChecksum"},
                    )
                handle.write(chunk)
                digest.update(chunk)
                progress.report(
                    min(0.99, (done + received) / total),
                    "progress.downloading",
                    {"received": done + received, "total": total},
                )
        if received != entry.size or digest.hexdigest() != entry.sha256:
            raise OpError(
                ErrorCode.NETWORK,
                f"{entry.name} failed its checksum",
                {"set": set_id, "reason": "fontChecksum"},
            )
        replace_patiently(temp_path, directory / entry.name)
    except BaseException:
        unlink_patiently(temp_path)
        raise


class FallbackFontSetInfo(RpcModel):
    id: str
    bytes: int
    installed: bool


class FallbackFontsParams(RpcModel):
    pass


class FallbackFontsResult(RpcModel):
    directory: str
    sets: list[FallbackFontSetInfo]


@op("system.fallback_fonts", FallbackFontsParams)
def fallback_fonts(_params: FallbackFontsParams, _progress: Progress) -> FallbackFontsResult:
    directory = fonts_dir()
    return FallbackFontsResult(
        directory=str(directory),
        sets=[
            FallbackFontSetInfo(
                id=font_set.id, bytes=font_set.size, installed=_installed(font_set, directory)
            )
            for font_set in FONT_SETS.values()
        ],
    )


class FallbackFontSetParams(RpcModel):
    set: str


class FallbackFontsDownloadResult(RpcModel):
    set: str
    bytes: int


@op("system.fallback_fonts_download", FallbackFontSetParams)
def fallback_fonts_download(
    params: FallbackFontSetParams, progress: Progress
) -> FallbackFontsDownloadResult:
    font_set = _font_set(params.set)
    directory = fonts_dir()
    done = 0
    for entry in font_set.files:
        target = directory / entry.name
        if not (target.is_file() and target.stat().st_size == entry.size):
            _fetch(font_set.id, entry, directory, progress, done, font_set.size)
        done += entry.size
    progress.report(1.0, "progress.downloading", {"received": done, "total": done})
    return FallbackFontsDownloadResult(set=font_set.id, bytes=font_set.size)


class FallbackFontsRemoveResult(RpcModel):
    set: str
    removed: bool


@op("system.fallback_fonts_remove", FallbackFontSetParams)
def fallback_fonts_remove(
    params: FallbackFontSetParams, _progress: Progress
) -> FallbackFontsRemoveResult:
    font_set = _font_set(params.set)
    directory = fonts_dir()
    removed = False
    for entry in font_set.files:
        target = directory / entry.name
        if target.is_file():
            unlink_patiently(target)
            removed = True
    return FallbackFontsRemoveResult(set=font_set.id, removed=removed)
