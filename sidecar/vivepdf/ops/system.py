import gc
import platform

import pymupdf

from vivepdf import VERSION
from vivepdf.ops._document import forget_all_documents, forget_document
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

STORE_EMPTY_PERCENT = 100


class PingParams(RpcModel):
    pass


class PingResult(RpcModel):
    version: str
    pymupdf: str
    python: str


@op("system.ping", PingParams)
def ping(_params: PingParams, _progress: Progress) -> PingResult:
    return PingResult(version=VERSION, pymupdf=pymupdf.version[0], python=platform.python_version())


class ReleaseParams(RpcModel):
    path: str | None = None


class ReleaseResult(RpcModel):
    released: int


@op("system.release", ReleaseParams)
def release(params: ReleaseParams, _progress: Progress) -> ReleaseResult:
    if params.path is not None:
        return ReleaseResult(released=forget_document(params.path))
    released = forget_all_documents()
    pymupdf.TOOLS.store_shrink(STORE_EMPTY_PERCENT)
    gc.collect()
    return ReleaseResult(released=released)
