import json
import time
from pathlib import Path
from typing import Any

from pydantic import Field

from vivepdf.ops._appdata import user_data_dir
from vivepdf.ops._output import write_atomically
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

DRAFT_FOLDER = "studio"
DRAFT_NAME = "draft.json"
DRAFT_FORMAT = "vivedraft"
DRAFT_VERSION = 1
MAX_DRAFT_BYTES = 7 * 1024 * 1024


class StudioDraftSaveParams(RpcModel):
    design: dict[str, Any]
    file_path: str | None = Field(default=None, max_length=4096)


class StudioDraftSaveResult(RpcModel):
    bytes: int
    saved_at: int


class StudioDraftLoadParams(RpcModel):
    pass


class StudioDraftLoadResult(RpcModel):
    found: bool
    design: dict[str, Any] | None = None
    file_path: str | None = None
    saved_at: int = 0


def draft_path() -> Path:
    folder = user_data_dir() / DRAFT_FOLDER
    folder.mkdir(parents=True, exist_ok=True)
    return folder / DRAFT_NAME


def _too_large(size: int) -> OpError:
    return OpError(
        ErrorCode.INVALID_PARAMS,
        f"the draft is too large: {size} bytes",
        {"reason": "draftTooLarge", "limit": MAX_DRAFT_BYTES},
    )


@op("studio.save_draft", StudioDraftSaveParams)
def save_draft(params: StudioDraftSaveParams, _progress: Progress) -> StudioDraftSaveResult:
    if params.design.get("kind") != "design" or not isinstance(params.design.get("pages"), list):
        raise OpError(ErrorCode.INVALID_PARAMS, "not a design", {"reason": "notDesign"})
    saved_at = int(time.time() * 1000)
    body = {
        "format": DRAFT_FORMAT,
        "version": DRAFT_VERSION,
        "savedAt": saved_at,
        "filePath": params.file_path,
        "design": params.design,
    }
    encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_DRAFT_BYTES:
        raise _too_large(len(encoded))
    write_atomically(draft_path(), lambda path: path.write_bytes(encoded))
    return StudioDraftSaveResult(bytes=len(encoded), saved_at=saved_at)


@op("studio.load_draft", StudioDraftLoadParams)
def load_draft(_params: StudioDraftLoadParams, _progress: Progress) -> StudioDraftLoadResult:
    target = draft_path()
    try:
        if target.stat().st_size > MAX_DRAFT_BYTES:
            return StudioDraftLoadResult(found=False)
        body = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return StudioDraftLoadResult(found=False)
    if not isinstance(body, dict) or body.get("format") != DRAFT_FORMAT:
        return StudioDraftLoadResult(found=False)
    design = body.get("design")
    version = body.get("version")
    if not isinstance(design, dict) or not isinstance(version, int) or version > DRAFT_VERSION:
        return StudioDraftLoadResult(found=False)
    file_path = body.get("filePath")
    saved_at = body.get("savedAt")
    return StudioDraftLoadResult(
        found=True,
        design=design,
        file_path=file_path if isinstance(file_path, str) else None,
        saved_at=saved_at if isinstance(saved_at, int) else 0,
    )
