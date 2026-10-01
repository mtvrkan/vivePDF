import os
import re
import shutil
from pathlib import Path

from pydantic import Field

from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MAX_LISTED_FILES = 2000
MAX_DEPTH = 8
MAX_NAME_ATTEMPTS = 1000
WORKING_FILE_MARKER = ".tmp-vivepdf."


class ListPdfsParams(RpcModel):
    folder: str
    recursive: bool = False
    limit: int = Field(default=MAX_LISTED_FILES, ge=1, le=MAX_LISTED_FILES)
    exclude: list[str] = Field(default_factory=list, max_length=32)


class PdfEntry(RpcModel):
    path: str
    size: int
    modified: int


class ListPdfsResult(RpcModel):
    files: list[str]
    entries: list[PdfEntry]
    truncated: bool


class MoveToFolderParams(RpcModel):
    path: str
    folder: str


class MoveToFolderResult(RpcModel):
    output: str


def _natural_key(relative: str) -> list[object]:
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", relative)]


def _is_listed(name: str) -> bool:
    return (
        name.lower().endswith(".pdf")
        and not name.startswith(".")
        and WORKING_FILE_MARKER not in name
    )


def _comparable(path: Path) -> str:
    text = os.path.normcase(os.path.abspath(path))
    return text.rstrip("\\/")


def _walk(root: Path, recursive: bool, excluded: set[str], progress: Progress) -> list[Path]:
    found: list[Path] = []
    pending: list[tuple[Path, int]] = [(root, 0)]
    while pending:
        progress.check_cancelled()
        folder, depth = pending.pop()
        try:
            entries = list(os.scandir(folder))
        except OSError:
            continue
        for entry in entries:
            try:
                if entry.is_file(follow_symlinks=False) and _is_listed(entry.name):
                    found.append(Path(entry.path))
                elif (
                    recursive
                    and depth < MAX_DEPTH
                    and entry.is_dir(follow_symlinks=False)
                    and not entry.name.startswith(".")
                    and _comparable(Path(entry.path)) not in excluded
                ):
                    pending.append((Path(entry.path), depth + 1))
            except OSError:
                continue
    return found


def _entry(path: Path) -> PdfEntry | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return PdfEntry(path=str(path), size=stat.st_size, modified=stat.st_mtime_ns // 1_000_000)


@op("files.list_pdfs", ListPdfsParams)
def list_pdfs(params: ListPdfsParams, progress: Progress) -> ListPdfsResult:
    root = Path(params.folder)
    if not root.is_dir():
        raise OpError(
            ErrorCode.FILE_NOT_FOUND, f"folder not found: {root.name}", {"path": params.folder}
        )
    excluded = {_comparable(Path(item)) for item in params.exclude if item.strip()}
    found = _walk(root, params.recursive, excluded, progress)
    found.sort(key=lambda item: _natural_key(str(item.relative_to(root))))
    kept = found[: params.limit]
    entries = [entry for entry in (_entry(item) for item in kept) if entry is not None]
    return ListPdfsResult(
        files=[entry.path for entry in entries],
        entries=entries,
        truncated=len(found) > params.limit,
    )


def _candidate(folder: Path, name: str, attempt: int) -> Path:
    if attempt < 2:
        return folder / name
    stem, dot, suffix = name.rpartition(".")
    if not dot or not stem:
        return folder / f"{name} ({attempt})"
    return folder / f"{stem} ({attempt}).{suffix}"


def _copy_exclusive(source: Path, target: Path) -> None:
    with source.open("rb") as reader, target.open("xb") as writer:
        shutil.copyfileobj(reader, writer)
    shutil.copystat(source, target)
    source.unlink()


def _move_exclusive(source: Path, target: Path) -> None:
    if os.name == "nt":
        try:
            os.rename(source, target)
            return
        except FileExistsError:
            raise
        except OSError:
            _copy_exclusive(source, target)
            return
    try:
        os.link(source, target)
    except FileExistsError:
        raise
    except OSError:
        _copy_exclusive(source, target)
        return
    source.unlink()


@op("files.move_to_folder", MoveToFolderParams)
def move_to_folder(params: MoveToFolderParams, _progress: Progress) -> MoveToFolderResult:
    source = Path(params.path)
    if not source.is_file():
        raise OpError(
            ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}", {"path": params.path}
        )
    folder = Path(params.folder)
    if _comparable(folder) == _comparable(source.parent):
        return MoveToFolderResult(output=str(source))
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise OpError(
            ErrorCode.PERMISSION_DENIED,
            f"cannot create folder: {folder.name}",
            {"path": params.folder},
        ) from error
    for attempt in range(1, MAX_NAME_ATTEMPTS + 1):
        target = _candidate(folder, source.name, attempt)
        if target.exists():
            continue
        try:
            _move_exclusive(source, target)
        except FileExistsError:
            continue
        except PermissionError as error:
            raise OpError(
                ErrorCode.PERMISSION_DENIED, f"cannot move: {source.name}", {"path": params.path}
            ) from error
        except OSError as error:
            raise OpError(
                ErrorCode.INTERNAL, f"cannot move: {source.name}", {"path": params.path}
            ) from error
        return MoveToFolderResult(output=str(target))
    raise OpError(ErrorCode.INTERNAL, f"no free name in {folder.name}", {"path": params.folder})
