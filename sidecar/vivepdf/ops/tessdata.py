import hashlib
import os
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path
from urllib.error import URLError

from vivepdf._data_home import unix_data_home
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

BUNDLED_TESSDATA_DIR = Path(__file__).resolve().parent.parent / "assets" / "tessdata"
TESSDATA_COMMIT = "87416418657359cb625c412a48b6e1d6d41c29bd"
TESSDATA_BASE_URL = f"https://github.com/tesseract-ocr/tessdata_fast/raw/{TESSDATA_COMMIT}"
DOWNLOAD_TIMEOUT = 60.0
CHUNK_SIZE = 256 * 1024
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
MIN_FILE_BYTES = 100 * 1024
USER_AGENT = "vivePDF"

LANGUAGES: list[tuple[str, str]] = [
    ("eng", "English"),
    ("tur", "Turkish"),
    ("deu", "German"),
    ("fra", "French"),
    ("spa", "Spanish"),
    ("ita", "Italian"),
    ("por", "Portuguese"),
    ("nld", "Dutch"),
    ("pol", "Polish"),
    ("rus", "Russian"),
    ("ukr", "Ukrainian"),
    ("ara", "Arabic"),
    ("fas", "Persian"),
    ("heb", "Hebrew"),
    ("hin", "Hindi"),
    ("ben", "Bengali"),
    ("jpn", "Japanese"),
    ("kor", "Korean"),
    ("chi_sim", "Chinese Simplified"),
    ("chi_tra", "Chinese Traditional"),
    ("vie", "Vietnamese"),
    ("tha", "Thai"),
    ("ind", "Indonesian"),
    ("msa", "Malay"),
    ("swe", "Swedish"),
    ("nor", "Norwegian"),
    ("dan", "Danish"),
    ("fin", "Finnish"),
    ("ell", "Greek"),
    ("ces", "Czech"),
    ("slk", "Slovak"),
    ("hun", "Hungarian"),
    ("ron", "Romanian"),
    ("bul", "Bulgarian"),
    ("hrv", "Croatian"),
    ("srp", "Serbian"),
    ("aze", "Azerbaijani"),
    ("kaz", "Kazakh"),
    ("uzb", "Uzbek"),
    ("lat", "Latin"),
]
LANGUAGE_CODES = {code for code, _name in LANGUAGES}
LANGUAGE_SHA256: dict[str, str] = {
    "eng": "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
    "tur": "7393381111e1152420fc4092cb44eef4237580d21b92bf30d7d221aad192c6b7",
    "deu": "19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d",
    "fra": "ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca",
    "spa": "6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464",
    "ita": "b8f89e1e785118dac4d51ae042c029a64edb5c3ee42ef73027a6d412748d8827",
    "por": "c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb",
    "nld": "ced0e5e046a84c908a6aa7accbef9a232c4a5d9a8276691b81c6ee64d02963f6",
    "pol": "c4476cdbc0e33d898d32345122b7be1cbf85ace15f920f06c7714756e1ef79b2",
    "rus": "e16e5e036cce1d9ec2b00063cf8b54472625b9e14d893a169e2b0dedeb4df225",
    "ukr": "d59e53e2bded32f4445f124b4b00240fcac7e8044c003ab822ccb94f0b3db59b",
    "ara": "e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729",
    "fas": "db1c0a91208aff00d3cf1ed2c1d23f76419afd5f024688b4f71adc3f2ce4a505",
    "heb": "11f9e43ab227f786352a50f75c94c2e9906f1baba86d93276da19da7ce0904db",
    "hin": "4c73ffc59d497c186b19d1e90f5d721d678ea6b2e277b719bee4e2af12271825",
    "ben": "31163084c279aaebd376216f0c3d5c17ad4b5fee8db49dae79c20000b5de5964",
    "jpn": "1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d",
    "kor": "6b85e11d9bbf07863b97b3523b1b112844c43e713df8b66418a081fd1060b3b2",
    "chi_sim": "a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730",
    "chi_tra": "529c5b5797d64b126065cd55f2bb4c7fd7b15790798091b1ff259941a829330b",
    "vie": "79df64caf7bcfb2a27df5042ecb6121e196eada34da774956995747636d5bfa1",
    "tha": "294227cc2d1292b0acb28d61d4115c88252b96d466ca90b417cf4cf0c67bf07c",
    "ind": "69786901da87ab8766c1ea7fbb10b28f2110c14da3f6c8f2735df131fba95d88",
    "msa": "e41a3e5febfec50c90371eb1cbb17a48b10cad387900e3420b1f134c1b766cba",
    "swe": "f7304988d41f833efebcc2d529df54b1903ecebbc3da1faabd19a0fddd4fe586",
    "nor": "0451eb4f8049ae78196806bf878a389a2f40f1386fe038568cf4441226ba6ef2",
    "dan": "acb1fd074487a31d1294fcdfd7d7c673467ffd8aeacb2ccd61ebcbf04eb4e2fa",
    "fin": "61a04cd62b507c3d9ae0e1cda399e6715ebf49dea9df47897c8acdcd3bd3e13c",
    "ell": "4fba8a0b461038d51f1c20d043d4f2ac38c4e778f1b90830847f7bd8fa3ba726",
    "ces": "934bcaf97ef3348413263331131c9fa7f55f30db333c711929c124fb635f7e1b",
    "slk": "fbcc400a9c74c6a13d922fcb1211b655d1b165387b675ed75cd2dbd756b974a5",
    "hun": "35067e7cfe102dcdc953f9a758fdfaa6296b17a1ee6d874ee780fa306430b9fb",
    "ron": "9adfde6b51ba4b97efd10ea37c3070fd3fc2bad7815e81f5c3c198cd96216cc9",
    "bul": "aebc9b0fcc8cfaf8a9f38a02bb7b85052bd850744696a2c11cf0081820e5b21e",
    "hrv": "9e515d9832ce259dbab550b1cc6b998f8b929faf2edacaaca981b05adb130571",
    "srp": "aa41ae3d9cc705e60d398ab38a5c3cc8b772c0d420c7d4f0859beb13d0e321b6",
    "aze": "a365310848aecb739f19369cb3831d4660fcd9345d798e91a3042455f9ccc9f0",
    "kaz": "fcc01eed3815a42b9c6321c4c9d3606f39b166cbf95ade98b7d8d12063eae53d",
    "uzb": "0e39021eefe692906b50d9bd22e580fa57fe43fa35db6846ad8b6369ddc21ea8",
    "lat": "3859d8ba60404f4b79830622625bbc76fb4ee2808eac1ad360ffa77f0a533328",
}


