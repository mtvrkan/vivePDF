import base64
import binascii
import re
import zipfile
from pathlib import Path, PurePosixPath
from typing import Literal

from pydantic import Field

from vivepdf.ops._output import prepare_data_output, write_atomically
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.paths import NotAPath, ReadPath, WritePath
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MEGABYTE = 1024 * 1024
MAX_ATTACHMENT_BYTES = 25 * MEGABYTE
MAX_ATTACHMENTS_BYTES = 50 * MEGABYTE
MAX_IMAGES_BYTES = 3 * MEGABYTE
MAX_TEXT_CHARS = 1_200_000
MAX_NAME_CHARS = 100
CHUNK_BYTES = MEGABYTE
UNSAFE_NAME = re.compile(r'[\x00-\x1f\x7f<>:"|?*]')
IMAGE_TYPES = ((b"\x89PNG\r\n\x1a\n", ".png"), (b"\xff\xd8\xff", ".jpg"))
FALLBACK_NAME = "file"


class SupportText(RpcModel):
    name: NotAPath = Field(min_length=1, max_length=200)
    text: str = Field(max_length=MAX_TEXT_CHARS)
    folder: Literal["", "logs"] = ""


class SupportImage(RpcModel):
    name: NotAPath = Field(min_length=1, max_length=200)
    base64: str = Field(max_length=(MAX_IMAGES_BYTES * 4) // 3 + 4)


class SupportBundleParams(RpcModel):
    output: WritePath
    texts: list[SupportText] = Field(default_factory=list, max_length=8)
    attachments: list[ReadPath] = Field(default_factory=list, max_length=20)
    images: list[SupportImage] = Field(default_factory=list, max_length=10)
    overwrite: bool = False


class SupportBundleResult(RpcModel):
    output: str
    bytes: int
    files: int


def safe_name(name: str) -> str:
    base = PurePosixPath(name.replace("\\", "/")).name
    cleaned = UNSAFE_NAME.sub("_", base).strip().lstrip(".").strip()
    if len(cleaned) > MAX_NAME_CHARS:
        stem, dot, extension = cleaned.rpartition(".")
        keep = MAX_NAME_CHARS - len(extension) - 1
        cleaned = (
            f"{stem[:keep]}.{extension}"
            if dot and 0 < len(extension) < 10
            else cleaned[:MAX_NAME_CHARS]
        )
    return cleaned or FALLBACK_NAME


class _Names:
    def __init__(self) -> None:
        self._taken: set[str] = set()

    def claim(self, folder: str, name: str) -> str:
        stem, dot, extension = name.rpartition(".")
        if not dot or not stem:
            stem, extension = name, ""
        candidate = f"{folder}{name}"
        counter = 2
        while candidate.lower() in self._taken:
            suffix = f".{extension}" if extension else ""
            candidate = f"{folder}{stem} ({counter}){suffix}"
            counter += 1
        self._taken.add(candidate.lower())
        return candidate


def _too_large(limit: int, name: str | None = None) -> OpError:
    data: dict[str, object] = {"reason": "tooLarge", "limitMb": limit // MEGABYTE}
    if name is not None:
        data["name"] = name
    return OpError(ErrorCode.INVALID_PARAMS, "the support bundle is too large", data)


def _decoded_images(images: list[SupportImage]) -> list[tuple[str, bytes]]:
    decoded: list[tuple[str, bytes]] = []
    total = 0
    for image in images:
        try:
            raw = base64.b64decode(image.base64, validate=True)
        except (binascii.Error, ValueError) as error:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "a pasted picture could not be read",
                {"reason": "badImage", "name": safe_name(image.name)},
            ) from error
        extension = next((ext for magic, ext in IMAGE_TYPES if raw.startswith(magic)), None)
        if extension is None:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "only PNG or JPEG pictures can be added",
                {"reason": "badImage", "name": safe_name(image.name)},
            )
        total += len(raw)
        if total > MAX_IMAGES_BYTES:
            raise _too_large(MAX_IMAGES_BYTES)
        decoded.append((str(PurePosixPath(safe_name(image.name)).with_suffix(extension)), raw))
    return decoded


def _checked_attachments(attachments: list[str], target: Path) -> list[Path]:
    files: list[Path] = []
    total = 0
    resolved_target = target.resolve()
    for attachment in attachments:
        path = Path(attachment)
        if not path.is_file():
            raise OpError(
                ErrorCode.FILE_NOT_FOUND,
                f"attachment not found: {path.name}",
                {"name": path.name},
            )
        if path.resolve() == resolved_target:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "output must differ from the input file",
                {"reason": "sameAsInput"},
            )
        size = path.stat().st_size
        if size > MAX_ATTACHMENT_BYTES:
            raise _too_large(MAX_ATTACHMENT_BYTES, path.name)
        total += size
        if total > MAX_ATTACHMENTS_BYTES:
            raise _too_large(MAX_ATTACHMENTS_BYTES)
        files.append(path)
    return files


def _copy_into(archive: zipfile.ZipFile, source: Path, member: str, progress: Progress) -> None:
    with source.open("rb") as reader, archive.open(member, "w", force_zip64=True) as writer:
        while chunk := reader.read(CHUNK_BYTES):
            progress.check_cancelled()
            writer.write(chunk)


@op("system.support_bundle", SupportBundleParams)
def support_bundle(params: SupportBundleParams, progress: Progress) -> SupportBundleResult:
    target = prepare_data_output(params.output, "zip", params.overwrite)
    images = _decoded_images(params.images)
    attachments = _checked_attachments(params.attachments, target)
    names = _Names()
    total_steps = max(1, len(attachments))
    written = 0

    def write(partial: Path) -> None:
        nonlocal written
        with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED) as archive:
            for entry in params.texts:
                folder = f"{entry.folder}/" if entry.folder else ""
                archive.writestr(
                    names.claim(folder, safe_name(entry.name)), entry.text.encode("utf-8")
                )
                written += 1
            for name, raw in images:
                archive.writestr(names.claim("attachments/", name), raw)
                written += 1
            for index, path in enumerate(attachments):
                progress.check_cancelled()
                progress.report(
                    index / total_steps,
                    "progress.attaching",
                    {"current": index + 1, "total": len(attachments)},
                )
                _copy_into(
                    archive, path, names.claim("attachments/", safe_name(path.name)), progress
                )
                written += 1
        progress.report(1.0, "progress.saving")

    write_atomically(target, write)
    return SupportBundleResult(output=str(target), bytes=target.stat().st_size, files=written)
