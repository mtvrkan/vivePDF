from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from vivepdf.rpc.progress import Progress

Handler = Callable[[Any, Progress], BaseModel]


@dataclass(frozen=True)
class Operation:
    name: str
    params_model: type[BaseModel]
    handler: Handler


_OPERATIONS: dict[str, Operation] = {}


def op(name: str, params_model: type[BaseModel]) -> Callable[[Handler], Handler]:
    def decorator(handler: Handler) -> Handler:
        if name in _OPERATIONS:
            raise ValueError(f"operation already registered: {name}")
        _OPERATIONS[name] = Operation(name=name, params_model=params_model, handler=handler)
        return handler

    return decorator


def get_operation(name: str) -> Operation | None:
    return _OPERATIONS.get(name)


def operation_names() -> list[str]:
    return sorted(_OPERATIONS)