def writable_tessdata_dir() -> Path:
    if override := os.environ.get("VIVEPDF_TESSDATA_DIR"):
        directory = Path(override)
    elif sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        directory = Path(base) / "vivePDF" / "tessdata"
    else:
        directory = unix_data_home() / "vivepdf" / "tessdata"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def ensure_bundled_copied(directory: Path) -> None:
    if not BUNDLED_TESSDATA_DIR.is_dir():
        return
    for source in BUNDLED_TESSDATA_DIR.glob("*.traineddata"):
        target = directory / source.name
        if not target.exists():
            shutil.copyfile(source, target)


def installed_languages() -> list[str]:
    directory = writable_tessdata_dir()
    ensure_bundled_copied(directory)
    codes = {item.stem for item in directory.glob("*.traineddata")}
    if BUNDLED_TESSDATA_DIR.is_dir():
        codes |= {item.stem for item in BUNDLED_TESSDATA_DIR.glob("*.traineddata")}
    return sorted(codes)


def _fetch(code: str, directory: Path, progress: Progress) -> Path:
    target = directory / f"{code}.traineddata"
    temp_fd, temp_name = tempfile.mkstemp(dir=directory, prefix=f".{code}-", suffix=".part")
    temp_path = Path(temp_name)
    request = urllib.request.Request(
        f"{TESSDATA_BASE_URL}/{code}.traineddata", headers={"User-Agent": USER_AGENT}
    )
    try:
        response = urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT)  # noqa: S310
    except (URLError, OSError) as error:
        os.close(temp_fd)
        temp_path.unlink(missing_ok=True)
        raise OpError(ErrorCode.NETWORK, f"download failed: {error}", {"code": code}) from error
    received = 0
    digest = hashlib.sha256()
    try:
        with response, os.fdopen(temp_fd, "wb") as handle:
            total_header = response.headers.get("Content-Length")
            total = int(total_header) if total_header else None
            next_report = CHUNK_SIZE
            while True:
                progress.check_cancelled()
                try:
                    chunk = response.read(CHUNK_SIZE)
                except OSError as error:
                    raise OpError(
                        ErrorCode.NETWORK, f"download failed: {error}", {"code": code}
                    ) from error
                if not chunk:
                    break
                handle.write(chunk)
                digest.update(chunk)
                received += len(chunk)
                if received > MAX_DOWNLOAD_BYTES:
                    raise OpError(
                        ErrorCode.NETWORK,
                        f"language data for {code} is unexpectedly large",
                        {"code": code, "limit": MAX_DOWNLOAD_BYTES},
                    )
                if received >= next_report:
                    progress.report(
                        min(0.95, received / total) if total else 0.5,
                        "progress.downloading",
                        {"received": received, "total": total},
                    )
                    next_report += CHUNK_SIZE
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise
    if received <= MIN_FILE_BYTES:
        temp_path.unlink(missing_ok=True)
        raise OpError(ErrorCode.NETWORK, f"downloaded file too small for {code}", {"code": code})
    if digest.hexdigest() != LANGUAGE_SHA256[code]:
        temp_path.unlink(missing_ok=True)
        raise OpError(
            ErrorCode.NETWORK,
            f"language data for {code} failed its checksum",
            {"code": code, "reason": "languageChecksum"},
        )
    temp_path.replace(target)
    return target


