import base64
import binascii
import hashlib
import io
import warnings
from pathlib import Path

from PIL import Image, ImageOps

from vivepdf.ops._appdata import user_data_dir
from vivepdf.ops._output import write_atomically
from vivepdf.ops._studio_models import (
    MAX_IMAGE_DATA,
    StudioSaveImageParams,
    StudioSaveImageResult,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.registry import op

FOLDER_NAME = "studio-images"
EXTENSIONS = {
    "PNG": "png",
    "JPEG": "jpg",
    "WEBP": "webp",
    "GIF": "gif",
    "BMP": "bmp",
    "TIFF": "tif",
}
NAME_LENGTH = 32
MAX_IMAGE_BYTES = MAX_IMAGE_DATA * 3 // 4


def images_folder() -> Path:
    folder = user_data_dir() / FOLDER_NAME
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _unreadable(reason: str = "imageUnreadable") -> OpError:
    return OpError(
        ErrorCode.INVALID_PARAMS, "the data is not a supported image", {"reason": reason}
    )


def _decoded(data: str) -> bytes:
    try:
        return base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as error:
        raise _unreadable() from error


def _inspected(payload: bytes) -> tuple[str, int, int]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload)) as opened:
                extension = EXTENSIONS.get(opened.format or "")
                if extension is None:
                    raise _unreadable()
                opened.load()
                width, height = ImageOps.exif_transpose(opened).size
    except Image.DecompressionBombError as error:
        raise _unreadable("pictureTooLarge") from error
    except (OSError, ValueError, SyntaxError) as error:
        raise _unreadable() from error
    return extension, width, height


def _file_bytes(path: str) -> bytes:
    source = Path(path)
    if not source.is_file():
        raise OpError(ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}", {"path": path})
    try:
        if source.stat().st_size > MAX_IMAGE_BYTES:
            raise _unreadable("pictureTooLarge")
        return source.read_bytes()
    except PermissionError as error:
        raise OpError(ErrorCode.PERMISSION_DENIED, f"cannot read: {source.name}") from error
    except OSError as error:
        raise _unreadable() from error


@op("studio.save_image", StudioSaveImageParams)
def save_image(params: StudioSaveImageParams, _progress: Progress) -> StudioSaveImageResult:
    payload = _file_bytes(params.path) if params.path is not None else _decoded(params.data or "")
    extension, width, height = _inspected(payload)
    digest = hashlib.sha256(payload).hexdigest()[:NAME_LENGTH]
    target = images_folder() / f"{digest}.{extension}"
    if not target.is_file() or target.stat().st_size != len(payload):
        write_atomically(target, lambda path: path.write_bytes(payload))
    return StudioSaveImageResult(path=str(target), width=width, height=height)
