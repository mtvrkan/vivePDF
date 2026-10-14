import re
from pathlib import Path
from typing import Any

import pytest
from pydantic import Field

from vivepdf.rpc import path_manifest
from vivepdf.rpc.path_manifest import ManifestError, build_manifest, render
from vivepdf.rpc.paths import PATH_MARKER, InPlacePath, ReadPath, WritePath
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.schema import operation_schemas

SHIPPED = (
    Path(__file__).resolve().parents[2]
    / "apps"
    / "desktop"
    / "src-tauri"
    / "resources"
    / "op-paths.json"
)
PATH_LIKE = re.compile(
    r"(path|dir|folder)|(file|files|output|outputs|image|images|logo|assets|certificate|"
    r"certificates|template|fonts|chapters|attachments|original|exclude|source|sources|target)$",
    re.IGNORECASE,
)


def _unmarked_path_like(node: Any, definitions: dict, name: str, seen: frozenset) -> list[str]:
    found: list[str] = []
    if isinstance(node, dict) and "$ref" in node:
        reference = node["$ref"].rsplit("/", 1)[-1]
        if reference in seen:
            return found
        seen = seen | {reference}
        node = definitions[reference]
    if not isinstance(node, dict):
        return found
    for combinator in ("anyOf", "oneOf", "allOf"):
        for option in node.get(combinator, []):
            found += _unmarked_path_like(option, definitions, name, seen)
    if node.get("type") == "string":
        plain = "enum" not in node and "const" not in node and PATH_MARKER not in node
        if plain and PATH_LIKE.search(name):
            found.append(name)
    if isinstance(node.get("items"), dict):
        found += _unmarked_path_like(node["items"], definitions, name, seen)
    for key, child in node.get("properties", {}).items():
        found += _unmarked_path_like(child, definitions, key, seen)
    if isinstance(node.get("additionalProperties"), dict):
        found += _unmarked_path_like(node["additionalProperties"], definitions, name, seen)
    return found


def test_the_shipped_manifest_matches_the_operations() -> None:
    assert SHIPPED.read_text(encoding="utf-8") == render(build_manifest()), (
        "run `uv run python -m vivepdf.rpc.path_manifest "
        "../apps/desktop/src-tauri/resources/op-paths.json`"
    )


def test_every_operation_is_listed() -> None:
    assert set(build_manifest()["operations"]) == set(operation_schemas())


def test_every_path_like_field_says_what_it_is() -> None:
    missing = []
    for method, schema in operation_schemas().items():
        params = schema["params"]
        for name in _unmarked_path_like(params, params.get("$defs", {}), "", frozenset()):
            missing.append(f"{method}: {name}")

    assert sorted(set(missing)) == []


def _patterns(model: type[RpcModel]) -> list[list[str]]:
    schema = model.model_json_schema(by_alias=True, mode="validation")
    collector = path_manifest._Collector("test.op", schema.get("$defs", {}))
    collector.walk(schema, (), {})
    return collector.patterns()


class _Leaf(RpcModel):
    image_path: ReadPath | None = None
    children: list["_Leaf"] = Field(default_factory=list)


class _Tree(RpcModel):
    path: InPlacePath
    in_place: bool = False
    output: WritePath | None = None
    sources: list[ReadPath] = Field(default_factory=list)
    nodes: list[_Leaf] = Field(default_factory=list)
    names: dict[str, ReadPath] = Field(default_factory=dict)


def test_patterns_cover_lists_maps_unions_and_recursion() -> None:
    assert _patterns(_Tree) == [
        ["names", "*", "read"],
        ["nodes", "*", "**", "imagePath", "read"],
        ["nodes", "*", "imagePath", "read"],
        ["output", "write"],
        ["path", "inPlace"],
        ["sources", "*", "read"],
    ]


class _ReadShape(RpcModel):
    kind: str = "a"
    path: ReadPath


class _WriteShape(RpcModel):
    kind: str = "b"
    path: WritePath


class _TextShape(RpcModel):
    kind: str = "c"
    path: str


class _Conflicting(RpcModel):
    item: _ReadShape | _WriteShape


class _Mixed(RpcModel):
    item: _ReadShape | _TextShape


@pytest.mark.parametrize("model", [_Conflicting, _Mixed])
def test_a_field_that_changes_meaning_between_shapes_is_refused(model: type[RpcModel]) -> None:
    with pytest.raises(ManifestError):
        _patterns(model)
