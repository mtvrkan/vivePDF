import json
import sys
from pathlib import Path
from typing import Any

from vivepdf.rpc.paths import PATH_MARKER
from vivepdf.rpc.schema import operation_schemas

MANIFEST_VERSION = 1
ANY_ITEM = "*"
ANY_DEPTH = "**"
IN_PLACE_KEY = "inPlace"
COMBINATORS = ("anyOf", "oneOf", "allOf")

Pattern = tuple[str, ...]


class ManifestError(ValueError):
    pass


def _definition(node: dict[str, Any], definitions: dict[str, Any]) -> tuple[str | None, dict]:
    reference = node.get("$ref")
    if reference is None:
        return None, node
    name = reference.rsplit("/", 1)[-1]
    if name not in definitions:
        raise ManifestError(f"unknown schema reference {reference}")
    return name, definitions[name]


class _Collector:
    def __init__(
        self, method: str, definitions: dict[str, Any], expanding: frozenset[str] = frozenset()
    ) -> None:
        self.method = method
        self.definitions = definitions
        self.expanding = expanding
        self.kinds: dict[Pattern, str] = {}
        self.plain: set[Pattern] = set()

    def walk(self, node: dict[str, Any], pattern: Pattern, stack: dict[str, int]) -> None:
        name, node = _definition(node, self.definitions)
        if name is not None:
            if name in stack:
                self._recurse(name, pattern, stack)
                return
            stack = {**stack, name: len(pattern)}
        for combinator in COMBINATORS:
            for option in node.get(combinator, []):
                self.walk(option, pattern, stack)
        kind = node.get("type")
        if kind == "string":
            self._string(node, pattern)
        elif kind == "array":
            items = node.get("items")
            if isinstance(items, dict):
                self.walk(items, (*pattern, ANY_ITEM), stack)
            for item in node.get("prefixItems", []):
                self.walk(item, (*pattern, ANY_ITEM), stack)
        for key, child in node.get("properties", {}).items():
            self.walk(child, (*pattern, key), stack)
        extra = node.get("additionalProperties")
        if isinstance(extra, dict):
            self.walk(extra, (*pattern, ANY_ITEM), stack)

    def _string(self, node: dict[str, Any], pattern: Pattern) -> None:
        marker = node.get(PATH_MARKER)
        if marker is None or marker == "none":
            self.plain.add(pattern)
            return
        known = self.kinds.get(pattern)
        if known is not None and known != marker:
            raise ManifestError(
                f"{self.method}: {'/'.join(pattern)} is both {known} and {marker} path"
            )
        self.kinds[pattern] = marker

    def _recurse(self, name: str, pattern: Pattern, stack: dict[str, int]) -> None:
        if name in self.expanding:
            return
        start = stack[name]
        inner = _Collector(self.method, self.definitions, self.expanding | {name})
        inner.walk(self.definitions[name], (), {name: 0})
        prefix = (*pattern[:start], ANY_DEPTH)
        for suffix, kind in inner.kinds.items():
            self.kinds.setdefault((*prefix, *suffix), kind)

    def patterns(self) -> list[list[str]]:
        mixed = self.plain & set(self.kinds)
        if mixed:
            pointer = "/".join(sorted(mixed)[0])
            raise ManifestError(
                f"{self.method}: {pointer} is a path in one shape and text in another"
            )
        return [[*pattern, self.kinds[pattern]] for pattern in sorted(self.kinds)]


def _in_place_by_default(params: dict[str, Any]) -> bool:
    return params.get("properties", {}).get(IN_PLACE_KEY, {}).get("default") is True


def build_manifest() -> dict[str, Any]:
    operations: dict[str, list[list[str]]] = {}
    in_place_by_default: list[str] = []
    for method, schema in sorted(operation_schemas().items()):
        params = schema["params"]
        collector = _Collector(method, params.get("$defs", {}))
        collector.walk(params, (), {})
        operations[method] = collector.patterns()
        if _in_place_by_default(params):
            in_place_by_default.append(method)
    return {
        "version": MANIFEST_VERSION,
        "operations": operations,
        "inPlaceByDefault": in_place_by_default,
    }


def render(manifest: dict[str, Any]) -> str:
    return json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def main() -> None:
    text = render(build_manifest())
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(text, encoding="utf-8", newline="\n")
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
