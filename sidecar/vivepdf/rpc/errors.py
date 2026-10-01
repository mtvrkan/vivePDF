from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    ENCRYPTED = "ENCRYPTED"
    NEEDS_PASSWORD = "NEEDS_PASSWORD"
    INVALID_PDF = "INVALID_PDF"
    CERTIFICATE_SEALED = "CERTIFICATE_SEALED"
    FILE_NOT_FOUND = "FILE_NOT_FOUND"
    LIBREOFFICE_MISSING = "LIBREOFFICE_MISSING"
    EXTERNAL_TOOL_FAILED = "EXTERNAL_TOOL_FAILED"
    TESSDATA_MISSING = "TESSDATA_MISSING"
    NETWORK = "NETWORK"
    CANCELLED = "CANCELLED"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    INVALID_PARAMS = "INVALID_PARAMS"
    UNSUPPORTED = "UNSUPPORTED"
    UNKNOWN_METHOD = "UNKNOWN_METHOD"
    INTERNAL = "INTERNAL"


class OpError(Exception):
    def __init__(self, code: ErrorCode, message: str, data: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code.value, "message": self.message}
        if self.data is not None:
            payload["data"] = self.data
        return payload
