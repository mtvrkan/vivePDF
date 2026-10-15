import hashlib
import os
import tempfile
import urllib.request
from pathlib import Path
from typing import Protocol
from urllib.error import URLError

from vivepdf.net import require_online
from vivepdf.ops._output import replace_patiently, unlink_patiently
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress

DOWNLOAD_TIMEOUT = 60.0
CHUNK_SIZE = 256 * 1024
USER_AGENT = "vivePDF"


class DownloadEntry(Protocol):
    @property
    def name(self) -> str: ...
    @property
    def size(self) -> int: ...
    @property
    def sha256(self) -> str: ...


def _network_error(set_id: str, error: BaseException) -> OpError:
    return OpError(ErrorCode.NETWORK, f"font download failed: {error}", {"set": set_id})


def fetch_font_file(
    set_id: str,
    entry: DownloadEntry,
    directory: Path,
    progress: Progress,
    done: int,
    total: int,
    base: str,
) -> None:
    require_online("fonts.download")
    request = urllib.request.Request(f"{base}/{entry.name}", headers={"User-Agent": USER_AGENT})
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
