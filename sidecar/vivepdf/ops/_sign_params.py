from typing import Literal

from pydantic import Field

from vivepdf.rpc.protocol import RpcModel


class SignParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    certificate_path: str
    certificate_password: str = Field(default="", repr=False)
    page: int = Field(default=1, ge=1)
    box: list[float] | None = None
    visible: bool = True
    reason: str = ""
    location: str = ""
    contact: str = ""
    field_name: str = "vivePDF-Signature"
    stamp_text: str = "{signer}\n{date}"
    certify: bool = False
    certify_permission: Literal["none", "forms", "annotations"] = "forms"
    lock: bool = False
    existing_field: str | None = None
    image_path: str | None = None
    image_base64: str | None = None
    timestamp_url: str | None = None


class SignResult(RpcModel):
    output: str
    page_count: int
    bytes: int
    signer: str
