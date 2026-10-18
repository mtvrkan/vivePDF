from datetime import UTC, datetime

from vivepdf.ops._document import open_document
from vivepdf.ops._inplace import finish
from vivepdf.ops._output import OutputResult
from vivepdf.ops._xmp_sync import sync_xmp
from vivepdf.rpc.paths import InPlacePath, WritePath
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

EDITABLE = ("title", "author", "subject", "keywords", "creator", "producer")


class SetMetadataParams(RpcModel):
    path: InPlacePath
    password: str | None = None
    output: WritePath | None = None
    in_place: bool = True
    overwrite: bool = False
    title: str | None = None
    author: str | None = None
    subject: str | None = None
    keywords: str | None = None
    creator: str | None = None
    producer: str | None = None


class SetMetadataResult(OutputResult):
    metadata: dict[str, str]


@op("info.set_metadata", SetMetadataParams)
def set_metadata(params: SetMetadataParams, progress: Progress) -> SetMetadataResult:
    document = open_document(params.path, params.password)
    try:
        current = {key: str(value or "") for key, value in (document.metadata or {}).items()}
        for key in EDITABLE:
            value = getattr(params, key)
            if value is not None:
                current[key] = value.strip()
        edited = {key: current[key] for key in EDITABLE if getattr(params, key) is not None}
        modified = datetime.now(UTC).replace(microsecond=0) if edited else None
        if modified is not None:
            current["modDate"] = modified.strftime("D:%Y%m%d%H%M%SZ")
        document.set_metadata(current)
        sync_xmp(document, edited, modified)
        progress.report(0.9, "progress.saving")
        saved = finish(document, params.path, params.output, params.in_place, params.overwrite)
        return SetMetadataResult(
            **saved.model_dump(), metadata={key: current.get(key, "") for key in EDITABLE}
        )
    finally:
        if not document.is_closed:
            document.close()