class TessdataLanguage(RpcModel):
    code: str
    name: str


class TessdataLanguagesParams(RpcModel):
    pass


class TessdataLanguagesResult(RpcModel):
    directory: str
    installed: list[str]
    available: list[TessdataLanguage]


@op("system.tessdata_languages", TessdataLanguagesParams)
def tessdata_languages(
    _params: TessdataLanguagesParams, _progress: Progress
) -> TessdataLanguagesResult:
    return TessdataLanguagesResult(
        directory=str(writable_tessdata_dir()),
        installed=installed_languages(),
        available=[TessdataLanguage(code=code, name=name) for code, name in LANGUAGES],
    )


class TessdataDownloadParams(RpcModel):
    code: str


class TessdataDownloadResult(RpcModel):
    code: str
    path: str
    bytes: int


@op("system.tessdata_download", TessdataDownloadParams)
def tessdata_download(params: TessdataDownloadParams, progress: Progress) -> TessdataDownloadResult:
    if params.code not in LANGUAGE_CODES:
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"unknown language code: {params.code}", {"code": params.code}
        )
    directory = writable_tessdata_dir()
    target = _fetch(params.code, directory, progress)
    size = target.stat().st_size
    progress.report(1.0, "progress.downloading", {"received": size, "total": size})
    return TessdataDownloadResult(code=params.code, path=str(target), bytes=size)


class TessdataRemoveParams(RpcModel):
    code: str


class TessdataRemoveResult(RpcModel):
    code: str
    removed: bool


@op("system.tessdata_remove", TessdataRemoveParams)
def tessdata_remove(params: TessdataRemoveParams, _progress: Progress) -> TessdataRemoveResult:
    if params.code not in LANGUAGE_CODES:
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"unknown language code: {params.code}", {"code": params.code}
        )
    directory = writable_tessdata_dir().resolve()
    target = (directory / f"{params.code}.traineddata").resolve()
    if target.parent != directory:
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"invalid language code: {params.code}", {"code": params.code}
        )
    removed = target.is_file()
    if removed:
        target.unlink()
    return TessdataRemoveResult(code=params.code, removed=removed)
