from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class RpcModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Request(BaseModel):
    id: str
    method: str
    params: dict[str, Any] = Field(default_factory=dict)


def result_line(request_id: str, result: BaseModel) -> dict[str, Any]:
    return {"id": request_id, "result": result.model_dump(by_alias=True, mode="json")}


def error_line(request_id: str | None, code: str, message: str, data: Any = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"id": request_id, "error": error}


def progress_line(
    request_id: str, value: float, message: str | None, detail: dict[str, Any] | None
) -> dict[str, Any]:
    line: dict[str, Any] = {"id": request_id, "progress": max(0.0, min(1.0, value))}
    if message is not None:
        line["message"] = message
    if detail is not None:
        line["detail"] = detail
    return line
