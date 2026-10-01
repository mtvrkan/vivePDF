import json
import sys
from typing import Any, get_type_hints

from pydantic import BaseModel

from vivepdf.rpc.loader import load_all
from vivepdf.rpc.registry import get_operation, operation_names


def _result_model(handler: Any) -> type[BaseModel] | None:
    hint = get_type_hints(handler).get("return")
    if isinstance(hint, type) and issubclass(hint, BaseModel):
        return hint
    return None


def operation_schemas() -> dict[str, dict[str, Any]]:
    load_all()
    schemas: dict[str, dict[str, Any]] = {}
    for name in operation_names():
        operation = get_operation(name)
        if operation is None:
            continue
        result = _result_model(operation.handler)
        schemas[name] = {
            "params": operation.params_model.model_json_schema(by_alias=True, mode="validation"),
            "result": (
                result.model_json_schema(by_alias=True, mode="serialization") if result else None
            ),
        }
    return schemas


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump(operation_schemas(), sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
