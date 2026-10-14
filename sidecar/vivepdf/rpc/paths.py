from dataclasses import dataclass
from typing import Annotated, Any, Literal

from pydantic import GetJsonSchemaHandler
from pydantic_core import CoreSchema

PATH_MARKER = "x-vivepdf-path"

PathKindName = Literal["read", "write", "modify", "inPlace", "readDir", "writeDir", "none"]


@dataclass(frozen=True)
class PathKind:
    kind: PathKindName

    def __get_pydantic_json_schema__(
        self, core_schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> dict[str, Any]:
        schema = handler(core_schema)
        schema[PATH_MARKER] = self.kind
        return schema


ReadPath = Annotated[str, PathKind("read")]
WritePath = Annotated[str, PathKind("write")]
ModifyPath = Annotated[str, PathKind("modify")]
InPlacePath = Annotated[str, PathKind("inPlace")]
ReadDir = Annotated[str, PathKind("readDir")]
WriteDir = Annotated[str, PathKind("writeDir")]
NotAPath = Annotated[str, PathKind("none")]
