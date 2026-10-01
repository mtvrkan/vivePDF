from vivepdf.ops._document import open_document
from vivepdf.ops._inplace import finish
from vivepdf.ops._output import OutputResult
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

EDITABLE = ("title", "author", "subject", "keywords", "creator", "producer")


class SetMetadataParams(RpcModel):
    path: str
    password: str | None = None
    output: str | None = None
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
        document.set_metadata(current)
        progress.report(0.9, "progress.saving")
        saved = finish(document, params.path, params.output, params.in_place, params.overwrite)
        return SetMetadataResult(
            **saved.model_dump(), metadata={key: current.get(key, "") for key in EDITABLE}
        )
    finally:
        if not document.is_closed:
            document.close()
